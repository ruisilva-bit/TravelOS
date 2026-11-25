# Stage 10 source/binary screening integration — independent review

## Adjudication

**Scoped GO:** the corrected source/binary-screen integration is acceptable for its stated bounded screening-mechanism purpose at the exact hashes below. The former “valid UTF-8 means text” gap is closed: text decoding is format-allowlisted, rejects NUL and malformed UTF-8, and unsupported formats fail closed. Exact finding classifications are tied to source-file and exact-line hashes; historical archives are screened recursively within explicit bounds and checked against immutable root hashes.

**Scoped NO-GO:** this review does not accept privacy, durable evidence, signing, deployment, or overall Stage 10. The executable report itself says `PENDING_INDEPENDENT_FINAL_EVIDENCE_ACCEPTANCE`; format recognition and heuristic scanning cannot establish absence of encoded secrets, steganography, or all sensitive content. The governing authority clarification at `docs/implementation/M1_STAGE_10_OPERATIONAL_AUTHORITY_ADJUDICATION.md:13–21,33` likewise keeps applicable independent evidence-retention findings open and expressly disclaims Stage 10 GO.

## Reviewed code identity (SHA-256)

| File | SHA-256 |
|---|---|
| `tooling/ci/stage-10/source-final-gate.mjs` | `25969a6e8b2355eff22539b0b2c99a5e8a8e80bcd880f5864bc694618c50666e` |
| `tooling/ci/stage-10/historical-archive-screen.mjs` | `753fd26034737e84d6f8de2ac342849eba550e3d2d01266fbeb8ddb6debf7604` |
| `tooling/ci/stage-10/text-input-profile.mjs` | `f5ed0606a8a05b2dcd73d1a669b14dd6a056f1d74b51bf6fa0b516708a015e6a` |
| `tooling/ci/stage-10/test-text-input-profile.mjs` | `b9a7a5fb576484fb02987213ac1469780efa1e47aa62238f7d4662f17c7a3541` |
| `tooling/ci/stage-10/test-historical-archive-screen.mjs` | `c109165dcfa6bf2b7d58d6b0dc2ae97f46c8314c931238c44a42f2832bc773b5` |
| `tooling/ci/stage-10/test-source-final-gate.mjs` | `24f7109a820a92b82bdff5faea1e0dabce3a29f3b4fef0d425c5293b93bdd09b` |

## Classification inputs checked (SHA-256)

| Review record | SHA-256 |
|---|---|
| `SOURCE_FINDING_CLASSIFICATION.md` | `9869ef0e81d996d0cb04eb395666ad04d4ea8369e19ef7041695c8f8f72a26a4` |
| `INHERITED_SOURCE_FINDING_CLASSIFICATION.json` | `fcd05c0d54f484d95120e3ce36398a1a1f2a256bf2ce88c1214fa94aacc3d013` |
| `HISTORICAL_ARCHIVE_FINDING_CLASSIFICATION.json` | `6b6d869e7edefee3b03f2dcd9739ada6c15e6f0b26447dbaa8cc45c37d01e8cd` |
| `ARCHIVE_SCANNER_TEST_FINDING_CLASSIFICATION.json` | `4fc39be1fbe1b079cc9a9c88da861e842a07ad6cce90220a898e0be5114b7086` |
| `SOURCE_IMAGE_VISUAL_REVIEW.json` | `e7d7e6d6ffa2147f17eed8a01f646bbc7eb97dbbe678201efb53a8ee3ab9729d` |

`source-final-gate.mjs` pins these five review records, requires them in the captured source, validates the exact file and line digests before honoring classifications, requires 160 unique inherited/successor `(path,line,rule)` entries, and verifies the two archive-scanner fixture records. The two reviewed scanner-test locations are `tooling/ci/stage-10/test-historical-archive-screen.mjs:51,55`; their current file digest is `c109165d…c773b5`, with exact line digests `8b806afd…912db1` and `e0c8047f…19b7d5d`, respectively. Matched values are intentionally not reproduced here.

The current run's source snapshot digest is `7101533522c769f40f6156fa781c83c16fddc22a7d87cd7381160b858aafe063`. Local summary `.hermes/state/stage10-reviewed-full-source-screen.json` (SHA-256 `4096116967852b67c4ffe67d92928bdb1b2972a4cd874494d972709a482f48af`) reports `PASS`, 2,818 files checked, 164 reviewed text findings, zero unresolved text findings, zero unsupported inputs, 40 archive findings with zero unresolved, 12 reviewed images, and privacy pending. The separate raw source/binary screening summaries remain `FAIL`/`INCOMPLETE` because they do not apply the final exact contextual classifications; do not confuse those intermediate results with the reviewed full-source summary. This is a local execution summary, not by itself a durable or independently authenticated Stage 10 receipt.

## Mechanism and bounded result

- `decodeSupportedTextInput` accepts only explicitly listed text suffixes or exact extensionless basenames; it rejects unknown suffixes even when bytes are valid UTF-8, as well as NUL and malformed UTF-8. Archive members use the same decoder; oversized, unsupported, unsafe, or malformed entries remain unsupported/rejected rather than treated as cleared text.
- The source gate rechecks each captured file digest during screening and recaptures the source at the end, failing on drift. It binds classification to exact current content and routes pinned historical `.tar.gz` roots and individually reviewed PNGs through their separate handling rather than treating their bytes as text.
- The historical screen admits exactly 19 tracked historical archives and four authorized immutable root hashes; recursive gzip/TAR inspection uses bounded depth, member counts, compressed/expanded budgets, strict path/header checks, and no filesystem extraction. The targeted run observed four unique roots, all `INSPECTED_HEURISTIC`, 152,340,480 expanded bytes, 40 findings, and zero unsupported members. The 40 archive classifications match the findings by root/member reference, line, rule, and content digests.
- Exact image count and SHA-256 set are checked against the 12-entry visual-review record. No source drift was reported by the reviewed run.

## Verification run

Ran:

```text
node --test tooling/ci/stage-10/test-text-input-profile.mjs tooling/ci/stage-10/test-historical-archive-screen.mjs tooling/ci/stage-10/test-source-final-gate.mjs
```

Result: **12 tests passed, 0 failed**. This included unknown-valid-UTF-8 format rejection, supported-text positive cases, NUL/invalid-UTF-8 rejection, 19-root recursive archive-screen fixture coverage, and classification count/duplicate/missing-entry guards. No Stage 10 PostgreSQL/browser flow was rerun.

## Review note / remaining boundary

`INHERITED_SOURCE_FINDING_CLASSIFICATION.json:3–8` explicitly retains an unresolved lineage-digest note and the historical statement that binary coverage was incomplete. These are inherited-record metadata, not current archive-screen results: the current gate does not consume `binaryCoverage` as a clearance decision, and the reviewed current run separately screens the archives and reports its bounded result. Keep those historical caveats visible; do not cite that JSON alone as current binary coverage or as fresh privacy acceptance.

No concrete defect was found in the corrected, narrowly scoped source/binary screening integration at the hashes listed above. This decision is limited to that mechanism and result; it grants no broader Stage 10 or privacy approval.