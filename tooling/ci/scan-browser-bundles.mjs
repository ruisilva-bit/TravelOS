import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { browserLeakageRules, scanSensitiveText } from "./sensitive-data-scanner.mjs";

const root = process.cwd();
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const findings = [];
const bundleResults = [];

for (const app of ["admin-web", "portal-web"]) {
  const directory = path.join(root, "apps", app, "dist");
  const files = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files.push(absolute);
    }
  };
  await walk(directory);
  if (files.length === 0) throw new Error(`${app} has no built browser files to scan`);
  for (const filePath of files.sort()) {
    const content = await readFile(filePath);
    const text = content.toString("utf8");
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    const result = scanSensitiveText({
      text,
      file: relativePath,
      additionalRules: browserLeakageRules,
    });
    findings.push(...result.findings.map((finding) => ({ app, ...finding })));
    bundleResults.push({
      app,
      file: relativePath,
      bytes: (await stat(filePath)).size,
      sha256: sha256(content),
    });
  }
}
console.log(
  JSON.stringify(
    {
      schemaVersion: 2,
      result: findings.length === 0 ? "PASS" : "FAIL",
      bundlesScanned: bundleResults,
      findings,
      matchedValuesEmitted: false,
    },
    null,
    2,
  ),
);
if (findings.length !== 0) process.exit(1);
