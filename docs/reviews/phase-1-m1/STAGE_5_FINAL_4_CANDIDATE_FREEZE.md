# TravelOS Phase 1 M1 — Stage 5 final-4 candidate freeze

- **Predecessor:** Stage 4 corrected candidate freeze SHA-256 `1d1784dc2b75f54a5b7634635f53b59403e9fad0bb68b3e7021044ec69102551`
- **Candidate:** Stage 5 final-4 implementation, validation, correction record and evidence bundle
- **Rows:** 44
- **Deterministic aggregate:** `672a32fd6cae3116cb881e9c6611f5a9c826e7b7ec96d28ad944fab3755a7677`
- **Aggregate serialization:** newline-terminated records `relative-path<TAB>bytes<TAB>sha256`, sorted by relative path

| # | Path | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `apps/admin-api/src/app.module.ts` | 191 | `fd56ee5f8360d4c252540c6ebc5e7002054f174c039d32b78e0cd17fcbf0683e` |
| 2 | `apps/admin-api/src/app.ts` | 784 | `4ae216c1bfcbad5f0f4acaa1cde9712b345d2686e1ef8a90d5ecec31f65bd6a4` |
| 3 | `apps/admin-api/src/auth-bridge.ts` | 7570 | `39994326504abab327bcba2b0a8dca06e27a0c60c49cc706b2b881c3cc0251a4` |
| 4 | `apps/admin-api/src/m1-routes.ts` | 17599 | `a32af6481410c40021d1e887fa4d75e238fe10ef8810fd330ebe19ffd8db12f1` |
| 5 | `apps/admin-api/src/main.ts` | 4951 | `7cce814087b6099b34a5ab229baf83d51197ccb1da4ce63e02b224fd42dbb5f1` |
| 6 | `apps/admin-api/test/composed-m1-body-parser.test.ts` | 3150 | `1f5ac5c715e32876d575526cff2bca4a5e29a6bfca5053410c675fcc1796fb48` |
| 7 | `apps/admin-api/test/m1-routes.test.ts` | 13409 | `d9fe0ba52ae0376d3df496ce3f068346f123ecb29a2e68fc6cac721223f2fefd` |
| 8 | `docs/evidence/phase-1-m1/stage-5-final-4/EVIDENCE_INDEX.json` | 2500 | `3eb3c1e1925a74d19984699b3489f4b63749c6c47b861be93dc55d16ed6e89c0` |
| 9 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_4_CANDIDATE_VALIDATION.md` | 653 | `911b35427ef3750cf1c0db30f90541756506e2f688f155ded66d8126e9f8af8f` |
| 10 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_4_IMPLEMENTATION.md` | 1250 | `aef02c5ac2a5e4683f26d54123fdcd641d899ef44d7d1b8fb5110610112fb08e` |
| 11 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_4_REVIEW_CORRECTIONS.md` | 1371 | `067328a63fe29b75e68f8d0b6943ba555985beeecf6788676d66b2def3c6dcf5` |
| 12 | `migrations/0007_stage5_m1_domain_slice.cjs` | 23736 | `2122000b4a04b5a08b4002c02af9dc92e5ff2bbb938307c3ada12c212aa31814` |
| 13 | `migrations/checksums.json` | 1106 | `4850df96b3433194c3a70858e42b02b627eac498af7f226dd7775c06ba24a4aa` |
| 14 | `packages/backend-core/src/index.ts` | 2946 | `2fe6d083ba73ab59435f5a5bddac0904845f98ffd5d973b841351b5230ae35f7` |
| 15 | `packages/backend-core/src/modules/crm/domain/continuity.ts` | 1763 | `7dc267f0bb9be6843e66407cc6bf3fdbc351670cda91ca9a9efd905e6b363197` |
| 16 | `packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts` | 827 | `7252abee19c826f9c30bd62365d846352893b5fad45be5a704d266918fe9a2c6` |
| 17 | `packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts` | 6716 | `09de446a276abb6fd624114adb9d498ebc59985c94282a17cf2058e770406ae1` |
| 18 | `packages/backend-core/src/modules/trip-operations/domain/m1-slice.ts` | 5283 | `28da22804ad1fd82de562b5f04035888eccb3d189413ba0bca87e792db0bf0bf` |
| 19 | `packages/backend-core/src/shared-kernel/money/money.ts` | 5539 | `b4462a77709a8c4eb8120d93154e503a137b9748528abb15e25befb0e2d6ad81` |
| 20 | `packages/backend-core/src/shared-kernel/opaque-id.ts` | 2122 | `cfefb0b58a5e6c20e7e980718c9c68b7d7ace1ae3193493d27feb5db5f55b303` |
| 21 | `packages/backend-core/src/shared-kernel/time.ts` | 2888 | `71451f08a2a40a120393f257d84a880f6acb80a7e9efa5335e7ca56581c373bf` |
| 22 | `packages/backend-core/src/staff-access/permission-registry.ts` | 3885 | `f2fd67cbc5433136692ede2d170b91105f1d9507d312bb39c80bba1dcd7f39ca` |
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
| 37 | `packages/database/src/trip-operations/m1-operational-slice-repository.ts` | 27090 | `761adf12606ce55bc1e57f42651dff87ac73633885624198175ee1315763d113` |
| 38 | `packages/database/src/uuidv7.ts` | 221 | `670a68ffeac6d52b84e9d24659afec337ce84e80ceceeec8cbee1664fa4a243e` |
| 39 | `tests/integration/stage-5-postgresql.test.ts` | 26135 | `30aa52855ef6c85d0e17bd9f677a4403ca09fa868a40768f53b756959cf8754b` |
| 40 | `tooling/ci/verify.mjs` | 1644 | `2949d79ff7dd0fe01e74d629d7821c7e6460621831e40804b4df75e210eaf527` |
| 41 | `tooling/database/prepare-postgresql-18.mjs` | 3127 | `4a02280980952cecf4c3cc4cb3fb279195571fc1ba17ecb48ca01eb8f8ccadf5` |
| 42 | `tooling/database/run-stage-5-disposable.mjs` | 10731 | `312244f3072d513a11fef09c7d8d0933c534b50b580d146b3177ad54181bc281` |
| 43 | `tooling/testing/vitest.config.ts` | 1114 | `64a0280b605bb8125f59bfd81c63734c7212ca7867b212c86147d52c27ee1241` |
| 44 | `tooling/testing/vitest.stage-5.config.ts` | 785 | `f3dfb48ee84e5c44cf138055e3efc0d3fdbd0a1972c5e8c8ab1fdb773f852a16` |
