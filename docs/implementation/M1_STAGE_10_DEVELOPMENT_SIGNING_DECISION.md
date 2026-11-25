# M1 Stage 10 — CT200 DEVELOPMENT signing profile

**Status:** PROPOSED — Product Owner authorized; independent security/architecture review and adjudication required before acceptance or use.

## Scope and historical decisions

This successor decision proposes a narrowly scoped exception to the Stage 1 corrected bootstrap signing decision in `M1_BOOTSTRAP_DECISIONS_CORRECTED.md`, section 4. That decision selected keyless GitHub Actions OIDC and specified no long-lived signing private key. The historical decision and frozen predecessor evidence remain unchanged. The proposed exception introduces a dedicated protected key **only for CT200 DEVELOPMENT**, not staging or production. Its different trust, provenance and operational risks require independent adjudication before it is accepted.

The Product Owner's Stage 10 DEVELOPMENT signing instruction authorizes this proposed design and secure storage of a dedicated development key, subject to independent review. It does not approve production, push, merge, external exposure, or Stage 11 work.

## DEVELOPMENT profile

- CI builds one immutable archive outside CT200; the archive is not edited after qualification. A detached Cosign signature is bound to its exact bytes and SHA-256. Signing metadata does not require rebuilding the artifact.
- Only an explicitly pinned DEVELOPMENT public key and fingerprint from independently controlled, versioned policy are trusted. A key bundled only with an otherwise untrusted artifact cannot establish its own trust. Development and production trust profiles are disjoint; reject environment/profile mismatch, unknown or unpinned keys, missing or invalid signatures, digest mismatch and modified archives before extraction, migration or activation.
- A dedicated DEVELOPMENT private key is generated and used only through a qualified protected credential mechanism on the build/operator side. Private signing material and passphrases never enter Git, artifact, receipt, logs, process arguments or evidence. Raw private key material must not persist as plaintext; a secure mechanism must be proven before use. Key generation, secure persistence, authorized use, rotation/revocation, access controls and recovery procedure are separately recorded by non-secret references and reviewed. If the approved executor or protected store is unavailable, fail closed rather than substitute an ad hoc key.
- Preserve the detached signature, the exact public-key fingerprint, artifact digest and sanitized verification receipts in the current indexed evidence package. Receipt integrity and signature verification are checked independently of the producer; logs cannot be self-certified through a self-comparison. Acceptance includes missing signature, wrong key, wrong profile and tampered-archive negative tests, plus exact extracted-artifact execution and a real activation-path guard.
- Signing proves possession of the selected DEVELOPMENT key over particular artifact bytes; it does not establish GitHub OIDC identity, a protected workflow, production provenance, or trust in the build host. Existing source and build provenance and CI evidence remain separate required gates.
- Stage 9 is not retrospectively altered or represented as signed under this new profile. A previously qualified exact artifact may be signed detached only after this policy is accepted; no historical one-shot CI is repeated and historical release evidence is unchanged. Stage 10 activation remains subject to all current contract, migration, backup, security and runtime gates.

## Production profile: unchanged

Production retains the Stage 1 policy: Cosign keyless signing in the authorized `ruisilva-bit/travelos` GitHub Actions `.github/workflows/release.yml@refs/heads/main` workflow; verification requires the pinned issuer `https://token.actions.githubusercontent.com`, exact workflow identity and provenance binding the repository, workflow, source ref and artifact digest. No DEVELOPMENT key or signature can satisfy production policy. Production signing remains unverified; GitHub 404 is not proof of repository nonexistence. No repository, production workflow, push, merge or production deployment is authorized here.

## Acceptance and rollback

This document is not an accepted exception until an independent non-author reviewer checks the exact document bytes, the historical no-long-lived-key boundary, proposed threat model, trusted-key distribution, protected storage, negative controls, fail-closed activation and production separation and returns a scoped GO, followed by recorded adjudication. Implementation-level trust, custody, signature, deployment and recovery evidence must be independently reviewed again in the final Stage 10 candidate. A policy-only GO is not Stage 10 GO.

A revoked or untrusted key blocks new activation. Runtime rollback may select a previously verified, schema-compatible artifact only under the applicable approved rollback contract; signatures never make an incompatible database rollback safe. If authenticity, key custody or schema compatibility cannot be established, preserve the active release and stop.
