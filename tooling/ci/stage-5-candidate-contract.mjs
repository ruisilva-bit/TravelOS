export const STAGE5_FINAL10_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-10";
export const STAGE5_FINAL10_EVIDENCE_INDEX = `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL10_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_10_CORRECTION_MATRIX.json";
export const STAGE5_FINAL10_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_10_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL10_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_10_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL10_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/post-freeze-scan-reports/STAGE_5_FINAL_10.json";
export const STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT = `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/final8-independent-review.json`;
export const STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT = `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/final9-independent-review.md`;
export const STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT = `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/final9-rejected-tag.json`;

export const STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    "auth-bridge-tests.json",
    "auth-bridge-tests.log",
    "ci-verify.log",
    "ci-verify-execution.json",
    "disposable-cleanup.json",
    "final8-independent-review.json",
    "final9-independent-review.md",
    "final9-rejected-tag.json",
    "focused-test-execution.json",
    "focused-tests.log",
    "integration-test-execution.json",
    "integration-tests.log",
    "migration-checksums.json",
    "package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "qualification-summary.json",
    "stage5-source-scope-test.log",
  ].toSorted(),
);

export const STAGE5_FINAL10_EXPECTED_FINAL8_REVIEW_FINDING_IDS = Object.freeze([
  "S5F8-HOST-001",
  "S5F8-AUTHZ-001",
  "S5F8-REVISION-GUC-001",
  "S5F8-CACHE-PREHANDLER-001",
  "S5F8-CACHE-OVERRIDE-001",
  "S5F8-CSRF-001",
  "S5F8-AUTH-PREFIX-001",
  "S5F8-AUTH-SCOPE-001",
  "S5F8-LOCKVERSION-001",
  "S5F8-ID-001",
  "S5F8-RESPONSE-COHERENCE-001",
  "S5F8-DEADLOCK-001",
  "S5F8-MULTIAGENCY-QUAL-001",
  "S5F8-SCAN-PROVENANCE-001",
  "S5F8-TEMPORAL-CONTRACT-001",
  "S5F8-MONEY-CANON-001",
  "S5F8-PERMISSION-DOC-001",
  "S5F8-INPUT-EVIDENCE-001",
  "S5F8-STALE-COST-EVIDENCE-001",
]);

export const STAGE5_FINAL10_EXPECTED_CARRIED_FINDING_IDS = Object.freeze([
  "S5F4-PRIMARY-001",
  "S5F4-TIME-001",
  "S5F4-INTERNAL-001",
  "S5F4-EVIDENCE-001",
  "S5F4-QUAL-001",
  "S5F5-PRIMARY-CARDINALITY-001",
  "S5F5-TIME-001",
  "S5F5-PRIMARY-TYPE-001",
  "S5F5-WORKSPACE-REVISION-001",
  "S5F5-MONEY-VALIDATION-001",
  "S5F6-EVIDENCE-PROVENANCE-001",
  "S5F6-EVIDENCE-COVERAGE-001",
  "S5F6-TIMEZONE-CONTRACT-PARITY-001",
  "S5F6-AUTH-REGISTRY-VERSION-001",
  "S5F6-PRIMARY-CONTINUITY-001",
  "S5F6-MONEY-NORMALIZATION-001",
  "S5F6-PRIMARY-REPARENT-QUAL-001",
  "S5F6-FOCUSED-TOOLCHAIN-ATTRIBUTION-001",
  "S5F7-PRIMARY-CONTINUITY-CONCURRENCY-001",
  "S5F7-WORKSPACE-REVISION-MONOTONICITY-001",
  "S5F7-WORKSPACE-REVISION-CHILD-FIRST-001",
  "S5F7-APPLICATION-INPUT-COMPLETENESS-001",
  "S5F7-TEMPORAL-RANGE-PARITY-001",
  "S5F7-SOURCE-SCAN-ORDER-001",
  "S5F7-ADJUDICATION-PROVENANCE-001",
  "S5F7-AUTH-CACHE-001",
]);

export const STAGE5_FINAL10_EXPECTED_FINAL9_REVIEW_FINDING_IDS = Object.freeze([
  "S5F9-SEC-001",
  "S5F9-DATA-DEADLOCK-HTTP-E2E-001",
  "S5F9-EVID-CLOSURE-001",
]);

export const STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS = Object.freeze([
  ...STAGE5_FINAL10_EXPECTED_FINAL8_REVIEW_FINDING_IDS,
  ...STAGE5_FINAL10_EXPECTED_CARRIED_FINDING_IDS,
  ...STAGE5_FINAL10_EXPECTED_FINAL9_REVIEW_FINDING_IDS,
]);

export const STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256 =
  "d343aae5ea315cb524b5e0a4afb3f4b7b452827543def934f3c4825011d316d3";
export const STAGE5_FINAL8_FREEZE = "docs/reviews/phase-1-m1/STAGE_5_FINAL_8_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL8_EVIDENCE_INDEX =
  "docs/evidence/phase-1-m1/stage-5-final-8/EVIDENCE_INDEX.json";
export const STAGE5_FINAL8_INDEPENDENT_REVIEW_ARTIFACT =
  "docs/evidence/phase-1-m1/stage-5-final-9/final8-independent-review.json";
export const STAGE5_FINAL8_REJECTED_TAG = "phase-1-stage-5-final-8-rejected";
export const STAGE5_FINAL8_REJECTED_TAG_TARGET = "294657132bf8a5b47181efd90732d5d8f2530c8e";
export const STAGE5_FINAL8_FREEZE_SHA256 =
  "5ec2cc5313cb31e7ddec6349749e6cb5d3934ace1f5e6eff67715b05dd3dbf76";
export const STAGE5_FINAL8_FREEZE_AGGREGATE_SHA256 =
  "c6bfbf895e454268281e67099eb216b8d324b0776cdd8bbffe092bf6707fc0f4";
export const STAGE5_FINAL8_EVIDENCE_INDEX_SHA256 =
  "ef6cb9987c83928894ec2aa1f739ae8bfcbec297406b3d98f5f6f4ac1e9d5397";
export const STAGE5_FINAL8_EVIDENCE_AGGREGATE_SHA256 =
  "b706fdb79b606c8b302f7e8bd17531e7aebbac6d1dba5e966b885dc662c56351";

export const STAGE5_FINAL9_REJECTED_TAG = "phase-1-stage-5-final-9-rejected";
export const STAGE5_FINAL9_REJECTED_TAG_TARGET = "45207d6c58e24e57ea25eca69a694ab33a171cce";
export const STAGE5_FINAL9_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_9_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL9_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_9_CORRECTION_MATRIX.json";
export const STAGE5_FINAL9_INDEPENDENT_REVIEW =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_9_INDEPENDENT_REVIEW.md";
export const STAGE5_FINAL9_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-9";
export const STAGE5_FINAL9_EVIDENCE_INDEX = `${STAGE5_FINAL9_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL9_FREEZE_SHA256 =
  "641b05029e8888c529b01fe0e5805d4ae083a46b544bb1bdfcf1756e8126a33a";
export const STAGE5_FINAL9_FREEZE_AGGREGATE_SHA256 =
  "7acdfaa29d3cf24c632fa854389554900a10d7656d42f62a0875056210dba34e";
export const STAGE5_FINAL9_EVIDENCE_INDEX_SHA256 =
  "70118b0890d7c73fd9654c522d2d077930a6d23273f22cbb126d9a45d02284f7";
export const STAGE5_FINAL9_EVIDENCE_AGGREGATE_SHA256 =
  "0e61ffbda493b5cc18cd769b5d5b3352da54713898270948617a70bb4ceabc9f";

export const STAGE5_FINAL10_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL10_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL10_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";

export const STAGE5_FINAL10_REJECTED_TAG = "phase-1-stage-5-final-10-rejected";
export const STAGE5_FINAL10_REJECTED_TAG_TARGET = "27184b598ae2be2eaf35616d4a9b6c2e623ccd42";
export const STAGE5_FINAL10_REJECTION_RECORD =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_10_REJECTION_RECORD.md";
export const STAGE5_FINAL10_REJECTION_RECORD_SHA256 =
  "9c2c3c9e9fdd5c46cef5f04099bf804ec38f52c4133279f2a8ed26f188b659f8";
export const STAGE5_FINAL10_CORRECTION_MATRIX_PATH =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_10_CORRECTION_MATRIX.json";
export const STAGE5_FINAL10_CORRECTION_MATRIX_SHA256 =
  "eeaba1a4b4090c3245d2934cac9036dc5b7f380a2030bfd2791ab14d93c7e778";
export const STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX =
  "docs/evidence/phase-1-m1/stage-5-final-10/EVIDENCE_INDEX.json";
export const STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX_SHA256 =
  "885cc4946296eb79c056cf4e1b2ecb05ce2a948c8be139519af2f56fb4bf5b27";
export const STAGE5_FINAL10_CI_LOG = "docs/evidence/phase-1-m1/stage-5-final-10/ci-verify.log";
export const STAGE5_FINAL10_CI_LOG_SHA256 =
  "511223cac393ae64fb700b6b884cc4c468e74c377ac7502fc20cf53f10db1ad6";
export const STAGE5_FINAL10_CI_EXECUTION =
  "docs/evidence/phase-1-m1/stage-5-final-10/ci-verify-execution.json";
export const STAGE5_FINAL10_CI_EXECUTION_SHA256 =
  "09ee0779646e4c300c4408f1d527580d78f13e79220f6319f27c979aa9e5591b";
export const STAGE5_FINAL10_PHASE1_BASELINE_SHA256 =
  "a8769309d7708174419e94407d2d5226c6bd72b982856a831f3e7df5dbb27ceb";
export const STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256 =
  "5682673b28e8e47cd05a6b95af63fcc01370a966a588b308736d2669a3ccdefb";
export const STAGE5_FINAL10_PHASE1_BASELINE_PATH =
  "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json";
export const STAGE5_FINAL10_INVOCATION_GUARD_PATH =
  ".hermes/state/stage5-final10-ci-verify-invocation.json";
export const STAGE5_FINAL10_INVOCATION_GUARD_SHA256 =
  "ca2a2b7e9c9615c90c0bf87a9b34234ec31f228214d2bc892369e2a26ab001e8";

export const STAGE5_FINAL11_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-11";
export const STAGE5_FINAL11_EVIDENCE_INDEX = `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL11_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_11_CORRECTION_MATRIX.json";
export const STAGE5_FINAL11_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_11_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL11_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_11_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/post-freeze-scan-reports/STAGE_5_FINAL_11.json";
export const STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT = `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/final8-independent-review.json`;
export const STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT = `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/final9-independent-review.md`;
export const STAGE5_FINAL11_FINAL9_REJECTED_TAG_ARTIFACT = `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/final9-rejected-tag.json`;
export const STAGE5_FINAL11_FINAL10_REJECTED_TAG_ARTIFACT = `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/final10-rejected-tag.json`;
export const STAGE5_FINAL11_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL11_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final11-readiness-preflight.json";
export const STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final11-ci-verify-invocation.json";
export const STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    "auth-bridge-tests.json",
    "auth-bridge-tests.log",
    "baseline-generation.json",
    "ci-verify-execution.json",
    "ci-verify.log",
    "disposable-cleanup.json",
    "final10-ci-verify-execution.json",
    "final10-ci-verify.log",
    "final10-correction-matrix.json",
    "final10-pre-ci-evidence-index.json",
    "final10-rejected-tag.json",
    "final10-rejection-record.md",
    "final10-security-extension-baseline.json",
    "final8-independent-review.json",
    "final9-independent-review.md",
    "final9-rejected-tag.json",
    "focused-test-execution.json",
    "focused-tests.log",
    "integration-test-execution.json",
    "integration-tests.log",
    "migration-checksums.json",
    "package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "qualification-summary.json",
    "readiness-preflight.json",
    "security-extension-baseline.json",
    "stage5-source-scope-test.log",
  ].toSorted(),
);
export const STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS = Object.freeze([
  ...STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS,
]);
export const STAGE5_FINAL11_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-11 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL11_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-11",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL11_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";

export const STAGE5_FINAL11_REJECTION_RECORD =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_11_REJECTION_RECORD.md";
export const STAGE5_FINAL11_CI_LOG = `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/ci-verify.log`;
export const STAGE5_FINAL11_CI_EXECUTION = `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/ci-verify-execution.json`;
export const STAGE5_FINAL11_CI_FAILED_EVIDENCE_INDEX = STAGE5_FINAL11_EVIDENCE_INDEX;
export const STAGE5_FINAL11_INVOCATION_GUARD_PATH =
  ".hermes/state/stage5-final11-ci-verify-invocation.json";
export const STAGE5_FINAL11_CI_LOG_SHA256 =
  "6e686ec0cf07bee47a155a5fc167f8ad9e55caa9ac2bb9564b755e90745db109";
export const STAGE5_FINAL11_CI_EXECUTION_SHA256 =
  "cfca7be8cb139bd32e4b43e6f7fb847b01b2042a217cec686b3234906a6d2cce";
export const STAGE5_FINAL11_CI_FAILED_INDEX_SHA256 =
  "620c4019206ffa97e8456cdb8e6fb3689d27ab1ae86720db5ccabb7e7269b46a";
export const STAGE5_FINAL11_INVOCATION_GUARD_SHA256 =
  "15a3d5fac1a61e1b354c88a53ca870a0a22d898a06c398622f908738bdf2f473";
export const STAGE5_FINAL11_SECURITY_BASELINE_SHA256 =
  "33aed369ec4346a517a969b60611c32583c69170d53c4c46dbb51c7c343282c7";
export const STAGE5_FINAL11_PRE_FORMAT_SNAPSHOT_SHA256 =
  "7da6175c438754c1eb296c70e041aed3f1dcd254801fb8405c7f33b15cbd2912";
export const STAGE5_FINAL11_REJECTION_RECORD_SHA256 =
  "1f98d609f47b5745639d51613de6420576d29dba038e18d55daf776bd467fdbf";
export const STAGE5_FINAL11_CORRECTION_MATRIX_SHA256 =
  "8a3faa17cb60d31765391db8135928632cd70de74a889428ae549125d0c0b175";
export const STAGE5_FINAL12_SECURITY_BASELINE_SHA256 =
  "9fdab6bd8c88c33ad492ca97ba294041b8754e4c465b95ef05a4f71e4d21893a";
export const STAGE5_FINAL12_CI_LOG_SHA256 =
  "4aae8ee4619ddf75ec89d4feaae0ab6a342b22f95cc638beca01d88ce5039aa5";
export const STAGE5_FINAL12_CI_EXECUTION_SHA256 =
  "c1fd59bbb7a1331507977bb8f874d9eb6416324b20e3b53d24d33f69db13c9e9";
export const STAGE5_FINAL12_CI_FAILED_INDEX_SHA256 =
  "b106f74abd4fee430eeb82c96751d660f0473cef7b03006a834764793236a73a";
export const STAGE5_FINAL12_INVOCATION_GUARD_SHA256 =
  "9f57c975cc393f19ec1cb1ea043ae9da5fb9e5159ac838b76705125cff7bb61c";
export const STAGE5_FINAL12_REJECTION_RECORD =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_12_REJECTION_RECORD.md";
export const STAGE5_FINAL12_REJECTION_RECORD_SHA256 =
  "e6849c2a884ed8d8fb19917bdddfcf023d1ff185e2c2fa8a513fbcd7d5e367c9";
export const STAGE5_FINAL12_REJECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_12_REJECTION_MATRIX.json";
export const STAGE5_FINAL12_REJECTION_MATRIX_SHA256 =
  "3c6bba735ef69651c9ea4609f97f0e0a78794193d3853a4bbdf1dab01cc66549";
export const STAGE5_FINAL12_CORRECTION_MATRIX_SHA256 =
  "d6fdd464ddaf27dd8f653cac18b20bd0399803e861843c179a477b00ecfea09f";
export const STAGE5_FINAL12_SNAPSHOT_SHA256 =
  "1842b9566a245e1e8fa1c9ceae836d11f9c8639ec32ce662be5c545400888320";

export const STAGE5_FINAL12_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-12";
export const STAGE5_FINAL12_EVIDENCE_INDEX = `${STAGE5_FINAL12_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL12_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_12_CORRECTION_MATRIX.json";
export const STAGE5_FINAL12_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_12_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL12_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_12_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL12_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL12_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL12_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final12-readiness-preflight.json";
export const STAGE5_FINAL12_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final12-ci-verify-invocation.json";
export const STAGE5_FINAL12_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-12 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL12_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-12",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL12_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
export const STAGE5_FINAL12_PREDECESSOR_EVIDENCE_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map((name) =>
      name === "security-extension-baseline.json"
        ? "final11-security-extension-baseline-verification.json"
        : `final11-${name}`,
    ),
    "final11-EVIDENCE_INDEX.json",
    "final11-invocation-guard.json",
    "final11-rejection-record.md",
    "final11-security-extension-baseline.json",
  ]
    .filter((name, index, all) => all.indexOf(name) === index)
    .toSorted(),
);
export const STAGE5_FINAL12_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL12_PREDECESSOR_EVIDENCE_NAMES,
    "final12-correction-matrix.json",
    "baseline-generation.json",
    "format-check.json",
    "format-check.log",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted(),
);

