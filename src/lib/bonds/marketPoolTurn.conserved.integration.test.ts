/** Conserved financing (#3381): pool liquidity is household money, never a mint. */
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";

vi.mock("@/lib/sovereignDefault/snapshotLoader", () => ({
  loadCountrySovereignSnapshots: vi.fn(async () => new Map()),
}));

import { processBondMarketPoolTurn } from "./marketPoolTurn";

function world(conserved: boolean, household: number) {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    {
      _id: "default",
      treasuryCashLedgerEnabled: true,
      ...(conserved ? { conservedSovereignFinancingEnabled: true } : {}),
    },
  ]);
  db.seed("centralBanks", [{ _id: "UK", countryId: "UK", externalBroadMoney: household }]);
  db.seed("bondMarketPools", [{ _id: "GBP", cashLocal: 100, targetCashLocal: 5, lifetime: {} }]);
  db.seed("moneySupplySnapshots", [{ _id: "GBP:583", currencyCode: "GBP", m2: 10_000, turn: 583 }]);
  db.seed("bonds", []);
  return db;
}

describe("bond market pool turn under conserved financing", () => {
  it("moves the inflow out of household money once per turn", async () => {
    const db = world(true, 1_000);
    const first = await processBondMarketPoolTurn(db as unknown as Db, 584, new Date());
    await processBondMarketPoolTurn(db as unknown as Db, 584, new Date());
    // Target 5% of 10,000 = 500; shortfall 400 -> inflow 8, debited from households.
    expect(first.inflowLocalByCurrency).toEqual({ GBP: 8 });
    expect(db.collection("bondMarketPools").docs[0]).toMatchObject({
      cashLocal: 108,
      lifetime: { householdInflowIn: 8 },
    });
    expect(db.collection("bondMarketPools").docs[0].lifetime).not.toHaveProperty("inflowIn");
    expect(db.collection("centralBanks").docs[0].externalBroadMoney).toBe(992);
  });

  it("leaves the pool short rather than minting when households cannot fund the inflow", async () => {
    const db = world(true, 3);
    const result = await processBondMarketPoolTurn(db as unknown as Db, 584, new Date());
    expect(result.inflowLocalByCurrency).toEqual({});
    expect(db.collection("bondMarketPools").docs[0].cashLocal).toBe(100);
    expect(db.collection("centralBanks").docs[0].externalBroadMoney).toBe(3);
  });

  it("keeps the existing minted inflow when the flag is absent", async () => {
    const db = world(false, 1_000);
    await processBondMarketPoolTurn(db as unknown as Db, 584, new Date());
    expect(db.collection("bondMarketPools").docs[0]).toMatchObject({
      cashLocal: 108,
      lifetime: { inflowIn: 8 },
    });
    expect(db.collection("centralBanks").docs[0].externalBroadMoney).toBe(1_000);
  });
});
