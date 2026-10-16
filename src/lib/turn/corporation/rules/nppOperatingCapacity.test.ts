import { describe, expect, it } from "vitest";
import { nppOperatingCapacityTarget, type NppOperatingCapacityInput } from "./nppOperatingCapacity";
const base: NppOperatingCapacityInput = {
  eligible: true,
  mothballed: false,
  activePercent: 100,
  demandThrottle: 0.2,
  measuredProfit: -100,
  measuredTurn: 99,
  currentTurn: 100,
  contractDemand: 0,
  outputBooks: [{ supply: 1000, demand: 500 }],
  physicalConstraintsClear: true,
  constructionOrRetool: false,
};
describe("reversible NPP operation", () => {
  it("keeps a loss-making plant's existing demand and headroom", () => {
    expect(nppOperatingCapacityTarget(base)).toBe(25);
  });
  it.each([
    { contractDemand: 200 },
    { contractDemand: undefined },
    { contractDemand: NaN },
    { contractDemand: -1 },
    { outputBooks: [] },
    { outputBooks: [undefined] },
    { outputBooks: [{ supply: 100, demand: 101 }] },
    { outputBooks: [{ supply: NaN, demand: 100 }] },
    { physicalConstraintsClear: false },
    { constructionOrRetool: true },
    { measuredTurn: 80 },
    { measuredTurn: undefined },
    { demandThrottle: NaN },
    { demandThrottle: 0 },
    { demandThrottle: 2 },
    { measuredProfit: NaN },
  ])("reactivates when a parked run lacks safe evidence: %j", (change) => {
    expect(nppOperatingCapacityTarget({ ...base, activePercent: 25, ...change })).toBe(100);
  });
  it("keeps profitable capacity and an explicit full mothball", () => {
    expect(nppOperatingCapacityTarget({ ...base, measuredProfit: 100 })).toBeNull();
    expect(nppOperatingCapacityTarget({ ...base, mothballed: true })).toBeNull();
    expect(nppOperatingCapacityTarget({ ...base, eligible: false })).toBeNull();
  });
  it("increases a parked run when buyers return", () => {
    expect(nppOperatingCapacityTarget({ ...base, activePercent: 20, demandThrottle: 1 })).toBe(25);
  });
});
