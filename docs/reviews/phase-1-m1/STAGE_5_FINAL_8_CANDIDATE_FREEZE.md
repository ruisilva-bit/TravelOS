# TravelOS Phase 1 M1 — Stage 5 FINAL-8 candidate freeze

- **Predecessor:** Stage 5 FINAL-7 candidate freeze SHA-256 `9197feedbf631f7ae79c3d4ff5dabae1962a4758ecb46a455c39d85a2f2b168f` (historical rejected candidate; preserved unchanged)
- **Candidate:** corrected Stage 5 implementation, FINAL-8 validation and FINAL-8 evidence bundle
- **Rows:** 51
- **Deterministic aggregate:** `c6bfbf895e454268281e67099eb216b8d324b0776cdd8bbffe092bf6707fc0f4`
- **Aggregate serialization:** newline-terminated records `relative-path<TAB>bytes<TAB>sha256`, sorted by relative path

| # | Path | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `apps/admin-api/src/app.module.ts` | 191 | `fd56ee5f8360d4c252540c6ebc5e7002054f174c039d32b78e0cd17fcbf0683e` |
| 2 | `apps/admin-api/src/app.ts` | 784 | `4ae216c1bfcbad5f0f4acaa1cde9712b345d2686e1ef8a90d5ecec31f65bd6a4` |
| 3 | `apps/admin-api/src/auth-bridge.ts` | 7628 | `f99283857bd9858a47bff32591a58e0662d16bbe9650c3e856a8a472a7d8757a` |
| 4 | `apps/admin-api/src/m1-routes.ts` | 17659 | `53fcc05c3c82e01967b44bb69dfd10449e5020d24e0e6b366621338fc2e08660` |
| 5 | `apps/admin-api/src/main.ts` | 4951 | `7cce814087b6099b34a5ab229baf83d51197ccb1da4ce63e02b224fd42dbb5f1` |
| 6 | `apps/admin-api/test/auth-bridge.test.ts` | 7837 | `ca4e51a6f845f0e15f60a99eafa10c216a9a0225ec79cc830d922138ca6ae3a5` |
| 7 | `apps/admin-api/test/composed-m1-body-parser.test.ts` | 3587 | `f5ba81fd23d6070c9c39a3ec914097f9275792df686ac9dbc74fa8d6eab69e31` |
| 8 | `apps/admin-api/test/m1-routes.test.ts` | 13409 | `d9fe0ba52ae0376d3df496ce3f068346f123ecb29a2e68fc6cac721223f2fefd` |
| 9 | `docs/evidence/phase-1-m1/stage-5-final-8/EVIDENCE_INDEX.json` | 3116 | `ef6cb9987c83928894ec2aa1f739ae8bfcbec297406b3d98f5f6f4ac1e9d5397` |
| 10 | `docs/reviews/phase-1-m1/STAGE_5_FINAL_8_CANDIDATE_VALIDATION.md` | 8577 | `56cfcf8db487d842e7e01b039b62a015af6faf37ac43fd8f7fe4735929842e75` |
| 11 | `migrations/0007_stage5_m1_domain_slice.cjs` | 47172 | `e52672ef7d720488b7b274cef30f3c89d68d8dd88fc616dc8baf356ac5265ddf` |
| 12 | `migrations/checksums.json` | 1106 | `93895424045706b1043ed9741b8ea06f650521705260c1122115fe63b39e455e` |
| 13 | `package.json` | 5658 | `be217a6b6fc0be6abee751417beb7675bb5ba692868b43a0544e50ea3a737282` |
| 14 | `packages/backend-core/src/agency-organization/agency-bootstrap.ts` | 2068 | `5d485dcdb000a2f81a94ab8ad0d989b79d425bb793e1fcfc9e09977350bb21f0` |
| 15 | `packages/backend-core/src/index.ts` | 3122 | `5639ff4d170993abc102ab84e5b9ead057a5a3b983f26d8271c05b1e88dd7db1` |
| 16 | `packages/backend-core/src/modules/crm/domain/continuity.ts` | 1866 | `2343d90c2cbaa21bd7e54706dde7396d9e23a5d34672945d565dcb019cbafe34` |
| 17 | `packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts` | 1625 | `1fca1f3ba87ab7827aedc3e3a62bdd9f920666700c4cefb9bb32894f6f3d7fd6` |
| 18 | `packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts` | 16429 | `65462782ede32444370f4549471b28014f97063db3e4ba0d6eb4d0238d57611f` |
| 19 | `packages/backend-core/src/modules/trip-operations/domain/m1-slice.ts` | 5297 | `f5f627cf1d852931040060b32e7801aa9a722366a1b7d22380358d53bbac3e30` |
| 20 | `packages/backend-core/src/shared-kernel/money/money.ts` | 5539 | `b4462a77709a8c4eb8120d93154e503a137b9748528abb15e25befb0e2d6ad81` |
| 21 | `packages/backend-core/src/shared-kernel/opaque-id.ts` | 2122 | `cfefb0b58a5e6c20e7e980718c9c68b7d7ace1ae3193493d27feb5db5f55b303` |
| 22 | `packages/backend-core/src/shared-kernel/time.ts` | 4317 | `fffe9e7321bd7645bf4bce51355b7df12115d41b315148eb78aad729a1e9278c` |
| 23 | `packages/backend-core/src/staff-access/authorization.ts` | 5249 | `ea970c63755fdede3b61a51d607d36d22c0cf17e97e6fbf221494f39d4b444cb` |
| 24 | `packages/backend-core/src/staff-access/permission-registry.ts` | 3885 | `f2fd67cbc5433136692ede2d170b91105f1d9507d312bb39c80bba1dcd7f39ca` |
| 25 | `packages/backend-core/test/m1/application.test.ts` | 8214 | `b07bbeff439da6176b31b1bc5f22e171dd2eecc75848890e95bd6a056a61e8e8` |
| 26 | `packages/backend-core/test/m1/shared-kernel.test.ts` | 6048 | `40fa59ab0e8d8c00b764490727585da5aedb9a35d2463252e2e29ff1c1a6e700` |
| 27 | `packages/contracts/src/admin/customers/index.ts` | 322 | `3539498a647aafce33e7bdb5ddeca2a34740c361c54facbaa5d9fea3e63c9a94` |
| 28 | `packages/contracts/src/admin/customers/m1.ts` | 1879 | `7bb4f3fbcbfd424b2bb75f4b79634a8cde4b8de9e85a53320b3b7343878f6c8a` |
| 29 | `packages/contracts/src/admin/index.ts` | 472 | `8fa185f0951bdd807196f2f24f5c2d5eb5b8f78fd25d13e41a8f33168d01a302` |
| 30 | `packages/contracts/src/admin/itinerary/index.ts` | 380 | `d072aaf92eed6afbe99099a8a220f699cb8cb8fa738f0baa24b1744ca1cb5fd7` |
| 31 | `packages/contracts/src/admin/itinerary/m1.ts` | 7472 | `3173dffff88ef9af998b71018d2a2d3cd7be78cf150986d192126553a7d168f6` |
| 32 | `packages/contracts/src/admin/money.ts` | 1371 | `c67de0e02e91f7f151658b99bcbfcf54a1234bf26e3121b50703f63a662e5459` |
| 33 | `packages/contracts/src/admin/reservations/index.ts` | 276 | `48c44c89faff3347fa7ed23baac913e8f74fd3b551071891b719446ff806bd29` |
| 34 | `packages/contracts/src/admin/reservations/m1.ts` | 2078 | `9e56881ad4dc4aeb6ddf640ea096725dac7d48641ad25313aa136309fc5b7da2` |
| 35 | `packages/contracts/src/admin/trips/index.ts` | 246 | `fa0b0aa32de6c56aa6447db8b58f4a358887bfb8aa1c985257b707f4d75413b0` |
| 36 | `packages/contracts/src/admin/trips/m1.ts` | 3244 | `847af70c8de43d164dd31a7af6021ffcad06b12bda8998e000e495150ba2adcb` |
| 37 | `packages/contracts/test/admin-m1-contracts.test.ts` | 10552 | `c7dd0b52db49ec895f707cbdfe747e202d0d067cf3f2ce204eecd197a58d160c` |
| 38 | `packages/database/src/index.ts` | 729 | `4d4a530087056c0946aafb81179f6a00ddfab18dd5111c6e4168252b1dd39e7f` |
| 39 | `packages/database/src/staff-access/staff-access-repository.ts` | 19265 | `a55292b781950a0ed2d0840027f4e52c9076d1579083aa3dcab0a2a22ed2f6ed` |
| 40 | `packages/database/src/trip-operations/m1-operational-slice-repository.ts` | 27145 | `f2c5d2c0ff0000b75627ad6195cbe1702ae298d89f05a6640979da3650c06f10` |
| 41 | `packages/database/src/uuidv7.ts` | 221 | `670a68ffeac6d52b84e9d24659afec337ce84e80ceceeec8cbee1664fa4a243e` |
| 42 | `tests/integration/stage-5-postgresql.test.ts` | 57678 | `dc54eefb395e5c9ce754f2f162029e788578f4a7bcb561e35394e8cedcb85649` |
| 43 | `tooling/ci/run-stage-5-focused.mjs` | 2605 | `f27e424ffed51c97295de3e6fb1b74f4ed8fafa9fb8837fe6562770a031f919b` |
| 44 | `tooling/ci/scan-source-secrets.mjs` | 10454 | `440c9ca55643ba098ce7398ed43a9c2e73cc79f4dd9d57a3bff03f74ea66881d` |
| 45 | `tooling/ci/stage-5-source-scope.mjs` | 7360 | `7e789f30213dcfa91e31f7ee83836ec00435f90396ff45ed15b392b4c96cba37` |
| 46 | `tooling/ci/test-stage-5-source-scope.mjs` | 2276 | `449362418e2c0e8322ef79989a099b53002b6d03bda54489363ec73247471a99` |
| 47 | `tooling/ci/verify.mjs` | 1704 | `9b6927fb1417520573aaa40b7d140aea663723bb42b4789749ba7607d575f4d0` |
| 48 | `tooling/database/prepare-postgresql-18.mjs` | 3127 | `4a02280980952cecf4c3cc4cb3fb279195571fc1ba17ecb48ca01eb8f8ccadf5` |
| 49 | `tooling/database/run-stage-5-disposable.mjs` | 10731 | `312244f3072d513a11fef09c7d8d0933c534b50b580d146b3177ad54181bc281` |
| 50 | `tooling/testing/vitest.config.ts` | 1114 | `64a0280b605bb8125f59bfd81c63734c7212ca7867b212c86147d52c27ee1241` |
| 51 | `tooling/testing/vitest.stage-5.config.ts` | 785 | `f3dfb48ee84e5c44cf138055e3efc0d3fdbd0a1972c5e8c8ab1fdb773f852a16` |
