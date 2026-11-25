import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  postgresCoverage,
  validatePostgresCoverage,
  POSTGRES_SUITES,
  INHERITED_POSTGRES_GATES,
} from "./postgres-successor-coverage.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
test("full successor mapping pins all unchanged inherited assertion sources and current harness bytes", async () => {
  const coverage = await postgresCoverage(root);
  assert.equal(coverage.sources.length, 13);
  assert.equal(coverage.sources.filter((row) => row.acceptedPredecessorBytes).length, 7);
  assert.deepEqual(coverage.suiteFiles, POSTGRES_SUITES);
  assert.deepEqual(coverage.gates, [...INHERITED_POSTGRES_GATES, "stage10-postgres-browser"]);
  const log = Buffer.from(POSTGRES_SUITES.join("\n"));
  const results = coverage.assertions.map((row) => ({ ...row, status: "passed" }));
  assert.equal(validatePostgresCoverage(coverage, coverage, log, results), coverage);
  for (const changed of [
    { ...coverage, suiteFiles: coverage.suiteFiles.slice(1) },
    { ...coverage, gates: coverage.gates.slice(1) },
    { ...coverage, browserAcceptance: false },
    { ...coverage, sources: coverage.sources.slice(1) },
    { ...coverage, expectedTests: 94 },
  ])
    assert.throws(() => validatePostgresCoverage(changed, coverage, log));
  assert.throws(
    () =>
      validatePostgresCoverage(
        coverage,
        coverage,
        Buffer.from(POSTGRES_SUITES.slice(1).join("\n")),
      ),
    /Missing inherited/u,
  );
});

test("exported accepted blobs qualify without git and reject changed or absent bytes", async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "s10-pg-blobs-"));
  try {
    const ordinary = await postgresCoverage(root);
    for (const row of ordinary.sources.filter((item) => item.acceptedPredecessorBytes)) {
      const destination = path.join(scratch, row.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(path.join(root, row.path)));
    }
    assert.deepEqual(await postgresCoverage(root, { acceptedBlobs: scratch }), ordinary);
    const prior = process.env.TRAVELOS_STAGE10_ACCEPTED_BLOBS;
    try {
      process.env.TRAVELOS_STAGE10_ACCEPTED_BLOBS = scratch;
      assert.deepEqual(await postgresCoverage(root), ordinary,
        "remote harness must resolve accepted bytes without git history");
      process.env.TRAVELOS_STAGE10_ACCEPTED_BLOBS = "relative/untrusted";
      await assert.rejects(postgresCoverage(root), /accepted blob path/u);
    } finally {
      if (prior === undefined) delete process.env.TRAVELOS_STAGE10_ACCEPTED_BLOBS;
      else process.env.TRAVELOS_STAGE10_ACCEPTED_BLOBS = prior;
    }
    const first = ordinary.sources.find((item) => item.acceptedPredecessorBytes).path;
    await writeFile(path.join(scratch, first), "changed");
    await assert.rejects(postgresCoverage(root, { acceptedBlobs: scratch }), /Historical PostgreSQL/u);
    await rm(path.join(scratch, first));
    await assert.rejects(postgresCoverage(root, { acceptedBlobs: scratch }));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
