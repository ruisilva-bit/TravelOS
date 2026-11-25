import assert from "node:assert/strict";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { TextDecoder } from "node:util";
import { captureSource } from "./candidate.mjs";
import { digest, regularBytes, sha256, strictOptions } from "./io.mjs";
import { scanSensitiveText } from "../sensitive-data-scanner.mjs";

// Conservative fixed budgets; this supplemental local check cannot grant privacy approval.
const MAX_COMPRESSED = 16 * 1024 * 1024;
const MAX_EXPANDED = 32 * 1024 * 1024;
const MAX_MEMBER = 4 * 1024 * 1024;
const MAX_MEMBERS = 2000;
const decoder = new TextDecoder("utf-8", { fatal: true });
const field = (b) =>
  b.subarray(0, Math.max(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0))).toString("utf8");
function octal(b) {
  const s = field(b).trim();
  if (!/^[0-7]+$/.test(s)) throw Error("invalid header");
  const n = Number.parseInt(s, 8);
  if (!Number.isSafeInteger(n)) throw Error("invalid header");
  return n;
}
function safePath(value) {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").includes("..") ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw Error("unsafe path");
  return value;
}
function paxPath(content, global) {
  let offset = 0,
    pathValue;
  const seen = new Set();
  while (offset < content.length) {
    const space = content.indexOf(32, offset);
    if (space < 0) throw Error("invalid metadata");
    const lengthText = content.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/.test(lengthText)) throw Error("invalid metadata");
    const length = Number(lengthText),
      end = offset + length;
    if (
      !Number.isSafeInteger(length) ||
      end > content.length ||
      end <= space + 2 ||
      content[end - 1] !== 10
    )
      throw Error("invalid metadata");
    let record;
    try {
      record = decoder.decode(content.subarray(space + 1, end - 1));
    } catch {
      throw Error("invalid metadata");
    }
    const equal = record.indexOf("=");
    if (equal < 1) throw Error("invalid metadata");
    const key = record.slice(0, equal),
      value = record.slice(equal + 1);
    if (seen.has(key)) throw Error("invalid metadata");
    seen.add(key);
    if (key === "path" && !global) pathValue = safePath(value);
    else if (key === "mtime" && /^-?\d+(?:\.\d+)?$/.test(value)) {
      /* inert timestamp */
    } else throw Error("unsupported metadata");
    offset = end;
  }
  if (!seen.size) throw Error("invalid metadata");
  return pathValue;
}
function inspectArchive(bytes, file) {
  const findings = [],
    unsupported = [];
  let members = 0;
  try {
    if (bytes.length > MAX_COMPRESSED) throw Error("compressed limit");
    const tar = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED });
    let offset = 0,
      ended = false,
      pendingPath,
      pendingMetadata = false;
    while (offset + 512 <= tar.length) {
      const h = tar.subarray(offset, offset + 512);
      offset += 512;
      if (h.every((x) => x === 0)) {
        if (offset + 512 > tar.length || !tar.subarray(offset).every((x) => x === 0))
          throw Error("invalid end");
        if (pendingMetadata) throw Error("invalid metadata");
        ended = true;
        break;
      }
      if (++members > MAX_MEMBERS) throw Error("member count limit");
      const checksum = octal(h.subarray(148, 156));
      let actual = 0;
      for (let i = 0; i < 512; i++) actual += i >= 148 && i < 156 ? 32 : h[i];
      if (checksum !== actual) throw Error("checksum");
      const name = field(h.subarray(0, 100)),
        prefix = field(h.subarray(345, 500));
      let full = safePath(prefix ? `${prefix}/${name}` : name);
      const type = h[156];
      if (![0, 48, 53, 120, 103, 76].includes(type))
        throw Error("unsupported or unsafe member type");
      const size = octal(h.subarray(124, 136));
      if (size > MAX_MEMBER || (type === 53 && size !== 0)) throw Error("member size limit");
      const padded = Math.ceil(size / 512) * 512;
      if (offset + padded > tar.length) throw Error("truncated member");
      if ([120, 103, 76].includes(type)) {
        if (pendingMetadata) throw Error("invalid metadata");
        const content = tar.subarray(offset, offset + size);
        if (type === 76) {
          if (
            content.length < 2 ||
            content[content.length - 1] !== 0 ||
            content.subarray(0, -1).includes(0)
          )
            throw Error("invalid metadata");
          try {
            pendingPath = safePath(decoder.decode(content.subarray(0, -1)));
          } catch {
            throw Error("invalid metadata");
          }
        } else pendingPath = paxPath(content, type === 103);
        pendingMetadata = type !== 103;
      } else {
        if (pendingPath !== undefined) full = pendingPath;
        pendingPath = undefined;
        pendingMetadata = false;
      }
      if (type === 0 || type === 48) {
        const content = tar.subarray(offset, offset + size);
        const label = `${file}#member-${members}`;
        let text;
        try {
          if (
            content.includes(0) ||
            (content[0] === 0x1f && content[1] === 0x8b) ||
            /\.(?:gz|zip|tar|png|pyc|jpg|jpeg|pdf)$/i.test(full)
          )
            throw Error("binary");
          text = decoder.decode(content);
        } catch {
          unsupported.push({ file: label, format: "binary-or-encoded-member" });
        }
        if (text !== undefined) findings.push(...scanSensitiveText({ text, file: label }).findings);
      }
      offset += padded;
    }
    if (!ended) throw Error("missing tar terminator");
    return {
      archive: { file, status: unsupported.length ? "INCOMPLETE" : "INSPECTED_HEURISTIC", members },
      findings,
      unsupported,
    };
  } catch (error) {
    // Use a fixed vocabulary only; parser and zlib diagnostics may contain data.
    const reasons = new Set([
      "compressed limit",
      "member count limit",
      "member size limit",
      "invalid header",
      "invalid end",
      "checksum",
      "unsafe path",
      "unsupported or unsafe member type",
      "unsupported metadata",
      "invalid metadata",
      "truncated member",
      "missing tar terminator",
    ]);
    const reason = reasons.has(error.message)
      ? error.message
      : "invalid or oversized compressed data";
    // Partial findings are retained; rejecting a member cannot suppress earlier hits.
    return { archive: { file, status: "REJECTED", members, reason }, findings, unsupported };
  }
}

