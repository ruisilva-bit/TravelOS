import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";

const modulePath = new URL("./stage10-runtime-api-postgres.mjs", import.meta.url);

test("PostgreSQL stop escalates and verifies status, failing closed", async () => {
  const mod = await import(modulePath);
  assert.equal(
    typeof mod.stopPostgres,
    "function",
    "bounded cleanup must be independently testable",
  );
  const dir = mkdtempSync(path.join(os.tmpdir(), "stage10-pg-cleanup-unit-"));
  try {
    const ctl = path.join(dir, "pg_ctl");
    const log = path.join(dir, "calls");
    writeFileSync(
      ctl,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$LOG"\ncase "$*" in\n *status*) exit "$STATUS";;\n *immediate*) exit "$IMMEDIATE";;\n *) exit "$FAST";;\nesac\n`,
      { mode: 0o700 },
    );
    const invoke = (fast, immediate, status) => {
      writeFileSync(log, "");
      const env = {
        ...process.env,
        LOG: log,
        FAST: String(fast),
        IMMEDIATE: String(immediate),
        STATUS: String(status),
      };
      const result = mod.stopPostgres({ pgCtl: ctl, data: dir, env });
      return { result, calls: readFileSync(log, "utf8").trim().split("\n") };
    };
    let x = invoke(0, 0, 3);
    assert.equal(x.result, true);
    assert.equal(x.calls.length, 2);
    assert.match(x.calls[0], /-m fast/);
    assert.match(x.calls[1], /status/);
    x = invoke(1, 0, 3);
    assert.equal(x.result, true);
    assert.equal(x.calls.length, 3);
    assert.match(x.calls[1], /-m immediate/);
    assert.match(x.calls[2], /status/);
    x = invoke(1, 1, 0);
    assert.equal(x.result, false);
    assert.equal(x.calls.length, 3);
    x = invoke(0, 0, 0);
    assert.equal(x.result, false, "successful stop without stopped status is not proof");
    x = invoke(1, 1, 4);
    assert.equal(x.result, false, "unknown status is not proof of stop");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "real PostgreSQL is stopped by immediate escalation after fast failure",
  { skip: !process.env.TRAVELOS_STAGE10_PG_ROOT, timeout: 60000 },
  async () => {
    const { stopPostgres } = await import(modulePath);
    const root = process.env.TRAVELOS_STAGE10_PG_ROOT;
    const bin = path.join(root, "usr/lib/postgresql/18/bin");
    const env = {
      ...process.env,
      LD_LIBRARY_PATH: [
        path.join(root, "usr/lib/x86_64-linux-gnu"),
        path.join(root, "usr/lib/postgresql/18/lib"),
      ].join(":"),
    };
    const dir = mkdtempSync(path.join(os.tmpdir(), "stage10-pg-real-cleanup-"));
    const data = path.join(dir, "data"),
      socket = path.join(dir, "socket");
    mkdirSync(socket);
    const pgCtl = path.join(bin, "pg_ctl");
    const run = (cmd, args) => spawnSync(cmd, args, { env, encoding: "utf8", timeout: 30000 });
    let safeToRemove = false;
    try {
      let r = run(path.join(bin, "initdb"), [
        "-D",
        data,
        "-L",
        path.join(root, "usr/share/postgresql/18"),
        "-U",
        "postgres",
        "--encoding=UTF8",
        "--locale=C.UTF-8",
        "--auth=trust",
        "--no-instructions",
      ]);
      assert.equal(r.status, 0, `initdb failed: ${r.stderr}`);
      r = run(pgCtl, [
        "-D",
        data,
        "-l",
        path.join(dir, "postgres.log"),
        "-w",
        "-t",
        "20",
        "start",
        "-o",
        `-c listen_addresses='' -k ${socket}`,
      ]);
      assert.equal(r.status, 0, `start failed: ${r.stderr}`);
      const wrapper = path.join(dir, "ctl");
      writeFileSync(
        wrapper,
        `#!/bin/sh\ncase "$*" in *'-m fast'*) exit 1;; esac\nexec "$REAL_PG_CTL" "$@"\n`,
        { mode: 0o700 },
      );
      assert.equal(
        stopPostgres({ pgCtl: wrapper, data, env: { ...env, REAL_PG_CTL: pgCtl } }),
        true,
      );
      assert.equal(run(pgCtl, ["-D", data, "status"]).status, 3);
      safeToRemove = true;
    } finally {
      if (!safeToRemove) {
        run(pgCtl, ["-D", data, "-w", "-t", "10", "stop", "-m", "immediate"]);
        safeToRemove = run(pgCtl, ["-D", data, "status"]).status === 3;
      }
      if (safeToRemove) rmSync(dir, { recursive: true, force: true });
    }
  },
);
