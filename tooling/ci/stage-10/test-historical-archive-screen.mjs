import assert from "node:assert/strict";
import {
  inspectHistoricalArchives,
  readHistoricalTextMember,
  _screenFixture,
} from "./historical-archive-screen.mjs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

function member(name, value = "", type = "0") {
  const b = Buffer.from(value),
    h = Buffer.alloc(512),
    put = (s, i, n) => h.write(s, i, n, "ascii");
  put(name, 0, 100);
  put("0000644\0", 100, 8);
  put("0000000\0", 108, 8);
  put("0000000\0", 116, 8);
  put(b.length.toString(8).padStart(11, "0") + "\0", 124, 12);
  put("00000000000\0", 136, 12);
  h.fill(32, 148, 156);
  put(type, 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  const checksum = h.reduce((a, x) => a + x, 0);
  put(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return Buffer.concat([h, b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
}
const archive = (...members) => gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]));
const bad = (bytes, reason) =>
  assert.ok(_screenFixture(bytes).archives.some((a) => a.reason === reason));
bad(archive(member("../escape")), "unsafe path");
bad(archive(member("/absolute")), "unsafe path");
bad(archive(member("link", "", "2")), "unsupported or unsafe member type");
bad(archive(member("same"), member("./same")), "duplicate or empty path");
let deep = archive(member("leaf"));
for (let i = 0; i < 7; i++) deep = archive(member("nested.tar.gz", deep));
bad(deep, "depth limit");
bad(gzipSync(Buffer.alloc(256 * 1024 * 1024 + 1)), "invalid or oversized compressed data");
bad(Buffer.alloc(64 * 1024 * 1024 + 1), "compressed limit");
bad(archive(...Array.from({ length: 20001 }, (_, i) => member(`f${i}`))), "member count limit");
assert.equal(
  _screenFixture(archive(member("large", Buffer.alloc(4 * 1024 * 1024 + 1)))).unsupported[0].format,
  "oversized-member",
);
assert.equal(
  _screenFixture(archive(member("image.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))))
    .unsupported[0].format,
  "png",
);
const partial = _screenFixture(
  archive(member("found.txt", "test@example.com\n"), member("../escape")),
);
assert.equal(partial.findings.length, 1);
assert.equal(partial.archives[0].reason, "unsafe path");
assert.ok(!JSON.stringify(partial).includes("test@example.com"));

const result = await inspectHistoricalArchives({ root: process.cwd() });
assert.equal(result.authority, "LOCAL_SCAN_ONLY_NOT_PRIVACY_REVIEW");
assert.equal(result.result, "INCOMPLETE");
assert.equal(result.roots.length, 19);
assert.equal(new Set(result.roots.map((r) => r.sha256)).size, 4);
assert.ok(result.expandedBytes <= 512 * 1024 * 1024);
assert.ok(result.findings.every((f) => f.memberSha256 && f.lineSha256 && f.rule && f.line));
assert.ok(result.archives.every((a) => a.status !== "REJECTED"));
const f = result.findings[0],
  rootSha256 = f.ref.split("#")[0];
const content = await readHistoricalTextMember({ root: process.cwd(), rootSha256, ref: f.ref });
assert.equal(createHash("sha256").update(content).digest("hex"), f.memberSha256);
await assert.rejects(
  readHistoricalTextMember({ root: process.cwd(), rootSha256: "0".repeat(64), ref: f.ref }),
);
console.log(
  JSON.stringify({
    roots: result.roots.length,
    uniqueRoots: 4,
    archives: result.archives.length,
    rejected: result.archives.filter((a) => a.status === "REJECTED").length,
    expandedBytes: result.expandedBytes,
    findings: result.findings.length,
    unsupported: result.unsupported.length,
  }),
);
