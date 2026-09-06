#!/usr/bin/env node
/**
 * A House Divided, singleplayer launcher.
 *
 * Runs the same app the multiplayer site runs, against a MongoDB that lives
 * in the player's home directory, with one local account. No sign-up, no
 * network beyond the first-run download of MongoDB and the art the world
 * happens to use.
 *
 * Plain Node, no dependencies: this file is copied next to the standalone
 * `server.js` by scripts/singleplayer/package.mjs and has to run from there.
 *
 *   node launch.mjs                 start (downloads MongoDB on first run)
 *   node launch.mjs --port N        serve on a different port (default 3111)
 *   node launch.mjs --home DIR      data directory (default ~/.a-house-divided)
 *   node launch.mjs --no-browser    do not open a browser; a host app will
 *   node launch.mjs --parent-pid P  exit, taking MongoDB with it, when P dies
 *
 * The last two exist for the desktop client, which runs this file under a
 * bundled Node and shows the game in its own window. Readiness is announced
 * on stdout as a single line, "[ahd] ready at http://127.0.0.1:<port>".
 *
 * Environment overrides: SINGLEPLAYER_HOME (data directory), MONGOD_PATH
 * (use an existing mongod instead of fetching one), SINGLEPLAYER_MONGO_PORT.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { randomBytes } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MONGO_VERSION = "8.0.12";
const DB_NAME = "a-house-divided";
const WIN = process.platform === "win32";

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

const HOME = path.resolve(
  arg("--home", process.env.SINGLEPLAYER_HOME || path.join(homedir(), ".a-house-divided"))
);
const RUNTIME_HOME = path.resolve(
  arg("--runtime-home", process.env.SINGLEPLAYER_RUNTIME_HOME || HOME)
);
const APP_PORT = Number(arg("--port", process.env.PORT || 3111));
const MONGO_PORT = Number(arg("--mongo-port", process.env.SINGLEPLAYER_MONGO_PORT || 27117));
const OPEN_BROWSER = !process.argv.includes("--no-browser");
const PARENT_PID = Number(arg("--parent-pid", 0));
const DATA_DIR = path.join(HOME, "data");
// The database belongs to a world, but the MongoDB executable does not. Native
// clients pass one shared runtime directory so every world reuses the same
// verified download.
const MONGO_DIR = path.join(RUNTIME_HOME, "mongodb");
const MONGOD = path.join(MONGO_DIR, WIN ? "mongod.exe" : "mongod");
const MONGO_COMPLETE = path.join(MONGO_DIR, `.complete-${MONGO_VERSION}`);

const log = (...parts) => console.log("[ahd]", ...parts);

// ---------------------------------------------------------------------------
// MongoDB: detect, else fetch.
// ---------------------------------------------------------------------------

function mongoArchive() {
  const arch = process.arch;
  switch (process.platform) {
    case "linux":
      if (arch !== "x64" && arch !== "arm64") break;
      // Ubuntu 22.04 builds run on every glibc 2.35+ distro, which is
      // everything a player is likely to have.
      return {
        url: `https://fastdl.mongodb.org/linux/mongodb-linux-${arch === "x64" ? "x86_64" : "aarch64"}-ubuntu2204-${MONGO_VERSION}.tgz`,
        kind: "tgz",
      };
    case "darwin":
      if (arch !== "x64" && arch !== "arm64") break;
      return {
        url: `https://fastdl.mongodb.org/osx/mongodb-macos-${arch === "x64" ? "x86_64" : "arm64"}-${MONGO_VERSION}.tgz`,
        kind: "tgz",
      };
    case "win32":
      if (arch !== "x64") break;
      return {
        url: `https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${MONGO_VERSION}.zip`,
        kind: "zip",
      };
  }
  throw new Error(
    `No MongoDB build for ${process.platform}/${process.arch}. Install MongoDB yourself and set MONGOD_PATH.`
  );
}

function which(bin) {
  const r = spawnSync(WIN ? "where" : "which", [bin], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find((line) => line.trim());
  return first ? first.trim() : null;
}

async function findMongod() {
  if (process.env.MONGOD_PATH) {
    if (!existsSync(process.env.MONGOD_PATH))
      throw new Error(`MONGOD_PATH does not exist: ${process.env.MONGOD_PATH}`);
    return process.env.MONGOD_PATH;
  }
  if (existsSync(MONGO_COMPLETE) && existsSync(MONGOD) && statSync(MONGOD).size > 1_000_000) {
    log(`using cached MongoDB at ${MONGOD}`);
    return MONGOD;
  }
  const onPath = which(WIN ? "mongod.exe" : "mongod");
  if (onPath) {
    log(`using MongoDB already installed at ${onPath}`);
    return onPath;
  }
  return fetchMongod();
}

async function download(url, dest, label) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let seen = 0;
  let lastPct = -1;
  const progress = new TransformStreamCounter((n) => {
    seen += n;
    if (!total) return;
    const pct = Math.floor((seen / total) * 100);
    if (pct !== lastPct && pct % 10 === 0) {
      lastPct = pct;
      log(`${label}: ${pct}%`);
    }
  });
  await pipeline(Readable.fromWeb(res.body), progress, createWriteStream(dest));
}

// A pass-through Transform that reports bytes as they flow.
import { Transform } from "node:stream";
class TransformStreamCounter extends Transform {
  constructor(onChunk) {
    super();
    this.onChunk = onChunk;
  }
  _transform(chunk, _enc, cb) {
    this.onChunk(chunk.length);
    cb(null, chunk);
  }
}

async function fetchMongod() {
  const { url, kind } = mongoArchive();
  mkdirSync(RUNTIME_HOME, { recursive: true });
  const staging = await mkdtemp(path.join(RUNTIME_HOME, "mongo-staging-"));
  log(`MongoDB ${MONGO_VERSION} is not installed; fetching it once from fastdl.mongodb.org`);
  try {
    if (kind === "zip") {
      await extractFromZipByRange(url, ["bin/mongod.exe", "bin/vc_redist.x64.exe"], staging);
    } else {
      const tmp = await mkdtemp(path.join(tmpdir(), "ahd-mongo-"));
      try {
        const archive = path.join(tmp, "mongodb.tgz");
        await download(url, archive, "MongoDB download");
        const r = spawnSync("tar", ["-xzf", archive, "-C", tmp], { stdio: "inherit" });
        if (r.status !== 0) throw new Error("tar failed while unpacking MongoDB");
        const extracted = spawnSync("sh", ["-c", `ls -d ${tmp}/mongodb-*/bin/mongod`], {
          encoding: "utf8",
        }).stdout.trim();
        if (!extracted) throw new Error("mongod not found inside the MongoDB archive");
        writeFileSync(path.join(staging, "mongod"), readFileSync(extracted), { mode: 0o755 });
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }
    await writeFile(path.join(staging, `.complete-${MONGO_VERSION}`), `${MONGO_VERSION}\n`);
    await rm(MONGO_DIR, { recursive: true, force: true });
    await rename(staging, MONGO_DIR);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  log(`MongoDB ready at ${MONGOD}`);
  return MONGOD;
}

/**
 * The Windows archive is 785 MB because it ships debug symbols; mongod.exe
 * itself is 28 MB compressed. Read the zip's central directory with a range
 * request, then range-fetch and inflate only the entries we want.
 */
async function extractFromZipByRange(url, wanted, destDir) {
  const head = await fetch(url, { method: "HEAD" });
  const size = Number(head.headers.get("content-length"));
  if (!size || head.headers.get("accept-ranges") !== "bytes")
    throw new Error("server does not support range requests");

  const tailLen = Math.min(size, 1 << 20);
  const tail = Buffer.from(
    await (
      await fetch(url, { headers: { Range: `bytes=${size - tailLen}-${size - 1}` } })
    ).arrayBuffer()
  );
  const eocd = tail.lastIndexOf(Buffer.from("PK\x05\x06", "binary"));
  if (eocd < 0) throw new Error("zip end-of-central-directory not found");
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = Buffer.from(
    await (
      await fetch(url, { headers: { Range: `bytes=${cdOffset}-${cdOffset + cdSize - 1}` } })
    ).arrayBuffer()
  );

  const entries = new Map();
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10);
    const csize = cd.readUInt32LE(p + 20);
    const usize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { method, csize, usize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  for (const suffix of wanted) {
    const match = [...entries.entries()].find(([name]) => name.endsWith("/" + suffix));
    if (!match) throw new Error(`${suffix} not found in the MongoDB archive`);
    const [name, e] = match;
    const localHead = Buffer.from(
      await (
        await fetch(url, { headers: { Range: `bytes=${e.localOffset}-${e.localOffset + 29}` } })
      ).arrayBuffer()
    );
    const nameLen = localHead.readUInt16LE(26);
    const extraLen = localHead.readUInt16LE(28);
    const dataStart = e.localOffset + 30 + nameLen + extraLen;
    log(`fetching ${path.basename(name)} (${(e.csize / 1048576).toFixed(0)} MB)`);
    const packed = Buffer.from(
      await (
        await fetch(url, { headers: { Range: `bytes=${dataStart}-${dataStart + e.csize - 1}` } })
      ).arrayBuffer()
    );
    const data = e.method === 8 ? inflateRawSync(packed) : packed;
    if (data.length !== e.usize) throw new Error(`${suffix}: size mismatch after inflate`);
    await writeFile(path.join(destDir, path.basename(name)), data);
  }
}

// ---------------------------------------------------------------------------
// Processes.
// ---------------------------------------------------------------------------

function waitForPort(port, label, deadlineMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = connect({ host: "127.0.0.1", port });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - started > deadlineMs)
          reject(new Error(`${label} did not open port ${port} within ${deadlineMs / 1000}s`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function startMongod(bin) {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!(await portFree(MONGO_PORT))) {
    log(`port ${MONGO_PORT} already in use; assuming a MongoDB is running there`);
    return null;
  }
  if (shuttingDown) return null;
  const child = spawn(
    bin,
    [
      "--dbpath",
      DATA_DIR,
      "--port",
      String(MONGO_PORT),
      "--bind_ip",
      "127.0.0.1",
      "--logpath",
      path.join(HOME, "mongod.log"),
      "--logappend",
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  // Track ownership before waiting for the port, including startup cancellation.
  mongo = child;
  child.once("exit", (code) => {
    if (!shuttingDown) {
      console.error(
        `[ahd] MongoDB exited unexpectedly (code ${code}). See ${path.join(HOME, "mongod.log")}`
      );
      if (WIN && (code === 3221225781 || code === -1073741515)) {
        console.error(
          `[ahd] That code means a missing Visual C++ runtime. Run ${path.join(MONGO_DIR, "vc_redist.x64.exe")} once, then start again.`
        );
      }
      process.exit(1);
    }
  });
  await waitForPort(MONGO_PORT, "MongoDB", 60_000);
  return child;
}

/**
 * The app refuses to boot without its secrets, so a local install mints its
 * own once and keeps them in the data directory. Nothing outside this
 * machine ever needs them; they exist to satisfy the same validation the
 * hosted game runs.
 */
function persistentSecret(name) {
  const file = path.join(HOME, name);
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const secret = randomBytes(48).toString("base64url");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function startApp() {
  const server = path.join(HERE, "server.js");
  if (!existsSync(server))
    throw new Error(
      `server.js not found next to the launcher (${HERE}). Run scripts/singleplayer/package.mjs first.`
    );
  const env = {
    ...process.env,
    NODE_ENV: "production",
    SINGLEPLAYER: "1",
    SINGLEPLAYER_ADMIN: "1",
    SINGLEPLAYER_HOME: HOME,
    MONGODB_URI: `mongodb://127.0.0.1:${MONGO_PORT}/${DB_NAME}`,
    AUTH_SECRET: persistentSecret("auth-secret"),
    CRON_SECRET: persistentSecret("cron-secret"),
    ADMIN_REGISTRATION_KEY: persistentSecret("admin-registration-key"),
    PORT: String(APP_PORT),
    HOSTNAME: "127.0.0.1",
  };
  const child = spawn(process.execPath, [server], { env, stdio: "inherit" });
  child.once("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[ahd] app exited unexpectedly (code ${code})`);
      shutdown(1);
    }
  });
  return child;
}

