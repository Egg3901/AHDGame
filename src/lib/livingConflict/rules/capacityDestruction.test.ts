import { describe, expect, it } from "vitest";
import {
  YUGOSLAV_ESCALATION_CAPACITY_DESTRUCTION,
  annualRepairSpendingAt,
  capacityObligationId,
  foldCapacityLedger,
  outstandingCapitalAt,
  planCapacityDestruction,
  proxyInfrastructureDamage,
  realizedInfrastructurePoints,
  repairProgress,
  repairedCapitalAt,
  validateCapacityDestructionSpec,
} from "./capacityDestruction";
import { CAPITAL_SHARE } from "@/lib/metricEngine/potentialGrowth";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { CapacityDestructionSpec } from "@/lib/db/types/conflictCapacity";

const spec: CapacityDestructionSpec = {
  regions: [
    { regionId: "A", capitalShare: 0.01 },
    { regionId: "B", capitalShare: 0.02 },
  ],
  maxOutstandingShare: 0.1,
  repairTurns: 10,
  repairCostMultiplier: 1,
};
const regions = [
  { regionId: "A", countryId: "YU", capitalStock: 1000, outstandingCapital: 0 },
  { regionId: "B", countryId: "YU", capitalStock: 2000, outstandingCapital: 0 },
];

describe("capacity destruction spec", () => {
  it("accepts the authored Yugoslav escalation spec", () => {
    expect(() =>
      validateCapacityDestructionSpec(YUGOSLAV_ESCALATION_CAPACITY_DESTRUCTION)
    ).not.toThrow();
  });

  it.each([
    ["no regions", { ...spec, regions: [] }],
    ["repeated region", { ...spec, regions: [spec.regions[0], spec.regions[0]] }],
    ["share above ceiling", { ...spec, regions: [{ regionId: "A", capitalShare: 0.5 }] }],
    ["zero share", { ...spec, regions: [{ regionId: "A", capitalShare: 0 }] }],
    ["outstanding ceiling", { ...spec, maxOutstandingShare: 0.9 }],
    ["fractional repair turns", { ...spec, repairTurns: 1.5 }],
    ["zero repair turns", { ...spec, repairTurns: 0 }],
    ["cost multiplier", { ...spec, repairCostMultiplier: 10 }],
  ])("rejects %s", (_name, bad) => {
    expect(() => validateCapacityDestructionSpec(bad as CapacityDestructionSpec)).toThrow();
  });
});

describe("planCapacityDestruction", () => {
  it("destroys the authored share of each named region once, with stable ids", () => {
    const plan = planCapacityDestruction({ spec, conflictKey: "c", resolutionId: "r1", regions });
    expect(plan.obligations.map((o) => [o.regionId, o.destroyedCapital])).toEqual([
      ["A", 10],
      ["B", 40],
    ]);
    expect(plan.obligations[0]._id).toBe(capacityObligationId("c", "r1", "A"));
    expect(plan.summary.realizedFraction).toBe(1);
    expect(plan.summary.skipped).toEqual([]);
  });

  it("reports unmodeled and stockless regions instead of charging elsewhere", () => {
    const plan = planCapacityDestruction({
      spec,
      conflictKey: "c",
      resolutionId: "r1",
      regions: [{ ...regions[0], capitalStock: 0 }],
    });
    expect(plan.obligations).toEqual([]);
    expect(plan.summary.skipped).toEqual([
      { regionId: "A", reason: "no_capital_stock" },
      { regionId: "B", reason: "region_not_modeled" },
    ]);
    expect(plan.summary.realizedFraction).toBe(0);
  });

  it("caps unrepaired damage at the outstanding ceiling", () => {
    const plan = planCapacityDestruction({
      spec,
      conflictKey: "c",
      resolutionId: "r2",
      regions: [{ ...regions[0], outstandingCapital: 95 }, regions[1]],
    });
    // A has 100 of headroom in total (10% of 1000) and 95 already outstanding.
    expect(plan.obligations.find((o) => o.regionId === "A")?.destroyedCapital).toBe(5);
    expect(plan.summary.realizedFraction).toBeLessThan(1);
    expect(plan.summary.realizedFraction).toBeGreaterThan(0.5);
  });

  it("skips a region already at the ceiling", () => {
    const plan = planCapacityDestruction({
      spec,
      conflictKey: "c",
      resolutionId: "r3",
      regions: [{ ...regions[0], outstandingCapital: 100 }, regions[1]],
    });
    expect(plan.summary.skipped).toEqual([{ regionId: "A", reason: "outstanding_ceiling" }]);
  });
});