export const STAGE5_FINAL13_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-13";
export const STAGE5_FINAL13_EVIDENCE_INDEX = `${STAGE5_FINAL13_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL13_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_13_CORRECTION_MATRIX.json";
export const STAGE5_FINAL13_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_13_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL13_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_13_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL13_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL13_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL13_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final13-readiness-preflight.json";
export const STAGE5_FINAL13_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final13-ci-verify-invocation.json";
export const STAGE5_FINAL13_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-13 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL13_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-13",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL13_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
export const STAGE5_FINAL13_PREDECESSOR_EVIDENCE_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL12_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map((name) =>
      name === "security-extension-baseline.json"
        ? "final12-security-extension-baseline-verification.json"
        : `final12-${name}`,
    ),
    "final12-correction-matrix.json",
    "final12-EVIDENCE_INDEX.json",
    "final12-invocation-guard.json",
    "final12-rejection-record.md",
    "final12-rejection-matrix.json",
    "final12-security-extension-baseline.json",
  ]
    .filter((name, index, all) => all.indexOf(name) === index)
    .toSorted(),
);
export const STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL13_PREDECESSOR_EVIDENCE_NAMES,
    "final13-correction-matrix.json",
    "baseline-generation.json",
    "format-check.json",
    "format-check.log",
    "lint-check.json",
    "lint-check.log",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted(),
);

export const STAGE5_FINAL13_REVIEW_NO_GO =
  "docs/evidence/phase-1-m1/final13-scan-reports/STAGE_5_FINAL_13_INDEPENDENT_REVIEW_NO_GO.json";
export const STAGE5_FINAL13_REVIEW_NO_GO_SHA256 =
  "f800f37a60a0e83268b5ee22bf32e466cbd1c6168610eca508a7ea434481a0c5";
export const STAGE5_FINAL13_ARCHIVE_MANIFEST =
  "docs/evidence/phase-1-m1/final13-scan-reports/STAGE_5_FINAL_13_ARCHIVE_MANIFEST.json";
export const STAGE5_FINAL13_ARCHIVE_MANIFEST_SHA256 =
  "ccd3d4b157eb94968d1aef4a8ff4b391e747b49b7293537ff2fff5e622f07769";
export const STAGE5_FINAL13_SOURCE_ARCHIVE =
  "docs/evidence/phase-1-m1/final13-scan-reports/STAGE_5_FINAL_13_FROZEN_SOURCE_SNAPSHOT.tar.gz";
export const STAGE5_FINAL13_SOURCE_ARCHIVE_SHA256 =
  "34eb908dd48bfdd36aa6723f7812e8236c3f4e50c03d3a6be96c7afa53835cc9";
export const STAGE5_FINAL13_FREEZE_SHA256 =
  "ededb602b9b52db3696c5e896fd3350d87c83b7878e16c32d16b13402119be5a";
export const STAGE5_FINAL13_CORRECTION_MATRIX_SHA256 =
  "19cf6aed9b4dc5bb453441c53c89969be5a3d20b8d3db8bf76d94ae754c55342";
export const STAGE5_FINAL13_VALIDATION_SHA256 =
  "2f2f888edf259383747d128728b7adae8b55c082a803bf352d81e5dfa21c5e7f";
export const STAGE5_FINAL13_INDEX_SHA256 =
  "3896d13368b2688c583357f806cc79b62c06c20d6f9b7c4998c559d035eeb7f8";
export const STAGE5_FINAL13_SECURITY_BASELINE_SHA256 =
  "2fb65b6fa0d14875f9c756496f75b2b9fed3a446409295f5bdff46e5deae70cb";
export const STAGE5_FINAL14_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-14";
export const STAGE5_FINAL14_EVIDENCE_INDEX = `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL14_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_14_CORRECTION_MATRIX.json";
export const STAGE5_FINAL14_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_14_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL14_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_14_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL14_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL14_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final14-readiness-preflight.json";
export const STAGE5_FINAL14_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final14-ci-verify-invocation.json";
export const STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/final14-scan-reports/STAGE_5_FINAL_14_POST_FREEZE.json";
export const STAGE5_FINAL14_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-14 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL14_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-14",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL14_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
export const STAGE5_FINAL14_PREDECESSOR_EVIDENCE_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map((name) => `final13-${name}`),
    "final13-EVIDENCE_INDEX.json",
    "final13-correction-matrix.json",
    "final13-candidate-validation.md",
    "final13-candidate-freeze.md",
    "final13-independent-review-no-go.json",
    "final13-archive-manifest.json",
    "final13-frozen-source-snapshot.tar.gz",
    "final13-security-extension-baseline.json",
  ].toSorted(),
);
export const STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL14_PREDECESSOR_EVIDENCE_NAMES,
    "final14-correction-matrix.json",
    "finding-lineage.json",
    "baseline-generation.json",
    "format-check.json",
    "format-check.log",
    "lint-check.json",
    "lint-check.log",
    "postgresql-disposable-cleanup.json",
    "postgresql-integration-test-execution.json",
    "postgresql-integration-tests.log",
    "postgresql-package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "postgresql-qualification-execution.json",
    "postgresql-qualification-runner.log",
    "postgresql-qualification.json",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted(),
);

