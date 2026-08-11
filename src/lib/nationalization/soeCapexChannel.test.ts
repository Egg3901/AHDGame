import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { buildSoeCapexGrant, processSoeOperations } from "./soeOperations";
import { soeCapacityReplacementCostAnchor } from "@/lib/economy/soe";
import { capacityPricePerUnit } from "@/lib/constants/capacityEconomy";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";

/**
 * THE STATE CAPEX CHANNEL.
 *
 * A state enterprise funds capacity from state channels, not by draining its
 * own operating cash. Two channels exist, and each is bounded at exactly one
 * turn of depreciation replacement so neither can grow the enterprise:
 *
 *   • command economies — the Gosbank directed-credit tranche, floored at
 *     replacement in `commandEconomyTurn`;
 *   • every other state-owned corp — the budgeted grant here, paid by the
 *     owning treasury.
 */

const YEAR = 1953;
const CORP_ID = new ObjectId();
const COMMAND_CORP_ID = new ObjectId();

function makeSector(
  corporationId: ObjectId,
  capitalStock: number,
  overrides: Partial<CorporateSector> = {}
): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId,
    stateId: "US-CA",
    countryId: "US",
    sectorType: "manufacturing",
    revenue: 1_000,
    realizedRevenue: 1_000,
    profitMargin: 12,
    capitalStock,
    createdAt: new Date(),
    ...overrides,
  } as unknown as CorporateSector;
}

describe("buildSoeCapexGrant", () => {
  it("buys back EXACTLY this turn's depreciation, so capital stock stays flat", () => {
    const stock = 10_000;
    const sector = makeSector(CORP_ID, stock);
    const { grantAnchor, buys } = buildSoeCapexGrant([sector], YEAR, 1);

    expect(buys).toHaveLength(1);
    // The anti-free-build invariant: units bought == units worn out.
    expect(buys[0].unitsAdded).toBeCloseTo(stock * CAPITAL_DEPRECIATION_PER_TURN, 9);
    expect(grantAnchor).toBeCloseTo(
      stock * CAPITAL_DEPRECIATION_PER_TURN * capacityPricePerUnit("manufacturing", YEAR, 1),
      6
    );
  });

  it("agrees with soeCapacityReplacementCostAnchor over the same sectors", () => {
    const sectors = [makeSector(CORP_ID, 4_000), makeSector(CORP_ID, 1_900)];
    expect(buildSoeCapexGrant(sectors, YEAR, 1).grantAnchor).toBeCloseTo(
      soeCapacityReplacementCostAnchor(sectors, YEAR, 1),
      6
    );
  });

  it("ANTI-EXPLOIT: an outstanding build queue does not change what the state pays", () => {
    const plain = makeSector(CORP_ID, 10_000);
    const withGiantOrder = makeSector(CORP_ID, 10_000, {
      buildQueue: Array.from({ length: 20 }, (_, i) => ({
        units: 1_000_000,
        startTurn: i,
      })),
      constructionInProgressAnchor: 999_999_999,
    } as unknown as Partial<CorporateSector>);

    expect(buildSoeCapexGrant([withGiantOrder], YEAR, 1).grantAnchor).toBeCloseTo(
      buildSoeCapexGrant([plain], YEAR, 1).grantAnchor,
      9
    );
  });

  it("grants nothing for a sector with no capacity (founding is policy, not maintenance)", () => {
    expect(buildSoeCapexGrant([makeSector(CORP_ID, 0)], YEAR, 1).grantAnchor).toBe(0);
    expect(buildSoeCapexGrant([], YEAR, 1).buys).toHaveLength(0);
  });

  it("raises the PAID basis by exactly what was paid (exits cannot mint)", () => {
    const sector = makeSector(CORP_ID, 10_000, {
      capacityBookAnchor: 1_234_567,
    } as Partial<CorporateSector>);
    const { buys } = buildSoeCapexGrant([sector], YEAR, 1);
    expect(buys[0].nextBookAnchor).toBeCloseTo(1_234_567 + buys[0].costAnchor, 6);
  });
});

// ── The wiring: treasury pays, the enterprise receives plant ────────────────

type Written = {
  sectorBulk: Array<{ updateOne: { filter: { _id: ObjectId }; update: Record<string, unknown> } }>;
  budgetIncs: Array<{ filter: unknown; update: Record<string, unknown> }>;
  corpBulk: unknown[];
};

function makeCorp(id: ObjectId, overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: id,
    name: "State Steel",
    countryId: "US",
    countryOwnerId: "US",
    type: "manufacturing",
    liquidCapital: 0,
    createdAt: new Date(),
    ...overrides,
  } as unknown as Corporation;
}

