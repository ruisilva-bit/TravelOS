# Actual DEVELOPMENT signing key checkpoint

The separately approved dedicated DEVELOPMENT signing key was provisioned once using the independently reviewed keystore mechanism, outside Git/artifacts under `/home/hermes/.config/travelos-stage10-credentials/signing-v1`. Do not recreate or rotate it as a retry. Its private key and password are encrypted with user systemd-creds and the Cosign password mechanism; no credential values were printed or added to source/evidence.

- Public verification-key SHA256: `e07b3b95c5c15a60e5cf2e854a046b50b2b0c708744d4a61dc3a3feb068fb777`.
- Pinned Cosign 3.1.3 SHA256: `4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71`.
- Actual encrypted-blob recovery into `signing-v1-recovery-check` succeeded on this same host. Signing a synthetic recovery-probe artifact with the definitive recovered key verified; modifying that probe was rejected. This is key recovery/signature-mechanism evidence, not a real release signature or host-loss recovery.
- Both real provisioning/recovery invocations ran in systemd user services with verified memory.swap.max=0 and core dumps disabled, reporting zero swap use. Cosign temporarily writes its password-encrypted key in the keystore's protected staging directory; no unencrypted private-key file is claimed or requested.
- Separate public-key readback matched the reported SHA256.

Independent deployment trust distribution and CT200 protected policy installation are PENDING. The production OIDC policy remains unchanged. No new release was signed, deployed or activated by this checkpoint. Host-loss recovery remains NOT_QUALIFIED. A passing same-host recovery probe is not Stage10 GO.
