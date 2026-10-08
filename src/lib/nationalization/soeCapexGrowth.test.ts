import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processSoeOperations } from "./soeOperations";
import { loadTreasuryCashContext } from "./treasuryLedger";
import { SOE_GROWTH_ORDER_SHARE } from "./rules/soeGrowth";
import { CAPACITY_BUILD_TURNS } from "@/lib/constants/capacityEconomy";

/**
 * State capex GROWTH (on top of the depreciation replacement): funded from the
 * owning treasury through the same settlement, only where the sector's market
 * is short, bounded per order and by the treasury's standing.
 */

const NOW = new Date("2026-10-08T00:00:00Z");
const TURN = 34;
const STOCK = 10_000;
const CORP = new ObjectId("650000000000000000004001");
const SECTOR = new ObjectId("650000000000000000004002");

function world(opts: {
  priceRatio?: number;
  cash?: number;
  debt?: number;
  ceiling?: number;
  buildQueue?: unknown[];
}) {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    { _id: "default", marketSystemMode: "plants", treasuryCashLedgerEnabled: true },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "1991-default" }]);
  db.seed("exchangeRates", [{ currencyCode: "GBP", rate: 1 }]);
  db.seed("federalBudget", [
    {
      _id: "UK",
      countryId: "UK",
      currencyCode: "GBP",
      treasuryBalance: 1_000_000_000_000,
      treasuryCashLocal: opts.cash ?? 1_000_000_000_000,
      debt: { principal: opts.debt ?? 100, interestRate: 0.02, ceiling: opts.ceiling ?? 1_000 },
      sovereignCrisisState: "normal",
    },
  ]);
  const ratio = opts.priceRatio ?? 2;
  db.seed("commodityPrices", [
    {
      _id: "energy",
      commodity: "energy",
      basePrice: 100,
      globalPrice: 100 * ratio,
      globalSupply: 100,
      globalDemand: 100,
      nationalPrices: { UK: 100 * ratio },
    },
  ]);
  db.seed("corporations", [
    {
      _id: CORP,
      name: "State Power",
      countryId: "UK",
      countryOwnerId: "UK",
      type: "energy",
      liquidCapital: 1_000,
      createdAt: NOW,
    },
  ]);
  db.seed("corporateSectors", [
    {
      _id: SECTOR,
      corporationId: CORP,
      countryId: "UK",
      stateId: "UK-X",
      sectorType: "energy",
      revenue: 1_000,
      profitMargin: 10,
      capitalStock: STOCK,
      ...(opts.buildQueue ? { buildQueue: opts.buildQueue } : {}),
      createdAt: NOW,
    },
  ]);
  return db;
}

type Db0 = ReturnType<typeof createInMemoryDb>;

async function run(db: Db0) {
  const context = await loadTreasuryCashContext(db as unknown as Db, TURN);
  return processSoeOperations(db as unknown as Db, NOW, 1991, undefined, { context });
}

const sectorDoc = (db: Db0) =>
  db.collection("corporateSectors").docs[0] as {
    capitalStock: number;
    buildQueue?: Array<{ unitsOrdered: number; costPaidAnchor: number; onlineTurn: number }>;
  };
const cash = (db: Db0) => db.collection("federalBudget").docs[0] as { treasuryCashLocal: number };

const depreciationOnlyStock = STOCK * (1 + 0.0005);

describe("state capex growth", () => {
  it("queues a funded growth order when the sector's market is short", async () => {
    const db = world({});
    await run(db);

    const s = sectorDoc(db);
    // Replacement still lands instantly, growth does NOT: it is a build order.
    expect(s.capitalStock).toBeCloseTo(depreciationOnlyStock, 6);
    expect(s.buildQueue).toHaveLength(1);
    expect(s.buildQueue![0].unitsOrdered).toBeCloseTo(STOCK * SOE_GROWTH_ORDER_SHARE, 6);
    expect(s.buildQueue![0].onlineTurn).toBe(TURN + CAPACITY_BUILD_TURNS("energy"));
    expect(s.buildQueue![0].costPaidAnchor).toBeGreaterThan(0);
  });

  it("conserves money: the treasury pays exactly replacement plus the order, nothing minted", async () => {
    const db = world({});
    const before = cash(db).treasuryCashLocal;
    await run(db);
    const s = sectorDoc(db);
    const paid = before - cash(db).treasuryCashLocal;
    const replacement =
      STOCK * 0.0005 * (s.buildQueue![0].costPaidAnchor / s.buildQueue![0].unitsOrdered);
    expect(paid).toBeGreaterThan(0);
    // Whole-currency rounding on each of the two settlements.
    expect(Math.abs(paid - (replacement + s.buildQueue![0].costPaidAnchor))).toBeLessThan(2);
    const budget = db.collection("federalBudget").docs[0] as { treasuryBalance: number };
    expect(1_000_000_000_000 - budget.treasuryBalance).toBe(paid);
  });

  it("buys depreciation only when the market is not short", async () => {
    const db = world({ priceRatio: 1 });
    await run(db);
    expect(sectorDoc(db).buildQueue ?? []).toHaveLength(0);
    expect(sectorDoc(db).capitalStock).toBeCloseTo(depreciationOnlyStock, 6);
  });

  it("buys depreciation only when the debt is near its ceiling", async () => {
    const db = world({ debt: 950, ceiling: 1_000 });
    await run(db);
    expect(sectorDoc(db).buildQueue ?? []).toHaveLength(0);
    expect(sectorDoc(db).capitalStock).toBeCloseTo(depreciationOnlyStock, 6);
  });

  it("refuses growth the treasury cannot cover and still pays the replacement", async () => {
    // Enough cash for the replacement, far too little for a 5% order.
    const probe = world({});
    await run(probe);
    const replacementPaid =
      1_000_000_000_000 -
      cash(probe).treasuryCashLocal -
      sectorDoc(probe).buildQueue![0].costPaidAnchor;
    const db = world({ cash: Math.ceil(replacementPaid) + 5 });
    await run(db);
    expect(sectorDoc(db).buildQueue ?? []).toHaveLength(0);
    expect(sectorDoc(db).capitalStock).toBeCloseTo(depreciationOnlyStock, 6);
  });

  it("does not stack a second order while one is still building", async () => {
    const pending = [
      { unitsOrdered: 50, costPaidAnchor: 5_000, startTurn: 10, onlineTurn: 100, smooth: true },
    ];
    const db = world({ buildQueue: pending });
    await run(db);
    expect(sectorDoc(db).buildQueue).toHaveLength(1);
  });

  it("a retry of the same turn neither double-pays nor double-queues", async () => {
    const db = world({});
    await run(db);
    const after = cash(db).treasuryCashLocal;
    await run(db);
    expect(sectorDoc(db).buildQueue).toHaveLength(1);
    expect(cash(db).treasuryCashLocal).toBe(after);
  });
});