function makeDb(corps: Corporation[], sectors: CorporateSector[]): { db: Db; written: Written } {
  const written: Written = { sectorBulk: [], budgetIncs: [], corpBulk: [] };
  const db = {
    collection: (name: string) => {
      switch (name) {
        case "gameConfig":
          return { findOne: async () => ({ marketSystemMode: "plants" }) };
        case "corporations":
          return {
            find: () => ({ toArray: async () => corps }),
            bulkWrite: async (ops: unknown[]) => {
              written.corpBulk.push(...ops);
              return {};
            },
            updateOne: async () => ({ matchedCount: 1 }),
          };
        case "corporateSectors":
          return {
            find: () => ({ toArray: async () => sectors }),
            bulkWrite: async (ops: Written["sectorBulk"]) => {
              written.sectorBulk.push(...ops);
              return {};
            },
          };
        case "exchangeRates":
          return { find: () => ({ toArray: async () => [] }) };
        case "federalBudget":
          return {
            updateOne: async (filter: unknown, update: Record<string, unknown>) => {
              written.budgetIncs.push({ filter, update });
              return { matchedCount: 1 };
            },
            findOne: async () => null,
          };
        // Mandate / metric surfaces — nothing seeded, so these are all empty.
        case "macroMetrics":
        case "politicalMetrics":
        case "states":
        case "regionDemographics":
          return {
            find: () => ({ toArray: async () => [] }),
            findOne: async () => null,
            bulkWrite: async () => ({}),
            updateOne: async () => ({ matchedCount: 0 }),
          };
        default:
          return {
            find: () => ({ toArray: async () => [] }),
            findOne: async () => null,
            bulkWrite: async () => ({}),
            updateOne: async () => ({ matchedCount: 0 }),
          };
      }
    },
  } as unknown as Db;
  return { db, written };
}

describe("processSoeOperations — state capex grant", () => {
  it("buys the replacement capacity and debits the owning treasury for it", async () => {
    const sector = makeSector(CORP_ID, 10_000);
    const { db, written } = makeDb([makeCorp(CORP_ID)], [sector]);

    await processSoeOperations(db, new Date(), YEAR);

    const buy = written.sectorBulk.find(
      (op) => String(op.updateOne.filter._id) === String(sector._id)
    );
    expect(buy).toBeDefined();
    const inc = (buy!.updateOne.update as { $inc: { capitalStock: number } }).$inc;
    expect(inc.capitalStock).toBeCloseTo(10_000 * CAPITAL_DEPRECIATION_PER_TURN, 9);

    // The state PAYS — visibly, on the same signed treasury balance every other
    // government flow moves.
    const expectedAnchor = soeCapacityReplacementCostAnchor([sector], YEAR, 1);
    const debit = written.budgetIncs.find(
      (b) => (b.update as { $inc?: { treasuryBalance?: number } }).$inc?.treasuryBalance != null
    );
    expect(debit).toBeDefined();
    const moved = (debit!.update as { $inc: { treasuryBalance: number } }).$inc.treasuryBalance;
    expect(moved).toBeLessThan(0);
    expect(-moved).toBeCloseTo(Math.round(expectedAnchor), 0);
  });

  it("does NOT double-fund a command SOE (the Gosbank already replaces its wear)", async () => {
    const sector = makeSector(COMMAND_CORP_ID, 10_000);
    const commandCorp = makeCorp(COMMAND_CORP_ID, {
      soe: {
        sector: "manufacturing",
        capacity: 1,
        output: 1,
        planTarget: 1,
        efficiency: 1,
        cumulativeLosses: 0,
        directorId: null,
      },
    } as unknown as Partial<Corporation>);
    const { db, written } = makeDb([commandCorp], [sector]);

    await processSoeOperations(db, new Date(), YEAR);

    expect(written.sectorBulk).toHaveLength(0);
    expect(
      written.budgetIncs.filter(
        (b) => (b.update as { $inc?: { treasuryBalance?: number } }).$inc?.treasuryBalance != null
      )
    ).toHaveLength(0);
  });

  it("never grants capacity a state enterprise does not already own", async () => {
    // No capital stock ⇒ no wear ⇒ no grant. An SOE cannot conjure a plant.
    const { db, written } = makeDb([makeCorp(CORP_ID)], [makeSector(CORP_ID, 0)]);
    await processSoeOperations(db, new Date(), YEAR);
    expect(written.sectorBulk).toHaveLength(0);
  });
});
