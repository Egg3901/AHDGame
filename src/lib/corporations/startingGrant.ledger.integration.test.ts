/** A spawned corporation's starting treasury reconciles through the actual spawn path. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { writeBalanceSnapshot, writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { runWithLedgerTurn } from "@/lib/ledger/ledgerTurn";
import { insertCorporationWithTickerRetry } from "@/lib/corporations/tickerSymbol";
import { spawnNppCorporation } from "@/lib/admin/spawnNppCorporation";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
// Identity and CEO selection carry no cash; the corporation insert stays real.
vi.mock("@/lib/npp/generator", () => ({
  createNPP: vi.fn(async () => ({ _id: new ObjectId(), name: "Fixture NPP" })),
}));
vi.mock("@/lib/admin/nppCorpCeoSelection", () => ({
  buildCeoAffiliations: vi.fn().mockReturnValue([]),
  chooseNppCorpCeo: vi.fn().mockReturnValue({ kind: "new", party: null }),
}));
vi.mock("@/lib/db/sequentialId", () => ({ getNextSequentialId: vi.fn().mockResolvedValue(42) }));
vi.mock("@/lib/corporations/tickerSymbol", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/corporations/tickerSymbol")>();
  return {
    ...actual,
    generateTickerSymbol: vi.fn().mockResolvedValue("SPWN"),
    insertCorporationWithTickerRetry: vi.fn(actual.insertCorporationWithTickerRetry),
  };
});

const nativeEnabled = process.env.AHD_STARTING_GRANT_REAL_MONGO === "1";
let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  resetLedgerShadowFlagCache();
});

async function world(native: boolean, options: { shadow?: boolean; clock?: number } = {}) {
  let db: Db;
  if (native) {
    const uri = new URL(process.env.AHD_STARTING_GRANT_MONGO_URI ?? "mongodb://127.0.0.1:27018");
    if (
      uri.protocol !== "mongodb:" ||
      !["127.0.0.1", "localhost"].includes(uri.hostname) ||
      !["27018", "27020"].includes(uri.port) ||
      uri.username ||
      uri.password ||
      (uri.pathname && uri.pathname !== "/") ||
      uri.search
    )
      throw new Error("Native spawn fixtures require a local sandbox endpoint");
    client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1 });
    db = client.db(`ahd_sim_fixture_grant_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  } else db = createInMemoryDb() as unknown as Db;
  await db
    .collection<{ _id: string; ledgerShadow: boolean }>("gameConfig")
    .insertOne({ _id: "default", ledgerShadow: options.shadow ?? true });
  await db
    .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
    .insertOne({ _id: "current", currentTurn: options.clock ?? 1, preset: "2019-default" });
  await db.collection("exchangeRates").insertMany([
    { currencyCode: "GBP", rate: 0.5 },
    { currencyCode: "USD", rate: 1 },
  ]);
  await db.collection<{ _id: string; countryId: string }>("states").insertMany([
    { _id: "LON", countryId: "UK" },
    { _id: "CA", countryId: "US" },
  ]);
  vi.mocked(getDb).mockResolvedValue(db);
  return db;
}

async function close(db: Db, entries: number) {
  await writePreForexBalanceCheckpoint(db, 2);
  await writeBalanceSnapshot(db, 2);
  const report = await reconcileTurn(db, 2);
  expect(report?.stockVsFlow.skipped).toBe(false);
  expect(report?.stockVsFlow.divergentCount).toBe(0);
  expect(report?.trialBalance.status).toBe("green");
  expect(report?.unattributed).toEqual([]);
  expect(report?.entriesChecked).toBe(entries);
}

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `spawned corporation starting grant (${native ? "native Mongo" : "memory"})`,
    () => {
      it("witnesses the default treasury in GBP at the processing turn", async () => {
        const db = await world(native, { clock: 9 });
        await writeBalanceSnapshot(db, 1);
        // Founding inside a turn: processTurn runs it in the turn's ledger scope.
        const spawned = await runWithLedgerTurn(2, () =>
          spawnNppCorporation(db, {
            name: "Fixture Holdings",
            type: "technology",
            countryId: "UK",
            headquartersState: "LON",
            foundedAtTurn: 2,
          })
        );
        const corp = await db
          .collection("corporations")
          .findOne({ _id: new ObjectId(spawned.corporationId) });
        expect(corp?.liquidCapital).toBe(spawned.startingCapital);
        expect(corp?.liquidCurrencyCode).toBe("GBP");
        await close(db, 1);
        const [entry] = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
        expect(entry.turn).toBe(2);
        expect(entry.legs.map((leg) => [leg.account, leg.anchorAmount])).toEqual([
          [`corporation:${spawned.corporationId}:GBP`, spawned.startingCapital / 0.5],
          ["mint:corporation_starting_grant:GBP", -spawned.startingCapital / 0.5],
        ]);
      });

      it("keeps an explicit capital literal and stamps the turn the clock is accumulating", async () => {
        const db = await world(native);
        await writeBalanceSnapshot(db, 1);
        const spawned = await spawnNppCorporation(db, {
          name: "Fixture Industries",
          type: "manufacturing",
          countryId: "US",
          headquartersState: "CA",
          startingCapital: 123_456.78,
        });
        expect(spawned.startingCapital).toBe(123_456.78);
        await close(db, 1);
      });

      it("writes no ledger rows with shadow accounting off", async () => {
        const db = await world(native, { shadow: false });
        const spawned = await spawnNppCorporation(db, {
          name: "Fixture Quiet",
          type: "technology",
          countryId: "UK",
          headquartersState: "LON",
          foundedAtTurn: 2,
        });
        const corp = await db
          .collection("corporations")
          .findOne({ _id: new ObjectId(spawned.corporationId) });
        expect(corp?.liquidCapital).toBe(spawned.startingCapital);
        expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
      });

      it("publishes nothing when the corporation insert fails", async () => {
        const db = await world(native);
        vi.mocked(insertCorporationWithTickerRetry).mockRejectedValueOnce(
          new Error("insert failed")
        );
        await expect(
          spawnNppCorporation(db, {
            name: "Fixture Failure",
            type: "technology",
            countryId: "UK",
            headquartersState: "LON",
            foundedAtTurn: 2,
          })
        ).rejects.toThrow("insert failed");
        expect(await db.collection("corporations").countDocuments()).toBe(0);
        expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
      });
    }
  );
}
