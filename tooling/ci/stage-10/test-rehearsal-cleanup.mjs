import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { stopRehearsalChild } from "./rehearsal-cleanup.mjs";

async function child(code) {
  const process = spawn(globalThis.process.execPath, ["-e", code], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  await new Promise((resolve, reject) => {
    process.once("error", reject);
    process.stdout.once("data", resolve);
  });
  return process;
}

test("stops a real child gracefully and handles repeat cleanup", async () => {
  const process = await child("console.log('ready');setInterval(()=>{},1000)");
  try {
    assert.equal(await stopRehearsalChild(process, { graceMs: 100, killMs: 1000 }), true);
    assert.equal(process.signalCode, "SIGTERM");
    assert.equal(await stopRehearsalChild(process), true);
  } finally {
    if (process.exitCode === null && process.signalCode === null) process.kill("SIGKILL");
  }
});

test("escalates a child that ignores SIGTERM", async () => {
  const process = await child(
    "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)",
  );
  try {
    assert.equal(await stopRehearsalChild(process, { graceMs: 100, killMs: 1000 }), true);
    assert.equal(process.signalCode, "SIGKILL");
  } finally {
    if (process.exitCode === null && process.signalCode === null) process.kill("SIGKILL");
  }
});

test("invalid policy rejects before signaling", () => {
  assert.throws(() => stopRehearsalChild({}, { graceMs: 0, killMs: 1 }), /INVALID_CLEANUP/);
});
