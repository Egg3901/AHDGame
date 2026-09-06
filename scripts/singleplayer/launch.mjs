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
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
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
// Startup phases.
//
// Every phase reports what it is doing in plain words, has its own deadline,
// and fails with the evidence a player (or the desktop client's bug report)
// needs: which phase stalled, how long it waited, the last lines the game
// server printed and the tail of MongoDB's log. Silence is never the answer.
// ---------------------------------------------------------------------------

const READY_TIMEOUT_MS = Number(process.env.SINGLEPLAYER_READY_TIMEOUT_MS) || 120_000;
const PORT_TIMEOUT_MS = Number(process.env.SINGLEPLAYER_PORT_TIMEOUT_MS) || 120_000;
const PROBE_TIMEOUT_MS = 30_000;
const OUTPUT_TAIL_LINES = 40;

export const PHASES = {
  database: {
    label: "starting the local database",
    hint: `MongoDB did not open its port. Its own log usually says why: ${path.join(HOME, "mongod.log")}`,
  },
  server: {
    label: "starting the game server",
    hint: "The game server never opened its port. The last lines it printed are above.",
  },
  code: {
    label: "loading the game's code",
    hint:
      "The server is listening but has not answered a single request yet. " +
      "On Windows the first start after an install is slower because antivirus " +
      "scans every file the game loads; if this keeps happening, exclude the " +
      "game folder from real-time scanning.",
  },
  account: {
    label: "connecting to the local database and preparing your account",
    hint:
      "The game server answers, but the singleplayer status route does not. " +
      "Check the error it reported above and the MongoDB log tail below.",
  },
};

export class StartupError extends Error {
  constructor(phase, message, details = {}) {
    super(message);
    this.name = "StartupError";
    this.phase = phase;
    this.details = details;
  }
}

/** Keeps the last N lines a child process printed, for failure reports. */
export class OutputTail {
  constructor(limit = OUTPUT_TAIL_LINES) {
    this.limit = limit;
    this.lines = [];
    this.partial = "";
  }
  push(chunk) {
    this.partial += chunk.toString();
    const parts = this.partial.split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.trim()) continue;
      this.lines.push(line);
      if (this.lines.length > this.limit) this.lines.shift();
    }
  }
  snapshot() {
    const all = this.partial.trim() ? [...this.lines, this.partial] : [...this.lines];
    return all.slice(-this.limit);
  }
}

/**
 * Attach a child's stdout and stderr: forward every line to our own streams
 * unchanged (the desktop client shows them to the player as they arrive) and
 * keep a tail for the failure report. Continuous, never buffered until exit,
 * so a stalled child can never fill its pipe and stall further.
 */
export function captureOutput(child, tail, { forward = true } = {}) {
  const wire = (stream, target) => {
    if (!stream) return;
    stream.on("data", (chunk) => {
      tail.push(chunk);
      if (forward) target.write(chunk);
    });
  };
  wire(child.stdout, process.stdout);
  wire(child.stderr, process.stderr);
}

