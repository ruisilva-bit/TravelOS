import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as backendCore from "@travelos/backend-core";
import * as database from "../../../packages/database/src/index.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const require = createRequire(path.join(repositoryRoot, "apps/admin-api/test/package-probe.cjs"));

const packageExportPaths = async (relativeManifestPath: string): Promise<string[]> => {
  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, relativeManifestPath), "utf8"),
  ) as { readonly exports: Readonly<Record<string, unknown>> };
  return Object.keys(manifest.exports).sort();
};

const expectPackageSubpathDenied = (specifier: string): void => {
  let resolutionError: unknown;
  try {
    require.resolve(specifier);
  } catch (error) {
    resolutionError = error;
  }
  expect(resolutionError).toMatchObject({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
};

describe("Stage 5 application authorization boundary", () => {
  it("exposes only the authorization-enforcing M1 application and database factories", () => {
    expect(backendCore).toHaveProperty("createM1StaffTripOperations");
    expect(database).toHaveProperty("createPostgresM1StaffTripOperations");

    for (const rawUseCase of [
      "createM1TripSlice",
      "readM1TripSlice",
      "updateM1Accommodation",
      "updateM1InternalSupplierNote",
    ]) {
      expect(backendCore).not.toHaveProperty(rawUseCase);
    }
    expect(database).not.toHaveProperty("createM1OperationalSliceRepository");
  });

  it("limits package subpaths so unguarded use cases and repositories cannot be imported", async () => {
    await expect(packageExportPaths("packages/backend-core/package.json")).resolves.toEqual(["."]);
    await expect(packageExportPaths("packages/database/package.json")).resolves.toEqual(["."]);
    expectPackageSubpathDenied(
      "@travelos/backend-core/modules/trip-operations/application/m1-trip-slice.js",
    );
    expectPackageSubpathDenied(
      "@travelos/database/trip-operations/m1-operational-slice-repository.js",
    );
  });
});
