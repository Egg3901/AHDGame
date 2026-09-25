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
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { MongoClient, ObjectId, type Db, type Document } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  assertOwnedMongod,
  fixtureProcExited,
  getFreePort,
  sleep,
  startIsolatedMongod,
  stopIsolatedMongod,
  waitExit,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { releaseCharacterHeldSharesToFloat } from "./releaseCharacterHeldSharesToFloat";
import { releaseCorporationHeldSharesToFloat } from "./releaseHeldSharesToFloat";

const ENABLED = REAL_MONGO_ENABLED;

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
  let fixture: IsolatedMongod | null = null;
  let db: Db;

  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-share-release-");
    db = fixture.db;
  }, 120_000);

  afterAll(async () => {
    await stopIsolatedMongod(fixture);
    fixture = null;
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
