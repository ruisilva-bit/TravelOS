# Phase 1 M1 — Stage 2 Corrected Candidate Freeze

- **Frozen at (UTC):** `2026-08-26T13:28:40Z`
- **Collector mode:** `FINAL_FREEZE`
- **Collector result:** **PASS**
- **Final-freeze eligibility:** **`true`**
- **Dual deterministic collection:** **PASS — paths, byte sizes, SHA-256 values, and aggregate were identical**
- **Completeness requirements:** **49/49 PASS**
- **Manifest entry count:** **241**
- **Deterministic manifest aggregate (SHA-256):** `0bcd42196fb1a853f08a92b82d317ab928d8cc48c42f037060f40fd480cd6709`
- **Aggregate algorithm:** SHA-256 over UTF-8 rows `path\0bytes\0sha256`, in the listed order, joined by LF with no trailing LF.
- **Freeze-document exclusion:** `docs/reviews/phase-1-m1/STAGE_2_CORRECTED_CANDIDATE_FREEZE.md` is the self-describing container and is excluded to avoid recursive hashing.

## Frozen manifest

| # | File path | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `.github/workflows/ci.yml` | 558 | `7df6ab58e1e6a0c71ec78122bc85b7b3d4d0e2dc9ed00a58e920b4d8bd231304` |
| 2 | `.gitignore` | 93 | `47c459f62358cf051e0e9e11d95337fbd0b74db7e007c9b684b63dd838e678ce` |
| 3 | `.hermes/phase0-sources.json` | 2494 | `6e097d8bc5dcaf49a216907b1a486a42cdf8d568bc13570e93712647122d610f` |
| 4 | `.hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md` | 65399 | `210ab56b4d104b9ba8c5f825bd370c3c9056be172f8a2f6db00704ca91a58f71` |
| 5 | `.node-version` | 8 | `7e8a2fa94951112b894a3dbe3d05efef5e9263741fa49125f0a70f40fedab4cc` |
| 6 | `.npmrc` | 65 | `300a6c5020343be00e16eee83a2bdfc2a33eaa56a82a8beffbdcc46eec9b6010` |
| 7 | `.prettierignore` | 119 | `217a7727cd90c49dd5daa5347cf2a4e6aac2f70f490a4763ad24146350dc8bd7` |
| 8 | `AGENTS.md` | 11014 | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` |
| 9 | `apps/admin-api/package.json` | 432 | `86ca882bf47c097ecf026679fa1bad948142665a0fa3b31df22581e326df6977` |
| 10 | `apps/admin-api/src/app.module.ts` | 191 | `fd56ee5f8360d4c252540c6ebc5e7002054f174c039d32b78e0cd17fcbf0683e` |
| 11 | `apps/admin-api/src/app.ts` | 390 | `ca793d146f60afbb19533ddf9002d38c132e4c382907285ea25d4441f8a28cb2` |
| 12 | `apps/admin-api/src/health.controller.ts` | 343 | `9150b915f39de1754a6a4b569cbebdee8818256d543ca6b6591c35ef0face21e` |
| 13 | `apps/admin-api/src/main.ts` | 2724 | `5cf4a650cea9156ebdb961fa77fe11bdc8c4877a97ede53668ad5b8deb6949a6` |
| 14 | `apps/admin-api/test/health-live.test.ts` | 611 | `3f685472f1c7d66ecff2c6737ed6224aca3fb74f98f09458ac1cf5e4a28b9561` |
| 15 | `apps/admin-api/tsconfig.build.json` | 272 | `dd4e96341a1763ace06f3729870abc1ae82f4302be0f4d6bef9030973ba83621` |
| 16 | `apps/admin-api/tsconfig.json` | 160 | `8d0a5b8fa42ddce7f1818c7094d9ad0c968412133a48f580f3a5af50ac3ced06` |
| 17 | `apps/admin-web/index.html` | 383 | `47a514aed86d53fd4628b2dd8e0464702a0e08dbbefe5b98b44940cbe0c4911f` |
| 18 | `apps/admin-web/package.json` | 389 | `fd04528c4fd57948c2bb10ee380c7203b5a8a42dac0248af5dc9fff8f7800d1d` |
| 19 | `apps/admin-web/src/app.tsx` | 230 | `771c83fc2894cd0cfce2f1e3d4798aacdaf3be973ddb29bbd2a8f440693903da` |
| 20 | `apps/admin-web/src/main.tsx` | 397 | `d7c151341dac8e265b2edbe2e1210d793b110c18d94588002a400ee06543ce51` |
| 21 | `apps/admin-web/test/app.test.tsx` | 631 | `63cf6058092b5ec19890e68db6f8d3c934ec99fff44dd919aa984a72020b6ad0` |
| 22 | `apps/admin-web/tsconfig.json` | 341 | `a5b380f66f8365f7acd6b902d3d09499fbf3ca64f51e0cc799e29caf4155f5ff` |
| 23 | `apps/admin-web/vite.config.ts` | 761 | `ddfde4f0639e1c7df0e716239ce97b15555154f81edf8e7eb19de71e97b9846d` |
| 24 | `apps/portal-api/package.json` | 433 | `0a6dd6ecf7d53c71508e809fcf2c371287101c8ef5df9700343715e3eac74466` |
| 25 | `apps/portal-api/src/app.module.ts` | 194 | `5525fb7ed7942ec1a3385397368453c2a66aed55582029bfa853fe6525961193` |
| 26 | `apps/portal-api/src/app.ts` | 393 | `5bc70f9a58b7641f28078854f38f14aaf19ffb5492e1e31cf711301a117912a2` |
| 27 | `apps/portal-api/src/health.controller.ts` | 348 | `58ca4b5ebcd60ad7a1c57088254dcdaac6bc0db4163358bbab6259fe21e0ce0b` |
| 28 | `apps/portal-api/src/main.ts` | 2731 | `b227d5a77d96e344e55371fe30967852779db4996b63829a3cfd08a5f65a7a92` |
| 29 | `apps/portal-api/test/health-live.test.ts` | 615 | `9793074b0989070aca56aa5d051028049c47c400ec68238a412c7209493f408e` |
| 30 | `apps/portal-api/tsconfig.build.json` | 272 | `dd4e96341a1763ace06f3729870abc1ae82f4302be0f4d6bef9030973ba83621` |
| 31 | `apps/portal-api/tsconfig.json` | 160 | `8d0a5b8fa42ddce7f1818c7094d9ad0c968412133a48f580f3a5af50ac3ced06` |
| 32 | `apps/portal-web/index.html` | 391 | `7d52863aefdf6dce69028ba1a24fef7b4fa61f1b2274fd54a245ff6e8b029391` |
| 33 | `apps/portal-web/package.json` | 390 | `6b464fe3fd4334268f0fb8a7e50c515e53b151f76a7901e27fc5f4535efc8d39` |
| 34 | `apps/portal-web/src/app.tsx` | 239 | `5860a6caa48b4b842161e93556a663ab725a0bcb037dd6211bace4d6aab69d6c` |
| 35 | `apps/portal-web/src/main.tsx` | 401 | `c34022fabe7286db12844085e2524f5a6213a19a2715e90458b50743ce256524` |
| 36 | `apps/portal-web/test/app.test.tsx` | 643 | `dce7c1e233162217934329997776f0ee74711e844b56ff9dd0c9a6db4a13ec6c` |
| 37 | `apps/portal-web/tsconfig.json` | 341 | `a5b380f66f8365f7acd6b902d3d09499fbf3ca64f51e0cc799e29caf4155f5ff` |
| 38 | `apps/portal-web/vite.config.ts` | 761 | `ddfde4f0639e1c7df0e716239ce97b15555154f81edf8e7eb19de71e97b9846d` |
| 39 | `apps/worker/package.json` | 226 | `5ad8241ef9ce559a4d56120daa45c829d97bcd66f3c12d10c11f28737b757a82` |
| 40 | `apps/worker/src/main.ts` | 1775 | `27fcda99d837358872cd9449db5c05022877164d28c04a1b38e5d6cb58de84bd` |
| 41 | `apps/worker/src/worker-process.ts` | 441 | `88f75c421c8dee74bdfc529e8450d13dab58d71281116936cbb0dded20de27d2` |
| 42 | `apps/worker/test/worker-process.test.ts` | 411 | `e033f8014ea41b1738cf1078eac4dfa56426ee934d9ce3db838e2f2d933f57db` |
| 43 | `apps/worker/tsconfig.build.json` | 272 | `dd4e96341a1763ace06f3729870abc1ae82f4302be0f4d6bef9030973ba83621` |
| 44 | `apps/worker/tsconfig.json` | 160 | `8d0a5b8fa42ddce7f1818c7094d9ad0c968412133a48f580f3a5af50ac3ced06` |
| 45 | `deploy/manifests/development.example.json` | 1324 | `5388a85194963541aa2208084919eff2c0461fa334d9d9dfba2adec7e3ef2618` |
| 46 | `deploy/manifests/schema/instance-manifest.schema.json` | 11323 | `6d46fd114195935b5724c0267ee4bdd73f67f63653483b1b81d7a061b81f87ff` |
| 47 | `docs/adr/ADR-001-modular-monolith.md` | 1733 | `d97f3583b944f72baa9d7cd5cf8af029a722003d67102fe08e426cacf08206f4` |
| 48 | `docs/adr/ADR-002-dedicated-single-tenant-deployment.md` | 1773 | `8eb647415c7e098f040eb77c11c5517ebfeefe41d6cf864565f5fadf2b56038f` |
| 49 | `docs/adr/ADR-003-independent-database-per-instance.md` | 1569 | `b93d2f91fbe51f7ce59692d9fec25c47d0c0d74cc4bed32f19574e1da53db19d` |
| 50 | `docs/adr/ADR-004-immutable-publishing-snapshots.md` | 2605 | `f4e3d1d272148e99873cfab0058b8126c104d724ab894fafa56488fabd9b8ef4` |
| 51 | `docs/adr/ADR-005-structured-itinerary-model.md` | 1834 | `ccef302ec616315b6f6ce2ae9e574acb0e18a3e56542e0286065f32ccfd060b5` |
| 52 | `docs/adr/ADR-006-provider-based-integration-architecture.md` | 2082 | `1f276f9568fbdd054a0f8819352c13195932ebdc2a91d265ac24dd99da49c775` |
| 53 | `docs/adr/ADR-007-separate-staff-and-portal-identity-realms.md` | 1673 | `5ad4ddd4fcd832854fac3ff117212ce8788e323dda5fe0f79deaf5946047ac2f` |
| 54 | `docs/adr/ADR-008-rbac-with-explicit-resource-scopes.md` | 1661 | `451db1e893346802160db8dc52e0f12ac6e7993d3e1137f840efe7d3d6721e14` |
| 55 | `docs/adr/ADR-009-transactional-outbox-and-postgresql-jobs.md` | 2874 | `08960ecbc796c637f09aa410100a0b33d6002089c2b84d598dbc00ae5f752388` |
| 56 | `docs/adr/ADR-010-exact-money-and-currency-representation.md` | 1846 | `5a52e10ddf151b7df12c440ead18fe2c1dadc5db02f1d3890284b3b30e713feb` |
| 57 | `docs/adr/ADR-011-document-storage-and-explicit-access-grants.md` | 3404 | `9beb7c8862067e842eded1ee1ff0bdb008c4391d0d5c9a2e141d7ba6172abca6` |
| 58 | `docs/adr/ADR-012-persistence-boundary-and-fleet-safe-migrations.md` | 2356 | `298dc1625a2d054490250db047131411a9e2ad34acac020ee521017dd72d93e7` |
| 59 | `docs/adr/ADR-013-monorepo-web-runtime-and-build-orchestration.md` | 1821 | `d98881a785973d0f89da8c0ec372899932c310bf0acdad34d61e7fcb6538ce69` |
| 60 | `docs/adr/ADR-014-durable-privacy-erasure-across-backups.md` | 5063 | `b0effe71de4f52570245d9e789ef018912a00d2bf1ba09aa16110fb75e3175c7` |
| 61 | `docs/adr/README.md` | 2248 | `c2ee6d59b7e8bd2a153381a8f9a8bbac2a0f07d8ead680a6b6ed5d8814f901da` |
| 62 | `docs/ARCHITECTURE.md` | 22908 | `5a6293b167ed591c3e1f7bf4a7bf8ca99ace838ec038dd6f97b7f44fbd1e6ec3` |
| 63 | `docs/DATA_MODEL.md` | 21143 | `f919e688ad9b42d804333d3d8e1355fe070176a704e73f523fc83bb6d82949b3` |
| 64 | `docs/DEPLOYMENT_MODEL.md` | 15279 | `de6c2ed3890558b7802c041b40677c8d2147f3221d5de812884724c4e5e108ee` |
| 65 | `docs/DESIGN_SYSTEM.md` | 9801 | `9dfb3ac7e92ae4253e17d32d47ba8b68a728c2fd2a99fc76f52c0c9f7f9bddac` |
| 66 | `docs/DOMAIN_MODEL.md` | 16184 | `4979ddb6dd8e937f548164572b6972afc12fe0c740ca08d233d8e6523808455d` |
| 67 | `docs/evidence/phase-1-m1/stage-1/better-auth-realm-separation.json` | 4581 | `74087b4519bc262980b764d5a2bfb3b2c73e906c4c4d08fe092b2e682b151c06` |
| 68 | `docs/evidence/phase-1-m1/stage-1/ct200-read-only-inventory.json` | 3810 | `ca027dcd13a40f877f25c85b1c5a718ffbb3c4522bf6d95211dae41fde044cfc` |
| 69 | `docs/evidence/phase-1-m1/stage-1/dependency-matrix.json` | 58048 | `e7a6469635fda29f87e9318828bf395361dd968ce9847b5e944e9b4001b7f958` |
| 70 | `docs/evidence/phase-1-m1/stage-1/disposable-cleanup.json` | 2178 | `bdb4941d01ebf2cd59d12d5dbd06e36096d88b4632074faa461129882fd86ee0` |
| 71 | `docs/evidence/phase-1-m1/stage-1/EVIDENCE_INDEX.json` | 6136 | `c5dce2f9217d24b4a0e4d00e12e9a9e089a62ed5676238a2ca8411d37f2bce21` |
| 72 | `docs/evidence/phase-1-m1/stage-1/install-audit-build-policy.json` | 8415 | `5aadc38d36d169e81e65d44702a6af7b0bd719da0777f4f2511a1abc3f0c9bab` |
| 73 | `docs/evidence/phase-1-m1/stage-1/postgresql-runtime-results.json` | 5252 | `154d3a3bdfa70b2e61a481b3cfb19dac4dca48a42149e30537ce42bf60019682` |
| 74 | `docs/evidence/phase-1-m1/stage-1/quality-build-results.json` | 13195 | `94ba8623a85a175ae8b4fd5fa8b695b6a1c9f879e3e3bfbd4a30ea4836f9f38f` |
| 75 | `docs/evidence/phase-1-m1/stage-1/resolved-engine-peer-graph.json` | 172932 | `1e3d0971e5e378c42412b0256866a8d25382fc36774130c05ce42058cb2dcf17` |
| 76 | `docs/evidence/phase-1-m1/stage-1/toolchain-package-provenance.json` | 9434 | `20838a66030a8d50144922440f644bd80dbcbe105bdaa8cf573b3efed767bebb` |
| 77 | `docs/evidence/phase-1-m1/stage-2/architecture-invalid-portal-fixture.json` | 1208 | `4ba2f4ca1cdcfcb9517294dc637a52e84a8bc0216c7099313ac80c84b1671b4d` |
| 78 | `docs/evidence/phase-1-m1/stage-2/architecture-production-graph.json` | 1730 | `1b793a8f249b172948bf28eebd9a88f19bc989e0e37e0eaa486e46b6a8418dae` |
| 79 | `docs/evidence/phase-1-m1/stage-2/browser-bundle-secret-scan.json` | 2115 | `bf6c0ed0d740e647560d90a52519b0a8f8ae9d2236e3397111f59bb0f2d8d994` |
| 80 | `docs/evidence/phase-1-m1/stage-2/ci-verify.json` | 1237 | `3562009c5208986d81f889447118c09101c63c32ffeff965831874543e4e34cf` |
| 81 | `docs/evidence/phase-1-m1/stage-2/clean-build.json` | 832 | `8139cb2734c42c3bb31c2db2c8be041ac4155d41e63f8d3473c412c3b491bb8b` |
| 82 | `docs/evidence/phase-1-m1/stage-2/clean-frozen-install.json` | 5413 | `78eb1dd8e982cb0140c157f45439ab60f6c3b5f2d8c8669ae9c53e40e67f61e7` |
| 83 | `docs/evidence/phase-1-m1/stage-2/configuration-contract-tests.json` | 1358 | `52643ec1268d3fcef6c200b6c25383a686a0f2f583f8bf7e72bc9c8dd4167747` |
| 84 | `docs/evidence/phase-1-m1/stage-2/configuration-schema-drift.json` | 779 | `618ca52b1ce511b31a0a20de2470215066cc91704f0f93d18a7e6b1bb091cfba` |
| 85 | `docs/evidence/phase-1-m1/stage-2/correction-tos-s2-001-architecture-boundaries.json` | 7802 | `6d378f7b58b8d405f55cb989e8d229d0980f324ad6cd8ef70424b1ef22b6d5a9` |
| 86 | `docs/evidence/phase-1-m1/stage-2/correction-tos-s2-002-lifecycle-policy.json` | 3693 | `e6c66d13dd123f5d021c75bc3224b74c8a69b35d11d0e7729802554c17ade780` |
| 87 | `docs/evidence/phase-1-m1/stage-2/correction-tos-s2-003-freeze-self-containment.json` | 1821 | `e2842d7dfef2ad5ef001dea82af4b12269e41b8d3c5b16f813393acc8924e996` |
| 88 | `docs/evidence/phase-1-m1/stage-2/correction-tos-s2-004-sensitive-data-scanner.json` | 2055 | `ce7848c8af1513ff83a52f4df573940f2dd1c48ebdf9612352191d09ccfa2429` |
| 89 | `docs/evidence/phase-1-m1/stage-2/correction-tos-s2-005-api-listener-separation.json` | 2550 | `fb712585c3de1c5d8812cae143db45a037256fe9555ae92eaa30067e946034ea` |
| 90 | `docs/evidence/phase-1-m1/stage-2/correction-tos-s2-006-json-schema-runtime-contract.json` | 5586 | `830ff6af52a3785508472c153deffd1b4285296d2f2170485d70781c2b3f8007` |
| 91 | `docs/evidence/phase-1-m1/stage-2/correction-tos-s2-007-semantic-rejected-technologies.json` | 4463 | `c5ab881ccf9a6033c62a8cfdc34ea26e85e7ee0de62447cb5cb3692683379f82` |
| 92 | `docs/evidence/phase-1-m1/stage-2/EVIDENCE_INDEX.json` | 7236 | `ac99fb7a72bda5f51d85f9d108dc0411fda9ca5cab51a8f59a7f68d1b281ac9e` |
| 93 | `docs/evidence/phase-1-m1/stage-2/exact-pins.json` | 1721 | `849d29088a1e2b33c15ea4e10528bda4c9e18236598cab7554217ebe89347c6a` |
| 94 | `docs/evidence/phase-1-m1/stage-2/five-deployable-smokes.json` | 4915 | `d0b83485ba212ce4608621e421c4a7c41984fb83d4e8f0b22e566025d799bf33` |
| 95 | `docs/evidence/phase-1-m1/stage-2/formatter-safety.json` | 847 | `14efbfebe5a768ebf2aa409352de9776a17c3892deef76d4c7d4dd26f3a1db6e` |
| 96 | `docs/evidence/phase-1-m1/stage-2/implementation-tree.json` | 27670 | `20bc139d6c50c567afdc58c36b0266d988e8a777b4d331981480872399392c02` |
| 97 | `docs/evidence/phase-1-m1/stage-2/lint.json` | 717 | `c52afca74a258fcaf739e1fb661c32b5a376ded89136f322edc3a03399d0d5d1` |
| 98 | `docs/evidence/phase-1-m1/stage-2/protected-baseline.json` | 1729 | `812cad51d6709848a37b0fef74913ca1c413410dfa0336f882466ea68137e79f` |
| 99 | `docs/evidence/phase-1-m1/stage-2/rejected-technologies.json` | 1788 | `b86ba12ededbfb7f36bc49d23a510fc7866ddf2e15bf5256930808700b271f66` |
| 100 | `docs/evidence/phase-1-m1/stage-2/source-credential-pii-scan.json` | 1322 | `99d6a057c716646843519f0f9f5b3f86cb53886fd2dbff7ba3275e3049274faa` |
| 101 | `docs/evidence/phase-1-m1/stage-2/stage-boundary.json` | 1906 | `76885516e5c1fab02477c9245603e283060fddd215282c2a015051bb822d8103` |
| 102 | `docs/evidence/phase-1-m1/stage-2/typecheck.json` | 738 | `64ac39c1432d72fe1b8d5115026929ee26369eef945b0987d157e4f45c95063f` |
| 103 | `docs/evidence/phase-1-m1/stage-2/unit-tests.json` | 6249 | `fd6014c0b63c2da5397460e5e6cd375266ba93799d8826b3f02cf4127ed9b5a6` |
| 104 | `docs/implementation/M1_BOOTSTRAP_DECISIONS_CORRECTED.md` | 5930 | `366816a9fda4c3c6fbccb26da3675832d8979b82c26714c65815146a0b11b6e2` |
| 105 | `docs/implementation/M1_STAGE_1_CT200_BASELINE_CORRECTED.md` | 2935 | `beb5951f5a3353a39184d4f168af4e2a4866f06793d8fbee8b4a2ee46235978e` |
| 106 | `docs/implementation/M1_STAGE_2_CONFIGURATION_CONTRACT.md` | 2533 | `e957ef42a676baf0320e03cd71760ecc1aae12727ff214be9c0edd5bcf62c59f` |
| 107 | `docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX_CORRECTED.md` | 8525 | `3ee47440d3304e92ab850db7865ff645b6e2fdf6172e5c071287e34db2ee6ad6` |
| 108 | `docs/PERMISSIONS.md` | 10010 | `ad036b8647f4482bc5e59bff09e5adbf653a4d3ed3994a20cd5b201d104ea1d9` |
| 109 | `docs/PRODUCT_BLUEPRINT.md` | 15398 | `c46e9e980da83e3c5d0c5816431195b8bf0b33a9a8e403533d28ec5ae8d37ecf` |
| 110 | `docs/PUBLISHING_MODEL.md` | 12228 | `def308a38f423be7902308ba665fe97ac5d585715c056f880e02adc6493aa5e4` |
| 111 | `docs/README.md` | 3049 | `fcdb512c3f5d669e54a56871eff60c7bf3101ce39996af77105e8ff516bd636b` |
| 112 | `docs/reviews/AGENTS_CANDIDATE.md` | 11014 | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` |
| 113 | `docs/reviews/PHASE_0_ACCEPTED_BASELINE.md` | 5935 | `bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb` |
| 114 | `docs/reviews/PHASE_0_ARCHITECTURE_REVIEW.md` | 8233 | `32ee880861bad548feca777c8be813cb30ff21752daa90587686ca00f17936cd` |
| 115 | `docs/reviews/PHASE_0_CANDIDATE_FREEZE.md` | 3057 | `06bf41b770f830d6a110422f21c8fb23ef54b30884e91d3c474b370c7638d3e4` |
| 116 | `docs/reviews/PHASE_0_CORRECTED_CANDIDATE_FREEZE.md` | 4879 | `d30c414d057bc33bc72cde30a91454ef1f651ca0a10a7e9cfa19b4d18a2fcc8a` |
| 117 | `docs/reviews/PHASE_0_FINAL_GATE.md` | 5203 | `0a2f3277f55c1fc2bb27ec832f9becb4086fcce658d3d0cb7e5c505d6a3ec595` |
| 118 | `docs/reviews/PHASE_0_PO_ADJUSTMENT_CORRECTIONS.md` | 6989 | `4056f3c4278ca7765d5c5046e0ce66952575f17a7d69b225e7d4f283dd97ae6f` |
| 119 | `docs/reviews/PHASE_0_POST_PO_CANDIDATE_FREEZE.md` | 7161 | `590e6dcdebcf325fe3a677e140b74b18f4fe06eb14adedeb686da4b48cf60040` |
| 120 | `docs/reviews/PHASE_0_POST_PO_CLOSURE_REVIEW.md` | 4889 | `e02c2adea3bc8cd9aa47f95acaecaf18ae37efa18c8376c2fd3227c983bd271d` |
| 121 | `docs/reviews/PHASE_0_POST_PO_VALIDATION.md` | 2937 | `9fab118f0ea77eff6bebae80fa61b193ff2c54f34b312e35758e1814ebfdf6b0` |
| 122 | `docs/reviews/PHASE_0_PRE_PO_CLOSURE_REVIEW.md` | 3700 | `668292f89cece7083cfdabf06e967a6cc380d1c48995da7c164be75f91c805c9` |
| 123 | `docs/reviews/PHASE_0_PRODUCT_OWNER_DECISIONS.md` | 3374 | `762a214f3b3ac57412b2806887954db7bc323b2c3a0ff969cd2eaf0bb6f39e3f` |
| 124 | `docs/reviews/PHASE_0_REVIEW_CORRECTIONS.md` | 7187 | `d72abdbe7c36c2ba8295ae13e5cc3077036ae55949b110081566dfab7ffe866b` |
| 125 | `docs/reviews/phase-1-m1/STAGE_1_CANDIDATE_FREEZE.md` | 4250 | `1b6302ae14bec1733ae693d948191464c1672b03f9aa39b2eee11f9ccee6f31a` |
| 126 | `docs/reviews/phase-1-m1/STAGE_1_CORRECTED_CANDIDATE_FREEZE.md` | 4926 | `dae9575284897d3cac3eef7851d41487c8003dde6a6e6e15fb1f14927c359d61` |
| 127 | `docs/reviews/phase-1-m1/STAGE_1_CORRECTED_CANDIDATE_VALIDATION.json` | 18790 | `e6c9c7e774dc090b1b3b40a974cee2a520bc278e22743de1b2a613c67b7f4f3d` |
| 128 | `docs/reviews/phase-1-m1/STAGE_1_CORRECTED_INDEPENDENT_CLOSURE.md` | 9876 | `9f629ae6309a8d86d43869777909f1e0a7e18c402fcfcef99932b87d94b6050d` |
| 129 | `docs/reviews/phase-1-m1/STAGE_1_INDEPENDENT_REVIEW.md` | 10806 | `fb88c2fb6b1e02ec33e771f0a2de8b71d10efae18c400811250bcbf3296e710d` |
| 130 | `docs/reviews/phase-1-m1/STAGE_1_REVIEW_CORRECTIONS.md` | 7639 | `0aadcceec817718193535c19d9f4c53a6698b9fb933187f67acc215295c7dc5f` |
| 131 | `docs/reviews/phase-1-m1/STAGE_2_CANDIDATE_FREEZE_CORRECTED.md` | 34144 | `761b4a9ff50cd6cdfd59f9e5b5d6bb119d3c3f0c9af2ff71a9a3c3a3b3d7dc5c` |
| 132 | `docs/reviews/phase-1-m1/STAGE_2_CANDIDATE_FREEZE.md` | 32999 | `acf699c0f48bba1c87df0bf4ed1f9fe64936f2e7a15bbd95633ff1fa4d3822d9` |
| 133 | `docs/reviews/phase-1-m1/STAGE_2_CANDIDATE_VALIDATION.md` | 8111 | `6876c396871229f79799c811797054271d7f12b336c73f6da60a3c3164bc4f05` |
| 134 | `docs/reviews/phase-1-m1/STAGE_2_CORRECTED_CANDIDATE_VALIDATION.md` | 3584 | `87a19fa97788774a349e00cc0ebd58c87417d4745fa80ba185f20956fd9caa7f` |
| 135 | `docs/reviews/phase-1-m1/STAGE_2_INDEPENDENT_REVIEW.md` | 18374 | `35463df16de6f77c4d9de5ba45710dc72746da8835c3f2e13d886b475330c6ed` |
| 136 | `docs/reviews/phase-1-m1/STAGE_2_REVIEW_CORRECTIONS.md` | 16238 | `91c4121d379eb89221c01797667e86cfc0fb6f47a01de7d95946c9e21d84098c` |
| 137 | `docs/SECURITY_MODEL.md` | 18862 | `5a719485642383988e1611c0f3c8a25d2a0550435025ae0c2e4a2412d0bf1ea1` |
| 138 | `eslint.config.mjs` | 1083 | `7ade2a4513b4610cb9b2870ef4793c82b032ca2483ee116af1e7e7f01187e0ec` |
| 139 | `IDEA.md` | 10628 | `2c7be6b7154835a1301118670a33f2c8b9d9f8a0f178b9565515ab2484a2f524` |
| 140 | `package.json` | 3380 | `1cb1e4147f2c1fa6dcb28382ee8783900a8a8a5240a746f263ce9ce963e3f731` |
| 141 | `packages/auth-adapters/package.json` | 330 | `35dae9ace0982f34a6d2373224d369e5c3b3288dcb0eebcffe120b58ec8ba970` |
| 142 | `packages/auth-adapters/src/index.ts` | 93 | `674dec82dab2f3d605f3a36338dd0b553f4d52afbfd8bf99997f9f6ec9104ed0` |
| 143 | `packages/auth-adapters/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| 144 | `packages/auth-adapters/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| 145 | `packages/backend-core/package.json` | 329 | `a1ccbe51b7b64c00479b92c89878174ff0320bf3fcd32d67ffcc91e665fa0418` |
| 146 | `packages/backend-core/src/index.ts` | 111 | `5debec22176a12ebda6d7f90dea80a704e19d07f0b9f4c93e9577c776c9af6e9` |
| 147 | `packages/backend-core/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| 148 | `packages/backend-core/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| 149 | `packages/config/package.json` | 367 | `5052899fc06ceb5669e5475209a51429f489cbd9ad8f8251acf91e984493d55e` |
| 150 | `packages/config/src/credential-reference.ts` | 308 | `6ae56031f59b5418a359afe5f4fcd3124cf518ae739082396c96263987087223` |
| 151 | `packages/config/src/index.ts` | 665 | `c5d498dd97d705023603f648b16e51d67daae82fca868f24608cb251d913118f` |
| 152 | `packages/config/src/instance-manifest-invariants.ts` | 3299 | `8a13457cf39454824b69fedd25b4eb3fdde64cc27d99ae9273aa8725cbec535d` |
| 153 | `packages/config/src/instance-manifest-json-schema.ts` | 1831 | `3d3cd5de5914c4348c7945a3d2ecf0564c74c7f1572ee43e4ca245ba09d933e3` |
| 154 | `packages/config/src/instance-manifest.ts` | 5737 | `f929f8fbe014feb97b802a945ff8dcaa205f74354f32d4b3eb02455bf49f8a7c` |
| 155 | `packages/config/src/load-development-instance-manifest.ts` | 411 | `cd1b5484a31a56b58ef9e54404751c71112902cfd30161387d2a8884a82b07d5` |
| 156 | `packages/config/test/instance-manifest-json-schema.test.ts` | 11046 | `7369bd717bfd9c7f0d360d1c9c17a8003b93715c89b11acc927b1eb5cf38faf3` |
| 157 | `packages/config/test/instance-manifest.test.ts` | 4749 | `23cc41846863a71f7cbd92330ab695894401389c6a4d08e80a295bb53b0752b6` |
| 158 | `packages/config/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| 159 | `packages/config/tsconfig.json` | 193 | `326a5f60475a157177d61e94b1886d0f6c1653a4ea144f43c430d5b7ad93337f` |
| 160 | `packages/contracts/package.json` | 497 | `8d50ebe3eebcf8b3bcfc2e48e655a4f1ddc13fdee9c611d8a0cfe2e9a11afac1` |
| 161 | `packages/contracts/src/admin/health.ts` | 298 | `a39764d7144a16405562c43dbbcf1da16a110f7f15eea6a1a4d3e92e02e78820` |
| 162 | `packages/contracts/src/admin/index.ts` | 91 | `1669ab8f0c197d0fd68e9c9f754d08ce97f00d58d2a188304a78db69e1dedf6b` |
| 163 | `packages/contracts/src/portal/health.ts` | 302 | `744dc95f8b1238975aaad38960c1a86d3b35153902db6d386eba46062f77e30c` |
| 164 | `packages/contracts/src/portal/index.ts` | 93 | `9b48b59ff0f94ef5a0250540b9a7b2f3f97ce2efdfabef05439e047897cefbc2` |
| 165 | `packages/contracts/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| 166 | `packages/contracts/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| 167 | `packages/database/package.json` | 325 | `89b2c9dd23d606990e34c58e6e6c87dae7cf12e1a3352612b8974d881a5c2ee2` |
| 168 | `packages/database/src/index.ts` | 111 | `1a8f4e1961e271f3c6fd1d9e98f2210b0883e363b8bf5d38efeee1488c31fb6a` |
| 169 | `packages/database/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| 170 | `packages/database/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| 171 | `packages/design-system/package.json` | 471 | `8fef1edb64a4b92bd1dee6926f1fff3176405b674727a11e0ed599d7347d7fb7` |
| 172 | `packages/design-system/src/foundation-page.tsx` | 427 | `dd199ec16f2763741a6384899e6e477bf2260f83409d5077b78f2852cff84a19` |
| 173 | `packages/design-system/src/index.ts` | 81 | `0dd0a9902e8b70a3868388aa7de14bc83e2d917d2287150406909948ed506b5a` |
| 174 | `packages/design-system/src/styles.css` | 1592 | `aa6f7a194f542731e63968b0957e603566053130118ca367de1c7337f4a31346` |
| 175 | `packages/design-system/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| 176 | `packages/design-system/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| 177 | `packages/observability/package.json` | 330 | `91ce86f786d9ef745e7735d35659231a4e2c6be701e7b65c1a1dc5efc7d623b6` |
| 178 | `packages/observability/src/index.ts` | 97 | `30052591e84039c62ed410859a38a4423d0a127ea149416ce4a90b3f701c4ae3` |
| 179 | `packages/observability/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| 180 | `packages/observability/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| 181 | `packages/portal-safe-core/package.json` | 647 | `8d8bee9714fce69b1ac1681baf0d5ac56d6cbe5e769ae6acb99d8e6b7b09d993` |
| 182 | `packages/portal-safe-core/src/customer-presentation/index.ts` | 194 | `e767db02378d17338d35fdde12af49b46ed6f47069ef8f70440b86c33f8198a8` |
| 183 | `packages/portal-safe-core/src/documents/index.ts` | 186 | `fd44e2e917a0e060d67e518e1a380796e7cb9cb6636e3bf72ad8c61b11f6b614` |
| 184 | `packages/portal-safe-core/src/index.ts` | 107 | `961ba07f01a5cd1bfc25ad3df37893a80fa3012ee649ff0013a4604ceccbee52` |
| 185 | `packages/portal-safe-core/src/portal-access/index.ts` | 166 | `677a3e254f4fc2073eb2bfba9ee625ea27c661e8f1f09c0ab9f76866439e667c` |
| 186 | `packages/portal-safe-core/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| 187 | `packages/portal-safe-core/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| 188 | `packages/test-support/package.json` | 329 | `b0ef9b3e2ebd08f5c2bb2c89c25bfec2d16fee233ff0a5680da1a3105bf673a0` |
| 189 | `packages/test-support/src/index.ts` | 103 | `0567c32252208a5659d2852f68d9fdb3a56aa4f5794a9945eb149462be5e4c00` |
| 190 | `packages/test-support/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| 191 | `packages/test-support/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| 192 | `playwright.config.ts` | 175 | `ff1e3099acd55234b87e06e69e9509c9743a3399f0d7410981fc3949bec07bd1` |
| 193 | `pnpm-lock.yaml` | 208980 | `c2b872478a60675300e83d8d45d70ec42e4bc272d16a17a7519e46f525d2cec9` |
| 194 | `pnpm-workspace.yaml` | 149 | `8840f7a60a38aaf6003fdf99922737ab6c1849929a7834ef60369c8adb9afcdd` |
| 195 | `prettier.config.mjs` | 164 | `1404e03791b81cf7ab663116a23718c4291f909ff668b5a57027bcff797c593a` |
| 196 | `tooling/architecture/check.mjs` | 4737 | `8af13d0c6b10e92e86147b249b77db2ad718717db079b626e786845d4b0c36de` |
| 197 | `tooling/architecture/dependency-cruiser.cjs` | 3468 | `8e78770a63af4b6adb6616a475a65313e94ac9b564351f2b4e533ce5cbfe83ac` |
| 198 | `tooling/architecture/fixtures/invalid-portal-import/portal-entry.ts` | 199 | `7437d1cae15b0989e8b86d3f67ad59fd3d4fe2810b77ab2b2947b2cfea4e6466` |
| 199 | `tooling/architecture/fixtures/layered-boundaries/backend-auth-alias.ts` | 69 | `cf69e601f0c8a9c5886fc5b81721735d58d28f545541cbeaf6f77cb2696d56ac` |
| 200 | `tooling/architecture/fixtures/layered-boundaries/backend-better-auth-deep.ts` | 78 | `a28410d78526a1cdbcad0ae070d0aa8f21edcd7328328981d1c561bd4891a9c4` |
| 201 | `tooling/architecture/fixtures/layered-boundaries/backend-better-auth-static.ts` | 115 | `a4426dfa19f958e287c31ed4b90527fd7d9a0f39cc2863e3acf8c1e8ff673392` |
| 202 | `tooling/architecture/fixtures/layered-boundaries/backend-computed-import.ts` | 99 | `83e4f1941d8413589d92c7c2c9d138ce235616d4f3ba291c30f595f4b8f30f4b` |
| 203 | `tooling/architecture/fixtures/layered-boundaries/backend-computed-require.ts` | 204 | `b7bd8b06754595d24b75359ffb1bd2baf8c835dfc92950076eb9caa006db42a9` |
| 204 | `tooling/architecture/fixtures/layered-boundaries/backend-design-system.ts` | 107 | `681d075528d4c80c0c7e9bd9ee286ab3993182a0ea916a4ce7cf9d8d4fd8172d` |
| 205 | `tooling/architecture/fixtures/layered-boundaries/cases.json` | 2777 | `0f1992bde3602a3190015b070816c72db7460ab17f7b8e1e2ae7dbd2f62ccfa0` |
| 206 | `tooling/architecture/fixtures/layered-boundaries/portal-admin-contract.ts` | 87 | `8cfd4f104cdc36ad27d8a6bd0975eb249a9e783ac64bf5575b783ef4eed2f26c` |
| 207 | `tooling/architecture/negative-fixture.cjs` | 828 | `17c9fa4b6f07d9437f5bc950804f309a047882998f20e4e6bd6f3db25d3eed22` |
| 208 | `tooling/architecture/package-boundary-policy.mjs` | 18389 | `bb26ba954e83160e9e2d41af92a3adcf55daeac5631136743071eebff309d9e3` |
| 209 | `tooling/architecture/reject-negative-fixture.mjs` | 1763 | `1184d892000009f3c5602c9d2b66471778df748485f753ff73c14d457f642af6` |
| 210 | `tooling/architecture/verify-layered-boundary-fixtures.mjs` | 5858 | `03d7feb9c5be30fd08c6b44479b70cc9ad1e19611797395f72d7bc0dc5f1f94f` |
| 211 | `tooling/ci/bootstrap-toolchain.sh` | 1126 | `1486b72ed7a72370c06f7545696ce4703f4f3c24b43784b890e1f86bab0e637c` |
| 212 | `tooling/ci/capture-stage-2-evidence.mjs` | 40140 | `c8667abc3eee7008dead237eae2994ea619cc5c6c3b67263dc0aa7d1afaae5b5` |
| 213 | `tooling/ci/clean-build-output.mjs` | 664 | `89de2b6b54a7d420a0f76b6466b1225c0bd6d5f2702897ecb20139561f0066d0` |
| 214 | `tooling/ci/collect-stage-2-freeze-inputs.mjs` | 1263 | `417f16b49059743181d0c4447f4e23e5da39855180234213d1eaee5f75f88c21` |
| 215 | `tooling/ci/format-stage-2.mjs` | 2614 | `20e061468648f37dcd19e8b1d912bfade81739675c3461f52f9e82e6c37a8921` |
| 216 | `tooling/ci/install-lifecycle-policy.mjs` | 3552 | `c928d582aa8ce6f3485ee841ed8adb0607747a55e0664bf882e0c9bd5135961c` |
| 217 | `tooling/ci/install.sh` | 225 | `7bd020676bdb1381382a85226f46c1b687d6df6e5fe4f3af99b60edf5a9d87ba` |
| 218 | `tooling/ci/rejected-technology-policy.mjs` | 9429 | `3858257e5fcd08e938cc3f872d065d12236329ead7e5ae73a4956e1610346f38` |
| 219 | `tooling/ci/run-clean-frozen-install.mjs` | 5455 | `1dd800696b2493bdfa3205e9784cff86b46c88634eec628ff2cc6aecdc63b7b8` |
| 220 | `tooling/ci/scan-browser-bundles.mjs` | 1729 | `00c47812ad1891ddd8d875a57d8044105b23e9d0080b66d44bf1dba1311285bd` |
| 221 | `tooling/ci/scan-source-secrets.mjs` | 1854 | `78e42a52728c1cfecb581dc6fc69b21be8780360d941475476dd25be68ee1832` |
| 222 | `tooling/ci/sensitive-data-scanner.mjs` | 6230 | `4dc9c007d57bcab6abff8b8893f41bed6ddbaf5e7e0ab0cfbebc11415a19a106` |
| 223 | `tooling/ci/stage-2-freeze-inputs.mjs` | 17018 | `1c00b8a95e734728f0b0d853f2e41d4aa95642971f04c232b7ff6266bc7bcd39` |
| 224 | `tooling/ci/test-lifecycle-policy.mjs` | 4716 | `9ad6cfb695a2a45a2a2143419814cb0458a6b02ca28efb700ef60a68529a2fd3` |
| 225 | `tooling/ci/test-rejected-technologies.mjs` | 4912 | `03909e0969310e4164f14f1e22bfcc5907dcd31dfbe6067131f893cf8e0d7520` |
| 226 | `tooling/ci/test-sensitive-data-scanner.mjs` | 4076 | `946eb86cd46e2166783330cd3fe9e07f906fd26005f0ceeafb9d5aeba3d52e55` |
| 227 | `tooling/ci/test-stage-2-freeze-inputs.mjs` | 2885 | `9ba8fda90877c64cb23b182911509ecc038a9602e4acc19a0d2e606473315374` |
| 228 | `tooling/ci/tsconfig.owned-declarations.json` | 378 | `4ac0e62f24108e4210ddabc75dd85ea8556eeb1e758758337d9a547d8e86221e` |
| 229 | `tooling/ci/tsconfig.typecheck.json` | 450 | `b6857bbe41955c3676900005def1b53a970f90e86b1fd86197fbd70da5ac936d` |
| 230 | `tooling/ci/verify-pins.mjs` | 5893 | `ad2475e1578207e9ada372799047283a9f1bf39d24a355ba237bc20e222e8c22` |
| 231 | `tooling/ci/verify-protected-baseline.mjs` | 3320 | `c6ba5ebb1ea9657d52a198b297805267df13b9eae44c1c2fe84e6ce9921fd36e` |
| 232 | `tooling/ci/verify-rejected-technologies.mjs` | 240 | `b49f630dcabe438fd431bfa775cb7c68ef827aa3ae2b2cd361712174eb8ceee0` |
| 233 | `tooling/ci/verify.mjs` | 1267 | `4dc596207fb4d96c3cd08064f8c1099e9747e1061c2fa9b8cc444f94db572bd1` |
| 234 | `tooling/ci/workspace-policy.mjs` | 2967 | `9c63b628d2c3f08869b693845aefd7fb203c84fe768f15e9222cc6d06bbba01b` |
| 235 | `tooling/ci/write-instance-manifest-schema.ts` | 1043 | `4e329398607a6ef39f0c4c1b19f9d4bbb256af4d089900a78c59c29d449d5073` |
| 236 | `tooling/testing/owned-declarations/stage-2-sentinel.d.ts` | 198 | `dcad06f99c52e7c0784c91eb0d6b77ae45b4178f203917cd9668ec974e344a60` |
| 237 | `tooling/testing/smoke-built.mjs` | 4500 | `27dd33819759eee7ead51a5010210ab70345f407f0b07b517960a0637c4d2b5f` |
| 238 | `tooling/testing/vitest.config.ts` | 990 | `d3708e498cb48cd2dc8ff6a2db442ec6540e095864133e78777a603026f66b68` |
| 239 | `tsconfig.base.json` | 1522 | `caffd83223e74a7c03d4079bfa21aac5978eceb5e96a5397ecdcbd28bbc7335e` |
| 240 | `tsconfig.json` | 55 | `698c199169b6e49a314caa8af5644ab5b80187b87d0e9b5463b6e0e3f034d290` |
| 241 | `vitest.workspace.ts` | 148 | `0883f76b31272fc1267847abf7442fffb70ff813fa762a72b6992b3f749c22b9` |

## Integrity requirements

- **Declared entries:** 241
- **Parsed manifest rows:** 241
- **Matched entries required:** 241
- **Missing required:** 0
- **Mismatches permitted:** 0
- **Duplicate paths permitted:** 0
- **Extra manifest rows permitted:** 0

This freeze records the corrected Stage 2 candidate only. It does not close the seven independent-review findings, authorize Stage 3, or record any action against CT 200.
