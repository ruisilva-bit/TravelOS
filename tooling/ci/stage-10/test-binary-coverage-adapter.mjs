import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { captureSource } from "./candidate.mjs";
import { inspectBinaryCoverage } from "./binary-coverage-adapter.mjs";

function archive(entries) {
  const parts = [];
  for (const { name, body = "", type = "0" } of entries) {
    const data = Buffer.from(body);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    parts.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "stage10-binary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  return root;
}
async function inspect(root) {
  return inspectBinaryCoverage({ root, source: await captureSource(root) });
}
function pax(key, value) {
  const rest = ` ${key}=${value}\n`;
  let n = Buffer.byteLength(rest) + 1;
  while (Buffer.byteLength(rest) + String(n).length !== n)
    n = Buffer.byteLength(rest) + String(n).length;
  return `${n}${rest}`;
}

test("screens regular members after safe PAX and GNU path metadata", async (t) => {
  const root = await fixture(t);
  const email = ["person", "example.com"].join("@");
  const entries = [
    { name: "meta", type: "x", body: pax("mtime", "123.4") + pax("path", "safe.txt") },
    { name: "placeholder", body: email },
    { name: "meta", type: "L", body: "another.txt\0" },
    { name: "placeholder", body: "ordinary" },
  ];
  await writeFile(path.join(root, "data.tar.gz"), archive(entries));
  const result = await inspect(root);
  assert.equal(result.archives[0].status, "INSPECTED_HEURISTIC");
  assert.equal(result.findings[0].rule, "email-address");
});
test("rejects metadata path traversal and dangerous overrides", async (t) => {
  const root = await fixture(t);
  for (const entry of [
    { name: "meta", type: "x", body: pax("path", "../escape") },
    { name: "meta", type: "x", body: pax("size", "999") },
    { name: "meta", type: "x", body: pax("linkpath", "target") },
    { name: "meta", type: "L", body: "/absolute\0" },
    { name: "meta", type: "K", body: "target\0" },
    { name: "meta", type: "x", body: "broken" },
  ]) {
    await writeFile(
      path.join(root, "data.tar.gz"),
      archive([entry, { name: "safe", body: "ordinary" }]),
    );
    assert.equal((await inspect(root)).archives[0].status, "REJECTED");
  }
});

test("applies metadata paths to classification and retains prior findings on rejection", async (t) => {
  const root = await fixture(t);
  const email = ["person", "example.com"].join("@");
  await writeFile(
    path.join(root, "data.tar.gz"),
    archive([
      { name: "dir/", type: "5" },
      { name: "plain", body: email },
      { name: "meta", type: "x", body: pax("path", "nested.zip") },
      { name: "placeholder", body: "ordinary" },
      { name: "meta", type: "x", body: pax("path", "../escape") },
      { name: "safe", body: "ordinary" },
    ]),
  );
  const report = await inspect(root);
  assert.equal(report.archives[0].status, "REJECTED");
  assert.equal(report.findings[0].rule, "email-address");
  assert.equal(report.unsupported[0].format, "binary-or-encoded-member");
});
test("rejects dangling and global path metadata", async (t) => {
  const root = await fixture(t);
  for (const entries of [
    [{ name: "meta", type: "x", body: pax("mtime", "123") }],
    [{ name: "meta", type: "g", body: pax("path", "safe") }, { name: "safe" }],
  ]) {
    await writeFile(path.join(root, "data.tar.gz"), archive(entries));
    assert.equal((await inspect(root)).archives[0].status, "REJECTED");
  }
});

test("inventories and screens tar members without disclosing member names or values", async (t) => {
  const root = await fixture(t);
  const sensitive = ["person", "example.com"].join("@");
  await writeFile(
    path.join(root, "data.tar.gz"),
    archive([{ name: "private.txt", body: sensitive }]),
  );
  const report = await inspect(root);
  assert.equal(report.result, "INCOMPLETE");
  assert.equal(report.archives[0].members, 1);
  assert.equal(report.findings[0].rule, "email-address");
  assert.equal(JSON.stringify(report).includes(sensitive), false);
  assert.equal(JSON.stringify(report).includes("private.txt"), false);
});
test("rejects unsafe tar paths and links", async (t) => {
  const root = await fixture(t);
  for (const entry of [
    { name: "../escape" },
    { name: "/absolute" },
    { name: "safe", type: "2" },
    { name: "safe", type: "1" },
  ]) {
    await writeFile(path.join(root, "data.tar.gz"), archive([entry]));
    const report = await inspect(root);
    assert.equal(report.archives[0].status, "REJECTED");
  }
});
test("marks PNG and pyc unsupported, never as inspected", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "a.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await writeFile(path.join(root, "a.pyc"), Buffer.from([1, 2, 3]));
  const report = await inspect(root);
  assert.equal(report.result, "INCOMPLETE");
  assert.deepEqual(report.unsupported.map((x) => x.format).sort(), ["png", "pyc"]);
});
test("rejects compressed output beyond bounded limits and malformed archives", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "data.tar.gz"), gzipSync(Buffer.alloc(33 * 1024 * 1024)));
  assert.equal((await inspect(root)).archives[0].status, "REJECTED");
  await writeFile(path.join(root, "data.tar.gz"), Buffer.from("bad"));
  assert.equal((await inspect(root)).archives[0].status, "REJECTED");
});
test("rejects stale capture and accounts for non-archive files", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "x.txt"), "ordinary");
  const source = await captureSource(root);
  const report = await inspectBinaryCoverage({ root, source });
  assert.equal(report.files.length, 1);
  await writeFile(path.join(root, "x.txt"), "different");
  await assert.rejects(inspectBinaryCoverage({ root, source }), /drift/i);
});
