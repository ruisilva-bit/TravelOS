// Trusted subprocess handles only; never accepts caller-selected PIDs.
export function stopRehearsalChild(child, { graceMs = 5000, killMs = 2000 } = {}) {
  if (!Number.isSafeInteger(graceMs) || graceMs < 1 || !Number.isSafeInteger(killMs) || killMs < 1)
    throw new Error("INVALID_CLEANUP_DEADLINE");
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined)
    return Promise.resolve(true);
  return new Promise((resolve) => {
    let grace,
      deadline,
      finished = false;
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(grace);
      clearTimeout(deadline);
      child.off("exit", exited);
      resolve(ok);
    };
    const exited = () => finish(true);
    child.once("exit", exited);
    grace = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        finish(false);
      }
    }, graceMs);
    deadline = setTimeout(() => finish(false), graceMs + killMs);
    try {
      child.kill("SIGTERM");
    } catch {
      finish(false);
    }
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
  });
}
