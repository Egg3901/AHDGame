import { spawn } from "node:child_process";
import { constants } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { clearCompilerCache } from "./clear-railway-build-cache.mjs";

// The persistence offset panic behind #2315. Require the Rust persistence
// source location beside the bounds failure, not just a Turbopack banner or
// an application RangeError. Unrecognized panics remain ordinary failures.
function corruptPersistence(output) {
  return /panicked at [^\n]*\bturbo-persistence[\\/]src[\\/][\w/\\.-]+\.rs:\d+(?::\d+)?:\r?\n(?:range (?:end|start) index \d+ out of range for slice of length \d+|index out of bounds: the len is \d+ but the index is \d+|offset \d+ (?:is )?out of range)/i.test(
    output
  );
}

export async function runBuild({
  cwd = process.cwd(),
  env = process.env,
  command = process.execPath,
  args = [resolve(cwd, "node_modules/next/dist/bin/next"), "build"],
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const attempt = () =>
    new Promise((done, reject) => {
      const child = spawn(command, args, { cwd, env, stdio: ["inherit", "pipe", "pipe"] });
      let tail = "",
        interrupted = false,
        cancelledSignal = null;
      const forward = (signal) => {
        interrupted = true;
        cancelledSignal = signal;
        child.kill(signal);
      };
      const int = () => forward("SIGINT"),
        term = () => forward("SIGTERM");
      process.on("SIGINT", int);
      process.on("SIGTERM", term);
      const cleanup = () => {
        process.off("SIGINT", int);
        process.off("SIGTERM", term);
      };
      for (const [stream, target] of [
        [child.stdout, stdout],
        [child.stderr, stderr],
      ]) {
        stream.setEncoding("utf8");
        stream.on("data", (chunk) => {
          target.write(chunk);
          tail = (tail + chunk).slice(-65536);
        });
      }
      child.once("error", (error) => {
        cleanup();
        reject(error);
      });
      child.once("close", (code, signal) => {
        cleanup();
        done({
          code: interrupted ? null : code,
          signal: signal || cancelledSignal,
          interrupted,
          tail,
        });
      });
    });
  const first = await attempt();
  if (
    first.code === 0 ||
    first.signal ||
    first.interrupted ||
    !env.RAILWAY_ENVIRONMENT_NAME ||
    !corruptPersistence(first.tail)
  )
    return first;
  stderr.write(
    "\nVerified Turbopack persistence bounds failure. Clearing compiler cache and retrying once.\n"
  );
  clearCompilerCache(cwd);
  return attempt();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runBuild({
    args: [
      resolve(process.cwd(), "node_modules/next/dist/bin/next"),
      "build",
      ...process.argv.slice(2),
    ],
  });
  process.exitCode = result.code ?? 128 + (constants.signals[result.signal] || 1);
}
