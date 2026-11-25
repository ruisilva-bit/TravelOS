# Stage 10 local package correction review and adjudication

Independent reviewer: `sa-0-188ed62a`, delegation `deleg_0906761b`. Read-only review; reviewer performed no tests, builds, candidate actions, canonical CI or remote operations.

**Decision: GO for this local correction slice only.** No Stage 10, runtime, deployment or release GO is awarded. Full-stage gates are not yet eligible for final adjudication.

## Reviewed conclusions

- Archive binding, packaged source/migration copies, dependency closure/lock membership, bundled Node pin and final binding recheck remain enforced.
- Declared-entry results explicitly disclaim executable import-graph completeness and leave patterns/directories/no-entry cases unqualified. Conditional exports are inspected as file metadata, not Node active-condition selection.
- Credential-free bootstrap preflight requires the exact source-owned missing-manifest failure protocol; it is not authentication, database, listener, dynamic-branch or runtime acceptance.
- Fixed Corepack entry/library/pnpm launcher hashes matched local bytes and launcher realpaths; recipe executes fixed Node/Corepack with bounded timeout/output, controlled environment and source drift checks.

## Caveats and parent adjudication

1. Synthetic fixture entrypoints emit the expected error protocol themselves. They prove probe protocol handling only. Alex separately exercised all three actual extracted application entries and retained that evidence in the real mutable package result; do not cite fixture results as application acceptance.
2. Main resolution uses `createRequire.resolve` before `lstat`, allowing contained main symlinks to be resolved differently from direct targets. Escaping targets remain rejected; a dedicated contained-main-symlink regression is still useful and is not claimed by existing escaping-symlink tests.
3. The declared-file check cannot replace actual importer-specifier/native/dynamic/CT200 qualification. Those remain explicit pending gates, as does the optional Better Auth test-peer packaging-hygiene issue.

Alex accepts this scoped GO with these limitations; no security finding is silently closed at a broader boundary.

## Parent-observed reviewed source hashes

| File under `tooling/ci/stage-10/` | SHA-256 |
| --- | --- |
| `bootstrap-preflight.mjs` | `0f788d4e9933ef2e624e9ca0fed15e9148812a213b403eb226748c73037a8bc7` |
| `declared-entry-checks.mjs` | `09e7491704ed3e5a7feee58d57cfb0dfe6b4fea2f1a513a001d8f6dd55a60805` |
| `qualify-artifact.mjs` | `c8c9990430226bc2013fe69abdf612b055ad3aa1b2db8d0c729aafac0c2ac3c1` |
| `candidate.mjs` | `598cdeae3602b31974a03b1cadfc90842fe6eae9f0b0bcce591a76e689081a6a` |
| `production-recipe.mjs` | `a25a7e8a2ab51791dcb3beaa0fa68b6385483f69ce7ded0ff3da3c93635ecf09` |

## Executed mutable qualification after review

Tracked process `proc_2913c1a59572` completed exit 0. Read-back of the actual receipts and archive bytes confirmed:

- Real offline frozen install, production build, four production pnpm deployments and dependency restoration passed.
- Exact archive assembly/extraction/package checks passed, explicitly **package-only**.
- Actual three-entry credential-free preflight passed its expected failure protocol.
- Expanded local Stage 10 suite: **70 tests passed, zero failed/cancelled/skipped**.
- Full lint, typecheck and format check passed; format checked 678 files.
- Full application unit suite: **65 files, 369 tests passed**.
- Scratch-only archive: **185622714 bytes**, SHA-256 `2f568bccf26d2c837a4e6b3e5383e0bb3ace22265ef2990e31f2a0c98ebee3bc`.
- Input digest: `81d7a7217bb78b3fcd88feae06e5432190bea4da305bf577ac5d070ebbc82c7b`.
- Manifest/source snapshot: 2732 source files. Declared-file coverage: 1782 entries, 1150 explicitly unqualified metadata cases.

The producer labels the archive `travelos-stage10-gen01-81d7a721`, but no canonical candidate freeze/claim/CI was created: it remains a mutable rehearsal archive and must not be promoted. This review document was added afterwards and is not retroactively included in that archive's source snapshot. No CT200 installation, backup, migration, activation or restart occurred in that rehearsal. Stage 11 actions: 0.
