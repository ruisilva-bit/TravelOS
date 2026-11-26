// Fault-inject only dependencies of the real CLI. No PostgreSQL/package/build runs.
// Synthetic receipts below are disposable orchestration fixtures, not qualification.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const runner = new URL("../../database/run-stage-10-postgres-disposable.mjs", import.meta.url).href;
for (const fault of [
  "none",
  "remove",
  "remove-silent",
  "stop",
  "stop-throw",
  "test-fail-stop-throw",
  "foreign-port",
]) {
  test(`PostgreSQL CLI exit agrees with retained cleanup result: ${fault}`, async (t) => {
    const work = await mkdtemp(path.join(process.env.TMPDIR, "pg-cleanup-exit-"));
    const evidence = await mkdtemp(path.join(root, ".hermes/state/pg-cleanup-exit-"));
    t.after(async () => {
      // Faults such as `remove` deliberately retain the runner's short /tmp socket root.
      const socket = await readFile(path.join(work, "socket-path"), "utf8").catch(() => "");
      if (/^\/tmp\/travelos-s10-sock-[A-Za-z0-9]{6}$/u.test(socket))
        await rm(socket, { recursive: true, force: true });
      await rm(work, { recursive: true, force: true });
      await rm(evidence, { recursive: true, force: true });
    });
    const bootstrap = path.join(work, "bootstrap.mjs");
    await mkdir(path.join(work, "scratch"));
    const sources = {
      "node:child_process": `let ownedData;export const spawnSync=(command,args)=>{if(args.includes('--pgdata'))ownedData=args[args.indexOf('--pgdata')+1];return {status:${fault === "test-fail-stop-throw" ? "args.includes('run')?2:0" : "0"},stdout:args.includes('--tuples-only')?'180006|on|127.0.0.1|23456|'+(${JSON.stringify(fault)}==='foreign-port'?'/foreign-cluster':ownedData)+'|'+globalThis.__travelosSocket+'\\n':'',stderr:''}};`,
      "node:net": `export default {createServer:()=>({once(){},listen(o,cb){cb()},address:()=>({port:23456}),close(cb){cb()}}),createConnection:()=>{const s={destroy(){},once(event,cb){if(event==='error')queueMicrotask(()=>cb());return s},setTimeout(){}};return s}};`,
      "node:fs/promises": `import * as real from 'node:fs/promises';
        export const {lstat,mkdir,mkdtemp,writeFile}=real;
        export const appendFile=async(file,text)=>{const m=/unix_socket_directories = '([^']*)'/.exec(String(text));if(m){globalThis.__travelosSocket=m[1];await real.writeFile(${JSON.stringify(path.join(work, "socket-path"))},m[1])}};
        export const rm=async(...args)=>{if(${JSON.stringify(fault)}==='remove')throw Error('SYNTHETIC_REMOVAL_FAILURE');if(${JSON.stringify(fault)}==='remove-silent')return;return real.rm(...args)};
        export const readFile=async(file,...args)=>{
          if(String(file).endsWith('postmaster.pid'))throw Object.assign(Error('absent'),{code:'ENOENT'});
          if(String(file).endsWith('release.json'))return JSON.stringify({stage:'PHASE_1_M1_STAGE_10',artifactId:'synthetic',candidate:'gen37'});
          if(file==='/synthetic/receipt'||file==='/synthetic/inputs'||String(file).endsWith('vitest-results.json'))return Buffer.from('{}');
          return real.readFile(file,...args);
        };`,
      "../ci/stage-10/qualify-artifact.mjs": "export const qualifyExtractedArtifact=async()=>{};",
      "../ci/stage-10/stage10-runtime-api-postgres.mjs": `export const stopPostgres=()=>{if(${JSON.stringify(fault)}.endsWith('stop-throw'))throw Error('SYNTHETIC_STOP_EXCEPTION');return ${fault !== "stop"}};`,
      "../ci/stage-10/postgres-successor-coverage.mjs":
        "export const postgresCoverage=async()=>({synthetic:true});export const summarizePostgresResults=()=>[];",
    };
    await writeFile(
      bootstrap,
      `import {registerHooks} from 'node:module';
      const sources=${JSON.stringify(sources)};
      registerHooks({resolve(specifier,context,next){
        if(context.parentURL===${JSON.stringify(runner)}&&Object.hasOwn(sources,specifier))
          return {url:'data:text/javascript,'+encodeURIComponent(sources[specifier]),shortCircuit:true};
        return next(specifier,context);
      }});
      await import(${JSON.stringify(runner)});
    `,
    );
    // {} digest is only a synthetic fixture input, never an authority pin.
    const { createHash } = await import("node:crypto");
    const pin = createHash("sha256").update("{}").digest("hex");
    const run = spawnSync(process.execPath, [bootstrap], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: {
        PATH: "/usr/bin:/bin",
        TMPDIR: path.join(work, "scratch"),
        TRAVELOS_STAGE10_EVIDENCE_DIR: evidence,
        TRAVELOS_STAGE10_EXTRACTED_ROOT: "/synthetic/payload",
        TRAVELOS_STAGE10_ARCHIVE: "/synthetic/archive",
        TRAVELOS_STAGE10_RECEIPT: "/synthetic/receipt",
        TRAVELOS_STAGE10_INPUTS: "/synthetic/inputs",
        TRAVELOS_STAGE10_RECEIPT_SHA256: pin,
        TRAVELOS_STAGE10_INPUTS_SHA256: pin,
        TRAVELOS_STAGE10_NODE_SHA256: pin,
      },
    });
    assert.equal(run.error, undefined);
    const receipt = JSON.parse(await readFile(path.join(evidence, "execution.json")));
    assert.equal(
      receipt.testExitCode,
      fault === "foreign-port" ? null : fault === "test-fail-stop-throw" ? 2 : 0,
      `Fixture must reach expected test result: ${receipt.failure}`,
    );
    if (fault === "test-fail-stop-throw")
      assert.match(receipt.failure, /PostgreSQL integration qualification failed/u);
    assert.equal(receipt.cleanup.clusterStartAttempted, true);
    assert.equal(receipt.cleanup.clusterStopped, !fault.endsWith("stop-throw") && fault !== "stop");
    assert.equal(receipt.cleanup.disposableRootsAbsent, ["none", "foreign-port"].includes(fault));
    assert.equal(receipt.result, fault === "none" ? "PASS" : "FAIL");
    assert.equal(run.status, fault === "none" ? 0 : 1, "FAIL receipt must never exit zero");
  });
}
