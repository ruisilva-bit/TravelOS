# TravelOS Phase 1 M1 — Stage 2 Candidate Freeze

- **Freeze timestamp:** `2026-08-21T08:39:03Z`
- **Candidate purpose:** exact reviewable freeze of the final Stage 2 monorepo, configuration contracts, architecture fences, CI, executable evidence and validation report.
- **Candidate validation:** **PASS**
- **Next permitted action:** independent non-authoring Stage 2 review only.
- **Stage 3 authorization:** **NOT GRANTED**
- **Frozen manifest entries:** **203** files.
- **Reviewable set including this freeze document:** **204** files.
- **Manifest aggregate SHA-256:** `ccc223d7ef8847ceceb260f19853300792a24fe8df6e6729e63061d17a851e5e`.

> This freeze document is intentionally excluded from its own manifest to avoid recursive self-hashing. Its final SHA-256 and size are verified separately after creation. Every other reviewable candidate byte is listed below.

## 1. Provenance anchors

- `AGENTS.md`: `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340`
- `IDEA.md`: `2c7be6b7154835a1301118670a33f2c8b9d9f8a0f178b9565515ab2484a2f524`
- Accepted Phase 0 baseline: `docs/reviews/PHASE_0_ACCEPTED_BASELINE.md` (`bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb`)
- Approved M1 plan: `.hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md`
- Corrected Stage 1 decisions, evidence, candidate freeze and independent closure are included for stack/provenance verification.
- Final Stage 2 evidence index: `docs/evidence/phase-1-m1/stage-2/EVIDENCE_INDEX.json` (`25df1c53e1da00b6cbc8e2c3e7ee867f216c17ee2058ef77df882e1691b1b55e`)
- Final Stage 2 validation report: `docs/reviews/phase-1-m1/STAGE_2_CANDIDATE_VALIDATION.md` (`6876c396871229f79799c811797054271d7f12b336c73f6da60a3c3164bc4f05`)

## 2. Scope and exclusions

Included:

- all 40 Accepted Phase 0 authoritative files;
- the approved M1 implementation plan;
- corrected Stage 1 provenance required to verify qualified pins and closure;
- root workspace, lockfile and tool configuration;
- all Stage 2 application/package source, configuration, architecture rules, CI and test tooling;
- generated non-secret configuration JSON Schema and DEVELOPMENT example;
- all final Stage 2 evidence artifacts and `EVIDENCE_INDEX.json`;
- the final Stage 2 candidate validation report.

Excluded:

- `.git` internals;
- `node_modules` and package caches;
- `dist`, coverage, Vite cache and TypeScript build-info output;
- disposable/temporary probe state;
- credentials, tokens, cookies and temporary secrets.

## 3. Category counts

| Category | Files |
|---|---:|
| Accepted Phase 0 | 40 |
| Approved M1 plan | 1 |
| Corrected Stage 1 provenance | 19 |
| Stage 2 evidence | 20 |
| Stage 2 implementation | 122 |
| Stage 2 validation | 1 |
| **Total manifest entries** | **203** |

## 4. Verification contract

For every row below, recompute the repository-relative file byte length and SHA-256. Verification passes only when all 203 entries exist and every size/hash matches. Recompute the aggregate as SHA-256 over the UTF-8 sequence of path-sorted rows in this exact form, joined by LF:

```text
<path>\0<bytes>\0<sha256>
```

Expected aggregate: `ccc223d7ef8847ceceb260f19853300792a24fe8df6e6729e63061d17a851e5e`.

After this file is written, no listed byte may be modified. Any correction requires a corrected candidate and a new freeze.

## 5. Exact frozen manifest