export const STAGE5_FINAL14_REVIEW_NO_GO =
  "docs/evidence/phase-1-m1/final14-scan-reports/STAGE_5_FINAL_14_INDEPENDENT_REVIEW_NO_GO.json";
export const STAGE5_FINAL14_REVIEW_NO_GO_SHA256 =
  "ff696612eb0776ca002b7042522e0f291a71f2fd7968ce787a95ab8afc1b5509";
export const STAGE5_FINAL14_ARCHIVE_MANIFEST =
  "docs/evidence/phase-1-m1/final14-scan-reports/STAGE_5_FINAL_14_ARCHIVE_MANIFEST.json";
export const STAGE5_FINAL14_ARCHIVE_MANIFEST_SHA256 =
  "7f4e660d04301dc61837f926b76a7bce4c5f2c418675396120b7876c2adc3493";
export const STAGE5_FINAL14_SOURCE_ARCHIVE =
  "docs/evidence/phase-1-m1/final14-scan-reports/STAGE_5_FINAL_14_FROZEN_SOURCE_SNAPSHOT.tar.gz";
export const STAGE5_FINAL14_SOURCE_ARCHIVE_SHA256 =
  "bab884c2013697ca2dc636175c59df6c029c113af49b4bb2b5bf2ee07bcf9466";
