import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPORT_ENV = "TRAVELOS_STAGE7_REHEARSAL_REPORT";
const REQUIRED_CREDENTIALS = [
  "portal-api-db",
  "portal-auth-realm",
  "stage7-staff-email",
  "stage7-staff-password",
  "stage7-staff-totp",
];
const PACKAGED_VERIFIER_TIMEOUT_MS = 120_000;
const scriptPath = fileURLToPath(import.meta.url);

const argumentValue = (prefix) => {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length) ?? null;
};

const safeCode = (error) =>
  typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code)
    ? error.code
    : "STAGE7_PACKAGED_REHEARSAL_ERROR";

const safeRuntimeFailure = (stderr) => {
  try {
    const failure = JSON.parse(stderr);
    const completedProbes = Array.isArray(failure.completedProbes)
      ? failure.completedProbes
          .filter((probe) => typeof probe === "string" && /^[a-z0-9-]{1,96}$/u.test(probe))
          .slice(0, 32)
      : null;
    return {
      stage:
        typeof failure.stage === "string" && /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/u.test(failure.stage)
          ? failure.stage
          : "UNRECOGNIZED_STAGE",
      code:
        typeof failure.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(failure.code)
          ? failure.code
          : "UNRECOGNIZED_CODE",
      ...(completedProbes === null ? {} : { completedProbes }),
    };
  } catch {
    return { stage: "UNPARSEABLE_FAILURE_OUTPUT", code: "UNPARSEABLE_FAILURE_OUTPUT" };
  }
};

const safeWriteReport = async (reportPath, report) => {
  await writeFile(reportPath, `${JSON.stringify(report)}\n`, { mode: 0o600 });
};

const validateTemporaryInputs = async (artifactRoot) => {
  assert.ok(path.isAbsolute(artifactRoot), "Artifact root must be absolute");
  const resolvedRoot = await realpath(artifactRoot);
  assert.ok(
    resolvedRoot.startsWith(`${os.tmpdir()}${path.sep}`),
    "Artifact root must be a clean extracted copy under TMPDIR",
  );
  const metadata = await stat(resolvedRoot);
  assert.ok(metadata.isDirectory());
  const reportPath = process.env[REPORT_ENV];
  const manifestPath = process.env["TRAVELOS_STAGE7_REHEARSAL_MANIFEST"];
  const adminCredentials = process.env["TRAVELOS_STAGE7_REHEARSAL_ADMIN_CREDENTIALS"];
  const portalCredentials = process.env["TRAVELOS_STAGE7_REHEARSAL_PORTAL_CREDENTIALS"];
  const operatorCredentials = process.env["TRAVELOS_STAGE7_REHEARSAL_OPERATOR_CREDENTIALS"];
  const missingCredentials = process.env["TRAVELOS_STAGE7_REHEARSAL_MISSING_CREDENTIALS"];
  const invalidCredentials = process.env["TRAVELOS_STAGE7_REHEARSAL_INVALID_CREDENTIALS"];
  const etcUpper = process.env["TRAVELOS_STAGE7_REHEARSAL_ETC_UPPER"];
  const etcWork = process.env["TRAVELOS_STAGE7_REHEARSAL_ETC_WORK"];
  const paths = [
    reportPath,
    manifestPath,
    adminCredentials,
    portalCredentials,
    operatorCredentials,
    missingCredentials,
    invalidCredentials,
    etcUpper,
    etcWork,
  ];
  for (const value of paths) {
    assert.ok(typeof value === "string" && path.isAbsolute(value));
    assert.ok(path.resolve(value).startsWith(`${os.tmpdir()}${path.sep}`));
  }
  return {
    artifactRoot: resolvedRoot,
    reportPath,
    manifestPath,
    adminCredentials,
    portalCredentials,
    operatorCredentials,
    missingCredentials,
    invalidCredentials,
    etcUpper,
    etcWork,
  };
};

const runSync = (command, args, { cwd, env, timeout = 30_000 } = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
};

