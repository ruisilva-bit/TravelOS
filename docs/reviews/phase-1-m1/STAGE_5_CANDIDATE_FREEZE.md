# TravelOS Phase 1 M1 — Stage 5 candidate freeze

- **Stage:** Phase 1 M1 / Stage 5
- **Status:** CANDIDATE — eligible for genuine independent review; not closure
- **Scope:** Person / Customer / TripTraveller, Trip, Flight, Accommodation, Reservation, ReservationItemLink, exact Money/INTERNAL_ONLY sentinel, persistence, Admin contracts/API, PostgreSQL qualification and CI
- **Predecessor closure:** `docs/reviews/phase-1-m1/STAGE_4_INDEPENDENT_CLOSURE.md`
- **Predecessor corrected freeze SHA-256:** `1d1784dc2b75f54a5b7634635f53b59403e9fad0bb68b3e7021044ec69102551`
- **Evidence index:** `docs/evidence/phase-1-m1/stage-5/EVIDENCE_INDEX.json` — aggregate `e7eebd66cbddeb8faf59001b00555b3733795b6914f0763dc131f1f9f65ce6ba`
- **Entry count:** 40
- **Deterministic aggregate:** `fa69cf6cacbac0e83a229250388f7caa5cdcc3759eb4593f0c5008ce23b86e18`
- **Aggregate algorithm:** `sha256(path\0bytes\0sha256 joined by LF in sorted path order)`
- **Excluded outputs:** this candidate freeze, the independent review, the correction record and the independent closure

The rows below are the exact candidate bytes. The freeze document is deliberately excluded from its own rows. Reviewers must recompute every row, the aggregate and the predecessor/evidence hashes before semantic review. Any listed-byte change invalidates this candidate and requires a new freeze generation; do not edit listed bytes during review.

