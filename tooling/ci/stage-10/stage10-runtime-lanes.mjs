// Internal lane runner. The CLI supplies fixed scripts and a scrubbed environment;
// injectable scripts are used only by direct unit tests, never by the CLI.
import { spawn } from "node:child_process";

const run = (node, script, env, timeout) =>
  new Promise((resolve) => {
    const child = spawn(node, [script], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "",
      timedOut = false,
      overflow = false,
      error = null;
    const kill = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already exited */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeout);
    for (const [stream, which] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ]) {
      stream.on("data", (chunk) => {
        if (which === "stdout") stdout += chunk.toString();
        else stderr += chunk.toString();
        if (stdout.length + stderr.length > 1024 * 1024) {
          overflow = true;
          kill();
        }
      });
    }
    child.on("error", (e) => {
      error = e.code ?? "SPAWN_ERROR";
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      let report = null;
      try {
        report = JSON.parse(stdout.trim().split("\n").at(-1));
      } catch {
        /* malformed lane output */
      }
      resolve({ status, signal, timedOut, overflow, error, report, stderr: stderr.slice(0, 4096) });
    });
  });

export async function runRuntimeLanes({ node, scripts, env, timeout = 900000 }) {
  const api = await run(node, scripts[0], env, timeout);
  const lanes = { api };
  if (
    api.status !== 0 ||
    api.timedOut ||
    api.overflow ||
    api.report?.result !== "PASS" ||
    api.report?.cleanup !== "PASS"
  )
    return { result: "FAIL", lanes };
  const cumulative = await run(node, scripts[1], env, timeout);
  lanes.cumulative = cumulative;
  if (
    cumulative.status !== 0 ||
    cumulative.timedOut ||
    cumulative.overflow ||
    !Array.isArray(cumulative.report?.remaining) ||
    cumulative.report?.postgresStopped !== true ||
    !["PASS", "SUBSET_PASS"].includes(cumulative.report?.result)
  )
    return { result: "FAIL", lanes };
  // This adapter is a local subset, not an aggregate qualification authority.
  return { result: "PARTIAL", lanes };
}
