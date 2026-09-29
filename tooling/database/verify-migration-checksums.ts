import path from "node:path";

import { verifyMigrationChain } from "./migration-runner.js";

const result = await verifyMigrationChain({
  directory: path.resolve("migrations"),
  checksumManifestPath: path.resolve("migrations/checksums.json"),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
