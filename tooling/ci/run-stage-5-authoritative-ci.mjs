import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * FINAL-9 is a rejected, tagged historical candidate. Its sole authorized
 * authoritative CI invocation was consumed before the independent NO-GO.
 * The original runner remains in the rejected tag; this live entry point is a
 * deliberate fail-closed tombstone so it cannot be used to mutate that history.
 */
export const FINAL9_AUTHORITATIVE_CI_SUPERSEDED_MESSAGE =
  "FINAL-9 authoritative CI is permanently superseded; use the FINAL-10 runner only.";

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) throw new Error(FINAL9_AUTHORITATIVE_CI_SUPERSEDED_MESSAGE);