export function tailOfFile(file, lines = 15, maxBytes = 64 * 1024) {
  try {
    const size = statSync(file).size;
    const fd = openSync(file, "r");
    try {
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return buffer.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-lines);
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
}

/**
 * What a MongoDB exit code means to a player. The codes are mongod's own
 * (src/mongo/util/exit_code.h) plus the Windows loader statuses for a binary
 * that cannot run at all.
 */
export function explainMongoExit(code, { win = WIN, mongoDir = MONGO_DIR } = {}) {
  if (code === 48) return "MongoDB could not bind its port; another program is using it.";
  if (code === 62)
    return (
      "The world's database files were written by a different MongoDB version and " +
      "this MongoDB refuses to open them. Point MONGOD_PATH at the version that " +
      "created the world, or start a new world."
    );
  if (code === 100 || code === 14)
    return "MongoDB hit an error while opening the database; its log says which.";
  if (win && (code === 3221225781 || code === -1073741515))
    return `MongoDB needs the Visual C++ runtime. Run ${path.join(mongoDir, "vc_redist.x64.exe")} once, then start the game again.`;
  if (win && (code === 3221225477 || code === -1073741819 || code === 3221225501))
    return "The MongoDB executable is damaged or blocked from running.";
  return null;
}

/** True when the failure is the binary itself rather than the data or the port. */
export function mongoBinaryLooksBroken(code, spawnErrorCode) {
  if (spawnErrorCode === "ENOENT" || spawnErrorCode === "EACCES" || spawnErrorCode === "UNKNOWN")
    return true;
  return (
    code === 126 ||
    code === 127 ||
    code === 3221225477 ||
    code === -1073741819 ||
    code === 3221225501
  );
}

/**
 * @param {unknown} error
 * @param {{ appTail?: string[], mongoLogTail?: string[] }} [evidence]
 */
export function formatStartupFailure(error, { appTail = [], mongoLogTail = [] } = {}) {
  const out = [];
  const phase = error instanceof StartupError ? PHASES[error.phase] : null;
  out.push(`[ahd] startup failed while ${phase?.label ?? "starting"}: ${error.message}`);
  if (phase?.hint) out.push(`[ahd] ${phase.hint}`);
  const reported = error instanceof StartupError ? error.details.lastResponse : null;
  if (reported) out.push(`[ahd] last answer from the game: ${reported}`);
  if (appTail.length) {
    out.push(`[ahd] last ${appTail.length} lines from the game server:`);
    for (const line of appTail) out.push(`    ${line}`);
  }
  if (mongoLogTail.length) {
    out.push(`[ahd] last ${mongoLogTail.length} lines from MongoDB:`);
    for (const line of mongoLogTail) out.push(`    ${line}`);
  }
  return out.join("\n");
}

export function waitForPort(port, phase, deadlineMs, { onExit } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      fn(value);
    };
    onExit?.((reason) => finish(reject, reason));
    const attempt = () => {
      if (done) return;
      const sock = connect({ host: "127.0.0.1", port });
      sock.once("connect", () => {
        sock.destroy();
        finish(resolve, Date.now() - started);
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - started > deadlineMs)
          finish(
            reject,
            new StartupError(
              phase,
              `port ${port} did not open within ${Math.round(deadlineMs / 1000)}s`
            )
          );
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

export function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

/**
 * One HTTP probe, classified. "ready" ends the phase. "fatal" ends startup
 * now with a reason (no amount of waiting fixes a 404 from a server that is
 * not in singleplayer mode). "waiting" keeps polling, carrying the reason so
 * a repeated server error is reported instead of hidden.
 */
export async function probe(url, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
  } catch (error) {
    const name = error?.name ?? "";
    if (name === "TimeoutError" || name === "AbortError")
      return { state: "waiting", reason: `no answer within ${Math.round(timeoutMs / 1000)}s` };
    return { state: "waiting", reason: error?.cause?.code ?? error?.message ?? String(error) };
  }
  if (res.ok) return { state: "ready" };
  const body = await res.text().catch(() => "");
  const summary = summarizeBody(body);
  if (res.status === 404)
    return {
      state: "fatal",
      reason:
        "the server answered 404: it is not running in singleplayer mode " +
        "(SINGLEPLAYER=1 was not honoured or a deployment marker is set)",
    };
  if (res.status === 403)
    return { state: "fatal", reason: `the server refused the request (403): ${summary}` };
  return { state: "waiting", reason: `HTTP ${res.status}${summary ? `: ${summary}` : ""}` };
}

function summarizeBody(body) {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message ?? parsed?.error ?? parsed?.message;
    if (typeof message === "string") return message.slice(0, 300);
  } catch {
    // Not JSON.
  }
  return body.replace(/\s+/g, " ").slice(0, 300);
}

/**
 * Poll one URL until it answers 200, reporting progress every few seconds and
 * every distinct error once. Returns the elapsed milliseconds.
 */
export async function waitForAnswer(
  url,
  phase,
  deadlineMs,
  { fetchImpl = fetch, probeTimeoutMs = PROBE_TIMEOUT_MS, sleepMs = 1000, log: report = log } = {}
) {
  const started = Date.now();
  const label = PHASES[phase].label;
  report(label);
  let nextProgressAt = 5;
  let lastReason = null;
  for (;;) {
    // A probe never outlives the phase: a silent server must fail at the
    // deadline, not one full probe timeout after it.
    const remaining = deadlineMs - (Date.now() - started);
    const timeoutMs = Math.max(250, Math.min(probeTimeoutMs, remaining));
    const result = await probe(url, { fetchImpl, timeoutMs });
    if (result.state === "ready") return Date.now() - started;
    if (result.state === "fatal") throw new StartupError(phase, result.reason);
    if (result.reason && result.reason !== lastReason) {
      lastReason = result.reason;
      if (
        !/^no answer within/.test(result.reason) &&
        !/ECONNREFUSED|ECONNRESET/.test(result.reason)
      )
        report(`the game reported: ${result.reason}`);
    }
    const elapsed = Date.now() - started;
    if (elapsed > deadlineMs) {
      throw new StartupError(phase, `no answer within ${Math.round(deadlineMs / 1000)}s`, {
        lastResponse: lastReason,
      });
    }
    const elapsedSeconds = Math.round(elapsed / 1000);
    if (elapsedSeconds >= nextProgressAt) {
      nextProgressAt = elapsedSeconds + 5;
      report(`still ${label} (${elapsedSeconds}s)`);
    }
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

/**
 * Two questions, in order. First: does the server answer anything at all?
 * (/api/health is a tiny route with no database.) Once it does, the game's
 * code is loaded and any further wait is ours, not Next's. Second: does the
 * singleplayer status route answer? That provisions the local account, so a
 * host that acts on the ready line never races first-run setup.
 */
export async function waitForGame(base, deadlineMs, options = {}) {
  const timings = {};
  const started = Date.now();
  timings.code = await waitForAnswer(`${base}/api/health`, "code", deadlineMs, options);
  const remaining = Math.max(Math.min(15_000, deadlineMs), deadlineMs - (Date.now() - started));
  timings.account = await waitForAnswer(
    `${base}/api/singleplayer/status`,
    "account",
    remaining,
    options
  );
  return timings;
}

export function formatTimings(timings) {
  return Object.entries(timings)
    .map(([phase, ms]) => `${phase} ${(ms / 1000).toFixed(1)}s`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Processes.
// ---------------------------------------------------------------------------

const MONGO_LOG = path.join(HOME, "mongod.log");

async function spawnMongod(bin) {
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
      MONGO_LOG,
      "--logappend",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  captureOutput(child, mongoTail);
  mongo = child;
  let spawnErrorCode;
  const earlyFailure = new Promise((resolve) => {
    child.once("error", (error) => {
      spawnErrorCode = error?.code ?? "UNKNOWN";
      resolve(
        new StartupError("database", `MongoDB could not be started: ${error.message}`, {
          spawnErrorCode,
        })
      );
    });
    child.once("exit", (code) => {
      const why = explainMongoExit(code);
      resolve(
        new StartupError(
          "database",
          `MongoDB exited with code ${code} before opening its port.${why ? ` ${why}` : ""}`,
          { exitCode: code }
        )
      );
    });
  });
  await waitForPort(MONGO_PORT, "database", 60_000, {
    onExit: (fail) => earlyFailure.then(fail),
  });
  child.once("exit", (code) => {
    if (shuttingDown) return;
    const why = explainMongoExit(code);
    console.error(
      `[ahd] MongoDB exited unexpectedly (code ${code}).${why ? ` ${why}` : ""} See ${MONGO_LOG}`
    );
    process.exit(1);
  });
  return child;
}

/**
 * Start MongoDB, recovering from the one failure a player can do nothing
 * about: a cached download that no longer runs is fetched again, once. Every
 * other exit is explained (port taken, incompatible data files, missing
 * Visual C++ runtime) rather than retried.
 */
async function startMongod(bin) {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!(await portFree(MONGO_PORT))) {
    log(`port ${MONGO_PORT} already in use; assuming a MongoDB is running there`);
    return null;
  }
  if (shuttingDown) return null;
  try {
    return await spawnMongod(bin);
  } catch (error) {
    const { exitCode, spawnErrorCode } = error?.details ?? {};
    if (bin === MONGOD && !shuttingDown && mongoBinaryLooksBroken(exitCode, spawnErrorCode)) {
      log(`the cached MongoDB does not run (${error.message}); fetching a fresh copy once`);
      await rm(MONGO_DIR, { recursive: true, force: true });
      const fresh = await fetchMongod();
      return await spawnMongod(fresh);
    }
    throw error;
  }
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
  // SINGLEPLAYER_SERVER_JS exists for the launcher's own tests, which point
  // it at a stub. Players never set it.
  const server = process.env.SINGLEPLAYER_SERVER_JS || path.join(HERE, "server.js");
  if (!existsSync(server))
    throw new StartupError(
      "server",
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
  const child = spawn(process.execPath, [server], { env, stdio: ["ignore", "pipe", "pipe"] });
  captureOutput(child, appTail);
  child.once("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[ahd] app exited unexpectedly (code ${code})`);
      shutdown(1);
    }
  });
  return child;
}

/** Rejects when the app exits, so a port wait never outlives the process it waits on. */
function appExit(child) {
  return (fail) =>
    child.once("exit", (code) =>
      fail(
        new StartupError("server", `the game server exited with code ${code} before it was ready`)
      )
    );
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

async function warmAssets(base) {
  try {
    const status = await (await fetch(`${base}/api/singleplayer/status`)).json();
    await Promise.allSettled((status.warmAssets ?? []).map((u) => fetch(new URL(u, base))));
  } catch {
    // Purely a nicety; the /cdn route fetches on demand anyway.
  }
}

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
let mongo = null;
let app = null;
const appTail = new OutputTail();
const mongoTail = new OutputTail();

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

function listenForControl() {
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
  process.stdin.on("error", () => {});
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

async function main() {
  listenForControl();
  const timings = {};
  try {
    mkdirSync(HOME, { recursive: true });
    const bin = await findMongod();
    if (shuttingDown) process.exit(0);
    let at = Date.now();
    log(PHASES.database.label);
    mongo = await startMongod(bin);
    timings.database = Date.now() - at;
    if (shuttingDown) process.exit(0);
    at = Date.now();
    log(PHASES.server.label);
    app = startApp();
    await waitForPort(APP_PORT, "server", PORT_TIMEOUT_MS, { onExit: appExit(app) });
    timings.server = Date.now() - at;
    const base = `http://127.0.0.1:${APP_PORT}`;
    Object.assign(timings, await waitForGame(base, READY_TIMEOUT_MS));
    log(`startup took ${formatTimings(timings)}`);
    log(`ready at ${base}`);
    if (OPEN_BROWSER) openBrowser(`${base}/singleplayer`);
    void warmAssets(base);
    watchParent();
  } catch (error) {
    const report =
      error instanceof StartupError
        ? formatStartupFailure(error, {
            appTail: appTail.snapshot(),
            mongoLogTail: [...mongoTail.snapshot(), ...tailOfFile(MONGO_LOG)].slice(-15),
          })
        : `[ahd] ${error instanceof Error ? error.message : error}`;
    console.error(report);
    shutdown(1);
  }
}

if (!process.env.AHD_LAUNCH_LIBRARY) await main();
