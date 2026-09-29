# TravelOS Phase 1 M1 — Stage 5 final-3 candidate freeze

- **Status:** frozen candidate; exact bytes are independently reviewable.
- **Predecessor:** Stage 4 corrected candidate freeze SHA-256 `1d1784dc2b75f54a5b7634635f53b59403e9fad0bb68b3e7021044ec69102551`.
- **Evidence aggregate:** `382dd50399f4b399f9b9ea07fb669f585f93a5b26d3563adb40916c7fae3dcf0`.
- **Rows:** 44.
- **Deterministic aggregate:** `b051aa0d8a8e727d225b45bf2231ede3af1d4902553decef0e17d50ec9d2f26c` (SHA-256 over newline-terminated records `path\0bytes\0sha256`).

| # | Path | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `apps/admin-api/src/app.module.ts` | 191 | `fd56ee5f8360d4c252540c6ebc5e7002054f174c039d32b78e0cd17fcbf0683e` |
| 2 | `apps/admin-api/src/app.ts` | 784 | `4ae216c1bfcbad5f0f4acaa1cde9712b345d2686e1ef8a90d5ecec31f65bd6a4` |
| 3 | `apps/admin-api/src/auth-bridge.ts` | 7570 | `39994326504abab327bcba2b0a8dca06e27a0c60c49cc706b2b881c3cc0251a4` |
| 4 | `apps/admin-api/src/m1-routes.ts` | 16934 | `9f80337c4b49652dbaa08873c20705a307bfe9c34d773a3c8b909668977da67b` |
| 5 | `apps/admin-api/src/main.ts` | 4951 | `7cce814087b6099b34a5ab229baf83d51197ccb1da4ce63e02b224fd42dbb5f1` |
| 6 | `apps/admin-api/test/composed-m1-body-parser.test.ts` | 3150 | `1f5ac5c715e32876d575526cff2bca4a5e29a6bfca5053410c675fcc1796fb48` |
| 7 | `apps/admin-api/test/m1-routes.test.ts` | 12919 | `c343b7fe61379f993748384f09725442988c58a0b6f56ed2f7e8a7a1098617fe` |
| 8 | `docs/evidence/phase-1-m1/stage-5-final-3/EVIDENCE_INDEX.json` | 2470 | `889cdca7b4985ef183eea4ac4dd6f85f8de036698d9b1c58233d89ab41ffb64c` |
| 9 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_3_CANDIDATE_VALIDATION.md` | 889 | `25d3326b9082a45a9886ab7032b813956a71afd3c17316a19641e4d2814a2ca5` |
| 10 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_3_IMPLEMENTATION.md` | 1252 | `164ed030c95fc7e37658f06eda8878d098088c4d956585ec61b76759fe324660` |
| 11 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_3_REVIEW_CORRECTIONS.md` | 1459 | `f3eae71e79076ce94fc13dcf7c3a0a02699be25d0fb9c4e04bf28d0b75095f44` |
| 12 | `migrations/0007_stage5_m1_domain_slice.cjs` | 23437 | `d2f87d3ada71b7ef3c744b85d0e2b0a75ed4dfcd6beb8f25292c52a7abac3cf3` |
| 13 | `migrations/checksums.json` | 1106 | `93a3f3bd885fec9eab5f659e1a25f115d7d568c2ffb1c17d72de6974ddaaf6ff` |
| 14 | `packages/backend-core/src/index.ts` | 2915 | `7366fee2e582088a454d1d37312e383ce7bb55ef5ffd1c36443cd229bcf8e3d0` |
| 15 | `packages/backend-core/src/modules/crm/domain/continuity.ts` | 1763 | `7dc267f0bb9be6843e66407cc6bf3fdbc351670cda91ca9a9efd905e6b363197` |
| 16 | `packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts` | 827 | `7252abee19c826f9c30bd62365d846352893b5fad45be5a704d266918fe9a2c6` |
| 17 | `packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts` | 6716 | `09de446a276abb6fd624114adb9d498ebc59985c94282a17cf2058e770406ae1` |
| 18 | `packages/backend-core/src/modules/trip-operations/domain/m1-slice.ts` | 5283 | `28da22804ad1fd82de562b5f04035888eccb3d189413ba0bca87e792db0bf0bf` |
| 19 | `packages/backend-core/src/shared-kernel/money/money.ts` | 5539 | `b4462a77709a8c4eb8120d93154e503a137b9748528abb15e25befb0e2d6ad81` |
| 20 | `packages/backend-core/src/shared-kernel/opaque-id.ts` | 2122 | `cfefb0b58a5e6c20e7e980718c9c68b7d7ace1ae3193493d27feb5db5f55b303` |
| 21 | `packages/backend-core/src/shared-kernel/time.ts` | 2888 | `71451f08a2a40a120393f257d84a880f6acb80a7e9efa5335e7ca56581c373bf` |
| 22 | `packages/backend-core/src/staff-access/permission-registry.ts` | 2602 | `8682d56953ee8d39e77d5a090591011d9417c536916481f1a4d2fa4b6f2e1fd7` |
| 23 | `packages/backend-core/test/m1/application.test.ts` | 4385 | `d5b578c21c94e5857a850abd11251bc5b6e1da0ad8b870a123ddc6e57d1e00a8` |
| 24 | `packages/backend-core/test/m1/shared-kernel.test.ts` | 4408 | `cf31f89dde0bb52d95bd50f8ac12b7c216290f4abc4efd6bc2fb5e3822e9ff84` |
| 25 | `packages/contracts/src/admin/customers/index.ts` | 279 | `40c446a2d2c56e4d42f1610c976d1e237064910841c4f0c762435d5a46a41069` |
| 26 | `packages/contracts/src/admin/customers/m1.ts` | 1649 | `f5a57830cdfcfb01eb0181bb3533c60f94ccb9e12852909e230b7c06c5294658` |
| 27 | `packages/contracts/src/admin/index.ts` | 472 | `8fa185f0951bdd807196f2f24f5c2d5eb5b8f78fd25d13e41a8f33168d01a302` |
| 28 | `packages/contracts/src/admin/itinerary/index.ts` | 262 | `fe7fbfa6d41825d6c1de87792586eb2fcfe520638a6aadd26cb16c446609028f` |
| 29 | `packages/contracts/src/admin/itinerary/m1.ts` | 5850 | `8f4f7726a156370c8701ea96c4baca57b8a02f899b656b9e9b7bf439147a4f0a` |
| 30 | `packages/contracts/src/admin/money.ts` | 1371 | `c67de0e02e91f7f151658b99bcbfcf54a1234bf26e3121b50703f63a662e5459` |
| 31 | `packages/contracts/src/admin/reservations/index.ts` | 276 | `48c44c89faff3347fa7ed23baac913e8f74fd3b551071891b719446ff806bd29` |
| 32 | `packages/contracts/src/admin/reservations/m1.ts` | 2078 | `9e56881ad4dc4aeb6ddf640ea096725dac7d48641ad25313aa136309fc5b7da2` |
| 33 | `packages/contracts/src/admin/trips/index.ts` | 246 | `fa0b0aa32de6c56aa6447db8b58f4a358887bfb8aa1c985257b707f4d75413b0` |
| 34 | `packages/contracts/src/admin/trips/m1.ts` | 3172 | `a4df7395088fa12b0469cdf288d29c481ba9a8675759764ac522d06c14c44903` |
| 35 | `packages/contracts/test/admin-m1-contracts.test.ts` | 7248 | `09c7a201906e62a8a643e917d604761ff89276f9c42395038c26bba743c250c8` |
| 36 | `packages/database/src/index.ts` | 729 | `4d4a530087056c0946aafb81179f6a00ddfab18dd5111c6e4168252b1dd39e7f` |
| 37 | `packages/database/src/trip-operations/m1-operational-slice-repository.ts` | 26902 | `449feda91523ad6104c425deaf0f24669726989a695ca2418de7c6c659c10a5d` |
| 38 | `packages/database/src/uuidv7.ts` | 221 | `670a68ffeac6d52b84e9d24659afec337ce84e80ceceeec8cbee1664fa4a243e` |
| 39 | `tests/integration/stage-5-postgresql.test.ts` | 23896 | `7a4d7312e6ab40532a4e965699b5ca61fbbd7a5fba208ad43dc92de082725955` |
| 40 | `tooling/ci/verify.mjs` | 1644 | `2949d79ff7dd0fe01e74d629d7821c7e6460621831e40804b4df75e210eaf527` |
| 41 | `tooling/database/prepare-postgresql-18.mjs` | 3127 | `4a02280980952cecf4c3cc4cb3fb279195571fc1ba17ecb48ca01eb8f8ccadf5` |
| 42 | `tooling/database/run-stage-5-disposable.mjs` | 10731 | `312244f3072d513a11fef09c7d8d0933c534b50b580d146b3177ad54181bc281` |
| 43 | `tooling/testing/vitest.config.ts` | 1114 | `64a0280b605bb8125f59bfd81c63734c7212ca7867b212c86147d52c27ee1241` |
| 44 | `tooling/testing/vitest.stage-5.config.ts` | 785 | `f3dfb48ee84e5c44cf138055e3efc0d3fdbd0a1972c5e8c8ab1fdb773f852a16` |
