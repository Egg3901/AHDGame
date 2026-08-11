/**
 * Directed credit, floored at capacity replacement (plants tier).
 *
 * The Gosbank tranche is an allocation of a posture-scaled budget, so a
 * restrained credit posture funded well under one turn of physical wear and a
 * command SOE's plant decayed one-way — while the treasury backstop refused to
 * pay for capex (correctly: that is the P3b exploit) and the private,
 * cash-rationed NPP reinvestment path excludes state enterprises. Directed
 * credit is the command economy's capex channel; these tests pin that it is
 * always at least big enough to replace what wore out, and that the extra is
 * paid for in issuance rather than conjured.
 */
import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { processCommandEconomyTurn } from "./commandEconomyTurn";
import { soeCapacityReplacementCostAnchor } from "@/lib/economy/soe";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";

const YEAR = 1953;
const CORP_ID = new ObjectId();
const STOCK = 20_000;

/** RU is a planned economy in the 1953 schedule; the SOE overlay makes it a Gosbank client. */
const CORP = {
  _id: CORP_ID,
  countryId: "RU",
  soe: {
    sector: "manufacturing",
    capacity: 1_000,
    output: 900,
    planTarget: 1_000,
    efficiency: 1,
    cumulativeLosses: 0,
    directorId: null,
  },
};

const SECTOR = {
  _id: new ObjectId(),
  corporationId: CORP_ID,
  sectorType: "manufacturing",
  stateId: "CEN",
  countryId: "RU",
  revenue: 1_000,
  realizedRevenue: 900,
  capitalStock: STOCK,
};

type Captured = {
  sectorBulk: Array<{
    updateOne: { filter: unknown; update: { $inc?: { capitalStock?: number } } };
  }>;
  budgetSets: Array<Record<string, unknown>>;
};

function makeDb(creditAggressiveness: number): { db: Db; captured: Captured } {
  const captured: Captured = { sectorBulk: [], budgetSets: [] };
  const budget = {
    _id: new ObjectId(),
    countryId: "RU",
    economicFactors: {
      gdpGrowth: 4,
      wageGrowth: 10,
      inflationRate: 3,
      tradeGrowth: 2,
      lastUpdated: new Date(),
      gosbankDirective: { creditAggressiveness },
    },
  };
  const empty = {
    find: () => ({ toArray: async () => [] }),
    findOne: async () => null,
    bulkWrite: async () => ({}),
    updateOne: async () => ({ matchedCount: 0 }),
  };
  const db = {
    collection: (name: string) => {
      switch (name) {
        case "gameConfig":
          return {
            findOne: async () => ({
              commandEconomyEnabled: true,
              marketSystemMode: "plants",
            }),
          };
        case "federalBudget":
          return {
            find: () => ({ toArray: async () => [budget] }),
            updateOne: async (_f: unknown, u: { $set: Record<string, unknown> }) => {
              captured.budgetSets.push(u.$set);
              return { matchedCount: 1 };
            },
          };
        case "corporations":
          return {
            find: () => ({ toArray: async () => [CORP] }),
            bulkWrite: async () => ({}),
          };
        case "corporateSectors":
          return {
            find: () => ({ toArray: async () => [SECTOR] }),
            bulkWrite: async (ops: Captured["sectorBulk"]) => {
              captured.sectorBulk.push(...ops);
              return {};
            },
          };
        default:
          return empty;
      }
    },
  } as unknown as Db;
  return { db, captured };
}

describe("directed credit — capacity replacement floor", () => {
  it("a restrained posture still buys back everything that wore out", async () => {
    // creditAggressiveness 0 ⇒ the posture-scaled budget is ZERO. Before the
    // floor this SOE received nothing and its plant shrank every turn forever.
    const { db, captured } = makeDb(0);
    await processCommandEconomyTurn(db, 1, YEAR);

    const inc = captured.sectorBulk[0]?.updateOne.update.$inc?.capitalStock;
    expect(inc).toBeDefined();
    expect(inc!).toBeCloseTo(STOCK * CAPITAL_DEPRECIATION_PER_TURN, 6);
  });

  it("the floored credit is PAID FOR — its unbacked share prints, like any tranche", async () => {
    const { db, captured } = makeDb(0);
    await processCommandEconomyTurn(db, 1, YEAR);

    const issuance = captured.budgetSets[0]?.["economicFactors.directedCreditIssuance"] as number;
    // A zero-aggressiveness budget would have issued nothing; the floor is real
    // credit, so it shows up in issuance (and therefore in the overhang).
    expect(issuance).toBeGreaterThan(0);
  });

  it("ANTI-EXPLOIT: the floor can only hold capacity flat, never grow it", async () => {
    const { db, captured } = makeDb(0);
    await processCommandEconomyTurn(db, 1, YEAR);

    const inc = captured.sectorBulk[0]!.updateOne.update.$inc!.capitalStock!;
    // Units bought == units worn out. `capitalStock` is unchanged net of
    // depreciation, so no amount of restraint or plan-shortfall can make the
    // floor fund growth.
    expect(inc).toBeLessThanOrEqual(STOCK * CAPITAL_DEPRECIATION_PER_TURN + 1e-6);
    // And it is priced at the standing list price, not discounted.
    expect(soeCapacityReplacementCostAnchor([SECTOR as never], YEAR, 1)).toBeGreaterThan(0);
  });

  it("reports the upkeep slice separately, so a zero-credit chair can see why the presses run", async () => {
    // The complaint this answers: set credit to zero, watch issuance stay
    // positive, conclude the lever is broken. It is not broken, it governs
    // investment and upkeep is not investment — but that is only defensible if
    // the upkeep bill is on screen next to the issuance it explains.
    const { db, captured } = makeDb(0);
    await processCommandEconomyTurn(db, 1, YEAR);

    const upkeep = captured.budgetSets[0]?.["economicFactors.directedCreditUpkeep"] as number;
    const issuance = captured.budgetSets[0]?.["economicFactors.directedCreditIssuance"] as number;
    // At zero aggressiveness the investment budget is zero, so the upkeep floor
    // is the WHOLE of the credit and accounts for the whole of the issuance.
    expect(upkeep).toBeGreaterThan(0);
    expect(upkeep).toBeCloseTo(soeCapacityReplacementCostAnchor([SECTOR as never], YEAR, 1), 0);
    expect(issuance).toBeGreaterThan(0);
    expect(issuance).toBeLessThanOrEqual(upkeep);
  });

  it("an aggressive posture is unchanged — the floor only lifts, never caps", async () => {
    const { db, captured } = makeDb(1);
    await processCommandEconomyTurn(db, 1, YEAR);
    const inc = captured.sectorBulk[0]!.updateOne.update.$inc!.capitalStock!;
    expect(inc).toBeGreaterThanOrEqual(STOCK * CAPITAL_DEPRECIATION_PER_TURN);
  });
});
