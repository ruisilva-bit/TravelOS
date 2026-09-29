# TravelOS Phase 1 M1 — Stage 5 corrected candidate freeze

- **Stage:** Phase 1 M1 / Stage 5 corrected generation
- **Status:** CANDIDATE — eligible for a fresh genuine independent review; not closure
- **Scope:** Corrected Person / Customer / TripTraveller, Trip, Flight, Accommodation, Reservation, ReservationItemLink, exact Money/INTERNAL_ONLY sentinel, persistence, Admin contracts/API, PostgreSQL qualification and CI
- **Predecessor closure:** `docs/reviews/phase-1-m1/STAGE_4_INDEPENDENT_CLOSURE.md`
- **Predecessor corrected freeze SHA-256:** `1d1784dc2b75f54a5b7634635f53b59403e9fad0bb68b3e7021044ec69102551`
- **Corrected evidence index:** `docs/evidence/phase-1-m1/stage-5-corrected/EVIDENCE_INDEX.json` — aggregate `c75fc5792a21e599e04b9bab62ccdfd2736613946e54e825c914705f29b94504`
- **Entry count:** 41
- **Deterministic aggregate:** `aef6e54e86f81bfbbfab12649926d378312ecbb1024b5dc04e9fc4717502cedf`
- **Aggregate algorithm:** `sha256(path\0bytes\0sha256 joined by LF in sorted path order)`
- **Excluded outputs:** this corrected candidate freeze, the fresh independent review, and the independent closure; superseded Stage 5 freeze/evidence remain historical and are not rewritten

The rows below are the exact corrected candidate bytes. This freeze is deliberately excluded from its own rows. Reviewers must recompute every row, the aggregate and the predecessor/evidence hashes before semantic review. Any listed-byte change invalidates this candidate and requires a new freeze generation; do not edit listed bytes during review.

