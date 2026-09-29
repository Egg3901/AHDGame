import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import type { Union } from "@/lib/db/types";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { processUndergroundTurn } from "@/lib/turn/unions/undergroundTurn";
import { POST as enforce } from "@/app/api/country/[code]/union-enforcement/route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/events/substrate/rng", () => ({ seededRoll: () => 1 }));

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No loopback port"));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function post(body: Record<string, unknown>) {
  return enforce(
    new Request("http://localhost/api/country/US/union-enforcement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code: "US" }) }
  );
}

// Explicit opt-in: CI hosts need no mongod, while an operator can prove the
// conditional writes against an owned, disposable local Mongo process.
const suite = process.env.AHD_UNDERGROUND_REAL_MONGO === "1" ? describe : describe.skip;

suite("union ban conditional writes against isolated Mongo", () => {
  let child: ChildProcess;
  let client: MongoClient | undefined;
  let db: Db;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = mkdtempSync(join(tmpdir(), "ahd-underground-mongo-"));
    const port = await freeLoopbackPort();
    child = spawn(
      "mongod",
      [
        "--dbpath",
        dbPath,
        "--port",
        String(port),
        "--bind_ip",
        "127.0.0.1",
        "--nounixsocket",
        "--wiredTigerCacheSizeGB",
        "0.25",
        "--quiet",
      ],
      { stdio: "ignore" }
    );
    if (!child.pid) throw new Error("Owned mongod did not start");
    const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
    let lastError: unknown;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Owned mongod exited: ${child.exitCode}`);
      const candidate = new MongoClient(uri, { serverSelectionTimeoutMS: 500 });
      try {
        await candidate.db("admin").command({ ping: 1 });
        client = candidate;
        break;
      } catch (error) {
        lastError = error;
        await candidate.close().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!client) throw lastError ?? new Error("Owned mongod never became ready");
    db = client.db(`ahd_underground_${new ObjectId().toHexString()}`);
  }, 60_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    if (child?.pid) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    if (dbPath) rmSync(dbPath, { recursive: true, force: true });
  }, 10_000);

  it("applies replay, raid, and prosecution claims once with absent legacy fields", async () => {
    const unionId = new ObjectId();
    const organizerId = new ObjectId();
    const executiveId = new ObjectId();
    const union = {
      _id: unionId,
      countryId: "US",
      sectorType: "manufacturing",
      suspended: true,
      heat: 80,
      recentUndergroundDriveCount: 4,
      lastUndergroundDriveTurn: 40,
      undergroundStrength: 25,
      treasury: 1000,
    } as Union;
    const organizer = {
      _id: new ObjectId(),
      unionId,
      characterId: organizerId,
      undergroundStrength: 10,
    };
    const executive = {
      _id: executiveId,
      countryId: "US",
      actions: 10,
      currentOffice: { type: "president" },
    };
    await Promise.all([
      db.collection("gameState").insertOne({ _id: "current" as never, currentTurn: 42 }),
      db.collection("federalBudget").insertOne({
        _id: getNationalBudgetId("US") as never,
        countryId: "US",
        unionsBanned: true,
      }),
      db.collection<Union>("unions").insertOne(union),
      db.collection("unionOrganizers").insertOne(organizer),
      db.collection("characters").insertOne(executive),
    ]);
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "executive", character: executive },
    } as never);

    expect((await processUndergroundTurn(db, 42, new Set(["US"]))).newlyExposed).toBe(1);
    const first = (await db.collection<Union>("unions").findOne({ _id: unionId }))!;
    expect(first).toMatchObject({
      heat: 78,
      recentUndergroundDriveCount: 2,
      undergroundProcessedTurn: 42,
      exposedUntilTurn: 47,
    });
    expect((await processUndergroundTurn(db, 42, new Set(["US"]))).newlyExposed).toBe(0);
    expect(await db.collection<Union>("unions").findOne({ _id: unionId })).toEqual(first);

    const raid = await post({ action: "raid", unionId: unionId.toString() });
    expect(raid.status, JSON.stringify(await raid.json())).toBe(200);
    expect((await post({ action: "raid", unionId: unionId.toString() })).status).toBe(409);
    const raided = (await db.collection<Union>("unions").findOne({ _id: unionId }))!;
    expect(raided.treasury).toBe(900);
    expect(raided.undergroundFinesSeized).toBe(100);
    expect(raided.lastUndergroundRaidTurn).toBe(42);

    const prosecution = await post({
      action: "prosecute",
      unionId: unionId.toString(),
      characterId: organizerId.toString(),
    });
    expect(prosecution.status, JSON.stringify(await prosecution.json())).toBe(200);
    expect(
      (
        await post({
          action: "prosecute",
          unionId: unionId.toString(),
          characterId: organizerId.toString(),
        })
      ).status
    ).toBe(409);
    expect(await db.collection("unionOrganizers").findOne({ _id: organizer._id })).toMatchObject({
      undergroundStrength: 5,
      barredUntilTurn: 45,
      lastProsecutedTurn: 42,
    });
    expect(await db.collection("characters").findOne({ _id: executiveId })).toMatchObject({
      actions: 5,
    });
  }, 30_000);
});
