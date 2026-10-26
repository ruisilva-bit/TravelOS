import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const [workerDropIn, runtimeAcceptance, controlledAcceptance] = await Promise.all([
  readFile(path.join(repositoryRoot, "deploy/systemd/worker-stage8.conf"), "utf8"),
  readFile(
    path.join(repositoryRoot, "deploy/systemd/travelos-stage8-runtime-acceptance.service"),
    "utf8",
  ),
  readFile(
    path.join(repositoryRoot, "deploy/systemd/travelos-stage8-controlled-acceptance.service"),
    "utf8",
  ),
]);

test("worker drop-in adds only encrypted DB access and a private runtime directory", () => {
  assert.match(
    workerDropIn,
    /^LoadCredentialEncrypted=worker-db:\/etc\/credstore\.encrypted\/travelos-worker-db$/mu,
  );
  assert.match(workerDropIn, /^RuntimeDirectory=travelos-worker$/mu);
  assert.match(workerDropIn, /^RuntimeDirectoryMode=0700$/mu);
  assert.doesNotMatch(workerDropIn, /^User=/mu);
  assert.doesNotMatch(workerDropIn, /^ExecStart=/mu);
});

test("authenticated acceptance is a private, bounded one-shot using the extracted paths", () => {
  for (const required of [
    "Type=oneshot",
    "DynamicUser=yes",
    "WorkingDirectory=/opt/travelos/current",
    "UMask=0077",
    "NoNewPrivileges=yes",
    "PrivateTmp=yes",
    "ProtectSystem=strict",
    "ProtectHome=yes",
    "ProtectControlGroups=yes",
    "ProtectKernelTunables=yes",
    "ProtectKernelModules=yes",
    "IPAddressDeny=any",
    "IPAddressAllow=localhost",
    "Restart=no",
    "ExecStartPre=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/deployment/verify-artifact.mjs --artifact-root=/opt/travelos/current",
    "ExecStart=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/operator/stage8-runtime-acceptance.mjs --manifest=/etc/travelos/instances/development.json",
  ])
    assert.ok(
      runtimeAcceptance.includes(`${required}\n`),
      `Missing acceptance unit contract: ${required}`,
    );
  assert.doesNotMatch(runtimeAcceptance, /^Listen(?:Stream|Datagram)=/mu);
});

test("controlled acceptance excludes the ordinary Worker while retaining its sandbox", () => {
  assert.match(controlledAcceptance, /^Conflicts=travelos-worker\.service$/mu);
  assert.match(
    controlledAcceptance,
    /^Requires=travelos-admin-api\.service travelos-portal-api\.service$/mu,
  );
  assert.doesNotMatch(controlledAcceptance, /^Requires=.*travelos-worker\.service/mu);
  assert.match(
    controlledAcceptance,
    /^ExecStart=\/opt\/travelos\/current\/runtime\/node\/bin\/node \/opt\/travelos\/current\/operator\/stage8-runtime-acceptance\.mjs --manifest=\/etc\/travelos\/instances\/development\.json --controlled-worker$/mu,
  );
  for (const required of [
    "DynamicUser=yes",
    "RuntimeDirectory=travelos-stage8-controlled",
    "RuntimeDirectoryMode=0700",
    "UMask=0077",
    "NoNewPrivileges=yes",
    "ProtectSystem=strict",
    "ProtectHome=yes",
    "IPAddressDeny=any",
    "IPAddressAllow=localhost",
    "Restart=no",
  ])
    assert.ok(
      controlledAcceptance.includes(`${required}\n`),
      `Missing controlled unit contract: ${required}`,
    );
});
