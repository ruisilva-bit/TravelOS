import { readFile, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { TextDecoder } from "node:util";
import { scanSensitiveText } from "../sensitive-data-scanner.mjs";
import { decodeSupportedTextInput } from "./text-input-profile.mjs";

// This profile is exclusively for the four immutable historical snapshots.
const ROOTS = new Map([
  ["34eb908dd48bfdd36aa6723f7812e8236c3f4e50c03d3a6be96c7afa53835cc9", 1104647],
  ["bab884c2013697ca2dc636175c59df6c029c113af49b4bb2b5bf2ee07bcf9466", 2618455],
  ["d99e715fc29a385cf345abcd88a2285c3560e6a7f277b4ce75dcb039fbd6738d", 33718227],
  ["7ba607c7750222cf81b86f318a8d44b882c9413108e88befc25ca3fd4e76abe5", 33554202],
]);
const MiB = 1024 * 1024,
  COMPRESSED = 64 * MiB,
  EXPANDED = 256 * MiB,
  TOTAL = 512 * MiB,
  FILES = 20000,
  DEPTH = 6,
  TEXT = 4 * MiB;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const decoder = new TextDecoder("utf-8", { fatal: true });
function field(b) {
  const i = b.indexOf(0);
  return decoder.decode(i < 0 ? b : b.subarray(0, i));
}
function octal(b) {
  const s = field(b).trim();
  if (!/^[0-7]+$/.test(s)) throw Error("invalid header");
  const n = parseInt(s, 8);
  if (!Number.isSafeInteger(n)) throw Error("invalid header");
  return n;
}
function safe(p) {
  if (
    !p ||
    p.startsWith("/") ||
    p.includes("\\") ||
    p.split("/").includes("..") ||
    [...p].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127)
  )
    throw Error("unsafe path");
  return p.replace(/\/+$/, "");
}
function pax(b, global) {
  let pos = 0,
    result;
  const keys = new Set();
  while (pos < b.length) {
    const s = b.indexOf(32, pos);
    if (s < 0) throw Error("invalid metadata");
    const ntext = b.subarray(pos, s).toString("ascii");
    if (!/^[1-9][0-9]*$/.test(ntext)) throw Error("invalid metadata");
    const end = pos + Number(ntext);
    if (!Number.isSafeInteger(end) || end > b.length || end <= s + 2 || b[end - 1] !== 10)
      throw Error("invalid metadata");
    const r = decoder.decode(b.subarray(s + 1, end - 1)),
      i = r.indexOf("=");
    if (i < 1) throw Error("invalid metadata");
    const k = r.slice(0, i),
      v = r.slice(i + 1);
    if (keys.has(k)) throw Error("invalid metadata");
    keys.add(k);
    if (k === "path" && !global) result = safe(v);
    else if (k === "mtime" && /^-?\d+(?:\.\d+)?$/.test(v)) {
      // Validated timestamp metadata does not change the effective member path.
    } else throw Error("unsupported metadata");
    pos = end;
  }
  if (!keys.size) throw Error("invalid metadata");
  return result;
}
function screen(roots, target, capture) {
  const result = {
    result: "INCOMPLETE",
    authority: "LOCAL_SCAN_ONLY_NOT_PRIVACY_REVIEW",
    roots: [],
    archives: [],
    findings: [],
    unsupported: [],
    expandedBytes: 0,
    members: 0,
  };
  const seen = new Map();
  function inspect(bytes, ref, depth) {
    const hash = sha(bytes);
    if (depth > DEPTH) {
      result.archives.push({
        sha256: hash,
        ref,
        aliases: [],
        status: "REJECTED",
        members: 0,
        expandedBytes: 0,
        reason: "depth limit",
      });
      return;
    }
    if (seen.has(hash)) {
      seen.get(hash).aliases.push(ref);
      return;
    }
    const entry = {
      sha256: hash,
      ref,
      aliases: [],
      status: "INSPECTED_HEURISTIC",
      members: 0,
      expandedBytes: 0,
    };
    seen.set(hash, entry);
    result.archives.push(entry);
    try {
      if (depth > DEPTH) throw Error("depth limit");
      if (bytes.length > COMPRESSED) throw Error("compressed limit");
      const remaining = TOTAL - result.expandedBytes;
      if (remaining <= 0) throw Error("total expanded limit");
      let tar;
      try {
        tar = gunzipSync(bytes, { maxOutputLength: Math.min(EXPANDED, remaining) });
      } catch {
        throw Error("invalid or oversized compressed data");
      }
      entry.expandedBytes = tar.length;
      result.expandedBytes += tar.length;
      let offset = 0,
        ended = false,
        pending,
        pendingMeta = false;
      const names = new Set();
      while (offset + 512 <= tar.length) {
        const h = tar.subarray(offset, offset + 512);
        offset += 512;
        if (h.every((x) => x === 0)) {
          if (
            offset + 512 > tar.length ||
            !tar.subarray(offset).every((x) => x === 0) ||
            pendingMeta
          )
            throw Error("invalid end");
          ended = true;
          break;
        }
        if (++result.members > FILES) throw Error("member count limit");
        entry.members++;
        let sum = 0;
        for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
        if (sum !== octal(h.subarray(148, 156))) throw Error("checksum");
        const name = field(h.subarray(0, 100)),
          prefix = field(h.subarray(345, 500));
        let full = safe(prefix ? `${prefix}/${name}` : name);
        const type = h[156],
          size = octal(h.subarray(124, 136));
        if (![0, 48, 53, 120, 103, 76].includes(type))
          throw Error("unsupported or unsafe member type");
        if (type === 53 && size !== 0) throw Error("invalid directory");
        const padded = Math.ceil(size / 512) * 512;
        if (offset + padded > tar.length) throw Error("truncated member");
        const content = tar.subarray(offset, offset + size);
        if ([120, 103, 76].includes(type)) {
          if (size > TEXT || pendingMeta) throw Error("invalid metadata");
          if (type === 76) {
            if (size < 2 || content[size - 1] !== 0 || content.subarray(0, -1).includes(0))
              throw Error("invalid metadata");
            pending = safe(decoder.decode(content.subarray(0, -1)));
          } else pending = pax(content, type === 103);
          pendingMeta = type !== 103;
        } else {
          if (pending !== undefined) full = pending;
          pending = undefined;
          pendingMeta = false;
          // Normalize benign dot components so aliases cannot evade duplicate detection.
          const canonical = full
            .split("/")
            .filter((p) => p && p !== ".")
            .join("/");
          if (!canonical || names.has(canonical)) throw Error("duplicate or empty path");
          names.add(canonical);
          if (type === 0 || type === 48) {
            const memberRef = `${hash}#member-${entry.members}`,
              memberSha256 = sha(content);
            if (content[0] === 0x1f && content[1] === 0x8b) {
              if (size > COMPRESSED) throw Error("compressed limit");
              inspect(content, memberRef, depth + 1);
            } else if (size > TEXT) {
              result.unsupported.push({
                ref: memberRef,
                sha256: memberSha256,
                format: "oversized-member",
              });
            } else {
              let text;
              try {
                text = decodeSupportedTextInput(full, content);
              } catch {
                result.unsupported.push({
                  ref: memberRef,
                  sha256: memberSha256,
                  format: content
                    .subarray(0, 8)
                    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                    ? "png"
                    : "binary-or-encoded-member",
                });
              }
              if (text !== undefined) {
                if (memberRef === target) capture.value = Buffer.from(content);
                const lines = text.split("\n");
                for (const f of scanSensitiveText({ text, file: memberRef }).findings)
                  result.findings.push({
                    ref: memberRef,
                    line: f.line,
                    rule: f.rule,
                    memberSha256,
                    lineSha256: sha(Buffer.from(lines[f.line - 1])),
                  });
              }
            }
          }
        }
        offset += padded;
      }
      if (!ended) throw Error("missing tar terminator");
    } catch (e) {
      const reasons = new Set([
        "depth limit",
        "compressed limit",
        "total expanded limit",
        "invalid or oversized compressed data",
        "member count limit",
        "invalid header",
        "checksum",
        "invalid directory",
        "truncated member",
        "unsupported or unsafe member type",
        "invalid metadata",
        "unsupported metadata",
        "unsafe path",
        "duplicate or empty path",
        "invalid end",
        "missing tar terminator",
      ]);
      entry.status = "REJECTED";
      entry.reason = reasons.has(e.message) ? e.message : "invalid metadata or encoding";
    }
  }
  for (const root of roots) {
    result.roots.push({ path: root.path, sha256: sha(root.bytes) });
    inspect(root.bytes, root.path, 0);
  }
  return result;
}
async function loadRoots(root) {
  const names = execFileSync("git", ["ls-files", "-z", "--", "*.tar.gz"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  if (names.length !== 19) throw Error("historical archive inventory mismatch");
  const roots = [];
  for (const name of names) {
    if (!name.startsWith("docs/evidence/phase-1-m1/"))
      throw Error("historical archive inventory mismatch");
    const p = path.join(root, name),
      st = await lstat(p);
    if (!st.isFile() || st.size > COMPRESSED) throw Error("invalid root archive");
    const bytes = await readFile(p),
      hash = sha(bytes);
    if (ROOTS.get(hash) !== bytes.length) throw Error("root archive not authorized");
    roots.push({ path: name, bytes });
  }
  if (new Set(roots.map((r) => sha(r.bytes))).size !== 4)
    throw Error("historical archive inventory mismatch");
  return roots;
}
export async function inspectHistoricalArchives({ root }) {
  return screen(await loadRoots(root));
}
// Restricted content access for independent review: root hash and logical member reference
// must both be valid, and every archive encountered must validate before bytes return.
export async function readHistoricalTextMember({ root, rootSha256, ref }) {
  if (!ROOTS.has(rootSha256) || !/^[0-9a-f]{64}#member-[1-9][0-9]*$/.test(ref))
    throw Error("invalid review reference");
  const roots = await loadRoots(root),
    selected = roots.find((r) => sha(r.bytes) === rootSha256),
    capture = {};
  const report = screen([selected], ref, capture);
  if (report.archives.some((a) => a.status === "REJECTED") || !capture.value)
    throw Error("unavailable review reference");
  return capture.value;
}
// Fixture-only seam; it is not used by the historical profile or exposed as a CLI.
export function _screenFixture(bytes) {
  return screen([{ path: "fixture", bytes }]);
}
