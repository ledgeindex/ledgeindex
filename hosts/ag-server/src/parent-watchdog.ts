/**
 * Electron runs this host as a child process and passes its own pid. If it dies
 * without stopping us — crash, Ctrl+C, a kill that misses this pid — we would
 * keep holding the port and the next launch could not bind it.
 *
 * Lives in the host entry point on purpose: `@ledgeindex/server` resolves to a
 * copy under node_modules, so a guard placed there would not run here.
 *
 * Inert when LEDGEINDEX_PARENT_PID is unset (hosted / standalone runs).
 */
export function watchParentProcess(): void {
  const parentPid = Number.parseInt(process.env.LEDGEINDEX_PARENT_PID ?? "", 10);
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;

  const timer = setInterval(() => {
    try {
      // Signal 0 only tests for existence, it does not touch the process.
      process.kill(parentPid, 0);
    } catch {
      console.info(`[host] parent process ${parentPid} is gone — shutting down`);
      process.exit(0);
    }
  }, 2_000);

  // Never keep the event loop alive on the watchdog's account.
  timer.unref();
}
