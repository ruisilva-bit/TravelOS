import assert from "node:assert/strict";
import test from "node:test";
import { nativePostgresVersionAccepted } from "./native-postgres-version.mjs";

test("accept only pinned Debian 18.6 postgres identity", () => {
  const pin = "4944085dba4adcf0f65b8fb4e698c5ac353ecff890fdc89afe8007c2547b1469";
  const version = "postgres (PostgreSQL) 18.6 (Debian 18.6-1.pgdg13+2)";
  assert.equal(nativePostgresVersionAccepted(version, pin), true);
  assert.equal(nativePostgresVersionAccepted(version, "0".repeat(64)), false);
  assert.equal(nativePostgresVersionAccepted("postgres (PostgreSQL) 18.6.1", pin), false);
});
