/**
 * Shared real-mongod fixture for opt-in integration tests.
 *
 * Opt-in only: suites gate on `REAL_MONGO_ENABLED` (`AHD_TEST_REAL_MONGO=1`).
 * Without the flag nothing spawns; with the flag but no `mongod` binary on
 * PATH the fixture fails loudly instead of silently skipping.
 *
 * `startIsolatedMongod` boots its own `mongod` on a loopback port (allocated
 * via listen-on-0, never a guessed random port) with a private dbpath
 * (resolved from the runtime temp dir, never a configured URI) and a random
 * database name per run. Before ANY fixture data write, it verifies the
 * answering server is the owned child (`serverStatus.pid` equals the spawned
 * proc's pid while that proc is still alive); on mismatch it closes the
 * client and fails without writing.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { statfsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient, type Db } from "mongodb";

export const REAL_MONGO_ENABLED = process.env.AHD_TEST_REAL_MONGO === "1";

const STARTUP_DEADLINE_MS = 25_000;
const STOP_GRACE_MS = 10_000;
const STOP_KILL_MS = 5_000;
const MIN_FREE_BYTES = 2 * 1024 ** 3;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A proc counts as exited on either an exit code or a fatal signal. */
export function fixtureProcExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

export function waitExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (fixtureProcExited(proc)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.removeListener("exit", onExit);
      resolve(fixtureProcExited(proc));
    }, timeoutMs);
    function onExit(): void {
      clearTimeout(timer);
      resolve(true);
    }
    proc.once("exit", onExit);
  });
}

/** Allocate an unused loopback port by binding port 0, then releasing it. */
export async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) throw new Error("Could not allocate a loopback port for the isolated mongod.");
  return port;
}

/**
 * Prove the answering server IS the owned child before any fixture data
 * write. Throws (fail, never write) when the owner is gone or the pid does
 * not match: the port may hold an unrelated Mongo.
 */
export async function assertOwnedMongod(proc: ChildProcess, client: MongoClient): Promise<void> {
  if (proc.pid === undefined || fixtureProcExited(proc)) {
    throw new Error("Refusing real-mongo fixture: owned mongod is not running.");
  }
  const status = (await client.db().admin().serverStatus()) as { pid?: unknown };
  if (typeof status?.pid !== "number" || status.pid !== proc.pid) {
    throw new Error(
      `Refusing real-mongo fixture: server pid ${String(status?.pid)} does not match ` +
        `owned mongod pid ${String(proc.pid)}.`
    );
  }
}

export interface IsolatedMongod {
  /** One control connection. Callers needing true parallel wire behavior open
   * their own MongoClients against `uri`. */
  client: MongoClient;
  db: Db;
  uri: string;
  dbName: string;
  proc: ChildProcess;
  dbpath: string;
  /** Tracks whether the owned proc's exit is confirmed; dbpath removal is
   * only safe while this holds. */
  exited: boolean;
}

/**
 * Boot a private mongod and return a handle whose `client`/`db` are already
 * connected and ownership-verified. `prefix` namespaces the temp dbpath and
 * database name (e.g. "ahd-vote-race-").
 */
export async function startIsolatedMongod(prefix: string): Promise<IsolatedMongod> {
  const base = tmpdir();
  const freeBytes = statfsSync(base).bavail * statfsSync(base).bsize;
  if (freeBytes < MIN_FREE_BYTES) {
    throw new Error(
      `Refusing real-mongo fixture: only ${Math.floor(freeBytes / 1024 ** 3)}GB free, need >2GB.`
    );
  }
  try {
    execFileSync("mongod", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("AHD_TEST_REAL_MONGO=1 but no mongod binary is available on PATH.");
  }

  const dbpath = await mkdtemp(join(base, prefix));
  const dbName = `${prefix.replace(/-/g, "_")}${randomUUID().replace(/-/g, "")}`;
  let client: MongoClient | null = null;
  let lastError: unknown = null;
  let proc: ChildProcess | null = null;
  let exited = true;
  let uri = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = await getFreePort();
    const child = spawn(
      "mongod",
      [
        "--port",
        String(port),
        "--dbpath",
        dbpath,
        "--bind_ip",
        "127.0.0.1",
        "--nounixsocket",
        "--wiredTigerCacheSizeGB",
        "0.25",
      ],
      { stdio: "ignore" }
    );
    // Registered synchronously so a failed spawn can never surface as an
    // unhandled 'error' event.
    let spawnError: unknown = null;
    child.once("error", (err) => {
      spawnError = err;
    });
    proc = child;
    exited = false;
    uri = `mongodb://127.0.0.1:${port}/${dbName}`;
    const deadline = Date.now() + STARTUP_DEADLINE_MS;
    let connected = false;
    while (Date.now() < deadline) {
      if (spawnError !== null) {
        lastError = spawnError;
        break;
      }
      if (fixtureProcExited(child)) {
        lastError = new Error(
          `mongod exited during startup (code ${child.exitCode}, signal ${child.signalCode})`
        );
        break;
      }
      const candidate = new MongoClient(uri, { serverSelectionTimeoutMS: 1000 });
      try {
        await candidate.connect();
        await candidate.db().admin().ping();
        // Ownership gate: prove the answering server is this child before
        // ANY fixture data write. On mismatch close and fail, never write.
        await assertOwnedMongod(child, candidate);
        client = candidate;
        connected = true;
        break;
      } catch (err) {
        lastError = err;
        await candidate.close().catch(() => {});
        if (err instanceof Error && err.message.startsWith("Refusing real-mongo fixture")) break;
        await sleep(250);
      }
    }
    if (connected) break;
    // Never reuse the dbpath under a possibly-live server: kill only the
    // owned proc, and refuse the next attempt until its exit is confirmed.
    if (!fixtureProcExited(child)) child.kill("SIGKILL");
    exited = await waitExit(child, STOP_KILL_MS);
    proc = null;
    if (!exited) {
      throw new Error(
        `Isolated mongod would not exit after SIGKILL; refusing to reuse its dbpath. ${String(lastError)}`
      );
    }
  }
  if (!client || !proc) {
    throw new Error(`Isolated mongod failed to start: ${String(lastError)}`);
  }
  return { client, db: client.db(dbName), uri, dbName, proc, dbpath, exited: false };
}

/**
 * Stop the owned mongod (SIGTERM, then SIGKILL on the grace deadline) and
 * remove its dbpath only once exit is confirmed — a server whose exit was
 * never confirmed may still hold the path.
 */
export async function stopIsolatedMongod(handle: IsolatedMongod | null): Promise<void> {
  if (!handle) return;
  await handle.client.close().catch(() => {});
  const { proc, dbpath } = handle;
  let exited = true;
  if (proc) {
    if (!fixtureProcExited(proc)) proc.kill("SIGTERM");
    exited = await waitExit(proc, STOP_GRACE_MS);
    if (!exited) {
      if (!fixtureProcExited(proc)) proc.kill("SIGKILL");
      exited = await waitExit(proc, STOP_KILL_MS);
    }
  }
  if (dbpath && exited) {
    await rm(dbpath, { recursive: true, force: true });
  }
}
