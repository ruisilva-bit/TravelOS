# TravelOS Phase 0 Accepted Baseline

- **Accepted at:** 2026-08-13T18:25:30+01:00
- **Decision:** GO for Phase 1 **M1 — Secure Published Trip Walking Skeleton** only
- **Reviewed candidate freeze:** `PHASE_0_POST_PO_CANDIDATE_FREEZE.md`
- **Reviewed candidate freeze SHA-256:** `590e6dcdebcf325fe3a677e140b74b18f4fe06eb14adedeb686da4b48cf60040`
- **Independent closure:** `PHASE_0_POST_PO_CLOSURE_REVIEW.md`
- **Final gate:** `PHASE_0_FINAL_GATE.md`
- **Entry count:** 40

This manifest records the accepted repository baseline after the reviewed candidate received independent closure and only administrative status/index/gate records were added. It does not replace the immutable 37-entry reviewed freeze as evidence of what the reviewer assessed. The candidate freeze proves technical closure; this manifest proves the exact accepted on-disk baseline from which M1 may start.

Any later architecture change requires a superseding ADR and a new baseline. Ordinary Phase 1 implementation files are not added to this Phase 0 manifest.

## SHA-256 manifest

| Path | SHA-256 |
|---|---|
| `.hermes/phase0-sources.json` | `6e097d8bc5dcaf49a216907b1a486a42cdf8d568bc13570e93712647122d610f` |
| `AGENTS.md` | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` |
| `IDEA.md` | `2c7be6b7154835a1301118670a33f2c8b9d9f8a0f178b9565515ab2484a2f524` |
| `docs/ARCHITECTURE.md` | `5a6293b167ed591c3e1f7bf4a7bf8ca99ace838ec038dd6f97b7f44fbd1e6ec3` |
| `docs/DATA_MODEL.md` | `f919e688ad9b42d804333d3d8e1355fe070176a704e73f523fc83bb6d82949b3` |
| `docs/DEPLOYMENT_MODEL.md` | `de6c2ed3890558b7802c041b40677c8d2147f3221d5de812884724c4e5e108ee` |
| `docs/DESIGN_SYSTEM.md` | `9dfb3ac7e92ae4253e17d32d47ba8b68a728c2fd2a99fc76f52c0c9f7f9bddac` |
| `docs/DOMAIN_MODEL.md` | `4979ddb6dd8e937f548164572b6972afc12fe0c740ca08d233d8e6523808455d` |
| `docs/PERMISSIONS.md` | `ad036b8647f4482bc5e59bff09e5adbf653a4d3ed3994a20cd5b201d104ea1d9` |
| `docs/PRODUCT_BLUEPRINT.md` | `c46e9e980da83e3c5d0c5816431195b8bf0b33a9a8e403533d28ec5ae8d37ecf` |
| `docs/PUBLISHING_MODEL.md` | `def308a38f423be7902308ba665fe97ac5d585715c056f880e02adc6493aa5e4` |
| `docs/README.md` | `fcdb512c3f5d669e54a56871eff60c7bf3101ce39996af77105e8ff516bd636b` |
| `docs/SECURITY_MODEL.md` | `5a719485642383988e1611c0f3c8a25d2a0550435025ae0c2e4a2412d0bf1ea1` |
| `docs/adr/ADR-001-modular-monolith.md` | `d97f3583b944f72baa9d7cd5cf8af029a722003d67102fe08e426cacf08206f4` |
| `docs/adr/ADR-002-dedicated-single-tenant-deployment.md` | `8eb647415c7e098f040eb77c11c5517ebfeefe41d6cf864565f5fadf2b56038f` |
| `docs/adr/ADR-003-independent-database-per-instance.md` | `b93d2f91fbe51f7ce59692d9fec25c47d0c0d74cc4bed32f19574e1da53db19d` |
| `docs/adr/ADR-004-immutable-publishing-snapshots.md` | `f4e3d1d272148e99873cfab0058b8126c104d724ab894fafa56488fabd9b8ef4` |
| `docs/adr/ADR-005-structured-itinerary-model.md` | `ccef302ec616315b6f6ce2ae9e574acb0e18a3e56542e0286065f32ccfd060b5` |
| `docs/adr/ADR-006-provider-based-integration-architecture.md` | `1f276f9568fbdd054a0f8819352c13195932ebdc2a91d265ac24dd99da49c775` |
| `docs/adr/ADR-007-separate-staff-and-portal-identity-realms.md` | `5ad4ddd4fcd832854fac3ff117212ce8788e323dda5fe0f79deaf5946047ac2f` |
| `docs/adr/ADR-008-rbac-with-explicit-resource-scopes.md` | `451db1e893346802160db8dc52e0f12ac6e7993d3e1137f840efe7d3d6721e14` |
| `docs/adr/ADR-009-transactional-outbox-and-postgresql-jobs.md` | `08960ecbc796c637f09aa410100a0b33d6002089c2b84d598dbc00ae5f752388` |
| `docs/adr/ADR-010-exact-money-and-currency-representation.md` | `5a52e10ddf151b7df12c440ead18fe2c1dadc5db02f1d3890284b3b30e713feb` |
| `docs/adr/ADR-011-document-storage-and-explicit-access-grants.md` | `9beb7c8862067e842eded1ee1ff0bdb008c4391d0d5c9a2e141d7ba6172abca6` |
| `docs/adr/ADR-012-persistence-boundary-and-fleet-safe-migrations.md` | `298dc1625a2d054490250db047131411a9e2ad34acac020ee521017dd72d93e7` |
| `docs/adr/ADR-013-monorepo-web-runtime-and-build-orchestration.md` | `d98881a785973d0f89da8c0ec372899932c310bf0acdad34d61e7fcb6538ce69` |
| `docs/adr/ADR-014-durable-privacy-erasure-across-backups.md` | `b0effe71de4f52570245d9e789ef018912a00d2bf1ba09aa16110fb75e3175c7` |
| `docs/adr/README.md` | `c2ee6d59b7e8bd2a153381a8f9a8bbac2a0f07d8ead680a6b6ed5d8814f901da` |
| `docs/reviews/AGENTS_CANDIDATE.md` | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` |
| `docs/reviews/PHASE_0_ARCHITECTURE_REVIEW.md` | `32ee880861bad548feca777c8be813cb30ff21752daa90587686ca00f17936cd` |
| `docs/reviews/PHASE_0_CANDIDATE_FREEZE.md` | `06bf41b770f830d6a110422f21c8fb23ef54b30884e91d3c474b370c7638d3e4` |
| `docs/reviews/PHASE_0_CORRECTED_CANDIDATE_FREEZE.md` | `d30c414d057bc33bc72cde30a91454ef1f651ca0a10a7e9cfa19b4d18a2fcc8a` |
| `docs/reviews/PHASE_0_FINAL_GATE.md` | `0a2f3277f55c1fc2bb27ec832f9becb4086fcce658d3d0cb7e5c505d6a3ec595` |
| `docs/reviews/PHASE_0_POST_PO_CANDIDATE_FREEZE.md` | `590e6dcdebcf325fe3a677e140b74b18f4fe06eb14adedeb686da4b48cf60040` |
| `docs/reviews/PHASE_0_POST_PO_CLOSURE_REVIEW.md` | `e02c2adea3bc8cd9aa47f95acaecaf18ae37efa18c8376c2fd3227c983bd271d` |
| `docs/reviews/PHASE_0_POST_PO_VALIDATION.md` | `9fab118f0ea77eff6bebae80fa61b193ff2c54f34b312e35758e1814ebfdf6b0` |
| `docs/reviews/PHASE_0_PO_ADJUSTMENT_CORRECTIONS.md` | `4056f3c4278ca7765d5c5046e0ce66952575f17a7d69b225e7d4f283dd97ae6f` |
| `docs/reviews/PHASE_0_PRE_PO_CLOSURE_REVIEW.md` | `668292f89cece7083cfdabf06e967a6cc380d1c48995da7c164be75f91c805c9` |
| `docs/reviews/PHASE_0_PRODUCT_OWNER_DECISIONS.md` | `762a214f3b3ac57412b2806887954db7bc323b2c3a0ff969cd2eaf0bb6f39e3f` |
| `docs/reviews/PHASE_0_REVIEW_CORRECTIONS.md` | `d72abdbe7c36c2ba8295ae13e5cc3077036ae55949b110081566dfab7ffe866b` |

## Scope boundary

- Phase 0 is complete.
- Phase 1 is authorized only for accepted M1 scope.
- Production, public exposure and real protected data remain separately gated.
- No application/runtime evidence is claimed by this manifest.
