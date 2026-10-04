import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { processTreasuryTurn } from "@/lib/turn/treasuryTurn";
import { writeBalanceSnapshot, writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import { prepareOpeningLedgerSnapshot } from "./openingLedgerSnapshot";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const nativeEnabled = process.env.AHD_OPENING_LEDGER_REAL_MONGO === "1";
let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});

async function world(native: boolean, empty = false): Promise<Db> {
  let db: Db;
  if (native) {
    // Native fixtures are isolated, disposable sandbox namespaces, never a game DB.
    const uri = new URL(process.env.AHD_OPENING_LEDGER_MONGO_URI ?? "mongodb://127.0.0.1:27018");
    if (
      uri.protocol !== "mongodb:" ||
      !["127.0.0.1", "localhost"].includes(uri.hostname) ||
      !["27018", "27020"].includes(uri.port) ||
      uri.username ||
      uri.password ||
      (uri.pathname && uri.pathname !== "/") ||
      uri.search
    ) {
      throw new Error("Opening ledger fixtures require a local sandbox Mongo endpoint");
    }
    client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1 });
    db = client.db(`ahd_sim_fixture_opening_ledger_${randomUUID().replaceAll("-", "")}`);
  } else db = createInMemoryDb() as unknown as Db;
  await db
    .collection<{ _id: string; ledgerShadow: boolean }>("gameConfig")
    .insertOne({ _id: "default", ledgerShadow: true });
  await db
    .collection<{ _id: string; preset: string; currentTurn: number }>("gameState")
    .insertOne({ _id: "current", preset: "1991-default", currentTurn: 1 });
  if (!empty)
    await db.collection("federalBudget").insertOne({
      _id: new ObjectId(),
      countryId: "BG",
      currencyCode: "BGL",
      treasuryBalance: 2825,
      revenue: { total: 135600 },
      spending: { total: 0, debtInterest: 0 },
      debt: { principal: 0, interestRate: 0 },
    });
  vi.mocked(getDb).mockResolvedValue(db);
  return db;
}

async function advance(db: Db) {
  await processTreasuryTurn(2);
  await writePreForexBalanceCheckpoint(db, 2);
  await writeBalanceSnapshot(db, 2);
  return reconcileTurn(db, 2);
}

function failOpeningWrite(db: Db, afterWrite: boolean): Db {
  return new Proxy(db, {
    get(target, key) {
      if (key === "collection")
        return (name: string) => {
          const collection = target.collection(name);
          if (name !== "balanceSnapshots") return collection;
          return new Proxy(collection, {
            get(targetCollection, method) {
              if (method === "replaceOne")
                return async (...args: Parameters<typeof collection.replaceOne>) => {
                  if (args[0].turn === 1) {
                    if (afterWrite) await targetCollection.replaceOne(...args);
                    throw new Error("Injected opening snapshot storage failure");
                  }
                  return targetCollection.replaceOne(...args);
                };
              const value = Reflect.get(targetCollection, method);
              return typeof value === "function" ? value.bind(targetCollection) : value;
            },
          });
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `opening cash baseline (${native ? "native Mongo" : "memory"})`,
    () => {
      it("reproduces the missing-opening skip using actual treasury movement", async () => {
        const db = await world(native);
        const report = await advance(db);
        expect(report?.stockVsFlow.skipped).toBe(true);
        expect(report?.stockVsFlow.divergentCount).toBeNull();
      });
      it("verifies the first actual treasury movement with authored valuation", async () => {
        const db = await world(native);
        const opening = await prepareOpeningLedgerSnapshot(db, 1);
        expect(opening).toMatchObject({ turn: 1, accounts: 1, reused: false });
        const report = await advance(db);
        expect(
          (await db.collection("federalBudget").findOne({ countryId: "BG" }))?.treasuryBalance
        ).toBe(5650);
        expect(report?.stockVsFlow.skipped).toBe(false);
        expect(report?.stockVsFlow.divergentCount).toBe(0);
        expect(report?.trialBalance.status).toBe("green");
        expect(report?.unattributed).toEqual([]);
      });
      it("reuses the original snapshot and exposes an unexplained cash change on resume", async () => {
        const db = await world(native);
        const first = await prepareOpeningLedgerSnapshot(db, 1);
        const original = await db.collection("balanceSnapshots").findOne({ turn: 1 });
        await db
          .collection("federalBudget")
          .updateOne({ countryId: "BG" }, { $inc: { treasuryBalance: 2825 } });
        expect(await prepareOpeningLedgerSnapshot(db, 1)).toEqual({ ...first, reused: true });
        expect(await db.collection("balanceSnapshots").findOne({ turn: 1 })).toEqual(original);
        const report = await advance(db);
        expect(report?.stockVsFlow.skipped).toBe(false);
        expect(report?.stockVsFlow.divergentCount).toBe(1);
      });
      it("refuses advancement after a swallowed snapshot write failure", async () => {
        const db = await world(native);
        await expect(prepareOpeningLedgerSnapshot(failOpeningWrite(db, false), 1)).rejects.toThrow(
          "Missing or invalid opening cash snapshot"
        );
        expect(await db.collection("balanceSnapshots").findOne({ turn: 1 })).toBeNull();
        expect(
          (await db.collection("federalBudget").findOne({ countryId: "BG" }))?.treasuryBalance
        ).toBe(2825);
        expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
      });
      it("recovers a lost acknowledgement by reading the actual persisted snapshot", async () => {
        const db = await world(native);
        const first = await prepareOpeningLedgerSnapshot(failOpeningWrite(db, true), 1);
        expect(await prepareOpeningLedgerSnapshot(db, 1)).toEqual({ ...first, reused: true });
        const report = await advance(db);
        expect(report?.stockVsFlow.skipped).toBe(false);
        expect(report?.stockVsFlow.divergentCount).toBe(0);
      });
      it("refuses a corrupt existing snapshot without replacing it", async () => {
        const db = await world(native);
        const corrupt = {
          _id: new ObjectId(),
          turn: 1,
          balances: { "government:BG:BGL": Number.NaN },
        };
        await db.collection("balanceSnapshots").insertOne(corrupt);
        await expect(prepareOpeningLedgerSnapshot(db, 1)).rejects.toThrow(
          "invalid opening cash snapshot"
        );
        const stored = await db.collection("balanceSnapshots").findOne({ turn: 1 });
        expect(stored?._id).toEqual(corrupt._id);
        expect(stored?.balances["government:BG:BGL"]).toBeNaN();
      });
      it("distinguishes a persisted empty world from a failed capture", async () => {
        const db = await world(native, true);
        expect(await prepareOpeningLedgerSnapshot(db, 1)).toMatchObject({
          accounts: 0,
          reused: false,
        });
        const report = await advance(db);
        expect(report?.stockVsFlow.skipped).toBe(false);
        expect(report?.stockVsFlow.divergentCount).toBe(0);
      });
    }
  );
}

describe("opening clock validation", () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses invalid turn %s",
    async (turn) => {
      const db = await world(false);
      await expect(prepareOpeningLedgerSnapshot(db, turn)).rejects.toThrow("valid turn number");
      expect(await db.collection("balanceSnapshots").countDocuments()).toBe(0);
    }
  );
});