export async function inspectBinaryCoverage(options) {
  strictOptions(options, ["root", "source"]);
  const { root, source } = options;
  assert.deepEqual(await captureSource(root), source, "Frozen source drift before inspection");
  const archives = [],
    unsupported = [],
    findings = [];
  for (const row of source.files) {
    const bytes = await regularBytes(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes, "Frozen source drift");
    assert.equal(sha256(bytes), row.sha256, "Frozen source drift");
    if (/\.tar\.gz$/i.test(row.path)) {
      const result = inspectArchive(bytes, row.path);
      archives.push(result.archive);
      unsupported.push(...result.unsupported);
      findings.push(...result.findings);
    } else if (
      /\.png$/i.test(row.path) ||
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      unsupported.push({ file: row.path, format: "png" });
    } else if (/\.pyc$/i.test(row.path)) {
      unsupported.push({ file: row.path, format: "pyc" });
    } else {
      // Non-archive inputs remain in the unchanged companion source scan's scope.
      unsupported.push({ file: row.path, format: "outside-binary-adapter" });
    }
  }
  assert.deepEqual(await captureSource(root), source, "Frozen source drift after inspection");
  return {
    schemaVersion: 1,
    result: "INCOMPLETE",
    authority: "LOCAL_SCAN_ONLY_NOT_PRIVACY_REVIEW",
    limitations:
      "Supplemental heuristic archive screening only; not image inspection, complete binary inspection, or privacy review",
    sourceSha256: digest(source),
    files: source.files,
    archives,
    unsupported,
    findings,
  };
}
