import { readFile } from "node:fs/promises";

import {
  parseDevelopmentInstanceManifest,
  type DevelopmentInstanceManifest,
} from "./instance-manifest.js";

export const loadDevelopmentInstanceManifest = async (
  manifestPath: string,
): Promise<DevelopmentInstanceManifest> => {
  const raw = await readFile(manifestPath, "utf8");
  return parseDevelopmentInstanceManifest(JSON.parse(raw) as unknown);
};