export const STAGE5_FINAL14_SECURITY_BASELINE_SHA256 =
  "a93a9b37ffa6923b7e06a66411551b3ce4f81cbefbb6ec5e37454a03327497d8";
export const STAGE5_FINAL15_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-15";
export const STAGE5_FINAL15_EVIDENCE_INDEX = `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL15_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_15_CORRECTION_MATRIX.json";
export const STAGE5_FINAL15_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_15_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL15_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_15_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL15_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL15_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final15-readiness-preflight.json";
export const STAGE5_FINAL15_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final15-ci-verify-invocation.json";
export const STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/final15-scan-reports/STAGE_5_FINAL_15_POST_FREEZE.json";
export const STAGE5_FINAL15_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-15 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL15_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-15",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL15_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
export const STAGE5_FINAL15_PREDECESSOR_EVIDENCE_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map((name) => `final14-${name}`),
    "final14-EVIDENCE_INDEX.json",
    "final14-correction-matrix.json",
    "final14-candidate-validation.md",
    "final14-candidate-freeze.md",
    "final14-independent-review-no-go.json",
    "final14-archive-manifest.json",
    "final14-frozen-source-snapshot.tar.gz",
    "final14-security-extension-baseline.json",
  ].toSorted(),
);
export const STAGE5_FINAL15_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL15_PREDECESSOR_EVIDENCE_NAMES,
    "final15-correction-matrix.json",
    "finding-lineage.json",
    "baseline-generation.json",
    "format-check.json",
    "format-check.log",
    "lint-check.json",
    "lint-check.log",
    "focused-test-execution.json",
    "focused-tests.log",
    "postgresql-disposable-cleanup.json",
    "postgresql-integration-test-execution.json",
    "postgresql-integration-tests.log",
    "postgresql-package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "postgresql-qualification-execution.json",
    "postgresql-qualification-runner.log",
    "postgresql-qualification.json",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted(),
);

export const STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256 =
  "5346753a67e853838b8132d8521c1cfad52b6825729e5bd1039609290e41dd02";
export const STAGE5_FINAL15_FAILURE_RECEIPT_SHA256 =
  "e86d4221ac72da2e5e9823839e3bbfb2962255fde48a7056afc8f256e049a247";
export const STAGE5_FINAL15_FAILURE_LOG_SHA256 =
  "3476f54c927e18b284d1e9e9983cfb37001da22b3b67aeedc323847f75ee8598";
export const STAGE5_FINAL15_BASELINE_FAILURE_RECEIPT =
  ".hermes/state/stage5-final15-baseline-generation-failure.json";
export const STAGE5_FINAL15_BASELINE_FAILURE_LOG =
  ".hermes/state/stage5-final15-baseline-generation-failure.log";
export const STAGE5_FINAL15_FAILED_BASELINE_COPY =
  ".hermes/state/stage5-final15-failed-security-extension-baseline.json";
export const STAGE5_FINAL15_SOURCE_INPUTS_MANIFEST =
  ".hermes/state/stage5-final15-source-inputs-manifest.json";
export const STAGE5_FINAL15_SOURCE_INPUTS = Object.freeze({
  packageJson: ".hermes/state/stage5-final15-source-inputs/package.json",
  runner:
    ".hermes/state/stage5-final15-source-inputs/tooling/ci/run-stage-5-final15-authoritative-ci.mjs",
  securityExtensionDocument:
    ".hermes/state/stage5-final15-source-inputs/docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
});
export const STAGE5_FINAL15_FAILED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  STAGE5_FINAL15_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
    (name) =>
      ![
        "baseline-generation.json",
        "format-check.json",
        "format-check.log",
        "lint-check.json",
        "lint-check.log",
      ].includes(name),
  ).toSorted(),
);

export const STAGE5_FINAL16_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-16";
export const STAGE5_FINAL16_EVIDENCE_INDEX = `${STAGE5_FINAL16_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL16_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_16_CORRECTION_MATRIX.json";
export const STAGE5_FINAL16_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_16_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL16_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_16_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL16_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL16_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL16_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final16-readiness-preflight.json";
export const STAGE5_FINAL16_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final16-ci-verify-invocation.json";
export const STAGE5_FINAL16_PRE_CI_FREEZE_GUARD =
  ".hermes/state/stage5-final16-pre-ci-freeze-guard.json";
export const STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/final16-scan-reports/STAGE_5_FINAL_16_POST_FREEZE.json";
export const STAGE5_FINAL16_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-16 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL16_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-16",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL16_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
export const STAGE5_FINAL16_PREDECESSOR_EVIDENCE_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map((name) => `final14-${name}`),
    "final14-EVIDENCE_INDEX.json",
    "final14-candidate-validation.md",
    "final14-candidate-freeze.md",
    "final14-correction-matrix.json",
    "final14-independent-review-no-go.json",
    "final14-archive-manifest.json",
    "final14-frozen-source-snapshot.tar.gz",
    "final14-security-extension-baseline.json",
    ...STAGE5_FINAL15_FAILED_EVIDENCE_ARTIFACT_NAMES.map((name) => `final15-${name}`),
    "final15-baseline-generation-failure.json",
    "final15-baseline-generation-failure.log",
    "final15-failed-security-extension-baseline.json",
    "final15-source-inputs-manifest.json",
    "final15-package.json",
    "final15-runner.mjs",
    "final15-security-extension-document.md",
  ].toSorted(),
);
export const STAGE5_FINAL16_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL16_PREDECESSOR_EVIDENCE_NAMES,
    "final16-correction-matrix.json",
    "finding-lineage.json",
    "baseline-generation.json",
    "baseline-generation-failure-01.json",
    "baseline-generation-failure-01.log",
    "baseline-generation-failure-02.json",
    "baseline-generation-failure-02.log",
    "evidence-preparation-failure-02.json",
    "evidence-preparation-failure-02.log",
    "evidence-preparation-failure-03.json",
    "evidence-preparation-failure-03.log",
    "format-check.json",
    "format-check.log",
    "lint-check.json",
    "lint-check.log",
    "focused-test-execution.json",
    "focused-tests.log",
    "postgresql-disposable-cleanup.json",
    "postgresql-integration-test-execution.json",
    "postgresql-integration-tests.log",
    "postgresql-package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "postgresql-qualification-execution.json",
    "postgresql-qualification-runner.log",
    "postgresql-qualification.json",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted(),
);