| # | Path | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `apps/admin-api/src/app.module.ts` | 191 | `fd56ee5f8360d4c252540c6ebc5e7002054f174c039d32b78e0cd17fcbf0683e` |
| 2 | `apps/admin-api/src/app.ts` | 701 | `f70b16c66e73665fa99628b5c4bf064bb5baf67b72efef86997526c9b66c9fe7` |
| 3 | `apps/admin-api/src/auth-bridge.ts` | 7570 | `39994326504abab327bcba2b0a8dca06e27a0c60c49cc706b2b881c3cc0251a4` |
| 4 | `apps/admin-api/src/m1-routes.ts` | 16739 | `8dc30ce0d0da366eb3cb4f0cc5b70f71677fc92c7749772167d421852e97620a` |
| 5 | `apps/admin-api/src/main.ts` | 4951 | `7cce814087b6099b34a5ab229baf83d51197ccb1da4ce63e02b224fd42dbb5f1` |
| 6 | `apps/admin-api/test/m1-routes.test.ts` | 10653 | `5717a355b6e6974d72f7f5164740805556c9ac756f9efb7f5cba1df802b6dd12` |
| 7 | `docs/evidence/phase-1-m1/stage-5-corrected/EVIDENCE_INDEX.json` | 2668 | `db3b005205ae9d57fb4811dfd8ecee5a45bc6f943a7ab8668236fded7bb99b53` |
| 8 | `docs/reviews/phase-1-m1/STAGE_5_CORRECTED_CANDIDATE_VALIDATION.md` | 4094 | `fa8539c5885250469c2e0f7e45e22ae5ba8d340f7e1cc1e640fbede671558667` |
| 9 | `docs/reviews/phase-1-m1/STAGE_5_CORRECTED_IMPLEMENTATION.md` | 3017 | `8e8cc54602bf56b202a35778fdc2eebb53a92cc29e9746f97cf9011d5b5846d6` |
| 10 | `docs/reviews/phase-1-m1/STAGE_5_REVIEW_CORRECTIONS.md` | 3837 | `d66b3119eecf8b0e079bf6e3c8e87f248d7de938eb58dfb36a679b267325eab6` |
| 11 | `migrations/0007_stage5_m1_domain_slice.cjs` | 22041 | `c35f3b21b77b222f2a90163ae7d121ab2f084bf02a9109cb5cc041271fde7a5c` |
| 12 | `migrations/checksums.json` | 1106 | `2c9fbc58eeb5137c5e51525008c23966ea1e8b1da24ebb507afcf1372ddfc6df` |
| 13 | `packages/backend-core/src/index.ts` | 2889 | `5912b32621ff38a502d398a4f13b0a4b667358d09b8a9bff65d159969aeb3673` |
| 14 | `packages/backend-core/src/modules/crm/domain/continuity.ts` | 1763 | `7dc267f0bb9be6843e66407cc6bf3fdbc351670cda91ca9a9efd905e6b363197` |
| 15 | `packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts` | 827 | `7252abee19c826f9c30bd62365d846352893b5fad45be5a704d266918fe9a2c6` |
| 16 | `packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts` | 6019 | `2277ace1597f2a3df50a472c605367aa1b80b27b0688beeef144d0116e57b53f` |
| 17 | `packages/backend-core/src/modules/trip-operations/domain/m1-slice.ts` | 5283 | `28da22804ad1fd82de562b5f04035888eccb3d189413ba0bca87e792db0bf0bf` |
| 18 | `packages/backend-core/src/shared-kernel/money/money.ts` | 5343 | `d60cff5b42e3e700af0bc3bc4ed163a72acdf069b41e4498b15542ee33ce7849` |
| 19 | `packages/backend-core/src/shared-kernel/opaque-id.ts` | 2122 | `cfefb0b58a5e6c20e7e980718c9c68b7d7ace1ae3193493d27feb5db5f55b303` |
| 20 | `packages/backend-core/src/shared-kernel/time.ts` | 2814 | `b57763986ef0616b5f0b49ee487995a915de992c960b9b99ba2233a6d51c982e` |
| 21 | `packages/backend-core/test/m1/application.test.ts` | 3678 | `df0a6305333983bde43880bd974b1b74d26705814cf2988e1339243d2a27ab5b` |
| 22 | `packages/backend-core/test/m1/shared-kernel.test.ts` | 2992 | `794a94713b8a91147ee02b30aa387d657279e6c6780daf3a1ec038f6857fe350` |
| 23 | `packages/contracts/src/admin/customers/index.ts` | 279 | `40c446a2d2c56e4d42f1610c976d1e237064910841c4f0c762435d5a46a41069` |
| 24 | `packages/contracts/src/admin/customers/m1.ts` | 1649 | `f5a57830cdfcfb01eb0181bb3533c60f94ccb9e12852909e230b7c06c5294658` |
| 25 | `packages/contracts/src/admin/index.ts` | 472 | `8fa185f0951bdd807196f2f24f5c2d5eb5b8f78fd25d13e41a8f33168d01a302` |
| 26 | `packages/contracts/src/admin/itinerary/index.ts` | 262 | `fe7fbfa6d41825d6c1de87792586eb2fcfe520638a6aadd26cb16c446609028f` |
| 27 | `packages/contracts/src/admin/itinerary/m1.ts` | 5522 | `1e3fae4c7ed588493a9e4b8c28320568612f48539f94514c0b4fbd1fb7a3ab55` |
| 28 | `packages/contracts/src/admin/money.ts` | 1017 | `2aa623c0f52bb526062fecf608b6360b551e327f03f89bddd1f4473255b6ede6` |
| 29 | `packages/contracts/src/admin/reservations/index.ts` | 276 | `48c44c89faff3347fa7ed23baac913e8f74fd3b551071891b719446ff806bd29` |
| 30 | `packages/contracts/src/admin/reservations/m1.ts` | 2078 | `9e56881ad4dc4aeb6ddf640ea096725dac7d48641ad25313aa136309fc5b7da2` |
| 31 | `packages/contracts/src/admin/trips/index.ts` | 246 | `fa0b0aa32de6c56aa6447db8b58f4a358887bfb8aa1c985257b707f4d75413b0` |
| 32 | `packages/contracts/src/admin/trips/m1.ts` | 3172 | `a4df7395088fa12b0469cdf288d29c481ba9a8675759764ac522d06c14c44903` |
| 33 | `packages/contracts/test/admin-m1-contracts.test.ts` | 5894 | `1edb1f4af8f005961e6a3c482bc472e4d95111834c78ff010450952fa9666111` |
| 34 | `packages/database/src/index.ts` | 698 | `a0e25417c1c7d901308d6702ccd2368ec4b1277fe2502e8ebfb8f9a832c9cab6` |
| 35 | `packages/database/src/trip-operations/m1-operational-slice-repository.ts` | 25926 | `c8d8e5f28a81606bba635b59760f30b82137444258bbab6dfa9fce2c25e8a85a` |
| 36 | `packages/database/src/uuidv7.ts` | 221 | `670a68ffeac6d52b84e9d24659afec337ce84e80ceceeec8cbee1664fa4a243e` |
| 37 | `tests/integration/stage-5-postgresql.test.ts` | 14389 | `dd5bc5fb081697f5690fb186cb5a271d47db3836a4a2c7666e8c3ba2184f5a0b` |
| 38 | `tooling/ci/verify.mjs` | 1644 | `2949d79ff7dd0fe01e74d629d7821c7e6460621831e40804b4df75e210eaf527` |
| 39 | `tooling/database/prepare-postgresql-18.mjs` | 3127 | `4a02280980952cecf4c3cc4cb3fb279195571fc1ba17ecb48ca01eb8f8ccadf5` |
| 40 | `tooling/database/run-stage-5-disposable.mjs` | 10731 | `312244f3072d513a11fef09c7d8d0933c534b50b580d146b3177ad54181bc281` |
| 41 | `tooling/testing/vitest.stage-5.config.ts` | 785 | `f3dfb48ee84e5c44cf138055e3efc0d3fdbd0a1972c5e8c8ab1fdb773f852a16` |