function openBrowser(url) {
  const cmd = WIN
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  const child = spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true });
  // No opener on this machine (headless box, minimal container): say where
  // to go instead of dying on the child's ENOENT.
  child.on("error", () => log(`open ${url} in your browser`));
  child.unref();
}

/**
 * The port opens before the game is usable: on a fresh database the server
 * seeds its reference data during the first request, which can take a
 * while. "ready" means the singleplayer status route answers, nothing less,
 * so a host that acts on the ready line never races that setup.
 */
async function waitForGame(base, deadlineMs) {
  const started = Date.now();
  let nextProgressAt = 0;
  for (;;) {
    try {
      const res = await fetch(`${base}/api/singleplayer/status`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() - started > deadlineMs) {
      throw new Error(`the game did not answer within ${deadlineMs / 1000}s of its port opening`);
    }
    const elapsedSeconds = Math.round((Date.now() - started) / 1000);
    if (elapsedSeconds >= nextProgressAt) {
      nextProgressAt = elapsedSeconds + 5;
      log(`still building the world (${elapsedSeconds}s): preparing its first turn`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function warmAssets(base) {
  try {
    const status = await (await fetch(`${base}/api/singleplayer/status`)).json();
    await Promise.allSettled((status.warmAssets ?? []).map((u) => fetch(new URL(u, base))));
  } catch {
    // Purely a nicety; the /cdn route fetches on demand anyway.
  }
}

// ---------------------------------------------------------------------------

/**
 * A host app that dies without warning (crash, force quit, Windows has no
 * signals to send) would leave a MongoDB and a game server behind. Poll the
 * parent instead of trusting it to say goodbye.
 */
function watchParent() {
  if (!PARENT_PID) return;
  const timer = setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      log(`parent process ${PARENT_PID} is gone`);
      clearInterval(timer);
      shutdown(0);
    }
  }, 2000);
  timer.unref();
}

let shuttingDown = false;
// The desktop supervisor owns stdin. Use a bounded line protocol so stopping
// one world terminates its children before the desktop starts another world.
let controlInput = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  controlInput = (controlInput + chunk).slice(-128);
  const lines = controlInput.split("\n");
  controlInput = lines.pop() ?? "";
  if (lines.some((line) => line.trim() === "shutdown")) shutdown(0);
});

let mongo = null;
let app = null;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down");
  app?.kill();
  // SIGTERM gives WiredTiger a clean checkpoint; Windows has no signal so it
  // is a hard stop there and the journal recovers on the next start.
  mongo?.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  mkdirSync(HOME, { recursive: true });
  const bin = await findMongod();
  if (shuttingDown) process.exit(0);
  mongo = await startMongod(bin);
  if (shuttingDown) process.exit(0);
  app = startApp();
  await waitForPort(APP_PORT, "app", 120_000);
  const base = `http://127.0.0.1:${APP_PORT}`;
  await waitForGame(base, 120_000);
  log(`ready at ${base}`);
  if (OPEN_BROWSER) openBrowser(`${base}/singleplayer`);
  void warmAssets(base);
  watchParent();
} catch (error) {
  console.error("[ahd]", error instanceof Error ? error.message : error);
  shutdown(1);
}
