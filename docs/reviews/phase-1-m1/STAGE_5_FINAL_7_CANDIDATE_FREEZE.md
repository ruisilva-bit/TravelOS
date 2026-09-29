# TravelOS Phase 1 M1 — Stage 5 FINAL-7 candidate freeze

- **Predecessor:** Stage 5 FINAL-6 candidate freeze SHA-256 `c8688ec9d606cf6bcc341dc3a235d68e60a14971623deae4c46abbf23129971e` (historical rejected candidate; preserved unchanged)
- **Candidate:** corrected Stage 5 implementation, FINAL-7 validation and evidence bundle
- **Rows:** 50
- **Deterministic aggregate:** `e2827c25dc48827e1f7e8a2999c29b6a5e42742b2142338ff7a07276c8727d5c`
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
| 8 | `docs/evidence/phase-1-m1/stage-5-final-7/EVIDENCE_INDEX.json` | 2916 | `8db01b6a1e7a270f68d771322229c9809b9de8b6f5539286a5e92b69b6e35e3f` |
| 9 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_7_CANDIDATE_VALIDATION.md` | 5891 | `cd0b5ac0bc44a64c6d446de28ff2e99a55d8a519311a6d23dcf3408673ccb431` |
| 10 | `migrations/0007_stage5_m1_domain_slice.cjs` | 42661 | `148512c1f328fd5a9a77b78f92099e38ac9bee7b0d3e61effbfa37ccefbba6d8` |
| 11 | `migrations/checksums.json` | 1106 | `c116fcf6ccf2653fcb4876885f456b1c53723139af5d6ad9d0de2b7e96f45122` |
| 12 | `package.json` | 5658 | `be217a6b6fc0be6abee751417beb7675bb5ba692868b43a0544e50ea3a737282` |
| 13 | `packages/backend-core/src/agency-organization/agency-bootstrap.ts` | 2068 | `5d485dcdb000a2f81a94ab8ad0d989b79d425bb793e1fcfc9e09977350bb21f0` |
| 14 | `packages/backend-core/src/index.ts` | 3122 | `5639ff4d170993abc102ab84e5b9ead057a5a3b983f26d8271c05b1e88dd7db1` |
| 15 | `packages/backend-core/src/modules/crm/domain/continuity.ts` | 1866 | `2343d90c2cbaa21bd7e54706dde7396d9e23a5d34672945d565dcb019cbafe34` |
| 16 | `packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts` | 1625 | `1fca1f3ba87ab7827aedc3e3a62bdd9f920666700c4cefb9bb32894f6f3d7fd6` |
| 17 | `packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts` | 6935 | `e3736eeff77ed87487f233d5a79a64cbb8d62bb762849d67a73787807ddb9656` |
| 18 | `packages/backend-core/src/modules/trip-operations/domain/m1-slice.ts` | 5297 | `f5f627cf1d852931040060b32e7801aa9a722366a1b7d22380358d53bbac3e30` |
| 19 | `packages/backend-core/src/shared-kernel/money/money.ts` | 5539 | `b4462a77709a8c4eb8120d93154e503a137b9748528abb15e25befb0e2d6ad81` |
| 20 | `packages/backend-core/src/shared-kernel/opaque-id.ts` | 2122 | `cfefb0b58a5e6c20e7e980718c9c68b7d7ace1ae3193493d27feb5db5f55b303` |
| 21 | `packages/backend-core/src/shared-kernel/time.ts` | 4279 | `533868ee4dccc26556cc0cfe32213f5f947701032287c80b78ddc7297bfa5394` |
| 22 | `packages/backend-core/src/staff-access/authorization.ts` | 5249 | `ea970c63755fdede3b61a51d607d36d22c0cf17e97e6fbf221494f39d4b444cb` |
| 23 | `packages/backend-core/src/staff-access/permission-registry.ts` | 3885 | `f2fd67cbc5433136692ede2d170b91105f1d9507d312bb39c80bba1dcd7f39ca` |
| 24 | `packages/backend-core/test/m1/application.test.ts` | 6292 | `74b033bbda55f0d94ef1fcbc4d80b1db9b05554440d1876b642100e9a782a32e` |
| 25 | `packages/backend-core/test/m1/shared-kernel.test.ts` | 5584 | `ce292c85a78482de1cbeb5bae95eab45c007902d009ae2edc51d72272f76a440` |
| 26 | `packages/contracts/src/admin/customers/index.ts` | 322 | `3539498a647aafce33e7bdb5ddeca2a34740c361c54facbaa5d9fea3e63c9a94` |
| 27 | `packages/contracts/src/admin/customers/m1.ts` | 1879 | `7bb4f3fbcbfd424b2bb75f4b79634a8cde4b8de9e85a53320b3b7343878f6c8a` |
| 28 | `packages/contracts/src/admin/index.ts` | 472 | `8fa185f0951bdd807196f2f24f5c2d5eb5b8f78fd25d13e41a8f33168d01a302` |
| 29 | `packages/contracts/src/admin/itinerary/index.ts` | 380 | `d072aaf92eed6afbe99099a8a220f699cb8cb8fa738f0baa24b1744ca1cb5fd7` |
| 30 | `packages/contracts/src/admin/itinerary/m1.ts` | 7432 | `e6d774da15fed2082b0c4e1569bbc705bd720da33084fd597a701e32cbbc0e2c` |
| 31 | `packages/contracts/src/admin/money.ts` | 1371 | `c67de0e02e91f7f151658b99bcbfcf54a1234bf26e3121b50703f63a662e5459` |
| 32 | `packages/contracts/src/admin/reservations/index.ts` | 276 | `48c44c89faff3347fa7ed23baac913e8f74fd3b551071891b719446ff806bd29` |
| 33 | `packages/contracts/src/admin/reservations/m1.ts` | 2078 | `9e56881ad4dc4aeb6ddf640ea096725dac7d48641ad25313aa136309fc5b7da2` |
| 34 | `packages/contracts/src/admin/trips/index.ts` | 246 | `fa0b0aa32de6c56aa6447db8b58f4a358887bfb8aa1c985257b707f4d75413b0` |
| 35 | `packages/contracts/src/admin/trips/m1.ts` | 3200 | `31cd82c755660f92b3bc4847f28dfe02c8e3b2b02ee21da367590539ad39e69a` |
| 36 | `packages/contracts/test/admin-m1-contracts.test.ts` | 10089 | `9660b6f9fd5f5814ac721758800f64732f22650e4cb631a03eb312ca635caca7` |
| 37 | `packages/database/src/index.ts` | 729 | `4d4a530087056c0946aafb81179f6a00ddfab18dd5111c6e4168252b1dd39e7f` |
| 38 | `packages/database/src/staff-access/staff-access-repository.ts` | 19265 | `a55292b781950a0ed2d0840027f4e52c9076d1579083aa3dcab0a2a22ed2f6ed` |
| 39 | `packages/database/src/trip-operations/m1-operational-slice-repository.ts` | 27145 | `f2c5d2c0ff0000b75627ad6195cbe1702ae298d89f05a6640979da3650c06f10` |
| 40 | `packages/database/src/uuidv7.ts` | 221 | `670a68ffeac6d52b84e9d24659afec337ce84e80ceceeec8cbee1664fa4a243e` |
| 41 | `tests/integration/stage-5-postgresql.test.ts` | 49577 | `6d256589497f9934c1e55c0d027884e40b96930c05233cb8292794ddbd3ff7e5` |
| 42 | `tooling/ci/run-stage-5-focused.mjs` | 2605 | `f27e424ffed51c97295de3e6fb1b74f4ed8fafa9fb8837fe6562770a031f919b` |
| 43 | `tooling/ci/scan-source-secrets.mjs` | 10454 | `440c9ca55643ba098ce7398ed43a9c2e73cc79f4dd9d57a3bff03f74ea66881d` |
| 44 | `tooling/ci/stage-5-source-scope.mjs` | 7360 | `7e789f30213dcfa91e31f7ee83836ec00435f90396ff45ed15b392b4c96cba37` |
| 45 | `tooling/ci/test-stage-5-source-scope.mjs` | 2276 | `449362418e2c0e8322ef79989a099b53002b6d03bda54489363ec73247471a99` |
| 46 | `tooling/ci/verify.mjs` | 1704 | `9b6927fb1417520573aaa40b7d140aea663723bb42b4789749ba7607d575f4d0` |
| 47 | `tooling/database/prepare-postgresql-18.mjs` | 3127 | `4a02280980952cecf4c3cc4cb3fb279195571fc1ba17ecb48ca01eb8f8ccadf5` |
| 48 | `tooling/database/run-stage-5-disposable.mjs` | 10731 | `312244f3072d513a11fef09c7d8d0933c534b50b580d146b3177ad54181bc281` |
| 49 | `tooling/testing/vitest.config.ts` | 1114 | `64a0280b605bb8125f59bfd81c63734c7212ca7867b212c86147d52c27ee1241` |
| 50 | `tooling/testing/vitest.stage-5.config.ts` | 785 | `f3dfb48ee84e5c44cf138055e3efc0d3fdbd0a1972c5e8c8ab1fdb773f852a16` |
