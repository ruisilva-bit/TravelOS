# TravelOS Phase 1 M1 — Stage 5 final candidate freeze

- **Stage:** Phase 1 M1 / Stage 5 final generation
- **Status:** CANDIDATE — eligible for a fresh genuine independent review; not closure
- **Scope:** Final Person / Customer / TripTraveller, Trip, Flight, Accommodation, Reservation, ReservationItemLink, exact Money/INTERNAL_ONLY sentinel, persistence, Admin contracts/API, PostgreSQL qualification and CI
- **Predecessor closure:** `docs/reviews/phase-1-m1/STAGE_4_INDEPENDENT_CLOSURE.md`
- **Predecessor corrected freeze SHA-256:** `1d1784dc2b75f54a5b7634635f53b59403e9fad0bb68b3e7021044ec69102551`
- **Final evidence index:** `docs/evidence/phase-1-m1/stage-5-final/EVIDENCE_INDEX.json` — aggregate `cd2c1413715838a36faacfe09bb710ceddd0eb4dd7e8f6a10d757ce6d7012007`
- **Entry count:** 44
- **Deterministic aggregate:** `282a90ab8ff45205eb0d8fbd1449976e74e2e0856535091cd1eae689f9659cbc`
- **Aggregate algorithm:** `sha256(path\0bytes\0sha256 joined by LF in sorted path order)`
- **Excluded outputs:** this final candidate freeze, the fresh independent review, and the independent closure; superseded Stage 5 freeze/evidence remain historical and are not rewritten

The rows below are the exact final candidate bytes. This freeze is deliberately excluded from its own rows. Reviewers must recompute every row, the aggregate, the evidence aggregate and the predecessor hash before semantic review. Any listed-byte change invalidates this candidate and requires a new freeze generation; do not edit listed bytes during review.

