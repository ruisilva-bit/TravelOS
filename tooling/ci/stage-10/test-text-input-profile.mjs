import assert from "node:assert/strict";
import test from "node:test";
import { decodeSupportedTextInput } from "./text-input-profile.mjs";

for (const name of [
  "opaque.bin",
  "opaque.dat",
  "image.png",
  "archive.zip",
  "unknown",
  ".gitignore.bin",
])
  test(`rejects unknown or binary format despite valid UTF-8: ${name}`, () => {
    assert.throws(
      () => decodeSupportedTextInput(name, Buffer.from("opaque payload")),
      /Unsupported text input format/,
    );
  });
test("permits supported text and exact extensionless names", () => {
  for (const name of ["source.mjs", "report.md", ".gitignore"])
    assert.equal(decodeSupportedTextInput(name, Buffer.from("synthetic text")), "synthetic text");
});
test("rejects NUL and malformed UTF-8 inside supported text formats", () => {
  assert.throws(() => decodeSupportedTextInput("source.mjs", Buffer.from([0])));
  assert.throws(() => decodeSupportedTextInput("report.md", Buffer.from([255])));
});
