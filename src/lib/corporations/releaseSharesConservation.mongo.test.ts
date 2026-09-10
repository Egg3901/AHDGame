/**
 * Real-mongod conservation proof for account-cleanup share releases.
 *
 * Opt-in only: runs when `AHD_TEST_REAL_MONGO=1`. Without the flag the suite
 * stays green without spawning anything. With the flag but no `mongod`
 * binary on PATH, the fixture fails loudly instead of silently skipping.
 *
 * The fixture boots its own `mongod` on a loopback port (allocated via
 * listen-on-0, never a guessed random port) with a private dbpath (resolved
 * from the runtime temp dir, never a configured URI) and a random database
 * name per run. Before ANY fixture data write, it verifies the answering
 * server is the owned child (`serverStatus.pid` equals the spawned proc's
 * pid while that proc is still alive); on mismatch it closes the client and
 * fails without writing. It then seeds duplicate character AND corporation
 * holder rows, races releases against a trade that changes shares between
 * snapshot and CAS, and asserts share quantity conservation separately from
 * money (`liquidCapital` untouched).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { statfsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient, ObjectId, type Db, type Document } from "mongodb";
import { releaseCharacterHeldSharesToFloat } from "./releaseCharacterHeldSharesToFloat";
import { releaseCorporationHeldSharesToFloat } from "./releaseHeldSharesToFloat";

const ENABLED = process.env.AHD_TEST_REAL_MONGO === "1";
const STARTUP_DEADLINE_MS = 25_000;
const STOP_GRACE_MS = 10_000;
const STOP_KILL_MS = 5_000;

function sleep(ms: number): Promise<void> {
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

function holderTotal(doc: Document): number {
  const holders = (doc.shareholders ?? []) as Array<{ shares: number }>;
  return holders.reduce((sum, row) => sum + row.shares, 0) + ((doc.publicFloat as number) ?? 0);
}

describe("share-release mongo fixture guards", () => {
  it("treats signal termination as exited", async () => {
    const sigkilled = {
      exitCode: null,
      signalCode: "SIGKILL",
      once: (): void => {},
      removeListener: (): void => {},
    } as unknown as ChildProcess;
    await expect(waitExit(sigkilled, 10)).resolves.toBe(true);
  });

  it("allocates a bindable loopback port", async () => {
    const port = await getFreePort();
    expect(port).toBeGreaterThan(0);
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => {
        probe.removeListener("error", reject);
        resolve();
      });
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  });

  it("rejects a server pid that does not match the owned proc", async () => {
    const proc = { pid: 11111, exitCode: null, signalCode: null } as unknown as ChildProcess;
    const client = {
      db: () => ({ admin: () => ({ serverStatus: async () => ({ pid: 22222 }) }) }),
    } as unknown as MongoClient;
    await expect(assertOwnedMongod(proc, client)).rejects.toThrow(/does not match/);
  });

  it("rejects an owner that already exited", async () => {
    const proc = { pid: 11111, exitCode: 1, signalCode: null } as unknown as ChildProcess;
    const client = {
      db: () => ({ admin: () => ({ serverStatus: async () => ({ pid: 11111 }) }) }),
    } as unknown as MongoClient;
    await expect(assertOwnedMongod(proc, client)).rejects.toThrow(/not running/);
  });
});

describe.runIf(ENABLED)("release share conservation against isolated mongod", () => {
  let proc: ChildProcess | null = null;
  let client: MongoClient | null = null;
  let db: Db;
  let dbpath = "";
  // True while no owned mongod exists or its exit is confirmed; the dbpath is
  // only removed when this holds, never under a possibly-live server.
  let mongodExited = true;

  beforeAll(async () => {
    const base = tmpdir();
    const freeBytes = statfsSync(base).bavail * statfsSync(base).bsize;
    if (freeBytes < 2 * 1024 ** 3) {
      throw new Error(
        `Refusing real-mongo fixture: only ${Math.floor(freeBytes / 1024 ** 3)}GB free, need >2GB.`
      );
    }
    try {
      execFileSync("mongod", ["--version"], { stdio: "ignore" });
    } catch {
      throw new Error("AHD_TEST_REAL_MONGO=1 but no mongod binary is available on PATH.");
    }

    dbpath = await mkdtemp(join(base, "ahd-share-release-"));
    const dbName = `shareReleaseConservation_${randomUUID().replace(/-/g, "")}`;
    let uri = "";
    let lastError: unknown = null;
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
      mongodExited = false;
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
      mongodExited = await waitExit(child, STOP_KILL_MS);
      proc = null;
      if (!mongodExited) {
        throw new Error(
          `Isolated mongod would not exit after SIGKILL; refusing to reuse its dbpath. ${String(lastError)}`
        );
      }
    }
    if (!client) {
      throw new Error(`Isolated mongod failed to start: ${String(lastError)}`);
    }
    db = client.db(dbName);
  }, 120_000);

  afterAll(async () => {
    await client?.close().catch(() => {});
    client = null;
    if (proc) {
      const owned = proc;
      proc = null;
      // Kill only the owned proc, and only while it is still running.
      if (!fixtureProcExited(owned)) owned.kill("SIGTERM");
      mongodExited = await waitExit(owned, STOP_GRACE_MS);
      if (!mongodExited) {
        if (!fixtureProcExited(owned)) owned.kill("SIGKILL");
        mongodExited = await waitExit(owned, STOP_KILL_MS);
      }
    }
    if (dbpath) {
      const path = dbpath;
      dbpath = "";
      // A server whose exit was never confirmed may still hold this path.
      if (mongodExited) {
        await rm(path, { recursive: true, force: true });
      }
    }
  }, 120_000);

  it("conserves duplicate character rows and leaves money alone", async () => {
    const charX = new ObjectId();
    const other = new ObjectId();
    const corps = db.collection("corporations");
    const { insertedId } = await corps.insertOne({
      name: "conservation-char-issuer",
      shareholders: [
        { characterId: charX, shares: 100 },
        { characterId: charX, shares: 250 },
        { characterId: other, shares: 50 },
      ],
      publicFloat: 1000,
      liquidCapital: 5000,
    });
    const before = await corps.findOne({ _id: insertedId });
    const beforeTotal = holderTotal(before as unknown as Document);

    const result = await releaseCharacterHeldSharesToFloat(db, [charX], new Date());

    expect(result).toEqual({ sharesReleased: 350, positionsReleased: 2 });
    const after = (await corps.findOne({ _id: insertedId })) as unknown as Document;
    expect(after.publicFloat).toBe(1350);
    expect(after.shareholders).toEqual([{ characterId: other, shares: 50 }]);
    expect(holderTotal(after)).toBe(beforeTotal);
    expect(after.liquidCapital).toBe(5000);
  });

  it("conserves duplicate corporation rows and leaves money alone", async () => {
    const holderCorp = new ObjectId();
    const otherCorp = new ObjectId();
    const corps = db.collection("corporations");
    const { insertedId } = await corps.insertOne({
      name: "conservation-corp-issuer",
      shareholders: [
        { corporationId: holderCorp, shares: 400 },
        { corporationId: holderCorp, shares: 600 },
        { corporationId: otherCorp, shares: 75 },
      ],
      publicFloat: 2000,
      liquidCapital: 7000,
    });
    const before = await corps.findOne({ _id: insertedId });
    const beforeTotal = holderTotal(before as unknown as Document);

    const result = await releaseCorporationHeldSharesToFloat(db, holderCorp, new Date());

    expect(result).toEqual({ sharesReleased: 1000, corpsShareholderCleared: 1 });
    const after = (await corps.findOne({ _id: insertedId })) as unknown as Document;
    expect(after.publicFloat).toBe(3000);
    expect(after.shareholders).toEqual([{ corporationId: otherCorp, shares: 75 }]);
    expect(holderTotal(after)).toBe(beforeTotal);
    expect(after.liquidCapital).toBe(7000);
  });

  it("credits exactly once when a trade changes shares between snapshot and CAS", async () => {
    const corps = db.collection("corporations");
    for (let round = 0; round < 3; round += 1) {
      const charZ = new ObjectId();
      const { insertedId } = await corps.insertOne({
        name: `conservation-race-${round}`,
        shareholders: [{ characterId: charZ, shares: 500 }],
        publicFloat: 0,
        liquidCapital: 9000,
      });

      // A trade bumps the holding right as two overlapping cleanups snapshot
      // it, forcing at least one CAS retry path in most schedules. Whatever
      // the interleaving, the credit must land exactly once and the share
      // quantity must conserve.
      const trade = (async () => {
        await sleep(1);
        return corps.updateOne(
          { _id: insertedId, "shareholders.characterId": charZ },
          { $inc: { "shareholders.$.shares": 100 } }
        );
      })();
      const [first, second] = await Promise.all([
        releaseCharacterHeldSharesToFloat(db, [charZ], new Date()),
        releaseCharacterHeldSharesToFloat(db, [charZ], new Date()),
      ]);
      const tradeRes = await trade;

      const after = (await corps.findOne({ _id: insertedId })) as unknown as Document;
      const tradeApplied = tradeRes.modifiedCount === 1 ? 100 : 0;
      expect(holderTotal(after)).toBe(500 + tradeApplied);
      expect(first.sharesReleased + second.sharesReleased).toBe((after.publicFloat as number) ?? 0);
      expect(after.liquidCapital).toBe(9000);
      await corps.deleteOne({ _id: insertedId });
    }
  }, 30_000);
});
