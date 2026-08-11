import { describe, it, expect } from "vitest";
import {
  getActionCostMultiplier,
  calculateActionCost,
  areStatesNeighbors,
  ACTION_COST_MULTIPLIERS,
} from "./adjacency";

describe("getActionCostMultiplier", () => {
  it("returns 1.0 for same state (home state)", () => {
    expect(getActionCostMultiplier("CA", "CA")).toBe(ACTION_COST_MULTIPLIERS.HOME_STATE);
    expect(getActionCostMultiplier("TX", "TX")).toBe(1.0);
  });

  it("returns 1.25 for neighboring states", () => {
    expect(getActionCostMultiplier("CA", "AZ")).toBe(ACTION_COST_MULTIPLIERS.NEIGHBORING_STATE);
    expect(getActionCostMultiplier("CA", "NV")).toBe(1.25);
    expect(getActionCostMultiplier("CA", "OR")).toBe(1.25);
    expect(getActionCostMultiplier("AZ", "CA")).toBe(1.25);
  });

  it("returns 1.5 for non-neighboring states", () => {
    expect(getActionCostMultiplier("CA", "TX")).toBe(ACTION_COST_MULTIPLIERS.DISTANT_STATE);
    expect(getActionCostMultiplier("NY", "CA")).toBe(1.5);
    expect(getActionCostMultiplier("FL", "WA")).toBe(1.5);
  });

  it("handles Alaska and Hawaii (limited neighbors)", () => {
    // HI standalone; AK only neighbors WA via the sea-border convention.
    expect(getActionCostMultiplier("AK", "CA")).toBe(1.5);
    expect(getActionCostMultiplier("HI", "CA")).toBe(1.5);
    expect(getActionCostMultiplier("CA", "AK")).toBe(1.5);
    // AK ↔ WA is NEIGHBORING per F4 sea-border policy.
    expect(getActionCostMultiplier("AK", "WA")).toBe(ACTION_COST_MULTIPLIERS.NEIGHBORING_STATE);
    expect(getActionCostMultiplier("WA", "AK")).toBe(ACTION_COST_MULTIPLIERS.NEIGHBORING_STATE);
  });

  it("handles unknown state codes as distant", () => {
    expect(getActionCostMultiplier("XX", "CA")).toBe(1.5);
    expect(getActionCostMultiplier("CA", "XX")).toBe(1.5);
  });
});

describe("calculateActionCost", () => {
  it("applies home state multiplier (1.0)", () => {
    expect(calculateActionCost(10, "CA", "CA")).toBe(10);
    expect(calculateActionCost(4, "TX", "TX")).toBe(4);
  });

  it("applies neighboring state multiplier (1.25), rounds up", () => {
    expect(calculateActionCost(10, "CA", "AZ")).toBe(13); // 10 * 1.25 = 12.5 -> 13
    expect(calculateActionCost(4, "CA", "NV")).toBe(5); // 4 * 1.25 = 5
  });

  it("applies distant state multiplier (1.5), rounds up", () => {
    expect(calculateActionCost(10, "CA", "TX")).toBe(15); // 10 * 1.5 = 15
    expect(calculateActionCost(4, "NY", "CA")).toBe(6); // 4 * 1.5 = 6
  });
});

describe("areStatesNeighbors", () => {
  it("returns true for adjacent states", () => {
    expect(areStatesNeighbors("CA", "AZ")).toBe(true);
    expect(areStatesNeighbors("AZ", "CA")).toBe(true);
    expect(areStatesNeighbors("TX", "OK")).toBe(true);
  });

  it("returns false for non-adjacent states", () => {
    expect(areStatesNeighbors("CA", "TX")).toBe(false);
    expect(areStatesNeighbors("AK", "HI")).toBe(false);
  });

  it("returns false for same state", () => {
    expect(areStatesNeighbors("CA", "CA")).toBe(false);
  });

  it("returns false when state has no neighbors beyond sea-border (HI)", () => {
    // HI is standalone — no neighbors at all.
    expect(areStatesNeighbors("HI", "CA")).toBe(false);
    // AK only borders WA via the sea-border convention.
    expect(areStatesNeighbors("AK", "CA")).toBe(false);
    expect(areStatesNeighbors("AK", "WA")).toBe(true);
  });
});

// Data-integrity (symmetric, coverage, sea-border edges) for STATE_ADJACENCY
// lives in src/lib/constants/stateAdjacency.test.ts now that the data has
// been consolidated to a single per-country source of truth.
