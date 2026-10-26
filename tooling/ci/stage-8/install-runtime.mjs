import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyArtifact } from "./verify-artifact.mjs";

const execute = async () => {
  const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  try {
    assert.deepEqual(
      process.argv.slice(2),
      process.argv.includes("--install") ? ["--install"] : ["--check"],
    );
    await verifyArtifact(root);
    const worker = await readFile(path.join(root, "deployment/worker-stage8.conf"), "utf8");
    const operator = await readFile(
      path.join(root, "deployment/travelos-stage8-runtime-acceptance.service"),
      "utf8",
    );
    const controlled = await readFile(
      path.join(root, "deployment/travelos-stage8-controlled-acceptance.service"),
      "utf8",
    );
    assert.ok(controlled.includes("Conflicts=travelos-worker.service\n"));
    assert.ok(controlled.includes(" --controlled-worker\n"));
    assert.ok(
      worker.includes(
        "LoadCredentialEncrypted=worker-db:/etc/credstore.encrypted/travelos-worker-db\n",
      ),
    );
    assert.ok(worker.includes("RuntimeDirectory=travelos-worker\n"));
    assert.ok(
      operator.includes(
        "ExecStartPre=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/deployment/verify-artifact.mjs --artifact-root=/opt/travelos/current\n",
      ),
    );
    assert.ok(operator.includes("Restart=no\n"));
    if (process.argv.includes("--install")) {
      assert.equal(process.getuid(), 0, "Installer requires approved operator privilege");
      assert.match(root, /^\/opt\/travelos\/releases\/travelos-stage8-gen[0-9]{2}-[a-f0-9]{8}$/u);
      assert.equal((await lstat(root)).uid, 0, "Release must be sealed");
      const existing = await readFile("/etc/systemd/system/travelos-worker.service", "utf8");
      assert.ok(existing.includes("User=travelos-worker\n"));
      assert.ok(existing.includes("ProtectSystem=strict\n"));
      assert.ok(existing.includes("WorkingDirectory=/opt/travelos/current/apps/worker\n"));
      assert.ok(
        existing.includes(
          "ExecStart=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/apps/worker/dist/main.js --manifest /etc/travelos/instances/development.json\n",
        ),
      );
      for (const [file, bytes] of [
        ["/etc/systemd/system/travelos-worker.service.d/stage8.conf", worker],
        ["/etc/systemd/system/travelos-stage8-runtime-acceptance.service", operator],
        ["/etc/systemd/system/travelos-stage8-controlled-acceptance.service", controlled],
      ]) {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
        try {
          assert.equal(await readFile(file, "utf8"), bytes, "Refusing divergent existing unit");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await writeFile(`${file}.new`, bytes, { flag: "wx", mode: 0o644 });
          await rename(`${file}.new`, file);
        }
        assert.equal(await readFile(file, "utf8"), bytes);
      }
      execFileSync("systemctl", ["daemon-reload"], { stdio: "pipe" });
    }
    console.log(
      JSON.stringify({
        result: "PASS",
        operation: process.argv.includes("--install") ? "INSTALL" : "CHECK",
        worker: "CREDENTIAL_AND_PRIVATE_RUNTIME_DIRECTORY",
        stage9Actions: 0,
      }),
    );
  } catch {
    console.error(JSON.stringify({ result: "FAIL", code: "RUNTIME_INSTALLATION_FAILED" }));
    process.exitCode = 1;
  }
};
const invokedPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
const modulePath = await realpath(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) await execute();
