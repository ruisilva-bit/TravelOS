// CT200 DEVELOPMENT native executable pin from read-only package metadata.
export function nativePostgresVersionAccepted(version, digest) {
  return (
    version === "postgres (PostgreSQL) 18.6 (Debian 18.6-1.pgdg13+2)" &&
    digest === "4944085dba4adcf0f65b8fb4e698c5ac353ecff890fdc89afe8007c2547b1469"
  );
}