export const stage7RehearsalGeneration = (release) => {
  const generation = release.source?.successorBaselineGeneration;
  assert.match(generation ?? "", /^gen[0-9]{2,}$/u);
  assert.match(
    release.artifactId ?? "",
    new RegExp(`^travelos-phase-1-m1-stage-7-${generation}-[a-f0-9]{8}$`, "u"),
  );
  return generation;
};

const runVerifier = (nodePath, script, args, cwd, generation) => {
  const result = runSync(nodePath, [script, ...args], {
    cwd,
    timeout: PACKAGED_VERIFIER_TIMEOUT_MS,
  });
  assert.equal(result.status, 0, "Packaged artifact verifier command failed");
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.result, "PASS");
  assert.equal(parsed.generation, generation);
  return { result: parsed.result, generation: parsed.generation, artifactId: parsed.artifactId };
};

const waitForHealth = async (child, listener, expectedHost, spawnErrors) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null || spawnErrors.has(child)) {
      throw new Error("Packaged API process failed before health became ready");
    }
    const healthy = await new Promise((resolve) => {
      const request = http.request(
        {
          hostname: listener.host,
          port: listener.port,
          method: listener.healthMethod,
          path: listener.healthPath,
          headers: { host: expectedHost, accept: "application/json" },
          timeout: 1_500,
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode === 200));
        },
      );
      request.on("timeout", () => request.destroy());
      request.on("error", () => resolve(false));
      request.end();
    });
    if (healthy) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Packaged API health endpoint did not become ready");
};

const stopChild = async (child) => {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
    return child.exitCode;
  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", () => resolve(null));
  });
  child.kill("SIGTERM");
  const firstExit = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(null), 8_000)),
  ]);
  if (firstExit !== null) return firstExit;
  child.kill("SIGKILL");
  return exited;
};

const portClosed = async (listener) =>
  new Promise((resolve) => {
    const request = http.request(
      {
        hostname: listener.host,
        port: listener.port,
        method: "GET",
        path: "/health/live",
        timeout: 1_000,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(false));
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(true));
    request.end();
  });