export const STAGE5_FINAL16_BASELINE_SHA256 =
  "a9ac910fc6275da9b3c957a6c280fa8eeb4b5bc03a383d935f08dde2662cdab5";
export const STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT =
  ".hermes/state/stage5-final16-preflight-failure.json";
export const STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG =
  ".hermes/state/stage5-final16-preflight-failure.log";
export const STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT_SHA256 =
  "febf0eacb4a193eae4a85fc681808549f9f67134e37af67aa021b8d06ded0a99";
export const STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG_SHA256 =
  "74b5bf57c7e3b35e5c68fd63ff36489bfc102fa446f4b6f37bb051ce1ed93176";
export const STAGE5_FINAL16_READINESS_SHA256 =
  "fd3c060bba288390aa9dc2e6f125c76a74a7164bdcccdead1c01cf376cdd907b";
export const STAGE5_FINAL16_EVIDENCE_INDEX_SHA256 =
  "dec1584cd914cb28b93bce7566b77c4ca7f549e33c75f73330cc22e767846bc3";
export const STAGE5_FINAL16_PACKAGE_SHA256 =
  "2dcaf47add95e5790d2956cec7f950e44f6217ba38a5460e9aae66e98d86ac46";
export const STAGE5_FINAL16_RUNNER_SHA256 =
  "925bef2cdfa6a8503bf2058d9f9fbcb24da596108c46c3fcc06fea61aa802d1d";
