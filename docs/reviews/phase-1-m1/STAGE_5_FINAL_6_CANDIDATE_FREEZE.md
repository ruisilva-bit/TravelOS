# TravelOS Phase 1 M1 — Stage 5 FINAL-6 candidate freeze

- **Predecessor:** Stage 5 FINAL-5 candidate freeze SHA-256 `9e0afc90eb9a65b611f9959fde868b45cb9d98748e34caaacccbdd47ea7a019e` (historical rejected candidate; preserved unchanged)
- **Candidate:** corrected Stage 5 implementation, FINAL-6 validation and evidence bundle
- **Rows:** 47
- **Deterministic aggregate:** `4008116ea98b419b6cc53e7b4582df2d22fa30fa09f0d0be9d2e82efd98ad9dc`
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
| 8 | `docs/evidence/phase-1-m1/stage-5-final-6/EVIDENCE_INDEX.json` | 2915 | `42e91abbd65697a6c6a3b86384cddcaa195c28f6f293ee1cf29a6dad72a2c7a4` |
| 9 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_6_CANDIDATE_VALIDATION.md` | 4702 | `7fc0628d41eb44e33e194a609472cf1da0d3e0709c470359e1e340b320d0bd1e` |
| 10 | `migrations/0007_stage5_m1_domain_slice.cjs` | 38218 | `a1f2e1ce9dcb50616cf71093d666573e5f468a6c92a9c704d1e83dfe739fafe2` |
| 11 | `migrations/checksums.json` | 1106 | `2032b377ba6a03c71c703999717343b5c2e4cced839ed16acf218d7e939546f9` |
| 12 | `package.json` | 5588 | `42fe1b3df9c7d9ca28900b44d165a760f5a4649dec9918b3956f2a390c009415` |
| 13 | `packages/backend-core/src/index.ts` | 3122 | `5639ff4d170993abc102ab84e5b9ead057a5a3b983f26d8271c05b1e88dd7db1` |
| 14 | `packages/backend-core/src/modules/crm/domain/continuity.ts` | 1866 | `2343d90c2cbaa21bd7e54706dde7396d9e23a5d34672945d565dcb019cbafe34` |
| 15 | `packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts` | 1563 | `5b0426d6ff4fc1cf253e4f8c59a1d90a8f2e2915de004a50c72e55767ad86e68` |
| 16 | `packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts` | 6825 | `a80c3036cdec45a4d07920e271b18453d4bb82aeaef95ee01ee34b12ec5ce0fc` |
| 17 | `packages/backend-core/src/modules/trip-operations/domain/m1-slice.ts` | 5297 | `f5f627cf1d852931040060b32e7801aa9a722366a1b7d22380358d53bbac3e30` |
| 18 | `packages/backend-core/src/shared-kernel/money/money.ts` | 5539 | `b4462a77709a8c4eb8120d93154e503a137b9748528abb15e25befb0e2d6ad81` |
| 19 | `packages/backend-core/src/shared-kernel/opaque-id.ts` | 2122 | `cfefb0b58a5e6c20e7e980718c9c68b7d7ace1ae3193493d27feb5db5f55b303` |
| 20 | `packages/backend-core/src/shared-kernel/time.ts` | 4279 | `533868ee4dccc26556cc0cfe32213f5f947701032287c80b78ddc7297bfa5394` |
| 21 | `packages/backend-core/src/staff-access/authorization.ts` | 5249 | `ea970c63755fdede3b61a51d607d36d22c0cf17e97e6fbf221494f39d4b444cb` |
| 22 | `packages/backend-core/src/staff-access/permission-registry.ts` | 3885 | `f2fd67cbc5433136692ede2d170b91105f1d9507d312bb39c80bba1dcd7f39ca` |
| 23 | `packages/backend-core/test/m1/application.test.ts` | 5389 | `0612d60235ec60a8a4400468681d7d829bbb6a113e3747d62d423bd3aaa25c91` |
| 24 | `packages/backend-core/test/m1/shared-kernel.test.ts` | 5584 | `ce292c85a78482de1cbeb5bae95eab45c007902d009ae2edc51d72272f76a440` |
| 25 | `packages/contracts/src/admin/customers/index.ts` | 322 | `3539498a647aafce33e7bdb5ddeca2a34740c361c54facbaa5d9fea3e63c9a94` |
| 26 | `packages/contracts/src/admin/customers/m1.ts` | 1879 | `7bb4f3fbcbfd424b2bb75f4b79634a8cde4b8de9e85a53320b3b7343878f6c8a` |
| 27 | `packages/contracts/src/admin/index.ts` | 472 | `8fa185f0951bdd807196f2f24f5c2d5eb5b8f78fd25d13e41a8f33168d01a302` |
| 28 | `packages/contracts/src/admin/itinerary/index.ts` | 262 | `fe7fbfa6d41825d6c1de87792586eb2fcfe520638a6aadd26cb16c446609028f` |
| 29 | `packages/contracts/src/admin/itinerary/m1.ts` | 6520 | `418c40ff8a43d424d6dae1d509ed827c28db55735e8f4bc57f5d1bd366608e47` |
| 30 | `packages/contracts/src/admin/money.ts` | 1371 | `c67de0e02e91f7f151658b99bcbfcf54a1234bf26e3121b50703f63a662e5459` |
| 31 | `packages/contracts/src/admin/reservations/index.ts` | 276 | `48c44c89faff3347fa7ed23baac913e8f74fd3b551071891b719446ff806bd29` |
| 32 | `packages/contracts/src/admin/reservations/m1.ts` | 2078 | `9e56881ad4dc4aeb6ddf640ea096725dac7d48641ad25313aa136309fc5b7da2` |
| 33 | `packages/contracts/src/admin/trips/index.ts` | 246 | `fa0b0aa32de6c56aa6447db8b58f4a358887bfb8aa1c985257b707f4d75413b0` |
| 34 | `packages/contracts/src/admin/trips/m1.ts` | 3200 | `31cd82c755660f92b3bc4847f28dfe02c8e3b2b02ee21da367590539ad39e69a` |
| 35 | `packages/contracts/test/admin-m1-contracts.test.ts` | 8772 | `a07b38a125896671272592511fb2dc1d63eb63e16bd22a07579b91e504c4daea` |
| 36 | `packages/database/src/index.ts` | 729 | `4d4a530087056c0946aafb81179f6a00ddfab18dd5111c6e4168252b1dd39e7f` |
| 37 | `packages/database/src/trip-operations/m1-operational-slice-repository.ts` | 27145 | `f2c5d2c0ff0000b75627ad6195cbe1702ae298d89f05a6640979da3650c06f10` |
| 38 | `packages/database/src/uuidv7.ts` | 221 | `670a68ffeac6d52b84e9d24659afec337ce84e80ceceeec8cbee1664fa4a243e` |
| 39 | `tests/integration/stage-5-postgresql.test.ts` | 40029 | `50c898d3bc9eb50ae6bb0dde8ea7e05158713dde70dd68740281b7c639f4a2fa` |
| 40 | `tooling/ci/scan-source-secrets.mjs` | 10454 | `440c9ca55643ba098ce7398ed43a9c2e73cc79f4dd9d57a3bff03f74ea66881d` |
| 41 | `tooling/ci/stage-5-source-scope.mjs` | 6208 | `0d9d07ed81ee42e0665140968267cd6291c2accc880fc921912738c9ddfc7126` |
| 42 | `tooling/ci/test-stage-5-source-scope.mjs` | 1537 | `055636b4eb6893fda51e43a8e44899375949228d9423e6040a57fa8000affdbb` |
| 43 | `tooling/ci/verify.mjs` | 1704 | `9b6927fb1417520573aaa40b7d140aea663723bb42b4789749ba7607d575f4d0` |
| 44 | `tooling/database/prepare-postgresql-18.mjs` | 3127 | `4a02280980952cecf4c3cc4cb3fb279195571fc1ba17ecb48ca01eb8f8ccadf5` |
| 45 | `tooling/database/run-stage-5-disposable.mjs` | 10731 | `312244f3072d513a11fef09c7d8d0933c534b50b580d146b3177ad54181bc281` |
| 46 | `tooling/testing/vitest.config.ts` | 1114 | `64a0280b605bb8125f59bfd81c63734c7212ca7867b212c86147d52c27ee1241` |
| 47 | `tooling/testing/vitest.stage-5.config.ts` | 785 | `f3dfb48ee84e5c44cf138055e3efc0d3fdbd0a1972c5e8c8ab1fdb773f852a16` |