const namespaceWorker = async (inputs) => {
  const reportPath = inputs.reportPath;
  const report = {
    schemaVersion: 1,
    result: "FAIL",
    stage: "namespace setup",
    code: "STAGE7_PACKAGED_REHEARSAL_ERROR",
    artifactId: null,
    preActivationVerifier: null,
    postActivationVerifier: null,
    missingCredentials: null,
    invalidCredentials: null,
    runner: null,
    services: { adminStarted: false, portalStarted: false, stopped: false, listenersClosed: false },
    cleanup: { temporaryMountNamespace: true, artifactsReadOnly: false },
  };
  const serviceChildren = [];
  const servicePorts = [];
  const spawnErrors = new WeakSet();
  try {
    const release = JSON.parse(
      await readFile(path.join(inputs.artifactRoot, "release.json"), "utf8"),
    );
    const generation = stage7RehearsalGeneration(release);
    const artifactId = release.artifactId;
    const suffix = artifactId.slice(-8);
    const releaseName = `travelos-stage7-${generation}-${suffix}`;
    const physicalRelease = `/opt/travelos/releases/${releaseName}`;
    const manifestInNamespace = "/etc/travelos/instances/development.json";
    const config = JSON.parse(await readFile(inputs.manifestPath, "utf8"));
    const deployment = JSON.parse(
      await readFile(
        path.join(inputs.artifactRoot, "deployment/deployment-contract.v1.json"),
        "utf8",
      ),
    );
    const unitText = await readFile(
      path.join(inputs.artifactRoot, "operator/travelos-stage7-runtime-acceptance.service"),
      "utf8",
    );
    assert.match(unitText, /^Type=oneshot$/mu);
    assert.match(unitText, /^DynamicUser=yes$/mu);
    assert.match(unitText, /^Restart=no$/mu);
    assert.match(unitText, /^WorkingDirectory=\/opt\/travelos\/current$/mu);
    assert.doesNotMatch(unitText, /^\s*(?:ListenStream|ListenDatagram|ListenSequentialPacket)=/mu);
    const credentialNames = [
      ...unitText.matchAll(
        /^LoadCredentialEncrypted=([^:=]+):\/etc\/credstore\.encrypted\/[^\s]+$/gmu,
      ),
    ]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(credentialNames, [...REQUIRED_CREDENTIALS].sort());
    const unitCommand = (key) => {
      const row = unitText.match(new RegExp(`^${key}=(.+)$`, "mu"));
      assert.ok(row?.[1]);
      return row[1].trim().split(/\s+/u);
    };
    const execStartPre = unitCommand("ExecStartPre");
    const execStart = unitCommand("ExecStart");
    assert.deepEqual(execStartPre, [
      "/opt/travelos/current/runtime/node/bin/node",
      "/opt/travelos/current/deployment/verify-stage7-artifact.mjs",
      "--artifact-root=/opt/travelos/current",
      "--release-root=/opt/travelos/releases",
      `--generation=${generation}`,
    ]);
    assert.deepEqual(execStart, [
      "/opt/travelos/current/runtime/node/bin/node",
      "/opt/travelos/current/operator/stage7-runtime-acceptance.mjs",
      "--manifest=/etc/travelos/instances/development.json",
    ]);
    const adminService = deployment.services.find(
      (service) => service.unit === "travelos-admin-api.service",
    );
    const portalService = deployment.services.find(
      (service) => service.unit === "travelos-portal-api.service",
    );
    assert.ok(adminService && portalService);
    assert.equal(config.runtime.listeners.adminApi.host, "127.0.0.1");
    assert.equal(config.runtime.listeners.portalApi.host, "127.0.0.1");
    assert.equal(adminService.listener.host, "127.0.0.1");
    assert.equal(portalService.listener.host, "127.0.0.1");
    assert.equal(config.database.name, "travelos_stage7_empty_qualification");

    report.artifactId = artifactId;
    report.cleanup.artifactsReadOnly = true;
    report.stage = "release layout";
    let mount = runSync("mount", ["--make-rprivate", "/"]);
    assert.equal(mount.status, 0);
    mount = runSync("mount", ["-t", "tmpfs", "tmpfs", "/opt"]);
    assert.equal(mount.status, 0);
    await mkdir("/opt/travelos/releases", { recursive: true });
    await mkdir(physicalRelease, { recursive: true });
    mount = runSync("mount", ["--bind", inputs.artifactRoot, physicalRelease]);
    assert.equal(mount.status, 0);
    mount = runSync("mount", ["-o", "remount,bind,ro", physicalRelease]);
    assert.equal(mount.status, 0);
    await mkdir("/opt/travelos/releases/travelos-stage7-gen05-rehearsal", { recursive: true });
    await rm("/opt/travelos/current", { force: true });
    await symlink(
      "/opt/travelos/releases/travelos-stage7-gen05-rehearsal",
      "/opt/travelos/current",
    );

    report.stage = "pre-activation physical release verifier";
    const physicalNode = path.join(physicalRelease, "runtime/node/bin/node");
    report.preActivationVerifier = runVerifier(
      physicalNode,
      path.join(physicalRelease, "deployment/verify-stage7-artifact.mjs"),
      [
        `--artifact-root=${physicalRelease}`,
        "--release-root=/opt/travelos/releases",
        `--generation=${generation}`,
      ],
      physicalRelease,
      generation,
    );
    assert.equal(
      await realpath("/opt/travelos/current"),
      "/opt/travelos/releases/travelos-stage7-gen05-rehearsal",
    );

    report.stage = "activation and systemd manifest layout";
    await rm("/opt/travelos/current", { force: true });
    await symlink(physicalRelease, "/opt/travelos/current");
    mount = runSync("mount", [
      "-t",
      "overlay",
      "overlay",
      "-o",
      `lowerdir=/etc,upperdir=${inputs.etcUpper},workdir=${inputs.etcWork}`,
      "/etc",
    ]);
    assert.equal(mount.status, 0);
    await mkdir("/etc/travelos/instances", { recursive: true });
    await copyFile(inputs.manifestPath, manifestInNamespace);
    assert.equal(await realpath("/opt/travelos/current"), physicalRelease);

    report.stage = "post-activation ExecStartPre";
    const preflight = runSync(execStartPre[0], execStartPre.slice(1), {
      cwd: "/opt/travelos/current",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent" },
      timeout: PACKAGED_VERIFIER_TIMEOUT_MS,
    });
    assert.equal(preflight.status, 0);
    const postPreflight = JSON.parse(preflight.stdout);
    assert.equal(postPreflight.result, "PASS");
    assert.equal(postPreflight.artifactId, artifactId);
    report.postActivationVerifier = {
      result: postPreflight.result,
      generation: postPreflight.generation,
      artifactId: postPreflight.artifactId,
    };

    report.stage = "packaged API commands";
    for (const service of [adminService, portalService]) {
      const credentialDirectory =
        service.unit === "travelos-admin-api.service"
          ? inputs.adminCredentials
          : inputs.portalCredentials;
      const listenerConfig =
        config.runtime.listeners[service.unit.includes("admin") ? "adminApi" : "portalApi"];
      const child = spawn(service.execStart[0], service.execStart.slice(1), {
        cwd: service.workingDirectory,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: "/nonexistent",
          CREDENTIALS_DIRECTORY: credentialDirectory,
        },
        stdio: "ignore",
      });
      child.once("error", () => spawnErrors.add(child));
      serviceChildren.push(child);
      servicePorts.push({ host: service.listener.host, port: listenerConfig.port });
      await waitForHealth(
        child,
        {
          host: service.listener.host,
          port: listenerConfig.port,
          healthMethod: service.listener.healthMethod,
          healthPath: service.listener.healthPath,
        },
        config.hosts[service.unit.includes("admin") ? "admin" : "portal"],
        spawnErrors,
      );
      if (service.unit === "travelos-admin-api.service") report.services.adminStarted = true;
      else report.services.portalStarted = true;
    }

    const operatorEnvironment = (credentialDirectory) => ({
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: "/nonexistent",
      CREDENTIALS_DIRECTORY: credentialDirectory,
    });
    const runOneShot = (credentialDirectory) => {
      const pre = runSync(execStartPre[0], execStartPre.slice(1), {
        cwd: "/opt/travelos/current",
        env: operatorEnvironment(credentialDirectory),
        timeout: PACKAGED_VERIFIER_TIMEOUT_MS,
      });
      if (pre.status !== 0)
        return { preflightStatus: pre.status, status: pre.status, stdout: "", stderr: "" };
      const result = runSync(execStart[0], execStart.slice(1), {
        cwd: "/opt/travelos/current",
        env: operatorEnvironment(credentialDirectory),
        timeout: 180_000,
      });
      return { preflightStatus: pre.status, ...result };
    };
    report.stage = "missing credential fail-closed";
    const missing = runOneShot(inputs.missingCredentials);
    assert.equal(missing.preflightStatus, 0);
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    const missingResult = JSON.parse(missing.stderr);
    assert.deepEqual(missingResult, {
      result: "FAIL",
      stage: "credential delivery",
      code: "STAGE7_RUNTIME_ACCEPTANCE_ERROR",
    });
    report.missingCredentials = {
      status: missing.status,
      stage: missingResult.stage,
      code: missingResult.code,
    };

    report.stage = "invalid credential fail-closed";
    const invalid = runOneShot(inputs.invalidCredentials);
    assert.equal(invalid.preflightStatus, 0);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, "");
    const invalidResult = JSON.parse(invalid.stderr);
    assert.deepEqual(invalidResult, {
      result: "FAIL",
      stage: "credential delivery",
      code: "STAGE7_RUNTIME_ACCEPTANCE_ERROR",
    });
    report.invalidCredentials = {
      status: invalid.status,
      stage: invalidResult.stage,
      code: invalidResult.code,
    };

    report.stage = "authenticated one-shot acceptance";
    const accepted = runOneShot(inputs.operatorCredentials);
    report.acceptedOneShot = {
      preflightStatus: accepted.preflightStatus,
      status: accepted.status,
      failure:
        accepted.preflightStatus !== 0
          ? { stage: "artifact preflight", code: "PREFLIGHT_FAILED" }
          : accepted.status === 0
            ? null
            : safeRuntimeFailure(accepted.stderr),
    };
    assert.equal(accepted.preflightStatus, 0);
    assert.equal(accepted.status, 0);
    assert.equal(accepted.stderr, "");
    const runtimeResult = JSON.parse(accepted.stdout);
    assert.equal(runtimeResult.result, "PASS");
    assert.equal(runtimeResult.stage8Actions, 0);
    assert.ok(Array.isArray(runtimeResult.probes) && runtimeResult.probes.length >= 15);
    report.runner = runtimeResult;
    report.probes = runtimeResult.probes;

    report.stage = "service cleanup";
    const stopCodes = await Promise.all(serviceChildren.map(stopChild));
    assert.ok(stopCodes.every((code) => code === 0 || code === null));
    report.services.stopped = true;
    const closed = await Promise.all(servicePorts.map(portClosed));
    assert.ok(closed.every(Boolean));
    report.services.listenersClosed = true;
    report.result = "PASS";
    report.stage = null;
    report.code = null;
  } catch (error) {
    report.code = safeCode(error);
  } finally {
    const stopCodes = await Promise.all(serviceChildren.map(stopChild));
    if (serviceChildren.length > 0 && stopCodes.every((code) => code === 0 || code === null)) {
      report.services.stopped = true;
      const closed = await Promise.all(servicePorts.map(portClosed));
      report.services.listenersClosed = closed.every(Boolean);
    }
    await safeWriteReport(reportPath, report);
  }
  if (report.result !== "PASS") process.exitCode = 1;
};

