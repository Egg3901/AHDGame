#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const launcher = path.join(root, "dist", "singleplayer", "launch.mjs");
const work = await mkdtemp(
  path.join(
    process.env.AHD_SMOKE_ROOT ? path.resolve(process.env.AHD_SMOKE_ROOT) : tmpdir(),
    "ahd-singleplayer-smoke-"
  )
);
const home = path.join(work, "world");
const runtimeHome = path.join(work, "runtime");

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

async function start() {
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
  let output = "";
  let readySeen = false;
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`startup timed out\n${output}`)),
      10 * 60_000
    );
    const consume = (chunk) => {
      const text = chunk.toString();
      output = (output + text).slice(-20_000);
      if (!readySeen) process.stdout.write(text);
      if (output.includes(`ready at http://127.0.0.1:${appPort}`)) {
        readySeen = true;
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`game exited before readiness with code ${code}\n${output}`));
    });
  });
  try {
    await ready;
  } catch (error) {
    child.kill();
    throw error;
  }
  return { child, base: `http://127.0.0.1:${appPort}` };
}

async function json(base, route, init) {
  const response = await fetch(`${base}${route}`, {
    ...init,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(`${route} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.stdin.write("shutdown\n");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("shutdown timed out")), 15_000)),
  ]);
}

let running;
try {
  running = await start();
  const setup = await json(running.base, "/api/singleplayer/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      preset: "1953-default",
      mode: "worldsim",
      difficulty: "normal",
      autonomyLevel: "v4",
    }),
  });
  if (!setup.ok) throw new Error("fresh world setup did not complete");
  const turn = await json(running.base, "/api/singleplayer/worldsim/advance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turns: 1 }),
  });
  if (turn.completed !== 1 || turn.finalTurn !== 2) {
    throw new Error(`turn smoke failed: ${JSON.stringify(turn)}`);
  }
  await stop(running.child);

  running = await start();
  const restored = await json(running.base, "/api/singleplayer/status");
  if (!restored.hasWorld || restored.turn !== 2 || restored.preset !== "1953-default") {
    throw new Error(`restart smoke failed: ${JSON.stringify(restored)}`);
  }
  console.log("[ahd-smoke] packaged world, turn and restart passed");
} finally {
  if (running?.child) await stop(running.child).catch(() => running.child.kill());
  await rm(work, { recursive: true, force: true });
}
