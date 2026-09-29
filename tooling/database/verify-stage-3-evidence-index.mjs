import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { verifyStage3EvidenceIndex } from "./stage-3-evidence-contract.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const verification = await verifyStage3EvidenceIndex({ root: repositoryRoot });
console.log(JSON.stringify(verification, null, 2));
if (verification.result !== "PASS") process.exit(1);