const main = async () => {
  const artifactRoot = argumentValue("--artifact-root=");
  assert.ok(
    artifactRoot,
    "Usage: node rehearse-packaged-operator.mjs --artifact-root=/absolute/extracted/release",
  );
  const inputs = await validateTemporaryInputs(artifactRoot);
  const worker = process.argv.includes("--namespace-worker");
  if (worker) return namespaceWorker(inputs);

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"].includes(name) ||
        name.startsWith("TRAVELOS_STAGE7_REHEARSAL_"),
    ),
  );
  const result = spawnSync(
    "unshare",
    [
      "--user",
      "--map-root-user",
      "--mount",
      "--pid",
      "--fork",
      "--mount-proc",
      process.execPath,
      scriptPath,
      "--namespace-worker",
      `--artifact-root=${inputs.artifactRoot}`,
    ],
    {
      cwd: path.dirname(scriptPath),
      env,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  let report;
  try {
    report = JSON.parse(await readFile(inputs.reportPath, "utf8"));
  } catch {
    report = {
      schemaVersion: 1,
      result: "FAIL",
      stage: "user namespace execution",
      code: result.error ? safeCode(result.error) : `UNSHARE_EXIT_${result.status ?? 1}`,
      stage8Actions: 0,
    };
    await safeWriteReport(inputs.reportPath, report);
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (result.status !== 0 || report.result !== "PASS") process.exitCode = 1;
};

if (process.argv[1] && (await realpath(process.argv[1])) === (await realpath(scriptPath)))
  main().catch((error) => {
    const failure = {
      schemaVersion: 1,
      result: "FAIL",
      stage: "rehearsal setup",
      code: safeCode(error),
      stage8Actions: 0,
    };
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  });
