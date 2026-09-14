import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath, URL } from "node:url";

import { createDevelopmentInstanceManifestJsonSchemaDocument } from "../../packages/config/src/index.js";

const outputPath = fileURLToPath(
  new URL("../../deploy/manifests/schema/instance-manifest.schema.json", import.meta.url),
);
const document = createDevelopmentInstanceManifestJsonSchemaDocument();
const serialized = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8");
  if (current !== serialized) {
    throw new Error("Generated instance-manifest JSON Schema is out of date");
  }
  console.log(JSON.stringify({ schemaVersion: 1, result: "PASS", generatedSchemaCurrent: true }));
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  console.log(JSON.stringify({ schemaVersion: 1, result: "PASS", generatedSchemaWritten: true }));
}
