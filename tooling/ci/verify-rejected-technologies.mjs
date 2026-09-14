import { verifyRejectedTechnologyRepository } from "./rejected-technology-policy.mjs";

const report = await verifyRejectedTechnologyRepository();
console.log(JSON.stringify(report, null, 2));
if (report.result !== "PASS") process.exit(1);
