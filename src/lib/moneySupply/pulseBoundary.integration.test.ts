import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { snapshotMoneySupply } from "./snapshot";
import { MONEY_ACCOUNTING_VERSION } from "./calculate";

/**
 * Snapshot-level proof for the v3 observed-M2 boundary (issue #2021).
 *
 * The raw-48/96/144 reproduction hits the six planned-economy currencies
 * (HUF, PLZ, ROL, YUD, BGL, CSK), which have no central-bank docs and reach
 * `moneySupplySnapshots` through the unbanked-budget write pass. These tests
 * run that whole path: pool spikes land in `excludedBondPoolCash`, observed
 * M2 never sees them, the v2 to v3 level drop never annualizes, and market
 * currencies keep their QE-parked and equity cash inside M2.
 */

const PLANNED = [
  { countryId: "HU", currencyCode: "HUF", spike: 4_700_000_000 },
  { countryId: "PL", currencyCode: "PLZ", spike: 6_300_000_000 },
  { countryId: "RO", currencyCode: "ROL", spike: 2_400_000_000 },
  { countryId: "YU", currencyCode: "YUD", spike: 5_500_000_000 },
  { countryId: "BG", currencyCode: "BGL", spike: 1_900_000_000 },
  { countryId: "CS", currencyCode: "CSK", spike: 3_100_000_000 },
] as const;

function world() {
  const db = createInMemoryDb();
  const snapshots = db.collection("moneySupplySnapshots");
  Object.assign(snapshots, {
    replaceOne: (
      filter: Record<string, unknown>,
      doc: Record<string, unknown>,
      options: { upsert?: boolean }
    ) => snapshots.updateOne(filter, { $set: doc }, options),
  });
  db.seed("gameConfig", [
    { _id: "default", moneySupplyEnabled: true, privateBankingEnabled: true },
  ]);
  db.seed("centralBanks", [
    { _id: "US", countryId: "US", externalBroadMoney: 1000, netMoneyCreatedLifetime: 0 },
  ]);
  db.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      treasuryBalance: 100,
      gdp: 100000,
      debt: { principal: 0 },
    },
  ]);
  return db;
}

async function observe(db: ReturnType<typeof world>, turn: number) {
  await snapshotMoneySupply(db as unknown as Db, turn);
  return db.collection("moneySupplySnapshots").docs;
}

type Docs = Array<Record<string, unknown>>;

function row(docs: Docs, id: string): Record<string, unknown> {
  const found = docs.find((entry) => entry._id === id);
  if (!found) throw new Error(`missing snapshot ${id}`);
  return found;
}

describe("pulse boundary across snapshot turns", () => {
  it("keeps multi-billion pool spikes out of observed M2 for all six planned currencies", async () => {
    const db = world();
    for (const { countryId, currencyCode } of PLANNED) {
      db.seed("federalBudget", [
        {
          _id: `budget-${countryId}`,
          countryId,
          currencyCode,
          treasuryBalance: 1000,
          gdp: 100000,
          debt: { principal: 0 },
        },
      ]);
    }
    for (const { currencyCode, spike } of PLANNED) {
      db.seed("bondMarketPools", [{ _id: currencyCode, cashLocal: spike }]);
    }
    const docs = await observe(db, 48);
    for (const { currencyCode, spike } of PLANNED) {
      const snapshot = row(docs, `48:${currencyCode}`);
      expect(snapshot.accountingVersion).toBe(MONEY_ACCOUNTING_VERSION);
      // Real economy is exactly the 1000 treasury surplus; the spike is audit only.
      expect(snapshot.m2).toBe(1000);
      expect(snapshot.observedBondPoolCash).toBe(0);
      expect(snapshot.excludedBondPoolCash).toBe(spike);
      // First observation has no comparable base, so growth is unavailable, not zero.
      expect(snapshot.annualizedM2GrowthPct).toBeNull();
    }
  });

  it("starts a new window at v3 instead of annualizing the legacy level drop", async () => {
    const db = world();
    db.seed("federalBudget", [
      {
        _id: "budget-HU",
        countryId: "HU",
        currencyCode: "HUF",
        treasuryBalance: 62_000_000,
        gdp: 100000,
        debt: { principal: 0 },
      },
    ]);
    db.seed("bondMarketPools", [{ _id: "HUF", cashLocal: 437_800_000 }]);
    // Raw-96 legacy row: M2 counted the whole 6.124B pool balance.
    db.seed("moneySupplySnapshots", [
      {
        _id: "36:HUF",
        currencyCode: "HUF",
        turn: 36,
        m2: 6_124_000_000,
        accountingVersion: 2,
        annualizedM2GrowthPct: 6_360_000,
      },
    ]);
    const first = await observe(db, 48);
    const v3 = row(first, "48:HUF");
    expect(v3.accountingVersion).toBe(MONEY_ACCOUNTING_VERSION);
    expect(v3.m2).toBe(62_000_000);
    expect(v3.excludedBondPoolCash).toBe(437_800_000);
    expect(v3.annualizedM2GrowthPct).toBeNull();
    // The legacy row stays readable and untouched.
    const legacy = row(first, "36:HUF");
    expect(legacy.m2).toBe(6_124_000_000);
    expect(legacy.accountingVersion).toBe(2);
    // One full window later the flat economy reads as flat, not destroyed.
    const second = await observe(db, 60);
    expect(row(second, "60:HUF").annualizedM2GrowthPct).toBe(0);
  });

  it("keeps QE-parked and equity cash inside M2 for a market currency", async () => {
    const db = world();
    db.seed("bondMarketPools", [{ _id: "USD", cashLocal: 1000, lifetime: { qeIn: 1000 } }]);
    db.seed("equityMarketPools", [{ _id: "USD", cashLocal: 500 }]);
    const docs = await observe(db, 0);
    const snapshot = row(docs, "0:USD");
    expect(snapshot.observedBondPoolCash).toBe(1000);
    expect(snapshot.excludedBondPoolCash).toBe(0);
    // 100 treasury surplus + 1000 external deposits + 1000 QE-parked + 500 equity.
    expect(snapshot.m2).toBe(2600);
  });
});
