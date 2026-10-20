export const RUNTIME_ACCEPTANCE_FIXTURE_RUN_STATES = [
  "OPEN",
  "CLEANUP_PENDING",
  "CLEANED",
] as const;

export type RuntimeAcceptanceFixtureRunState =
  (typeof RUNTIME_ACCEPTANCE_FIXTURE_RUN_STATES)[number];
