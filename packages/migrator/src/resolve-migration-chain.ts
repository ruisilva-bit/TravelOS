import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MigrationChainPaths {
  readonly directory: string;
  readonly checksumManifestPath: string;
}

export const resolveMigrationChainPaths = (moduleUrl = import.meta.url): MigrationChainPaths => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../../../..");
  const directory = path.join(packageRoot, "migrations");
  return {
    directory,
    checksumManifestPath: path.join(directory, "checksums.json"),
  };
};