| # | Path | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `apps/admin-api/src/app.module.ts` | 191 | `fd56ee5f8360d4c252540c6ebc5e7002054f174c039d32b78e0cd17fcbf0683e` |
| 2 | `apps/admin-api/src/app.ts` | 784 | `4ae216c1bfcbad5f0f4acaa1cde9712b345d2686e1ef8a90d5ecec31f65bd6a4` |
| 3 | `apps/admin-api/src/auth-bridge.ts` | 7570 | `39994326504abab327bcba2b0a8dca06e27a0c60c49cc706b2b881c3cc0251a4` |
| 4 | `apps/admin-api/src/m1-routes.ts` | 16900 | `3a0a5e18c5866de7a15cbdcedbecacc1adf36882f4cc5e6133428fd648783203` |
| 5 | `apps/admin-api/src/main.ts` | 4951 | `7cce814087b6099b34a5ab229baf83d51197ccb1da4ce63e02b224fd42dbb5f1` |
| 6 | `apps/admin-api/test/composed-m1-body-parser.test.ts` | 3150 | `1f5ac5c715e32876d575526cff2bca4a5e29a6bfca5053410c675fcc1796fb48` |
| 7 | `apps/admin-api/test/m1-routes.test.ts` | 11869 | `d2c8afff581b18af4678ac083623649c0c9995436d56a5a80f45d4ebad2618d8` |
| 8 | `docs/evidence/phase-1-m1/stage-5-final/EVIDENCE_INDEX.json` | 2626 | `a4913093dfd7bfcc006452b14412cc513d615829f44f334d9a4fd13a9f910c0c` |
| 9 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_CANDIDATE_VALIDATION.md` | 2852 | `cfb607aa86fbe4bb32ab17af7093d1f6365dce3cfa7e82208f21edd3918037d9` |
| 10 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_IMPLEMENTATION.md` | 3138 | `db454266cc80b67af2017e49e1691b8941eae4f9b3a989d5b3a0144545d07b4f` |
| 11 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_REVIEW_CORRECTIONS.md` | 3396 | `93494a54428ea7fac0830d0ed4f3e807d4062e1a56e35ecf33688f4cb6039a2d` |
| 12 | `migrations/0007_stage5_m1_domain_slice.cjs` | 22012 | `044bf4147cf140670995ed99911e042e1a9999cce99e43e86ef59ed96aaac1f1` |
| 13 | `migrations/checksums.json` | 1106 | `52779181fa8e4312763d37c3fabbddda46d5ba36aad10caa015a8f8f639c4c84` |
| 14 | `packages/backend-core/src/index.ts` | 2915 | `7366fee2e582088a454d1d37312e383ce7bb55ef5ffd1c36443cd229bcf8e3d0` |
| 15 | `packages/backend-core/src/modules/crm/domain/continuity.ts` | 1763 | `7dc267f0bb9be6843e66407cc6bf3fdbc351670cda91ca9a9efd905e6b363197` |
| 16 | `packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts` | 827 | `7252abee19c826f9c30bd62365d846352893b5fad45be5a704d266918fe9a2c6` |
| 17 | `packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts` | 6716 | `09de446a276abb6fd624114adb9d498ebc59985c94282a17cf2058e770406ae1` |
| 18 | `packages/backend-core/src/modules/trip-operations/domain/m1-slice.ts` | 5283 | `28da22804ad1fd82de562b5f04035888eccb3d189413ba0bca87e792db0bf0bf` |
| 19 | `packages/backend-core/src/shared-kernel/money/money.ts` | 5539 | `b4462a77709a8c4eb8120d93154e503a137b9748528abb15e25befb0e2d6ad81` |
| 20 | `packages/backend-core/src/shared-kernel/opaque-id.ts` | 2122 | `cfefb0b58a5e6c20e7e980718c9c68b7d7ace1ae3193493d27feb5db5f55b303` |
| 21 | `packages/backend-core/src/shared-kernel/time.ts` | 2861 | `48085a9e7d07ebca5ac070521583b91942be2d7b4a1f818df638664a79abb3cc` |
| 22 | `packages/backend-core/src/staff-access/permission-registry.ts` | 2602 | `8682d56953ee8d39e77d5a090591011d9417c536916481f1a4d2fa4b6f2e1fd7` |
| 23 | `packages/backend-core/test/m1/application.test.ts` | 3891 | `39bf29eda73ed53f6a984fd6c12cfd4127b61404ae2e231f21e367892c2b4d18` |
| 24 | `packages/backend-core/test/m1/shared-kernel.test.ts` | 3496 | `c9e69448c84bc1d60dc0f3c26a4e31d1a365b323e53262f69607a8b5f80e5181` |
| 25 | `packages/contracts/src/admin/customers/index.ts` | 279 | `40c446a2d2c56e4d42f1610c976d1e237064910841c4f0c762435d5a46a41069` |
| 26 | `packages/contracts/src/admin/customers/m1.ts` | 1649 | `f5a57830cdfcfb01eb0181bb3533c60f94ccb9e12852909e230b7c06c5294658` |
| 27 | `packages/contracts/src/admin/index.ts` | 472 | `8fa185f0951bdd807196f2f24f5c2d5eb5b8f78fd25d13e41a8f33168d01a302` |
| 28 | `packages/contracts/src/admin/itinerary/index.ts` | 262 | `fe7fbfa6d41825d6c1de87792586eb2fcfe520638a6aadd26cb16c446609028f` |
| 29 | `packages/contracts/src/admin/itinerary/m1.ts` | 5823 | `905c7fb4e8baee5a9ab7f64698c4a8a0038bc5d43801bcfbf4e02fd8c5c3251f` |
| 30 | `packages/contracts/src/admin/money.ts` | 1371 | `c67de0e02e91f7f151658b99bcbfcf54a1234bf26e3121b50703f63a662e5459` |
| 31 | `packages/contracts/src/admin/reservations/index.ts` | 276 | `48c44c89faff3347fa7ed23baac913e8f74fd3b551071891b719446ff806bd29` |
| 32 | `packages/contracts/src/admin/reservations/m1.ts` | 2078 | `9e56881ad4dc4aeb6ddf640ea096725dac7d48641ad25313aa136309fc5b7da2` |
| 33 | `packages/contracts/src/admin/trips/index.ts` | 246 | `fa0b0aa32de6c56aa6447db8b58f4a358887bfb8aa1c985257b707f4d75413b0` |
| 34 | `packages/contracts/src/admin/trips/m1.ts` | 3172 | `a4df7395088fa12b0469cdf288d29c481ba9a8675759764ac522d06c14c44903` |
| 35 | `packages/contracts/test/admin-m1-contracts.test.ts` | 6306 | `d44406255f465791940702178a1abc89813c690b0cdc87961fc8e550a5374ef5` |
| 36 | `packages/database/src/index.ts` | 698 | `a0e25417c1c7d901308d6702ccd2368ec4b1277fe2502e8ebfb8f9a832c9cab6` |
| 37 | `packages/database/src/trip-operations/m1-operational-slice-repository.ts` | 26098 | `c55191e2fb8029738b3667bd8c9aa8688c9e613b2e9e18d22e015dce471cbf54` |
| 38 | `packages/database/src/uuidv7.ts` | 221 | `670a68ffeac6d52b84e9d24659afec337ce84e80ceceeec8cbee1664fa4a243e` |
| 39 | `tests/integration/stage-5-postgresql.test.ts` | 16306 | `ed336a1ed64d058c821469f9aa6b2188aa3af8706fd1a29f0c4a5f72675b3fa6` |
| 40 | `tooling/ci/verify.mjs` | 1644 | `2949d79ff7dd0fe01e74d629d7821c7e6460621831e40804b4df75e210eaf527` |
| 41 | `tooling/database/prepare-postgresql-18.mjs` | 3127 | `4a02280980952cecf4c3cc4cb3fb279195571fc1ba17ecb48ca01eb8f8ccadf5` |
| 42 | `tooling/database/run-stage-5-disposable.mjs` | 10731 | `312244f3072d513a11fef09c7d8d0933c534b50b580d146b3177ad54181bc281` |
| 43 | `tooling/testing/vitest.config.ts` | 1114 | `64a0280b605bb8125f59bfd81c63734c7212ca7867b212c86147d52c27ee1241` |
| 44 | `tooling/testing/vitest.stage-5.config.ts` | 785 | `f3dfb48ee84e5c44cf138055e3efc0d3fdbd0a1972c5e8c8ab1fdb773f852a16` |