describe("repair schedule", () => {
  const obligation = {
    createdTurn: 100,
    destroyedCapital: 100,
    repairTurns: 10,
    repairCostMultiplier: 2,
  };

  it("repairs in equal installments after the damage turn", () => {
    expect(repairProgress(obligation, 100)).toBe(0);
    expect(repairProgress(obligation, 105)).toBe(0.5);
    expect(repairProgress(obligation, 110)).toBe(1);
    expect(repairProgress(obligation, 500)).toBe(1);
    expect(repairedCapitalAt(obligation, 105)).toBe(50);
  });

  it("charges the budget only on installment turns, at replacement cost", () => {
    expect(annualRepairSpendingAt(obligation, 100)).toBe(0);
    expect(annualRepairSpendingAt(obligation, 101)).toBe(
      Math.round((100 / 10) * 1_000_000 * 2 * TURNS_PER_YEAR)
    );
    expect(annualRepairSpendingAt(obligation, 110)).toBeGreaterThan(0);
    expect(annualRepairSpendingAt(obligation, 111)).toBe(0);
  });

  it("spends exactly the cost of the capital rebuilt over the schedule", () => {
    let spent = 0;
    for (let turn = 100; turn <= 130; turn++)
      spent += annualRepairSpendingAt(obligation, turn) / TURNS_PER_YEAR;
    expect(spent).toBe(100 * 1_000_000 * 2);
  });

  it("sums outstanding damage across obligations", () => {
    expect(outstandingCapitalAt([obligation, obligation], 105)).toBe(100);
    expect(outstandingCapitalAt([obligation], 200)).toBe(0);
  });
});

describe("foldCapacityLedger", () => {
  const entry = (funded: number) => ({ id: "o1", destroyedCapital: 100, fundedCapital: funded });

  it("removes destroyed capital once and scales output through the production function", () => {
    const first = foldCapacityLedger({
      capitalStock: 1000,
      gdp: 300,
      entries: [entry(0)],
      applied: undefined,
    });
    expect(first.capitalStock).toBe(900);
    expect(first.gdp).toBeCloseTo(300 * Math.pow(0.9, CAPITAL_SHARE), 10);
    // The same turn replayed from the persisted ledger changes nothing.
    const replay = foldCapacityLedger({
      capitalStock: first.capitalStock,
      gdp: first.gdp,
      entries: [entry(0)],
      applied: first.applied,
    });
    expect(replay.capitalStock).toBe(900);
    expect(replay.gdp).toBe(first.gdp);
    expect(replay.capitalDelta).toBe(0);
  });

  it("returns only funded capital, and conserves the stock when fully repaired", () => {
    let stock = 1000;
    let gdp = 300;
    let applied: Parameters<typeof foldCapacityLedger>[0]["applied"];
    for (const funded of [0, 40, 40, 100, 100]) {
      const step = foldCapacityLedger({
        capitalStock: stock,
        gdp,
        entries: [entry(funded)],
        applied,
      });
      stock = step.capitalStock;
      gdp = step.gdp;
      applied = step.applied;
    }
    expect(stock).toBeCloseTo(1000, 9);
    expect(gdp).toBeCloseTo(300, 9);
  });

  it("never lets funded repair exceed the destruction", () => {
    const step = foldCapacityLedger({
      capitalStock: 900,
      gdp: 300,
      entries: [entry(500)],
      applied: { o1: { destroyed: 100, repaired: 0 } },
    });
    expect(step.capitalStock).toBe(1000);
    expect(step.settledIds).toEqual(["o1"]);
  });
});

describe("infrastructure proxy netting", () => {
  it("nets out only the share that landed on modeled regions", () => {
    expect(realizedInfrastructurePoints(10, 18, 1)).toBe(8);
    expect(realizedInfrastructurePoints(10, 18, 0.5)).toBe(4);
    expect(realizedInfrastructurePoints(10, 18, 0)).toBe(0);
    expect(realizedInfrastructurePoints(10, 6, 1)).toBe(0);
  });

  it("charges the proxy only for the unrealized remainder", () => {
    expect(proxyInfrastructureDamage(18, 8)).toBe(10);
    expect(proxyInfrastructureDamage(5, 8)).toBe(0);
    expect(proxyInfrastructureDamage(18, undefined)).toBe(18);
  });
});
