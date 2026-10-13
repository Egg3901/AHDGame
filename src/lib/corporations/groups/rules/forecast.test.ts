import { describe, it, expect } from "vitest";
import { coordinationFixture } from "./testFixtures";
import { estimateGroupSupply, type GroupForecastBasis } from "./forecast";
describe("participation-sensitive market estimates", () => {
  it("recomputes group and corporation differences on opt-out", () => {
    const f = coordinationFixture();
    const basis: GroupForecastBasis = {
      turn: 10,
      rootId: "r",
      memberIds: ["s", "b"],
      cashByMember: { s: 1000, b: 1000 },
      complete: true,
      books: [{ ...f, sellers: f.sellers.map((s) => ({ ...s, openFill: 0.5, quoteFactor: 1.2 })) }],
    };
    const on = estimateGroupSupply(basis, f.members, 11)!;
    expect(on.total.revenueDifference).toBeCloseTo(80);
    expect(on.total.internalTradingValue).toBe(200);
    f.members[1].preference!.enabled = false;
    const off = estimateGroupSupply(basis, f.members, 11)!;
    expect(off.total.revenueDifference).toBe(0);
    expect(off.total.internalTradingValue).toBe(0);
  });
  it("includes the buyer benchmark price difference and preserves corporate sums", () => {
    const f = coordinationFixture();
    f.buyers[0].publicPriceFactor = 0.8;
    const basis: GroupForecastBasis = {
      turn: 10,
      rootId: "r",
      memberIds: ["s", "b"],
      cashByMember: {},
      complete: true,
      books: [
        {
          ...f,
          benchmarkFactor: 1,
          sellers: f.sellers.map((s) => ({ ...s, openFill: 1, quoteFactor: 1 })),
        },
      ],
    };
    const result = estimateGroupSupply(basis, f.members, 11)!;
    expect(result.total.revenueDifference).toBe(0);
    expect(result.total.operatingProfitDifference).toBeCloseTo(-40);
    expect(result.corporations.reduce((n, c) => n + c.operatingProfitDifference, 0)).toBe(
      result.total.operatingProfitDifference
    );
    basis.complete = false;
    expect(estimateGroupSupply(basis, f.members, 11)).toBeNull();
    basis.complete = true;
    expect(estimateGroupSupply(basis, f.members.slice(0, 1), 11)).toBeNull();
  });
});

it("recalculates saved discounts without inventing group profit or changing gross sales", () => {
  const f = coordinationFixture();
  const basis: GroupForecastBasis = {
    turn: 10,
    rootId: "r",
    memberIds: ["s", "b"],
    cashByMember: {},
    complete: true,
    books: [{ ...f, sellers: f.sellers.map((s) => ({ ...s, openFill: 1, quoteFactor: 1 })) }],
  };
  const before = estimateGroupSupply(basis, f.members, 11)!;
  f.members.forEach((m) => {
    m.supplyDiscount = 0.35;
  });
  const after = estimateGroupSupply(basis, f.members, 11)!;
  expect(after.total.operatingProfitDifference).toBeCloseTo(before.total.operatingProfitDifference);
  expect(after.total.coordinatedRevenue).toBe(before.total.coordinatedRevenue);
  expect(after.corporations.find((c) => c.id === "s")!.operatingProfitDifference).toBe(-70);
  expect(after.corporations.find((c) => c.id === "b")!.operatingProfitDifference).toBe(70);
  expect(after.total.internalTradingValue).toBe(130);
  f.members[1].preference!.enabled = false;
  expect(estimateGroupSupply(basis, f.members, 11)!.total.internalTradingValue).toBe(0);
});
