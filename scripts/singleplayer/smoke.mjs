#!/usr/bin/env node
/**
 * End-to-end smoke for the packaged singleplayer runtime, run as a player
 * would: the launcher from dist/singleplayer, a scratch home, a scratch
 * runtime directory. Proves, with timings:
 *
 *   1. a fresh install reaches readiness (database, server, code, account);
 *   2. first-run world setup completes and reports progress while it runs;
 *   3. a turn processes;
 *   4. shutdown is graceful (exit code 0 on the control channel);
 *   5. a restart restores the save at turn 2;
 *   6. MongoDB is fetched at most once and reused on restart;
 *   7. the launcher captures the game server's own output continuously.
 *
 * Every step has a deadline and fails with the launcher's captured output,
 * so a stall reads as a named phase and its evidence, never as a hang.
 *
 *   AHD_SMOKE_ROOT     where to create the scratch directories (default tmpdir)
 *   AHD_SMOKE_BUDGET_MS per-step deadline (default 10 minutes)
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const launcher = path.join(root, "dist", "singleplayer", "launch.mjs");
const budgetMs = Number(process.env.AHD_SMOKE_BUDGET_MS) || 10 * 60_000;
const work = await mkdtemp(
  path.join(
    process.env.AHD_SMOKE_ROOT ? path.resolve(process.env.AHD_SMOKE_ROOT) : tmpdir(),
    "ahd-singleplayer-smoke-"
  )
);
const home = path.join(work, "world");
const runtimeHome = path.join(work, "runtime");
const timings = [];
const allOutput = [];

function record(step, ms) {
  timings.push({ step, seconds: Number((ms / 1000).toFixed(1)) });
  console.log(`[ahd-smoke] ${step}: ${(ms / 1000).toFixed(1)}s`);
}

async function timed(step, fn) {
  const started = Date.now();
  const result = await fn();
  record(step, Date.now() - started);
  return result;
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function start(label) {
  const appPort = await freePort();
  let mongoPort = await freePort();
  while (mongoPort === appPort) mongoPort = await freePort();
  const child = spawn(
    process.execPath,
    [
      launcher,
      "--port",
      String(appPort),
      "--mongo-port",
      String(mongoPort),
      "--home",
      home,
      "--runtime-home",
      runtimeHome,
      "--no-browser",
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  const run = { child, base: `http://127.0.0.1:${appPort}`, output: "", label };
  let readySeen = false;
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(new Error(`${label}: startup timed out after ${budgetMs / 1000}s\n${run.output}`)),
      budgetMs
    );
    const consume = (chunk) => {
      const text = chunk.toString();
      run.output = (run.output + text).slice(-40_000);
      allOutput.push(text);
      if (!readySeen) process.stdout.write(text);
      if (run.output.includes(`ready at http://127.0.0.1:${appPort}`)) {
        readySeen = true;
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`${label}: game exited before readiness with code ${code}\n${run.output}`));
    });
  });
  try {
    await timed(`${label}: ready`, () => ready);
  } catch (error) {
    child.kill();
    throw error;
  }
  return run;
}

async function json(run, route, init) {
  const response = await fetch(`${run.base}${route}`, {
    ...init,
    signal: AbortSignal.timeout(budgetMs),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(`${route} returned ${response.status}: ${JSON.stringify(body)}\n${run.output}`);
  return body;
}

/** Ask for a graceful stop over the control channel; the exit code must be 0. */
async function stop(run) {
  if (run.child.exitCode !== null) return run.child.exitCode;
  run.child.stdin.write("shutdown\n");
  return await Promise.race([
    new Promise((resolve) => run.child.once("exit", resolve)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${run.label}: shutdown timed out\n${run.output}`)), 30_000)
    ),
  ]);
}

/** Watch the setup progress route while setup runs; it must move, not stall. */
function watchSetup(run) {
  const seen = [];
  let stalled = 0;
  const timer = setInterval(async () => {
    try {
      const progress = await (
        await fetch(`${run.base}/api/singleplayer/setup/progress`, {
          signal: AbortSignal.timeout(5_000),
        })
      ).json();
      const line = `${progress.phase} ${Math.round(progress.progress)}% ${progress.detail}`;
      if (seen.at(-1) !== line) {
        seen.push(line);
        console.log(`[ahd-smoke] setup: ${line}`);
      }
      if (progress.stalled) stalled += 1;
    } catch {
      // The route is best-effort while the server is busy.
    }
  }, 5_000);
  return {
    stop() {
      clearInterval(timer);
      return { seen, stalled };
    },
  };
}

function fail(message, run) {
  throw new Error(`${message}\n${run?.output ?? ""}`);
}

let running;
try {
  running = await start("first start");
  if (process.env.AHD_SMOKE_STARTUP_ONLY === "1") {
    // Diagnostic mode for the smoke workflow: reaching readiness is the whole
    // test (used to bisect launcher variants against the same build).
    console.log("[ahd-smoke] startup-only run reached readiness");
    await stop(running).catch(() => running.child.kill());
    running = null;
    process.exit(0);
  }
  if (!/startup took .*account/.test(running.output))
    fail("launcher did not report phase timings", running);
  if (!/Next\.js|Ready in/.test(running.output))
    fail("launcher did not forward the game server's own output", running);

  const watcher = watchSetup(running);
  const setup = await timed("first-run world setup", () =>
    json(running, "/api/singleplayer/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preset: "1953-default",
        mode: "worldsim",
        difficulty: "normal",
        autonomyLevel: "v4",
      }),
    })
  );
  const progress = watcher.stop();
  if (!setup.ok) fail("fresh world setup did not complete", running);
  if (progress.stalled > 0)
    fail(`setup progress reported itself stalled ${progress.stalled} time(s)`, running);

  const turn = await timed("turn 1 to 2", () =>
    json(running, "/api/singleplayer/worldsim/advance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turns: 1 }),
    })
  );
  if (turn.completed !== 1 || turn.finalTurn !== 2)
    fail(`turn smoke failed: ${JSON.stringify(turn)}`, running);

  // Prove the turn is on disk before anything stops, so a restart failure
  // can be told apart from a turn that never persisted.
  const afterTurn = await json(running, "/api/singleplayer/status");
  if (afterTurn.turn !== 2 || afterTurn.turnInProgress)
    fail(`turn did not persist before shutdown: ${JSON.stringify(afterTurn)}`, running);

  const exitCode = await timed("graceful shutdown", () => stop(running));
  if (exitCode !== 0) fail(`shutdown exit code was ${exitCode}, expected 0`, running);
  if (!running.output.includes("database stopped cleanly"))
    fail("MongoDB was not stopped through its shutdown command", running);
  const first = running;
  running = null;

  running = await start("restart");
  const restored = await json(running, "/api/singleplayer/status");
  if (!restored.hasWorld || restored.turn !== 2 || restored.preset !== "1953-default")
    fail(`restart smoke failed: ${JSON.stringify(restored)}`, running);

  const everything = allOutput.join("");
  const downloads = (everything.match(/is not installed; fetching it once/g) ?? []).length;
  if (downloads > 1) fail(`MongoDB was downloaded ${downloads} times; the cache is not reused`);
  if (!/using cached MongoDB|using MongoDB already installed|MONGOD_PATH/.test(running.output))
    fail("restart did not reuse the MongoDB runtime", running);
  void first;

  const summary = [
    "| step | seconds |",
    "| --- | ---: |",
    ...timings.map((t) => `| ${t.step} | ${t.seconds} |`),
  ].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Singleplayer smoke (${process.platform}/${process.arch})\n\n${summary}\n\nMongoDB downloads: ${downloads}\n`
    );
  }
  console.log("[ahd-smoke] packaged world, turn, shutdown and restart passed");
} finally {
  if (running?.child) await stop(running).catch(() => running.child.kill());
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
