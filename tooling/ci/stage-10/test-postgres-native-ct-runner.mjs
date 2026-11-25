import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../../database/run-stage-10-postgres-disposable.mjs", import.meta.url));
test("native CT runner uses fixed PG18 binaries without apt preparation or wildcard bind", async () => {
  const code = await readFile(runner, "utf8");
  assert.match(code, /TRAVELOS_STAGE10_NATIVE_PG_BIN/u);
  assert.match(code, /\/usr\/lib\/postgresql\/18\/bin/u);
  assert.match(code, /listen_addresses = '127\.0\.0\.1'/u);
  assert.match(code, /postgresCoverage\(repositoryRoot\)/u);
  assert.match(code, /TRAVELOS_STAGE10_PREDECESSOR_ARCHIVE/u);
  assert.match(code, /listenerClosed\(port\)/u);
});
