/** Standalone watchdog: survives loss of the queue worker and owns only its child's process group. */
import { spawn } from "node:child_process";
const [rawBudget, command, ...args] = process.argv.slice(2);
const budgetMs = Number(rawBudget);
if (!command || !Number.isFinite(budgetMs) || budgetMs <= 0 || process.platform === "win32") {
  process.stderr.write("Invalid budgeted process configuration\n");
  process.exit(1);
}
let expired = false;
let grace;
const child = spawn(command, args, { detached: true, stdio: "inherit" });
function signalGroup(signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") process.exitCode = 1;
  }
}
function stop() {
  expired = true;
  signalGroup("SIGTERM");
  grace ??= setTimeout(() => signalGroup("SIGKILL"), 1000);
}
const deadline = setTimeout(stop, budgetMs);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("error", () => {
  clearTimeout(deadline);
  clearTimeout(grace);
  process.stderr.write("Budgeted engine could not start\n");
  process.exitCode = 1;
});
child.on("close", (code) => {
  clearTimeout(deadline);
  clearTimeout(grace);
  // Even a normally exiting shell must not leave a daemon behind.
  signalGroup("SIGKILL");
  process.exitCode = expired ? 124 : (code ?? 1);
});