| Category | Path | Bytes | SHA-256 |
|---|---|---:|---|
| Stage 2 implementation | `.github/workflows/ci.yml` | 558 | `7df6ab58e1e6a0c71ec78122bc85b7b3d4d0e2dc9ed00a58e920b4d8bd231304` |
| Stage 2 implementation | `.gitignore` | 93 | `47c459f62358cf051e0e9e11d95337fbd0b74db7e007c9b684b63dd838e678ce` |
| Accepted Phase 0 | `.hermes/phase0-sources.json` | 2494 | `6e097d8bc5dcaf49a216907b1a486a42cdf8d568bc13570e93712647122d610f` |
| Approved M1 plan | `.hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md` | 65399 | `210ab56b4d104b9ba8c5f825bd370c3c9056be172f8a2f6db00704ca91a58f71` |
| Stage 2 implementation | `.node-version` | 8 | `7e8a2fa94951112b894a3dbe3d05efef5e9263741fa49125f0a70f40fedab4cc` |
| Stage 2 implementation | `.npmrc` | 65 | `300a6c5020343be00e16eee83a2bdfc2a33eaa56a82a8beffbdcc46eec9b6010` |
| Stage 2 implementation | `.prettierignore` | 119 | `217a7727cd90c49dd5daa5347cf2a4e6aac2f70f490a4763ad24146350dc8bd7` |
| Accepted Phase 0 | `AGENTS.md` | 11014 | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` |
| Accepted Phase 0 | `IDEA.md` | 10628 | `2c7be6b7154835a1301118670a33f2c8b9d9f8a0f178b9565515ab2484a2f524` |
| Stage 2 implementation | `apps/admin-api/package.json` | 432 | `86ca882bf47c097ecf026679fa1bad948142665a0fa3b31df22581e326df6977` |
| Stage 2 implementation | `apps/admin-api/src/app.module.ts` | 191 | `fd56ee5f8360d4c252540c6ebc5e7002054f174c039d32b78e0cd17fcbf0683e` |
| Stage 2 implementation | `apps/admin-api/src/app.ts` | 390 | `ca793d146f60afbb19533ddf9002d38c132e4c382907285ea25d4441f8a28cb2` |
| Stage 2 implementation | `apps/admin-api/src/health.controller.ts` | 343 | `9150b915f39de1754a6a4b569cbebdee8818256d543ca6b6591c35ef0face21e` |
| Stage 2 implementation | `apps/admin-api/src/main.ts` | 2695 | `d904a7d1340c15ec3d5b167baf636afead570072d4fbfdd4ddd31a54b9edcf72` |
| Stage 2 implementation | `apps/admin-api/test/health-live.test.ts` | 611 | `3f685472f1c7d66ecff2c6737ed6224aca3fb74f98f09458ac1cf5e4a28b9561` |
| Stage 2 implementation | `apps/admin-api/tsconfig.build.json` | 272 | `dd4e96341a1763ace06f3729870abc1ae82f4302be0f4d6bef9030973ba83621` |
| Stage 2 implementation | `apps/admin-api/tsconfig.json` | 160 | `8d0a5b8fa42ddce7f1818c7094d9ad0c968412133a48f580f3a5af50ac3ced06` |
| Stage 2 implementation | `apps/admin-web/index.html` | 383 | `47a514aed86d53fd4628b2dd8e0464702a0e08dbbefe5b98b44940cbe0c4911f` |
| Stage 2 implementation | `apps/admin-web/package.json` | 389 | `fd04528c4fd57948c2bb10ee380c7203b5a8a42dac0248af5dc9fff8f7800d1d` |
| Stage 2 implementation | `apps/admin-web/src/app.tsx` | 230 | `771c83fc2894cd0cfce2f1e3d4798aacdaf3be973ddb29bbd2a8f440693903da` |
| Stage 2 implementation | `apps/admin-web/src/main.tsx` | 397 | `d7c151341dac8e265b2edbe2e1210d793b110c18d94588002a400ee06543ce51` |
| Stage 2 implementation | `apps/admin-web/test/app.test.tsx` | 631 | `63cf6058092b5ec19890e68db6f8d3c934ec99fff44dd919aa984a72020b6ad0` |
| Stage 2 implementation | `apps/admin-web/tsconfig.json` | 341 | `a5b380f66f8365f7acd6b902d3d09499fbf3ca64f51e0cc799e29caf4155f5ff` |
| Stage 2 implementation | `apps/admin-web/vite.config.ts` | 761 | `ddfde4f0639e1c7df0e716239ce97b15555154f81edf8e7eb19de71e97b9846d` |
| Stage 2 implementation | `apps/portal-api/package.json` | 433 | `0a6dd6ecf7d53c71508e809fcf2c371287101c8ef5df9700343715e3eac74466` |
| Stage 2 implementation | `apps/portal-api/src/app.module.ts` | 194 | `5525fb7ed7942ec1a3385397368453c2a66aed55582029bfa853fe6525961193` |
| Stage 2 implementation | `apps/portal-api/src/app.ts` | 393 | `5bc70f9a58b7641f28078854f38f14aaf19ffb5492e1e31cf711301a117912a2` |
| Stage 2 implementation | `apps/portal-api/src/health.controller.ts` | 348 | `58ca4b5ebcd60ad7a1c57088254dcdaac6bc0db4163358bbab6259fe21e0ce0b` |
| Stage 2 implementation | `apps/portal-api/src/main.ts` | 2702 | `e072163355176e089ef31caeb348256b42a9db0caa5496a924d560c216a7f182` |
| Stage 2 implementation | `apps/portal-api/test/health-live.test.ts` | 615 | `9793074b0989070aca56aa5d051028049c47c400ec68238a412c7209493f408e` |
| Stage 2 implementation | `apps/portal-api/tsconfig.build.json` | 272 | `dd4e96341a1763ace06f3729870abc1ae82f4302be0f4d6bef9030973ba83621` |
| Stage 2 implementation | `apps/portal-api/tsconfig.json` | 160 | `8d0a5b8fa42ddce7f1818c7094d9ad0c968412133a48f580f3a5af50ac3ced06` |
| Stage 2 implementation | `apps/portal-web/index.html` | 391 | `7d52863aefdf6dce69028ba1a24fef7b4fa61f1b2274fd54a245ff6e8b029391` |
| Stage 2 implementation | `apps/portal-web/package.json` | 390 | `6b464fe3fd4334268f0fb8a7e50c515e53b151f76a7901e27fc5f4535efc8d39` |
| Stage 2 implementation | `apps/portal-web/src/app.tsx` | 239 | `5860a6caa48b4b842161e93556a663ab725a0bcb037dd6211bace4d6aab69d6c` |
| Stage 2 implementation | `apps/portal-web/src/main.tsx` | 401 | `c34022fabe7286db12844085e2524f5a6213a19a2715e90458b50743ce256524` |
| Stage 2 implementation | `apps/portal-web/test/app.test.tsx` | 643 | `dce7c1e233162217934329997776f0ee74711e844b56ff9dd0c9a6db4a13ec6c` |
| Stage 2 implementation | `apps/portal-web/tsconfig.json` | 341 | `a5b380f66f8365f7acd6b902d3d09499fbf3ca64f51e0cc799e29caf4155f5ff` |
| Stage 2 implementation | `apps/portal-web/vite.config.ts` | 761 | `ddfde4f0639e1c7df0e716239ce97b15555154f81edf8e7eb19de71e97b9846d` |
| Stage 2 implementation | `apps/worker/package.json` | 226 | `5ad8241ef9ce559a4d56120daa45c829d97bcd66f3c12d10c11f28737b757a82` |
| Stage 2 implementation | `apps/worker/src/main.ts` | 1775 | `27fcda99d837358872cd9449db5c05022877164d28c04a1b38e5d6cb58de84bd` |
| Stage 2 implementation | `apps/worker/src/worker-process.ts` | 441 | `88f75c421c8dee74bdfc529e8450d13dab58d71281116936cbb0dded20de27d2` |
| Stage 2 implementation | `apps/worker/test/worker-process.test.ts` | 411 | `e033f8014ea41b1738cf1078eac4dfa56426ee934d9ce3db838e2f2d933f57db` |
| Stage 2 implementation | `apps/worker/tsconfig.build.json` | 272 | `dd4e96341a1763ace06f3729870abc1ae82f4302be0f4d6bef9030973ba83621` |
| Stage 2 implementation | `apps/worker/tsconfig.json` | 160 | `8d0a5b8fa42ddce7f1818c7094d9ad0c968412133a48f580f3a5af50ac3ced06` |
| Stage 2 implementation | `deploy/manifests/development.example.json` | 1225 | `21f89f66a5107c408b834ef1619e56148ed1f0cebd64b016007f5ca3b8a51006` |
| Stage 2 implementation | `deploy/manifests/schema/instance-manifest.schema.json` | 5795 | `0489a6d82af6f9177083f2c00e22a867fc3ccc4b8b5a013c4ab138cf18c476d6` |
| Accepted Phase 0 | `docs/ARCHITECTURE.md` | 22908 | `5a6293b167ed591c3e1f7bf4a7bf8ca99ace838ec038dd6f97b7f44fbd1e6ec3` |
| Accepted Phase 0 | `docs/DATA_MODEL.md` | 21143 | `f919e688ad9b42d804333d3d8e1355fe070176a704e73f523fc83bb6d82949b3` |
| Accepted Phase 0 | `docs/DEPLOYMENT_MODEL.md` | 15279 | `de6c2ed3890558b7802c041b40677c8d2147f3221d5de812884724c4e5e108ee` |
| Accepted Phase 0 | `docs/DESIGN_SYSTEM.md` | 9801 | `9dfb3ac7e92ae4253e17d32d47ba8b68a728c2fd2a99fc76f52c0c9f7f9bddac` |
| Accepted Phase 0 | `docs/DOMAIN_MODEL.md` | 16184 | `4979ddb6dd8e937f548164572b6972afc12fe0c740ca08d233d8e6523808455d` |
| Accepted Phase 0 | `docs/PERMISSIONS.md` | 10010 | `ad036b8647f4482bc5e59bff09e5adbf653a4d3ed3994a20cd5b201d104ea1d9` |
| Accepted Phase 0 | `docs/PRODUCT_BLUEPRINT.md` | 15398 | `c46e9e980da83e3c5d0c5816431195b8bf0b33a9a8e403533d28ec5ae8d37ecf` |
| Accepted Phase 0 | `docs/PUBLISHING_MODEL.md` | 12228 | `def308a38f423be7902308ba665fe97ac5d585715c056f880e02adc6493aa5e4` |
| Accepted Phase 0 | `docs/README.md` | 3049 | `fcdb512c3f5d669e54a56871eff60c7bf3101ce39996af77105e8ff516bd636b` |
| Accepted Phase 0 | `docs/SECURITY_MODEL.md` | 18862 | `5a719485642383988e1611c0f3c8a25d2a0550435025ae0c2e4a2412d0bf1ea1` |
| Accepted Phase 0 | `docs/adr/ADR-001-modular-monolith.md` | 1733 | `d97f3583b944f72baa9d7cd5cf8af029a722003d67102fe08e426cacf08206f4` |
| Accepted Phase 0 | `docs/adr/ADR-002-dedicated-single-tenant-deployment.md` | 1773 | `8eb647415c7e098f040eb77c11c5517ebfeefe41d6cf864565f5fadf2b56038f` |
| Accepted Phase 0 | `docs/adr/ADR-003-independent-database-per-instance.md` | 1569 | `b93d2f91fbe51f7ce59692d9fec25c47d0c0d74cc4bed32f19574e1da53db19d` |
| Accepted Phase 0 | `docs/adr/ADR-004-immutable-publishing-snapshots.md` | 2605 | `f4e3d1d272148e99873cfab0058b8126c104d724ab894fafa56488fabd9b8ef4` |
| Accepted Phase 0 | `docs/adr/ADR-005-structured-itinerary-model.md` | 1834 | `ccef302ec616315b6f6ce2ae9e574acb0e18a3e56542e0286065f32ccfd060b5` |
| Accepted Phase 0 | `docs/adr/ADR-006-provider-based-integration-architecture.md` | 2082 | `1f276f9568fbdd054a0f8819352c13195932ebdc2a91d265ac24dd99da49c775` |
| Accepted Phase 0 | `docs/adr/ADR-007-separate-staff-and-portal-identity-realms.md` | 1673 | `5ad4ddd4fcd832854fac3ff117212ce8788e323dda5fe0f79deaf5946047ac2f` |
| Accepted Phase 0 | `docs/adr/ADR-008-rbac-with-explicit-resource-scopes.md` | 1661 | `451db1e893346802160db8dc52e0f12ac6e7993d3e1137f840efe7d3d6721e14` |
| Accepted Phase 0 | `docs/adr/ADR-009-transactional-outbox-and-postgresql-jobs.md` | 2874 | `08960ecbc796c637f09aa410100a0b33d6002089c2b84d598dbc00ae5f752388` |
| Accepted Phase 0 | `docs/adr/ADR-010-exact-money-and-currency-representation.md` | 1846 | `5a52e10ddf151b7df12c440ead18fe2c1dadc5db02f1d3890284b3b30e713feb` |
| Accepted Phase 0 | `docs/adr/ADR-011-document-storage-and-explicit-access-grants.md` | 3404 | `9beb7c8862067e842eded1ee1ff0bdb008c4391d0d5c9a2e141d7ba6172abca6` |
| Accepted Phase 0 | `docs/adr/ADR-012-persistence-boundary-and-fleet-safe-migrations.md` | 2356 | `298dc1625a2d054490250db047131411a9e2ad34acac020ee521017dd72d93e7` |
| Accepted Phase 0 | `docs/adr/ADR-013-monorepo-web-runtime-and-build-orchestration.md` | 1821 | `d98881a785973d0f89da8c0ec372899932c310bf0acdad34d61e7fcb6538ce69` |
| Accepted Phase 0 | `docs/adr/ADR-014-durable-privacy-erasure-across-backups.md` | 5063 | `b0effe71de4f52570245d9e789ef018912a00d2bf1ba09aa16110fb75e3175c7` |
| Accepted Phase 0 | `docs/adr/README.md` | 2248 | `c2ee6d59b7e8bd2a153381a8f9a8bbac2a0f07d8ead680a6b6ed5d8814f901da` |
| Corrected Stage 1 provenance | `docs/evidence/phase-1-m1/stage-1/EVIDENCE_INDEX.json` | 6136 | `c5dce2f9217d24b4a0e4d00e12e9a9e089a62ed5676238a2ca8411d37f2bce21` |
| Corrected Stage 1 provenance | `docs/evidence/phase-1-m1/stage-1/better-auth-realm-separation.json` | 4581 | `74087b4519bc262980b764d5a2bfb3b2c73e906c4c4d08fe092b2e682b151c06` |
| Corrected Stage 1 provenance | `docs/evidence/phase-1-m1/stage-1/ct200-read-only-inventory.json` | 3810 | `ca027dcd13a40f877f25c85b1c5a718ffbb3c4522bf6d95211dae41fde044cfc` |
| Corrected Stage 1 provenance | `docs/evidence/phase-1-m1/stage-1/dependency-matrix.json` | 58048 | `e7a6469635fda29f87e9318828bf395361dd968ce9847b5e944e9b4001b7f958` |
| Corrected Stage 1 provenance | `docs/evidence/phase-1-m1/stage-1/disposable-cleanup.json` | 2178 | `bdb4941d01ebf2cd59d12d5dbd06e36096d88b4632074faa461129882fd86ee0` |
| Corrected Stage 1 provenance | `docs/evidence/phase-1-m1/stage-1/install-audit-build-policy.json` | 8415 | `5aadc38d36d169e81e65d44702a6af7b0bd719da0777f4f2511a1abc3f0c9bab` |
| Corrected Stage 1 provenance | `docs/evidence/phase-1-m1/stage-1/postgresql-runtime-results.json` | 5252 | `154d3a3bdfa70b2e61a481b3cfb19dac4dca48a42149e30537ce42bf60019682` |
| Corrected Stage 1 provenance | `docs/evidence/phase-1-m1/stage-1/quality-build-results.json` | 13195 | `94ba8623a85a175ae8b4fd5fa8b695b6a1c9f879e3e3bfbd4a30ea4836f9f38f` |
| Corrected Stage 1 provenance | `docs/evidence/phase-1-m1/stage-1/resolved-engine-peer-graph.json` | 172932 | `1e3d0971e5e378c42412b0256866a8d25382fc36774130c05ce42058cb2dcf17` |
| Corrected Stage 1 provenance | `docs/evidence/phase-1-m1/stage-1/toolchain-package-provenance.json` | 9434 | `20838a66030a8d50144922440f644bd80dbcbe105bdaa8cf573b3efed767bebb` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/EVIDENCE_INDEX.json` | 5267 | `25df1c53e1da00b6cbc8e2c3e7ee867f216c17ee2058ef77df882e1691b1b55e` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/architecture-invalid-portal-fixture.json` | 1208 | `c36f1e8b2c06ee890b2a1a16654a049c4e8ef7490125743a28945ece3c21ef42` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/architecture-production-graph.json` | 1564 | `6c9e780ee707574f6bf85c3c481d6bedad991d19c45a78a0d7ad46bb7b8076ef` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/browser-bundle-secret-scan.json` | 2080 | `dcb5372a9dd589ff96eb0385c42a15ae71ea745a98ac21727d5d429552f4e930` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/ci-verify.json` | 1111 | `f65fd01e1b201bd6ef3c125badefa944c6b0611c50d26d7d00fb4d8b241382bd` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/clean-build.json` | 832 | `dbd182b25226234b64e21f2aa029e2bffc066f7aca5556a16fb8370736bc44a8` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/clean-frozen-install.json` | 3853 | `7f8f377ad5b7b0246a74cdd2beda30e22aa092e352b63524346b8bb3191ea040` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/configuration-contract-tests.json` | 824 | `0bb309e1a9a522c7851ec8687b5b2171b084d8fff77dec28e801a8bcd21e36f9` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/configuration-schema-drift.json` | 779 | `1b6a5722651389a57f4ee056ae5394a7dd5617a9db6489b17ff0c282b8730c0e` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/exact-pins.json` | 1401 | `a0f8724e9bf62bc65585a29f4dccee83696eae2a546a18b662d903846e153b76` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/five-deployable-smokes.json` | 4915 | `8a4f43299ee748a28e7f16e236e3564348fd3128416e09458101886b9c2a18cf` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/formatter-safety.json` | 847 | `e529cca892a85185559d2945a143f8a06160bd36f0f1dbd00c9154273af8c655` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/implementation-tree.json` | 22925 | `f07649cadc8874fc9b2c5defad9ec60db581337e9390838a2c55705ae309f99d` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/lint.json` | 717 | `b6bb535974e66c6bafa88d5d2e751dace3014f7650e12086f8d27025221ff261` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/protected-baseline.json` | 1729 | `accc4c19420abebacbddd5c0beaaa9f8029ea0c60ccd46cd31e8840e29e29dd1` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/rejected-technologies.json` | 1024 | `b33a6974036a8c6ea75c15754091877a8594565c0fedbc931edec6224c46df1f` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/source-credential-pii-scan.json` | 789 | `680c2568f24fe1fffa8cdb4504b32a9d42a654b9d434e0f4896859f914dd2aae` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/stage-boundary.json` | 1788 | `805a5d6d721a7765a4e41e0c6be40b693aeadef7784eb97a7fe573742d78f4bb` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/typecheck.json` | 738 | `0975f85d8b67273961a4cf4956514f6ff3b432cb83586ce048873d1eb1107439` |
| Stage 2 evidence | `docs/evidence/phase-1-m1/stage-2/unit-tests.json` | 3296 | `8914f6745785b883f7a607a7ed32291208563d6e500eed383d694c7b7ac38888` |
| Corrected Stage 1 provenance | `docs/implementation/M1_BOOTSTRAP_DECISIONS_CORRECTED.md` | 5930 | `366816a9fda4c3c6fbccb26da3675832d8979b82c26714c65815146a0b11b6e2` |
| Corrected Stage 1 provenance | `docs/implementation/M1_STAGE_1_CT200_BASELINE_CORRECTED.md` | 2935 | `beb5951f5a3353a39184d4f168af4e2a4866f06793d8fbee8b4a2ee46235978e` |
| Corrected Stage 1 provenance | `docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX_CORRECTED.md` | 8525 | `3ee47440d3304e92ab850db7865ff645b6e2fdf6172e5c071287e34db2ee6ad6` |
| Accepted Phase 0 | `docs/reviews/AGENTS_CANDIDATE.md` | 11014 | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_ARCHITECTURE_REVIEW.md` | 8233 | `32ee880861bad548feca777c8be813cb30ff21752daa90587686ca00f17936cd` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_CANDIDATE_FREEZE.md` | 3057 | `06bf41b770f830d6a110422f21c8fb23ef54b30884e91d3c474b370c7638d3e4` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_CORRECTED_CANDIDATE_FREEZE.md` | 4879 | `d30c414d057bc33bc72cde30a91454ef1f651ca0a10a7e9cfa19b4d18a2fcc8a` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_FINAL_GATE.md` | 5203 | `0a2f3277f55c1fc2bb27ec832f9becb4086fcce658d3d0cb7e5c505d6a3ec595` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_POST_PO_CANDIDATE_FREEZE.md` | 7161 | `590e6dcdebcf325fe3a677e140b74b18f4fe06eb14adedeb686da4b48cf60040` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_POST_PO_CLOSURE_REVIEW.md` | 4889 | `e02c2adea3bc8cd9aa47f95acaecaf18ae37efa18c8376c2fd3227c983bd271d` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_POST_PO_VALIDATION.md` | 2937 | `9fab118f0ea77eff6bebae80fa61b193ff2c54f34b312e35758e1814ebfdf6b0` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_PO_ADJUSTMENT_CORRECTIONS.md` | 6989 | `4056f3c4278ca7765d5c5046e0ce66952575f17a7d69b225e7d4f283dd97ae6f` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_PRE_PO_CLOSURE_REVIEW.md` | 3700 | `668292f89cece7083cfdabf06e967a6cc380d1c48995da7c164be75f91c805c9` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_PRODUCT_OWNER_DECISIONS.md` | 3374 | `762a214f3b3ac57412b2806887954db7bc323b2c3a0ff969cd2eaf0bb6f39e3f` |
| Accepted Phase 0 | `docs/reviews/PHASE_0_REVIEW_CORRECTIONS.md` | 7187 | `d72abdbe7c36c2ba8295ae13e5cc3077036ae55949b110081566dfab7ffe866b` |
| Corrected Stage 1 provenance | `docs/reviews/phase-1-m1/STAGE_1_CANDIDATE_FREEZE.md` | 4250 | `1b6302ae14bec1733ae693d948191464c1672b03f9aa39b2eee11f9ccee6f31a` |
| Corrected Stage 1 provenance | `docs/reviews/phase-1-m1/STAGE_1_CORRECTED_CANDIDATE_FREEZE.md` | 4926 | `dae9575284897d3cac3eef7851d41487c8003dde6a6e6e15fb1f14927c359d61` |
| Corrected Stage 1 provenance | `docs/reviews/phase-1-m1/STAGE_1_CORRECTED_CANDIDATE_VALIDATION.json` | 18790 | `e6c9c7e774dc090b1b3b40a974cee2a520bc278e22743de1b2a613c67b7f4f3d` |
| Corrected Stage 1 provenance | `docs/reviews/phase-1-m1/STAGE_1_CORRECTED_INDEPENDENT_CLOSURE.md` | 9876 | `9f629ae6309a8d86d43869777909f1e0a7e18c402fcfcef99932b87d94b6050d` |
| Corrected Stage 1 provenance | `docs/reviews/phase-1-m1/STAGE_1_INDEPENDENT_REVIEW.md` | 10806 | `fb88c2fb6b1e02ec33e771f0a2de8b71d10efae18c400811250bcbf3296e710d` |
| Corrected Stage 1 provenance | `docs/reviews/phase-1-m1/STAGE_1_REVIEW_CORRECTIONS.md` | 7639 | `0aadcceec817718193535c19d9f4c53a6698b9fb933187f67acc215295c7dc5f` |
| Stage 2 validation | `docs/reviews/phase-1-m1/STAGE_2_CANDIDATE_VALIDATION.md` | 8111 | `6876c396871229f79799c811797054271d7f12b336c73f6da60a3c3164bc4f05` |
| Stage 2 implementation | `eslint.config.mjs` | 1083 | `7ade2a4513b4610cb9b2870ef4793c82b032ca2483ee116af1e7e7f01187e0ec` |
| Stage 2 implementation | `package.json` | 3066 | `01fb68c2f9e32f906d4fd592279698d6de598796b81132004fcbd5f2c05e8208` |
| Stage 2 implementation | `packages/auth-adapters/package.json` | 330 | `35dae9ace0982f34a6d2373224d369e5c3b3288dcb0eebcffe120b58ec8ba970` |
| Stage 2 implementation | `packages/auth-adapters/src/index.ts` | 93 | `674dec82dab2f3d605f3a36338dd0b553f4d52afbfd8bf99997f9f6ec9104ed0` |
| Stage 2 implementation | `packages/auth-adapters/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| Stage 2 implementation | `packages/auth-adapters/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| Stage 2 implementation | `packages/backend-core/package.json` | 329 | `a1ccbe51b7b64c00479b92c89878174ff0320bf3fcd32d67ffcc91e665fa0418` |
| Stage 2 implementation | `packages/backend-core/src/index.ts` | 111 | `5debec22176a12ebda6d7f90dea80a704e19d07f0b9f4c93e9577c776c9af6e9` |
| Stage 2 implementation | `packages/backend-core/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| Stage 2 implementation | `packages/backend-core/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| Stage 2 implementation | `packages/config/package.json` | 367 | `5052899fc06ceb5669e5475209a51429f489cbd9ad8f8251acf91e984493d55e` |
| Stage 2 implementation | `packages/config/src/credential-reference.ts` | 308 | `6ae56031f59b5418a359afe5f4fcd3124cf518ae739082396c96263987087223` |
| Stage 2 implementation | `packages/config/src/index.ts` | 384 | `370a6aea1fe3e6b320d4a581c0386b88283a67002bd096be5604055a2d3915ea` |
| Stage 2 implementation | `packages/config/src/instance-manifest.ts` | 5057 | `63044555aaa845f79c8817284f11db01a4e22136a3ee9689de50be2f07297505` |
| Stage 2 implementation | `packages/config/src/load-development-instance-manifest.ts` | 411 | `cd1b5484a31a56b58ef9e54404751c71112902cfd30161387d2a8884a82b07d5` |
| Stage 2 implementation | `packages/config/test/instance-manifest.test.ts` | 3426 | `3c6eff6da3935b27af6247aac84ec0dab71aa7f5e4da463b6d53da43146b9654` |
| Stage 2 implementation | `packages/config/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| Stage 2 implementation | `packages/config/tsconfig.json` | 193 | `326a5f60475a157177d61e94b1886d0f6c1653a4ea144f43c430d5b7ad93337f` |
| Stage 2 implementation | `packages/contracts/package.json` | 497 | `8d50ebe3eebcf8b3bcfc2e48e655a4f1ddc13fdee9c611d8a0cfe2e9a11afac1` |
| Stage 2 implementation | `packages/contracts/src/admin/health.ts` | 298 | `a39764d7144a16405562c43dbbcf1da16a110f7f15eea6a1a4d3e92e02e78820` |
| Stage 2 implementation | `packages/contracts/src/admin/index.ts` | 91 | `1669ab8f0c197d0fd68e9c9f754d08ce97f00d58d2a188304a78db69e1dedf6b` |
| Stage 2 implementation | `packages/contracts/src/portal/health.ts` | 302 | `744dc95f8b1238975aaad38960c1a86d3b35153902db6d386eba46062f77e30c` |
| Stage 2 implementation | `packages/contracts/src/portal/index.ts` | 93 | `9b48b59ff0f94ef5a0250540b9a7b2f3f97ce2efdfabef05439e047897cefbc2` |
| Stage 2 implementation | `packages/contracts/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| Stage 2 implementation | `packages/contracts/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| Stage 2 implementation | `packages/database/package.json` | 325 | `89b2c9dd23d606990e34c58e6e6c87dae7cf12e1a3352612b8974d881a5c2ee2` |
| Stage 2 implementation | `packages/database/src/index.ts` | 111 | `1a8f4e1961e271f3c6fd1d9e98f2210b0883e363b8bf5d38efeee1488c31fb6a` |
| Stage 2 implementation | `packages/database/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| Stage 2 implementation | `packages/database/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| Stage 2 implementation | `packages/design-system/package.json` | 471 | `8fef1edb64a4b92bd1dee6926f1fff3176405b674727a11e0ed599d7347d7fb7` |
| Stage 2 implementation | `packages/design-system/src/foundation-page.tsx` | 427 | `dd199ec16f2763741a6384899e6e477bf2260f83409d5077b78f2852cff84a19` |
| Stage 2 implementation | `packages/design-system/src/index.ts` | 81 | `0dd0a9902e8b70a3868388aa7de14bc83e2d917d2287150406909948ed506b5a` |
| Stage 2 implementation | `packages/design-system/src/styles.css` | 1592 | `aa6f7a194f542731e63968b0957e603566053130118ca367de1c7337f4a31346` |
| Stage 2 implementation | `packages/design-system/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| Stage 2 implementation | `packages/design-system/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| Stage 2 implementation | `packages/observability/package.json` | 330 | `91ce86f786d9ef745e7735d35659231a4e2c6be701e7b65c1a1dc5efc7d623b6` |
| Stage 2 implementation | `packages/observability/src/index.ts` | 97 | `30052591e84039c62ed410859a38a4423d0a127ea149416ce4a90b3f701c4ae3` |
| Stage 2 implementation | `packages/observability/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| Stage 2 implementation | `packages/observability/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| Stage 2 implementation | `packages/portal-safe-core/package.json` | 647 | `8d8bee9714fce69b1ac1681baf0d5ac56d6cbe5e769ae6acb99d8e6b7b09d993` |
| Stage 2 implementation | `packages/portal-safe-core/src/customer-presentation/index.ts` | 194 | `e767db02378d17338d35fdde12af49b46ed6f47069ef8f70440b86c33f8198a8` |
| Stage 2 implementation | `packages/portal-safe-core/src/documents/index.ts` | 186 | `fd44e2e917a0e060d67e518e1a380796e7cb9cb6636e3bf72ad8c61b11f6b614` |
| Stage 2 implementation | `packages/portal-safe-core/src/index.ts` | 107 | `961ba07f01a5cd1bfc25ad3df37893a80fa3012ee649ff0013a4604ceccbee52` |
| Stage 2 implementation | `packages/portal-safe-core/src/portal-access/index.ts` | 166 | `677a3e254f4fc2073eb2bfba9ee625ea27c661e8f1f09c0ab9f76866439e667c` |
| Stage 2 implementation | `packages/portal-safe-core/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| Stage 2 implementation | `packages/portal-safe-core/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| Stage 2 implementation | `packages/test-support/package.json` | 329 | `b0ef9b3e2ebd08f5c2bb2c89c25bfec2d16fee233ff0a5680da1a3105bf673a0` |
| Stage 2 implementation | `packages/test-support/src/index.ts` | 103 | `0567c32252208a5659d2852f68d9fdb3a56aa4f5794a9945eb149462be5e4c00` |
| Stage 2 implementation | `packages/test-support/tsconfig.build.json` | 299 | `4413b2f179eb45584f9a6a829c9461f09a666c5122bf1b925ad8a0c853b5a881` |
| Stage 2 implementation | `packages/test-support/tsconfig.json` | 170 | `e76bd261e9399a3da09ed00772ad3100a54d6589406f27436cea9d1e699ccc6e` |
| Stage 2 implementation | `playwright.config.ts` | 175 | `ff1e3099acd55234b87e06e69e9509c9743a3399f0d7410981fc3949bec07bd1` |
| Stage 2 implementation | `pnpm-lock.yaml` | 208980 | `c2b872478a60675300e83d8d45d70ec42e4bc272d16a17a7519e46f525d2cec9` |
| Stage 2 implementation | `pnpm-workspace.yaml` | 149 | `8840f7a60a38aaf6003fdf99922737ab6c1849929a7834ef60369c8adb9afcdd` |
| Stage 2 implementation | `prettier.config.mjs` | 164 | `1404e03791b81cf7ab663116a23718c4291f909ff668b5a57027bcff797c593a` |
| Stage 2 implementation | `tooling/architecture/check.mjs` | 3442 | `ec8af9dd69477f7bdc3d9c650c2408573862ae7fb57f8d9467853f8684be0e91` |
| Stage 2 implementation | `tooling/architecture/dependency-cruiser.cjs` | 2846 | `bd77ecc558629027b19c86d57564096d92df5cdc3b6af011cce2513634e437cc` |
| Stage 2 implementation | `tooling/architecture/fixtures/invalid-portal-import/portal-entry.ts` | 199 | `7437d1cae15b0989e8b86d3f67ad59fd3d4fe2810b77ab2b2947b2cfea4e6466` |
| Stage 2 implementation | `tooling/architecture/negative-fixture.cjs` | 828 | `17c9fa4b6f07d9437f5bc950804f309a047882998f20e4e6bd6f3db25d3eed22` |
| Stage 2 implementation | `tooling/architecture/reject-negative-fixture.mjs` | 1763 | `1184d892000009f3c5602c9d2b66471778df748485f753ff73c14d457f642af6` |
| Stage 2 implementation | `tooling/ci/bootstrap-toolchain.sh` | 1126 | `202c5bd95896f6641f6bd455be25e347467d18ce155560eecaf8bc906a3669f6` |
| Stage 2 implementation | `tooling/ci/capture-stage-2-evidence.mjs` | 27605 | `bc5d50b4120d6e281ac505b64487fdb0cef8b916488c230c72b274885bc761f8` |
| Stage 2 implementation | `tooling/ci/clean-build-output.mjs` | 664 | `89de2b6b54a7d420a0f76b6466b1225c0bd6d5f2702897ecb20139561f0066d0` |
| Stage 2 implementation | `tooling/ci/format-stage-2.mjs` | 2614 | `20e061468648f37dcd19e8b1d912bfade81739675c3461f52f9e82e6c37a8921` |
| Stage 2 implementation | `tooling/ci/install.sh` | 225 | `7bd020676bdb1381382a85226f46c1b687d6df6e5fe4f3af99b60edf5a9d87ba` |
| Stage 2 implementation | `tooling/ci/scan-browser-bundles.mjs` | 2312 | `d53639f1b57ffb2dc4c6e0964fe1b5064cc43333e9e2a32fe950edfcacee4c1f` |
| Stage 2 implementation | `tooling/ci/scan-source-secrets.mjs` | 2345 | `586beb465eb0a8d5c217f66ef968534f06f20c6dd9786cd82eb8a7101ebab894` |
| Stage 2 implementation | `tooling/ci/tsconfig.owned-declarations.json` | 378 | `4ac0e62f24108e4210ddabc75dd85ea8556eeb1e758758337d9a547d8e86221e` |
| Stage 2 implementation | `tooling/ci/tsconfig.typecheck.json` | 450 | `b6857bbe41955c3676900005def1b53a970f90e86b1fd86197fbd70da5ac936d` |
| Stage 2 implementation | `tooling/ci/verify-pins.mjs` | 5719 | `eee152f68b6f7036025a9737946166e9e34d71eaa25924d5321cf5079f058282` |
| Stage 2 implementation | `tooling/ci/verify-protected-baseline.mjs` | 3320 | `c6ba5ebb1ea9657d52a198b297805267df13b9eae44c1c2fe84e6ce9921fd36e` |
| Stage 2 implementation | `tooling/ci/verify-rejected-technologies.mjs` | 3271 | `5392300e3204ef5415d28725dcf16b11f3d896a0a81c74c921fc2011297da86e` |
| Stage 2 implementation | `tooling/ci/verify.mjs` | 1047 | `657399be014c51408dd164e543bcacee54714acf4be1851060f2cc0050b48c5b` |
| Stage 2 implementation | `tooling/ci/write-instance-manifest-schema.ts` | 1212 | `d6d31e3946540c048a22dcd8110081326518a8d1a745f087f67e1cffe88ce9c1` |
| Stage 2 implementation | `tooling/testing/owned-declarations/stage-2-sentinel.d.ts` | 198 | `dcad06f99c52e7c0784c91eb0d6b77ae45b4178f203917cd9668ec974e344a60` |
| Stage 2 implementation | `tooling/testing/smoke-built.mjs` | 4500 | `27dd33819759eee7ead51a5010210ab70345f407f0b07b517960a0637c4d2b5f` |
| Stage 2 implementation | `tooling/testing/vitest.config.ts` | 990 | `d3708e498cb48cd2dc8ff6a2db442ec6540e095864133e78777a603026f66b68` |
| Stage 2 implementation | `tsconfig.base.json` | 1522 | `caffd83223e74a7c03d4079bfa21aac5978eceb5e96a5397ecdcbd28bbc7335e` |
| Stage 2 implementation | `tsconfig.json` | 55 | `698c199169b6e49a314caa8af5644ab5b80187b87d0e9b5463b6e0e3f034d290` |
| Stage 2 implementation | `vitest.workspace.ts` | 148 | `0883f76b31272fc1267847abf7442fffb70ff813fa762a72b6992b3f749c22b9` |
