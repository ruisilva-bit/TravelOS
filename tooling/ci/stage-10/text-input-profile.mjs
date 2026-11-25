import path from "node:path";
import { TextDecoder } from "node:util";

// Supported source formats, not a claim that UTF-8 proves privacy clearance.
// Unknown formats require explicit inspection even when their bytes are ASCII.
const suffixes = new Set([
  ".md",
  ".json",
  ".mjs",
  ".py",
  ".c",
  ".in",
  ".service",
  ".timer",
  ".ts",
  ".yml",
  ".html",
  ".tsx",
  ".css",
  ".sql",
  ".conf",
  ".log",
  ".txt",
  ".cjs",
  ".yaml",
  ".sh",
]);
const names = new Set([
  ".gitattributes",
  ".gitignore",
  ".node-version",
  ".npmrc",
  ".prettierignore",
  "stage10-ct200-known-hosts",
  "Caddyfile.stage9-development",
]);
const decoder = new TextDecoder("utf-8", { fatal: true });

export function decodeSupportedTextInput(name, bytes) {
  if (
    !suffixes.has(path.posix.extname(name).toLowerCase()) &&
    !names.has(path.posix.basename(name))
  )
    throw new Error("Unsupported text input format");
  if (bytes.includes(0)) throw new Error("Binary content in text input");
  return decoder.decode(bytes);
}
