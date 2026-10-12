import type { CorporateSector } from "@/lib/db/types";
import { describe, expect, it } from "vitest";
import { runInternalSupplyWorld } from "@/lib/test-utils/internalSupplyWorld";
import { processSectors } from "./sectorCalculations";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

describe("real internal supply clearing and plant-turn chain", () => {
  it("raises real factory production and books a consumed-input discount on both sides", () => {
    const baseline = runInternalSupplyWorld({ priority: "market", discount: 0 });
    const priority = runInternalSupplyWorld({ priority: "own", discount: 0 });
    const discount = runInternalSupplyWorld({ priority: "own", discount: 0.1 });
    expect(priority.updates[1]?.producedUnits).toBeGreaterThan(
      baseline.updates[1]?.producedUnits ?? 0
    );
    expect(priority.updates[1]?.throughputFactor).toBe(1);
    const consumed = discount.buyer.internalSupplyInputUnits?.get("iron") ?? 0;
    const rebate = (consumed * COMMODITY_BASE_PRICES.iron * 0.1) / TURNS_PER_DAY;
    expect(rebate).toBeGreaterThan(0);
    expect(consumed).toBeLessThan(discount.updates[1]?.internalSupplyReceipt?.received.iron ?? 0);
    expect(discount.buyer.costs - priority.buyer.costs).toBeCloseTo(-rebate, 8);
    expect(discount.seller.costs - priority.seller.costs).toBeCloseTo(rebate, 8);
    expect(discount.buyer.costs + discount.seller.costs).toBeCloseTo(
      priority.buyer.costs + priority.seller.costs,
      8
    );
    expect(discount.updates).toHaveLength(2);
    expect(discount.updates[1]?.plantsPnl?.profit).toBeCloseTo(
      (discount.buyer.hourlyRevenue - discount.buyer.costs) * TURNS_PER_DAY,
      2
    );
  });
  it("includes a fully owned subsidiary only with group priority", () => {
    const own = runInternalSupplyWorld({ priority: "own", discount: 0.1 }, { group: true });
    const group = runInternalSupplyWorld({ priority: "group", discount: 0.1 }, { group: true });
    expect(own.updates[1]?.internalSupplyReceipt?.received).toEqual({});
    expect(group.updates[1]?.internalSupplyReceipt?.received.iron).toBeGreaterThan(0);
    expect(group.updates[1]?.throughputFactor).toBe(1);
    const costs = [...(group.market.internalSupplyDiscountCostBySectorId?.values() ?? [])];
    expect(costs.reduce((n, c) => n + c, 0)).toBeCloseTo(0, 8);
  });
  it("does not give cold suppliers phantom output or discounted inputs", () => {
    const r = runInternalSupplyWorld({ priority: "own", discount: 0.1 }, { mothballed: true });
    expect(r.updates[1]?.internalSupplyReceipt?.received).toEqual({});
    expect(r.updates[0]?.plantsPnl?.internalSupplyDiscountCost).toBe(0);
  });
});

it("keeps matching discount values in anchor across different functional currencies", () => {
  const r = runInternalSupplyWorld({ priority: "group", discount: 0.1 }, { group: true, fx: 100 });
  const seller = r.updates[0]?.plantsPnl?.internalSupplyDiscountCost ?? 0;
  const buyer = r.updates[1]?.plantsPnl?.internalSupplyDiscountCost ?? 0;
  expect(seller).toBeGreaterThan(0);
  expect(buyer / 100).toBeCloseTo(-seller, 8);
  expect(r.updates[0]?.internalSupplyReceipt?.discountCostAnchor).toBeCloseTo(
    -(r.updates[1]?.internalSupplyReceipt?.discountCostAnchor ?? 0),
    8
  );
});

it("aggregates finalized discounts once into real corporation income and persisted sector writes", () => {
  const worlds = [0, 0.1].map((discount) => runInternalSupplyWorld({ priority: "own", discount }));
  const turns = worlds.map((w) =>
    processSectors(
      w.lookups,
      1000,
      new Date("2026-01-01T00:00:00Z"),
      false,
      2019,
      undefined,
      w.market
    )
  );
  expect(Number.isFinite(turns[0].totalIncomeGenerated)).toBe(true);
  expect(turns[1].totalIncomeGenerated).toBeCloseTo(turns[0].totalIncomeGenerated, 8);
  expect(turns[1].sectorOps).toHaveLength(2);
  const writes = turns[1].sectorOps.map(
    (op) => op.updateOne.update.$set as Partial<CorporateSector> | undefined
  );
  expect(writes[0]?.plantsPnl?.internalSupplyDiscountCost).toBeGreaterThan(0);
  expect(writes[1]?.plantsPnl?.internalSupplyDiscountCost).toBeLessThan(0);
  expect(turns[1].corpSnapshots[0].income).toBeCloseTo(turns[0].corpSnapshots[0].income, 8);
});

describe("automatic NPP Group Chain discount integration", () => {
  it.each([0.05, 0.2, 0.35])(
    "settles %s discounts on real consumed inputs with matching charges",
    (discount) => {
      const options = { group: true, coordinationDiscount: 0 };
      const base = runInternalSupplyWorld({ priority: "market", discount: 0 }, options);
      const discounted = runInternalSupplyWorld(
        { priority: "market", discount: 0 },
        { ...options, coordinationDiscount: discount }
      );
      expect(discounted.market.groupSupplyReceipts?.length).toBeGreaterThan(0);
      const costs = discounted.market.internalSupplyDiscountCostBySectorId!;
      expect(costs.size).toBe(2);
      const supplierCharge = [...costs.values()].find((c) => c > 0)!;
      expect(supplierCharge).toBeGreaterThan(0);
      expect(discounted.seller.costs - base.seller.costs).toBeCloseTo(supplierCharge, 8);
      expect(discounted.buyer.costs - base.buyer.costs).toBeCloseTo(-supplierCharge, 8);
      expect(discounted.seller.hourlyRevenue).toBe(base.seller.hourlyRevenue);
      expect([...costs.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
      expect(discounted.updates[0]?.plantsPnl?.internalSupplyDiscountCost).toBeGreaterThan(0);
      expect(discounted.updates[1]?.plantsPnl?.internalSupplyDiscountCost).toBeLessThan(0);
      expect(discounted.market.internalSupplyTrades).toBeUndefined();
    }
  );
  it("cannot rebate a cold Group supplier", () => {
    const world = runInternalSupplyWorld(
      { priority: "market", discount: 0 },
      { group: true, coordinationDiscount: 0.35, mothballed: true }
    );
    expect(world.market.groupSupplyReceipts).toEqual([]);
    expect(world.updates.every((s) => !s.plantsPnl?.internalSupplyDiscountCost)).toBe(true);
  });
});

it.each([0.01, 100])(
  "preserves matched Group discount accounting at era unit scale %s",
  (eraScale) => {
    const options = { group: true, coordinationDiscount: 0.35, eraScale };
    const r = runInternalSupplyWorld({ priority: "market", discount: 0 }, options);
    const costs = [...(r.market.internalSupplyDiscountCostBySectorId?.values() ?? [])];
    expect(costs.length).toBe(2);
    expect(costs.some((c) => c > 0)).toBe(true);
    expect(costs.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
  }
);
