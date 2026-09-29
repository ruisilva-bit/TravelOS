# TravelOS Phase 1 M1 — Stage 5 FINAL-5 candidate freeze

- **Predecessor:** Stage 5 FINAL-4 candidate freeze SHA-256 `ef893e4ef6ebafb68c3aef49a01db5fbd5d10ec4a4975f244c28761032a1e292` (historical rejected candidate; preserved unchanged)
- **Candidate:** corrected Stage 5 implementation, FINAL-5 validation and evidence bundle
- **Rows:** 47
- **Deterministic aggregate:** `5085d952974ecff28a0ccabf8a4874139a6cac4794e8bc9422d9d171d726a774`
- **Aggregate serialization:** newline-terminated records `relative-path<TAB>bytes<TAB>sha256`, sorted by relative path

| # | Path | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `apps/admin-api/src/app.module.ts` | 191 | `fd56ee5f8360d4c252540c6ebc5e7002054f174c039d32b78e0cd17fcbf0683e` |
| 2 | `apps/admin-api/src/app.ts` | 784 | `4ae216c1bfcbad5f0f4acaa1cde9712b345d2686e1ef8a90d5ecec31f65bd6a4` |
| 3 | `apps/admin-api/src/auth-bridge.ts` | 7570 | `39994326504abab327bcba2b0a8dca06e27a0c60c49cc706b2b881c3cc0251a4` |
| 4 | `apps/admin-api/src/m1-routes.ts` | 17659 | `53fcc05c3c82e01967b44bb69dfd10449e5020d24e0e6b366621338fc2e08660` |
| 5 | `apps/admin-api/src/main.ts` | 4951 | `7cce814087b6099b34a5ab229baf83d51197ccb1da4ce63e02b224fd42dbb5f1` |
| 6 | `apps/admin-api/test/composed-m1-body-parser.test.ts` | 3587 | `f5ba81fd23d6070c9c39a3ec914097f9275792df686ac9dbc74fa8d6eab69e31` |
| 7 | `apps/admin-api/test/m1-routes.test.ts` | 13409 | `d9fe0ba52ae0376d3df496ce3f068346f123ecb29a2e68fc6cac721223f2fefd` |
| 8 | `docs/evidence/phase-1-m1/stage-5-final-5/EVIDENCE_INDEX.json` | 2915 | `8d758420cd7c397bd2dfb6186e23c6a523a521d68db4cb1242929568aa293bf7` |
| 9 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_5_CANDIDATE_VALIDATION.md` | 3443 | `f40ca0f4fbd638bc72abd73eb9bbb0f57cf7b554e0b668c0fb1c4203868fe052` |
| 10 | `migrations/0007_stage5_m1_domain_slice.cjs` | 27675 | `2a49d6c026a6aefa1b4b7334982c5b3dc925655e25b7658d667e978bbeb3458d` |
| 11 | `migrations/checksums.json` | 1106 | `dad96b63d1067e71d46764efd310b82b2fd8f8372c8aec38a319ea1778f3402a` |
| 12 | `package.json` | 5588 | `42fe1b3df9c7d9ca28900b44d165a760f5a4649dec9918b3956f2a390c009415` |
| 13 | `packages/backend-core/src/index.ts` | 2946 | `2fe6d083ba73ab59435f5a5bddac0904845f98ffd5d973b841351b5230ae35f7` |
| 14 | `packages/backend-core/src/modules/crm/domain/continuity.ts` | 1763 | `7dc267f0bb9be6843e66407cc6bf3fdbc351670cda91ca9a9efd905e6b363197` |
| 15 | `packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts` | 827 | `7252abee19c826f9c30bd62365d846352893b5fad45be5a704d266918fe9a2c6` |
| 16 | `packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts` | 6825 | `a80c3036cdec45a4d07920e271b18453d4bb82aeaef95ee01ee34b12ec5ce0fc` |
| 17 | `packages/backend-core/src/modules/trip-operations/domain/m1-slice.ts` | 5283 | `28da22804ad1fd82de562b5f04035888eccb3d189413ba0bca87e792db0bf0bf` |
| 18 | `packages/backend-core/src/shared-kernel/money/money.ts` | 5539 | `b4462a77709a8c4eb8120d93154e503a137b9748528abb15e25befb0e2d6ad81` |
| 19 | `packages/backend-core/src/shared-kernel/opaque-id.ts` | 2122 | `cfefb0b58a5e6c20e7e980718c9c68b7d7ace1ae3193493d27feb5db5f55b303` |
| 20 | `packages/backend-core/src/shared-kernel/time.ts` | 2888 | `71451f08a2a40a120393f257d84a880f6acb80a7e9efa5335e7ca56581c373bf` |
| 21 | `packages/backend-core/src/staff-access/authorization.ts` | 5249 | `ea970c63755fdede3b61a51d607d36d22c0cf17e97e6fbf221494f39d4b444cb` |
| 22 | `packages/backend-core/src/staff-access/permission-registry.ts` | 3885 | `f2fd67cbc5433136692ede2d170b91105f1d9507d312bb39c80bba1dcd7f39ca` |
| 23 | `packages/backend-core/test/m1/application.test.ts` | 4653 | `a2bce29c8c486dc4f88aca2e43b176253cc9841ddf6dee198284416465f77a1d` |
| 24 | `packages/backend-core/test/m1/shared-kernel.test.ts` | 4408 | `cf31f89dde0bb52d95bd50f8ac12b7c216290f4abc4efd6bc2fb5e3822e9ff84` |
| 25 | `packages/contracts/src/admin/customers/index.ts` | 279 | `40c446a2d2c56e4d42f1610c976d1e237064910841c4f0c762435d5a46a41069` |
| 26 | `packages/contracts/src/admin/customers/m1.ts` | 1732 | `61f0588bc6c7eb5924f36a0a702431c1bfd81045f83849d25ff2723647fdb4ce` |
| 27 | `packages/contracts/src/admin/index.ts` | 472 | `8fa185f0951bdd807196f2f24f5c2d5eb5b8f78fd25d13e41a8f33168d01a302` |
| 28 | `packages/contracts/src/admin/itinerary/index.ts` | 262 | `fe7fbfa6d41825d6c1de87792586eb2fcfe520638a6aadd26cb16c446609028f` |
| 29 | `packages/contracts/src/admin/itinerary/m1.ts` | 5850 | `8f4f7726a156370c8701ea96c4baca57b8a02f899b656b9e9b7bf439147a4f0a` |
| 30 | `packages/contracts/src/admin/money.ts` | 1371 | `c67de0e02e91f7f151658b99bcbfcf54a1234bf26e3121b50703f63a662e5459` |
| 31 | `packages/contracts/src/admin/reservations/index.ts` | 276 | `48c44c89faff3347fa7ed23baac913e8f74fd3b551071891b719446ff806bd29` |
| 32 | `packages/contracts/src/admin/reservations/m1.ts` | 2078 | `9e56881ad4dc4aeb6ddf640ea096725dac7d48641ad25313aa136309fc5b7da2` |
| 33 | `packages/contracts/src/admin/trips/index.ts` | 246 | `fa0b0aa32de6c56aa6447db8b58f4a358887bfb8aa1c985257b707f4d75413b0` |
| 34 | `packages/contracts/src/admin/trips/m1.ts` | 3186 | `d560a0be441adf75484a61b29259ce97636e7e6c882c49136eda0633a4c97c29` |
| 35 | `packages/contracts/test/admin-m1-contracts.test.ts` | 7542 | `9e93ceeaadfd18ab97c8659ab78a3f11c38ab90123dfca1b1f3091702b7e6f2e` |
| 36 | `packages/database/src/index.ts` | 729 | `4d4a530087056c0946aafb81179f6a00ddfab18dd5111c6e4168252b1dd39e7f` |
| 37 | `packages/database/src/trip-operations/m1-operational-slice-repository.ts` | 27169 | `63b9d07c956e1ee6fc79241c9d2044c540e0d01d9e6b7d6a7061d527ca445b3d` |
| 38 | `packages/database/src/uuidv7.ts` | 221 | `670a68ffeac6d52b84e9d24659afec337ce84e80ceceeec8cbee1664fa4a243e` |
| 39 | `tests/integration/stage-5-postgresql.test.ts` | 29283 | `57aaac9500cf1cfa8fdc617bfd798b2aaf3520b02272fe978909177aa2d4689b` |
| 40 | `tooling/ci/scan-source-secrets.mjs` | 10454 | `440c9ca55643ba098ce7398ed43a9c2e73cc79f4dd9d57a3bff03f74ea66881d` |
| 41 | `tooling/ci/stage-5-source-scope.mjs` | 6208 | `0d9d07ed81ee42e0665140968267cd6291c2accc880fc921912738c9ddfc7126` |
| 42 | `tooling/ci/test-stage-5-source-scope.mjs` | 1537 | `055636b4eb6893fda51e43a8e44899375949228d9423e6040a57fa8000affdbb` |
| 43 | `tooling/ci/verify.mjs` | 1704 | `9b6927fb1417520573aaa40b7d140aea663723bb42b4789749ba7607d575f4d0` |
| 44 | `tooling/database/prepare-postgresql-18.mjs` | 3127 | `4a02280980952cecf4c3cc4cb3fb279195571fc1ba17ecb48ca01eb8f8ccadf5` |
| 45 | `tooling/database/run-stage-5-disposable.mjs` | 10731 | `312244f3072d513a11fef09c7d8d0933c534b50b580d146b3177ad54181bc281` |
| 46 | `tooling/testing/vitest.config.ts` | 1114 | `64a0280b605bb8125f59bfd81c63734c7212ca7867b212c86147d52c27ee1241` |
| 47 | `tooling/testing/vitest.stage-5.config.ts` | 785 | `f3dfb48ee84e5c44cf138055e3efc0d3fdbd0a1972c5e8c8ab1fdb773f852a16` |