export const STAGE5_FINAL17_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-17";
export const STAGE5_FINAL17_EVIDENCE_INDEX = `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL17_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_17_CORRECTION_MATRIX.json";
export const STAGE5_FINAL17_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_17_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL17_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_17_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL17_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL17_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final17-readiness-preflight.json";
export const STAGE5_FINAL17_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final17-ci-verify-invocation.json";
export const STAGE5_FINAL17_PRE_CI_FREEZE_GUARD =
  ".hermes/state/stage5-final17-pre-ci-freeze-guard.json";
export const STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/final17-scan-reports/STAGE_5_FINAL_17_POST_FREEZE.json";
export const STAGE5_FINAL17_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-17 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL17_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-17",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL17_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
export const STAGE5_FINAL18_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-18";
export const STAGE5_FINAL18_EVIDENCE_INDEX = `${STAGE5_FINAL18_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL18_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_18_CORRECTION_MATRIX.json";
export const STAGE5_FINAL18_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_18_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL18_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_18_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/final18-scan-reports/STAGE_5_FINAL_18_POST_FREEZE.json";
export const STAGE5_FINAL17_SECURITY_BASELINE_SHA256 =
  "7378975380066e296df1f4617b2771d104a0697e87480f217638bdbe030b1802";
export const STAGE5_FINAL18_SECURITY_BASELINE_SHA256 =
  "be645da572d2b461daabe96fdd173334d7878e387859b6b00fd225c81c8b03fa";
export const STAGE5_FINAL18_EVIDENCE_INDEX_SHA256 =
  "5f68a3838f555de7beb6e35ee6a51e6f9f946b90e6ceb7cceae89d6383be7c13";
export const STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT =
  ".hermes/state/stage5-final18-preflight-failure-01.json";
export const STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT_SHA256 =
  "acac23cb56589cd9cfc565c555f358cab2cfa7e706fc062d0057ae831423ee43";
export const STAGE5_FINAL18_PREBASELINE_FINDING_LINEAGE_SHA256 =
  "17cf3a1643af12813eb265e023854fd579afac58eb47f64734a42558f3db390c";
export const STAGE5_FINAL17_EVIDENCE_INDEX_SHA256 =
  "240013b0927a9083f744c48983c619b8aa2379e1f14c995259009acd1169e4e6";
export const STAGE5_FINAL18_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL18_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL18_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final18-readiness-preflight.json";
export const STAGE5_FINAL18_PRE_CI_FREEZE_GUARD =
  ".hermes/state/stage5-final18-pre-ci-freeze-guard.json";
export const STAGE5_FINAL18_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final18-ci-verify-invocation.json";
export const STAGE5_FINAL18_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
export const STAGE5_FINAL18_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-18 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL18_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-18",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL18_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    "final17-EVIDENCE_INDEX.json",
    "final17-baseline-generation.json",
    "final17-candidate-validation.md",
    "final17-candidate-freeze-placeholder.md",
    "final17-correction-matrix.json",
    "final17-security-extension-baseline.json",
    "final17-ci-verify.log",
    "final17-ci-verify-execution.json",
    "final17-post-ci-finalization-failure.json",
    "final17-post-ci-finalization-failure.log",
    "final17-invalid-final-index-attempt.json",
    "final17-final-candidate-scope-failure.json",
    "final17-final-candidate-scope-failure.log",

    "final17-ci-invocation-guard.json",
    "final17-pre-ci-freeze-guard.json",
    "final18-correction-matrix.json",
    "finding-lineage-prebaseline-attempt-01.json",
    "finding-lineage.json",
    "baseline-generation.json",
    "focused-test-execution.json",
    "focused-tests.log",
    "format-check-execution.json",
    "format-check.log",
    "lint-check-execution.json",
    "lint-check.log",
    "typecheck-execution.json",
    "typecheck.log",
    "migration-check-execution.json",
    "migration-check.log",
    "postgresql-qualification-continuity.json",
    "postgresql-disposable-cleanup.json",
    "postgresql-integration-test-execution.json",
    "postgresql-integration-tests.log",
    "postgresql-package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "postgresql-qualification-execution.json",
    "postgresql-qualification-runner.log",
    "postgresql-qualification.json",
    "migration-checksums.json",
    "source-scope-test.json",
    "source-scope-tests.log",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted(),
);
export const STAGE5_FINAL17_PREDECESSOR_EVIDENCE_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL16_PREDECESSOR_EVIDENCE_NAMES,
    ...STAGE5_FINAL16_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map((name) => `final16-${name}`),
    "final16-EVIDENCE_INDEX.json",
    "final16-security-extension-baseline.json",
    "final16-preflight-failure.json",
    "final16-preflight-failure.log",
    "final16-package.json",
    "final16-runner.mjs",
  ].toSorted(),
);
export const STAGE5_FINAL17_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL17_PREDECESSOR_EVIDENCE_NAMES,
    "final17-correction-matrix.json",
    "finding-lineage.json",
    "baseline-generation.json",
    "format-check.json",
    "format-check.log",
    "lint-check.json",
    "lint-check.log",
    "focused-test-execution.json",
    "focused-tests.log",
    "postgresql-disposable-cleanup.json",
    "postgresql-integration-test-execution.json",
    "postgresql-integration-tests.log",
    "postgresql-package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "postgresql-qualification-execution.json",
    "postgresql-qualification-runner.log",
    "postgresql-qualification.json",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted(),
);
export const STAGE5_FINAL19_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-19";
export const STAGE5_FINAL19_EVIDENCE_INDEX = `${STAGE5_FINAL19_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL19_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_19_CORRECTION_MATRIX.json";
export const STAGE5_FINAL19_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL19_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL19_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final19-readiness-preflight.json";
export const STAGE5_FINAL19_PRE_CI_FREEZE_GUARD =
  ".hermes/state/stage5-final19-pre-ci-freeze-guard.json";
export const STAGE5_FINAL19_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final19-ci-verify-invocation.json";
export const STAGE5_FINAL19_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/final19-scan-reports/STAGE_5_FINAL_19_POST_FREEZE.json";
export const STAGE5_FINAL19_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_19_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL19_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_19_CANDIDATE_FREEZE.json";
export const STAGE5_FINAL19_PREDECESSOR_EVIDENCE_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL18_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map((name) => `final18-${name}`),
    "final18-EVIDENCE_INDEX.json",
    "final18-security-extension-baseline.json",
    "final18-correction-matrix.json",
    "final18-preflight-failure-01.json",
  ].toSorted(),
);
export const STAGE5_FINAL19_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL19_PREDECESSOR_EVIDENCE_NAMES,
    "final19-correction-matrix.json",
    "author-tooling-remediation.json",
    "finding-lineage.json",
    "baseline-generation.json",
    "format-check-execution.json",
    "format-check.log",
    "lint-check-execution.json",
    "lint-check.log",
    "typecheck-execution.json",
    "typecheck.log",
    "migration-check-execution.json",
    "migration-check.log",
    "migration-checksums.json",
    "focused-test-execution.json",
    "focused-tests.log",
    "postgresql-disposable-cleanup.json",
    "postgresql-integration-test-execution.json",
    "postgresql-integration-tests.log",
    "postgresql-package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "postgresql-qualification-continuity.json",
    "postgresql-qualification-execution.json",
    "postgresql-qualification-runner.log",
    "postgresql-qualification.json",
    "source-scope-test.json",
    "source-scope-tests.log",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted(),
);
export const STAGE5_FINAL19_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
export const STAGE5_FINAL19_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-19 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL19_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-19",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;

export const STAGE5_FINAL19_SECURITY_BASELINE_SHA256 =
  "a88ff3bf204ec9a56b02f6fbd242061ccf0cf0b85569395835b406c0f7c8fe76";
export const STAGE5_FINAL19_CORRECTION_MATRIX_SHA256 =
  "6a18bb31f030cfa03a1ae5ca7e99fa1785566ee7a2223131e1171f3ebd0355b6";
export const STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT =
  ".hermes/state/stage5-final19-preflight-failure-01.json";
export const STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256 =
  "89664dd1c8a3538ca16badd6b3d1d8e25a40dab4192f00fefa076bc2b625d009";

export const STAGE5_FINAL20_BASELINE_ATTEMPT_01_SHA256 =
  "afd01703ce1dac3408e24d7a8fa0a340cdf65bd26370a0f1444d096b64a20238";
export const STAGE5_FINAL20_SECURITY_BASELINE_SHA256 =
  "553894689208af9aec37b7814112baa1b4616d2253e863ef1cf47a8e2befa9a3";
export const STAGE5_FINAL20_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-20";
export const STAGE5_FINAL20_EVIDENCE_INDEX = `${STAGE5_FINAL20_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL20_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_20_CORRECTION_MATRIX.json";
export const STAGE5_FINAL20_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL20_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL20_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final20-readiness-preflight.json";
export const STAGE5_FINAL20_PRE_CI_FREEZE_GUARD =
  ".hermes/state/stage5-final20-pre-ci-freeze-guard.json";
export const STAGE5_FINAL20_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final20-ci-verify-invocation.json";
export const STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/final20-scan-reports/STAGE_5_FINAL_20_POST_FREEZE.json";
export const STAGE5_FINAL20_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_20_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL20_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_20_CANDIDATE_FREEZE.json";
export const STAGE5_FINAL20_PREDECESSOR_EVIDENCE_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL19_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
      (name) => name !== "migration-checksums.json",
    ).map((name) => `final19-${name}`),
    "final19-security-extension-baseline.json",
    "final19-correction-matrix.json",
    "final19-preflight-failure-01.json",
  ].toSorted(),
);
export const STAGE5_FINAL20_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL20_PREDECESSOR_EVIDENCE_NAMES,
    "final20-correction-matrix.json",
    "finding-lineage.json",
    "baseline-generation.json",
    "baseline-attempt-01.json",
    "baseline-generation-final.json",
    "readiness-pre-resume.json",
    "evidence-index-pre-resume.json",
    "readiness-resume-failure-01.json",
    "evidence-index-resume-attempt-02.json",
    "readiness-resume-failure-02.json",
    "format-check-execution.json",
    "format-check.log",
    "lint-check-execution.json",
    "lint-check.log",
    "typecheck-execution.json",
    "typecheck.log",
    "migration-check-execution.json",
    "migration-check.log",
    "migration-checksums.json",
    "focused-test-execution.json",
    "focused-tests.log",
    "postgresql-disposable-cleanup.json",
    "postgresql-integration-test-execution.json",
    "postgresql-integration-tests.log",
    "postgresql-package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "postgresql-qualification-continuity.json",
    "postgresql-qualification-execution.json",
    "postgresql-qualification-runner.log",
    "postgresql-qualification.json",
    "source-scope-test.json",
    "source-scope-tests.log",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted(),
);
export const STAGE5_FINAL20_PRE_RESUME_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  STAGE5_FINAL20_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
    (name) =>
      ![
        "readiness-pre-resume.json",
        "evidence-index-pre-resume.json",
        "readiness-resume-failure-01.json",
        "evidence-index-resume-attempt-02.json",
        "readiness-resume-failure-02.json",
      ].includes(name),
  ),
);
export const STAGE5_FINAL20_RESUME_ATTEMPT_02_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  STAGE5_FINAL20_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
    (name) =>
      !["evidence-index-resume-attempt-02.json", "readiness-resume-failure-02.json"].includes(name),
  ),
);
export const STAGE5_FINAL20_PRE_RESUME_INDEX_SHA256 =
  "504793328e5c65474cadf34aeea003e27b2b9e5f56a81487bfd8526676a057ab";