| # | Path | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `apps/admin-api/src/app.module.ts` | 191 | `fd56ee5f8360d4c252540c6ebc5e7002054f174c039d32b78e0cd17fcbf0683e` |
| 2 | `apps/admin-api/src/app.ts` | 701 | `f70b16c66e73665fa99628b5c4bf064bb5baf67b72efef86997526c9b66c9fe7` |
| 3 | `apps/admin-api/src/auth-bridge.ts` | 7570 | `39994326504abab327bcba2b0a8dca06e27a0c60c49cc706b2b881c3cc0251a4` |
| 4 | `apps/admin-api/src/m1-routes.ts` | 16707 | `b3470c99d1fd8a7e2e6ec278b5d6064f97fdbb01bc219bd85987849db8d3b76a` |
| 5 | `apps/admin-api/src/main.ts` | 4951 | `7cce814087b6099b34a5ab229baf83d51197ccb1da4ce63e02b224fd42dbb5f1` |
| 6 | `apps/admin-api/test/m1-routes.test.ts` | 9638 | `5b6c489320efd5fbf5eb5754a7f074c98ea584464463b97932a1b8699a95b5c6` |
| 7 | `docs/evidence/phase-1-m1/stage-5/EVIDENCE_INDEX.json` | 2500 | `cb402eabf4c230f3748b0d13c1421dad9335a459e4690a7bc19e936cfc6543ca` |
| 8 | `docs/reviews/phase-1-m1/STAGE_5_CANDIDATE_VALIDATION.md` | 2432 | `969ad96bcd7e31cbde53b40b28ecf616b3fb417e28a767a2cbba0731a7c9dc0c` |
| 9 | `docs/reviews/phase-1-m1/STAGE_5_IMPLEMENTATION.md` | 2535 | `80a0ce1d6c6094b53abf71354c68af8b06b67a018066d29f3dbaa921aaeccab6` |
| 10 | `migrations/0007_stage5_m1_domain_slice.cjs` | 20425 | `f83d9d37f6d57716e1d103ef515e74a5f297084e20fdf60017c1a9e93e2492d9` |
| 11 | `migrations/checksums.json` | 1106 | `1224634772b4e7e2e00e55c25ab3c37167ac4777bfd0421d010e494b2e40179c` |
| 12 | `packages/backend-core/src/index.ts` | 2889 | `5912b32621ff38a502d398a4f13b0a4b667358d09b8a9bff65d159969aeb3673` |
| 13 | `packages/backend-core/src/modules/crm/domain/continuity.ts` | 1763 | `7dc267f0bb9be6843e66407cc6bf3fdbc351670cda91ca9a9efd905e6b363197` |
| 14 | `packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts` | 827 | `7252abee19c826f9c30bd62365d846352893b5fad45be5a704d266918fe9a2c6` |
| 15 | `packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts` | 6019 | `2277ace1597f2a3df50a472c605367aa1b80b27b0688beeef144d0116e57b53f` |
| 16 | `packages/backend-core/src/modules/trip-operations/domain/m1-slice.ts` | 5283 | `28da22804ad1fd82de562b5f04035888eccb3d189413ba0bca87e792db0bf0bf` |
| 17 | `packages/backend-core/src/shared-kernel/money/money.ts` | 5184 | `a6b8e77d5f56def3d598d1e0b44f4e9601d8f8096613896cbabe4b739518fabc` |
| 18 | `packages/backend-core/src/shared-kernel/opaque-id.ts` | 2122 | `cfefb0b58a5e6c20e7e980718c9c68b7d7ace1ae3193493d27feb5db5f55b303` |
| 19 | `packages/backend-core/src/shared-kernel/time.ts` | 1578 | `119246984af0e9360b05c961a4b21482e25780a0f079ed92c652d4e92ff9b971` |
| 20 | `packages/backend-core/test/m1/application.test.ts` | 3678 | `df0a6305333983bde43880bd974b1b74d26705814cf2988e1339243d2a27ab5b` |
| 21 | `packages/backend-core/test/m1/shared-kernel.test.ts` | 2347 | `ae8694d74729ed7d5e4925fe1019593c4cd974becd3590bcbacffd1c0b38a04c` |
| 22 | `packages/contracts/src/admin/customers/index.ts` | 279 | `40c446a2d2c56e4d42f1610c976d1e237064910841c4f0c762435d5a46a41069` |
| 23 | `packages/contracts/src/admin/customers/m1.ts` | 1649 | `f5a57830cdfcfb01eb0181bb3533c60f94ccb9e12852909e230b7c06c5294658` |
| 24 | `packages/contracts/src/admin/index.ts` | 472 | `8fa185f0951bdd807196f2f24f5c2d5eb5b8f78fd25d13e41a8f33168d01a302` |
| 25 | `packages/contracts/src/admin/itinerary/index.ts` | 262 | `fe7fbfa6d41825d6c1de87792586eb2fcfe520638a6aadd26cb16c446609028f` |
| 26 | `packages/contracts/src/admin/itinerary/m1.ts` | 3694 | `1846dfab7c802d2884356939bfff8faead3de7c5a78bfdc5fdd55b87e29da9b6` |
| 27 | `packages/contracts/src/admin/money.ts` | 634 | `3bade3e2a57c6122708eda1a43b2602921fffd69932bc4c17d11486fd279dfb1` |
| 28 | `packages/contracts/src/admin/reservations/index.ts` | 276 | `48c44c89faff3347fa7ed23baac913e8f74fd3b551071891b719446ff806bd29` |
| 29 | `packages/contracts/src/admin/reservations/m1.ts` | 2078 | `9e56881ad4dc4aeb6ddf640ea096725dac7d48641ad25313aa136309fc5b7da2` |
| 30 | `packages/contracts/src/admin/trips/index.ts` | 246 | `fa0b0aa32de6c56aa6447db8b58f4a358887bfb8aa1c985257b707f4d75413b0` |
| 31 | `packages/contracts/src/admin/trips/m1.ts` | 2728 | `0237b4383f7195b5af9506601cc1febada24a4c57e9d9abae7b43e1ded276044` |
| 32 | `packages/contracts/test/admin-m1-contracts.test.ts` | 5002 | `e5217d23a509d01fe7947f8c3329f8344010e6b35faf60e36e21cc5edbef9408` |
| 33 | `packages/database/src/index.ts` | 698 | `a0e25417c1c7d901308d6702ccd2368ec4b1277fe2502e8ebfb8f9a832c9cab6` |
| 34 | `packages/database/src/trip-operations/m1-operational-slice-repository.ts` | 25556 | `ea969567e5e759ea6313aedf2e4cbd420bfd776712bb8eac0dbf9cf809c18286` |
| 35 | `packages/database/src/uuidv7.ts` | 221 | `670a68ffeac6d52b84e9d24659afec337ce84e80ceceeec8cbee1664fa4a243e` |
| 36 | `tests/integration/stage-5-postgresql.test.ts` | 12160 | `a6e8365884d4f91d9212565bb8c786030fcf0f641fc9d8e6813364df86e772f9` |
| 37 | `tooling/ci/verify.mjs` | 1644 | `2949d79ff7dd0fe01e74d629d7821c7e6460621831e40804b4df75e210eaf527` |
| 38 | `tooling/database/prepare-postgresql-18.mjs` | 3127 | `4a02280980952cecf4c3cc4cb3fb279195571fc1ba17ecb48ca01eb8f8ccadf5` |
| 39 | `tooling/database/run-stage-5-disposable.mjs` | 8915 | `7c10ffd035a9e98d1f1875074a14dfe69ea0ab81264223f935110eefaec1dcb9` |
| 40 | `tooling/testing/vitest.stage-5.config.ts` | 785 | `f3dfb48ee84e5c44cf138055e3efc0d3fdbd0a1972c5e8c8ab1fdb773f852a16` |
