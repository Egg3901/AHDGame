/** Org-building charges reconcile through the actual treasury command. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { writeBalanceSnapshot, writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { chargeOrgBuildFunds } from "@/lib/parties/commands/chargeOrgBuildFunds";
import { loadOrgBuildLedgerContext } from "@/lib/parties/orgBuildLedger";
import { preloadNppBuildOrgSweepCache } from "@/lib/nppAutonomy/v3/party/nppBuildOrg";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const nativeEnabled = process.env.AHD_ORG_BUILD_REAL_MONGO === "1";
const NOW = new Date("2026-10-03T00:00:00Z");
let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  resetLedgerShadowFlagCache();
});

async function world(
  native: boolean,
  options: { shadow?: boolean; stateTreasury?: number; partyTreasury?: number } = {}
) {
  let db: Db;
  if (native) {
    const uri = new URL(process.env.AHD_ORG_BUILD_MONGO_URI ?? "mongodb://127.0.0.1:27018");
    if (
      uri.protocol !== "mongodb:" ||
      !["127.0.0.1", "localhost"].includes(uri.hostname) ||
      !["27018", "27020"].includes(uri.port) ||
      uri.username ||
      uri.password ||
      (uri.pathname && uri.pathname !== "/") ||
      uri.search
    )
      throw new Error("Native party fixtures require a local sandbox endpoint");
    client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1 });
    db = client.db(`ahd_sim_fixture_orgbuild_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  } else db = createInMemoryDb() as unknown as Db;
  await db
    .collection<{ _id: string; ledgerShadow: boolean }>("gameConfig")
    .insertOne({ _id: "default", ledgerShadow: options.shadow ?? true });
  await db
    .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
    .insertOne({ _id: "current", currentTurn: 2, preset: "2019-default" });
  await db.collection("exchangeRates").insertMany([
    { currencyCode: "GBP", rate: 0.5 },
    { currencyCode: "USD", rate: 1 },
  ]);
  await db
    .collection<{
      _id: string;
      countryId: string;
      stateId: string;
      partyId: string;
      treasury: number;
    }>("statePartyOrg")
    .insertOne({
      _id: "UK_LON_1",
      countryId: "UK",
      stateId: "LON",
      partyId: "1",
      treasury: options.stateTreasury ?? 1_000,
    });
  const partyId = new ObjectId();
  await db.collection("politicalParties").insertOne({
    _id: partyId,
    countryId: "US",
    sequentialId: 2,
    name: "Fixture Party",
    treasury: options.partyTreasury ?? 5_000,
  });
  vi.mocked(getDb).mockResolvedValue(db);
  return { db, partyId };
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

function stateCharge(amount: number) {
  return {
    countryId: "UK" as const,
    partyId: "1",
    scope: "state" as const,
    stateRowId: "UK_LON_1",
    amount,
    memo: "Build Org (LON)",
    turn: 2,
    now: NOW,
  };
}

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `org-building charge witnesses (${native ? "native Mongo" : "memory"})`,
    () => {
      it("witnesses a state-party charge in GBP", async () => {
        const { db } = await world(native);
        await writeBalanceSnapshot(db, 1);
        expect(await chargeOrgBuildFunds(stateCharge(300), db)).toEqual({ charged: 300 });
        await close(db, 1);
        const [entry] = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
        expect(entry.legs.map((leg) => [leg.account, leg.anchorAmount])).toEqual([
          ["state_party:UK_LON_1:GBP", -600],
          ["sink:organization_building:GBP", 600],
        ]);
      });

      it("witnesses only the capped amount a short treasury pays", async () => {
        const { db } = await world(native, { stateTreasury: 100 });
        await writeBalanceSnapshot(db, 1);
        expect(await chargeOrgBuildFunds(stateCharge(300), db)).toEqual({ charged: 100 });
        await close(db, 1);
      });

      it("witnesses a national party charge with a preloaded context", async () => {
        const { db, partyId } = await world(native);
        await writeBalanceSnapshot(db, 1);
        const context = await loadOrgBuildLedgerContext(db);
        const result = await chargeOrgBuildFunds(
          {
            countryId: "US",
            partyId: "2",
            scope: "national",
            amount: 1_200,
            memo: "Build Org (national)",
            turn: 2,
            now: NOW,
          },
          db,
          { context }
        );
        expect(result).toEqual({ charged: 1_200 });
        await close(db, 1);
        const accounts = (await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray())
          .flatMap((entry) => entry.legs)
          .map((leg) => leg.account);
        expect(accounts).toContain(`party:${partyId.toString()}:USD`);
      });

      it("publishes nothing for an overdrawn, missing or shadow-disabled charge", async () => {
        const overdrawn = await world(native, { stateTreasury: -50 });
        expect(await chargeOrgBuildFunds(stateCharge(300), overdrawn.db)).toEqual({ charged: 0 });
        expect(
          await chargeOrgBuildFunds({ ...stateCharge(300), stateRowId: "UK_MAN_1" }, overdrawn.db)
        ).toEqual({ charged: 0 });
        expect(await overdrawn.db.collection("ledgerEntries").countDocuments()).toBe(0);
        const quiet = await world(native, { shadow: false });
        expect(await chargeOrgBuildFunds(stateCharge(300), quiet.db)).toEqual({ charged: 300 });
        expect(
          await quiet.db.collection("statePartyOrg").findOne({ _id: "UK_LON_1" } as never)
        ).toMatchObject({ treasury: 700 });
        expect(await quiet.db.collection("ledgerEntries").countDocuments()).toBe(0);
      });
    }
  );
}

it("the NPP org-building sweep preloads its accounting context once", async () => {
  const { db } = await world(false);
  const cache = await preloadNppBuildOrgSweepCache(db, ["UK"]);
  expect(cache.orgBuildLedger?.rates.get("GBP")).toBe(0.5);
  const quiet = await world(false, { shadow: false });
  expect((await preloadNppBuildOrgSweepCache(quiet.db, ["UK"])).orgBuildLedger).toBeNull();
});