export const STAGE5_FINAL20_PRE_RESUME_READINESS_SHA256 =
  "cc5fa1a2a0694e37f2d53e3f84df38a70b69bd7c34e1d3e4e7cd951954619ac0";
export const STAGE5_FINAL20_RESUME_ATTEMPT_02_INDEX_SHA256 =
  "82c5e3bac49e7e93b7b701afe03a06a0f0550669029b4e19c26e5a36f51703a9";
export const STAGE5_FINAL20_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
export const STAGE5_FINAL20_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-20 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL20_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-20",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;

export const STAGE5_FINAL20_CORRECTION_MATRIX_SHA256 =
  "4d2df960ec341bb7b0604926facb179ebed0fe3eb0d492a3c28cd5357ca1bb25";
export const STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT =
  ".hermes/state/stage5-final20-final-candidate-scan-failure-01.json";
export const STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT_SHA256 =
  "df9795fcdc9fb54280dce078ef49758476d0655e5b999c42fe6425cdea5faa79";

export const STAGE5_FINAL21_SECURITY_BASELINE_SHA256 =
  "54e4583bd7884c1ab8dfd067dc7fc8214548559bf5f5a0dc79043686e588abb0";
export const STAGE5_FINAL21_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-21";
export const STAGE5_FINAL21_EVIDENCE_INDEX = `${STAGE5_FINAL21_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL21_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_21_CORRECTION_MATRIX.json";
export const STAGE5_FINAL21_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_21_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL21_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_21_CANDIDATE_FREEZE.json";
export const STAGE5_FINAL21_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/final21-scan-reports/STAGE_5_FINAL_21_POST_FREEZE.json";
export const STAGE5_FINAL21_READINESS_PREFLIGHT_EVIDENCE = `${STAGE5_FINAL21_EVIDENCE_DIRECTORY}/readiness-preflight.json`;
export const STAGE5_FINAL21_READINESS_PREFLIGHT_LOCAL_STATE =
  ".hermes/state/stage5-final21-readiness-preflight.json";
export const STAGE5_FINAL21_PRE_CI_FREEZE_GUARD =
  ".hermes/state/stage5-final21-pre-ci-freeze-guard.json";
export const STAGE5_FINAL21_CI_VERIFY_INVOCATION_GUARD =
  ".hermes/state/stage5-final21-ci-verify-invocation.json";
export const STAGE5_FINAL21_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative FINAL-21 pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL21_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    candidate: "FINAL-21",
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL21_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
export const STAGE5_FINAL21_PREDECESSOR_EVIDENCE_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL20_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
      (name) => name !== "migration-checksums.json",
    ).map((name) => `final20-${name}`),
    "final20-security-extension-baseline.json",
    "final20-correction-matrix.json",
    "final20-final-candidate-scan-failure-01.json",
  ].toSorted(),
);
export const STAGE5_FINAL21_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    ...STAGE5_FINAL21_PREDECESSOR_EVIDENCE_NAMES,
    "final21-correction-matrix.json",
    "finding-lineage.json",
    "baseline-generation.json",
    "baseline-generation-final.json",
    "focused-test-execution.json",
    "focused-tests.log",
    "format-check-execution.json",
    "format-check.log",
    "lint-check-execution.json",
    "lint-check.log",
    "typecheck-execution.json",
    "typecheck.log",
    "migration-check-execution.json",
    "migration-check.log",
    "migration-checksums.json",
    "postgresql-qualification.json",
    "source-scope-test.json",
    "source-scope-tests.log",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted(),
);
export const STAGE5_FINAL21_PRE_RESUME_INDEX_SHA256 = "0".repeat(64);
export const STAGE5_FINAL21_PRE_RESUME_READINESS_SHA256 = "0".repeat(64);
export const STAGE5_FINAL21_RESUME_ATTEMPT_02_EVIDENCE_ARTIFACT_NAMES =
  STAGE5_FINAL21_EXPECTED_EVIDENCE_ARTIFACT_NAMES;
export const STAGE5_FINAL21_RESUME_ATTEMPT_02_INDEX_SHA256 = "0".repeat(64);
