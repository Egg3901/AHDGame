import { describe, expect, it } from "vitest";
import {
  SOE_GROWTH_MAX_CASH_SHARE,
  SOE_GROWTH_MIN_SHORTAGE,
  SOE_GROWTH_ORDER_SHARE,
  planSoeCapexGrowth,
  soeGrowthBudgetAnchor,
  type SoeGrowthSectorInput,
} from "./soeGrowth";

const sector = (over: Partial<SoeGrowthSectorInput> = {}): SoeGrowthSectorInput => ({
  id: "s1",
  sectorType: "energy",
  capitalStock: 10_000,
  pendingOrders: 0,
  unitPriceAnchor: 100,
  shortage: 2,
  ...over,
});

describe("soeGrowthBudgetAnchor", () => {
  const good = { debtPrincipal: 50, debtCeiling: 100, crisisState: "normal", cashAnchor: 1_000 };

  it("commits a bounded share of cash for a treasury in good standing", () => {
    expect(soeGrowthBudgetAnchor(good)).toBeCloseTo(1_000 * SOE_GROWTH_MAX_CASH_SHARE, 9);
  });

  it("pays nothing near the debt ceiling, past it, or in a sovereign crisis", () => {
    expect(soeGrowthBudgetAnchor({ ...good, debtPrincipal: 95 })).toBe(0);
    expect(soeGrowthBudgetAnchor({ ...good, debtPrincipal: 120 })).toBe(0);
    expect(soeGrowthBudgetAnchor({ ...good, crisisState: "default" })).toBe(0);
  });

  it("pays nothing without funded cash or a readable debt ceiling", () => {
    expect(soeGrowthBudgetAnchor({ ...good, cashAnchor: 0 })).toBe(0);
    expect(soeGrowthBudgetAnchor({ ...good, cashAnchor: -5 })).toBe(0);
    expect(soeGrowthBudgetAnchor({ ...good, debtCeiling: 0 })).toBe(0);
    expect(soeGrowthBudgetAnchor({ ...good, debtPrincipal: Number.NaN })).toBe(0);
  });
});

describe("planSoeCapexGrowth", () => {
  it("orders a fixed share of capacity for a short sector at list price", () => {
    const { growthAnchor, orders } = planSoeCapexGrowth([sector()], 1e9);
    expect(orders).toHaveLength(1);
    expect(orders[0].units).toBeCloseTo(10_000 * SOE_GROWTH_ORDER_SHARE, 9);
    expect(orders[0].costAnchor).toBeCloseTo(orders[0].units * 100, 9);
    expect(growthAnchor).toBeCloseTo(orders[0].costAnchor, 9);
  });

  it("orders nothing without a shortage", () => {
    expect(
      planSoeCapexGrowth([sector({ shortage: SOE_GROWTH_MIN_SHORTAGE - 0.01 })], 1e9).orders
    ).toHaveLength(0);
    expect(planSoeCapexGrowth([sector({ shortage: null })], 1e9).orders).toHaveLength(0);
  });

  it("orders nothing while the sector is still building, for extraction, or with no plant", () => {
    expect(planSoeCapexGrowth([sector({ pendingOrders: 1 })], 1e9).orders).toHaveLength(0);
    expect(planSoeCapexGrowth([sector({ sectorType: "extraction" })], 1e9).orders).toHaveLength(0);
    expect(planSoeCapexGrowth([sector({ capitalStock: 0 })], 1e9).orders).toHaveLength(0);
  });

  it("never plans more than the budget, serving the shortest-supplied sector first", () => {
    const sectors = [
      sector({ id: "a", shortage: 1.5 }),
      sector({ id: "b", shortage: 3 }),
      sector({ id: "c", shortage: 2 }),
    ];
    const one = 10_000 * SOE_GROWTH_ORDER_SHARE * 100;
    const { growthAnchor, orders } = planSoeCapexGrowth(sectors, one * 2.5);
    expect(orders.map((o) => o.sectorId)).toEqual(["b", "c"]);
    expect(growthAnchor).toBeLessThanOrEqual(one * 2.5);
    expect(planSoeCapexGrowth(sectors, 0).orders).toHaveLength(0);
  });
});
