import { describe, it, expect } from "vitest";
import {
  STATE_ARMS_INDUSTRY,
  stateArmsLotsPerTurn,
  stateArmsAllocation,
} from "./stateArmsIndustry";

/**
 * A planned-defence economy does not buy its materiel through defence contracts, so the
 * arsenal pipeline that feeds every market nation never feeds it. RU and DD sat at an
 * empty store for the whole life of the save and could not replace a single piece of
 * battle-destroyed equipment.
 *
 * The accrual is deliberately modest and capped. It has to clear three bars at once:
 * keep a resting army equipped, let a new formation be kitted out in a sensible span,
 * and still lose to a war fought at pace.
 */
describe("state arms industry roster", () => {
  it("covers the planned economies and nobody else", () => {
    expect(Object.keys(STATE_ARMS_INDUSTRY).sort()).toEqual(["DD", "RU"]);
  });

  it("gives a market economy nothing", () => {
    expect(stateArmsLotsPerTurn("US")).toBe(0);
    expect(stateArmsLotsPerTurn("UK")).toBe(0);
  });

  it("gives the Soviet Union the larger programme", () => {
    expect(stateArmsLotsPerTurn("RU")).toBeGreaterThan(stateArmsLotsPerTurn("DD"));
    expect(stateArmsLotsPerTurn("DD")).toBeGreaterThan(0);
  });
});

describe("state arms allocation", () => {
  const domains = {
    ground: { need: 20, ceiling: 40, stock: 0 },
    air: { need: 2, ceiling: 10, stock: 0 },
  };

  it("feeds the domain with the most unmet need", () => {
    expect(stateArmsAllocation(3, domains)).toEqual({ domain: "ground", lots: 3 });
  });

  it("moves on once that domain is stocked past its need", () => {
    const stocked = { ...domains, ground: { need: 20, ceiling: 40, stock: 30 } };
    expect(stateArmsAllocation(3, stocked)?.domain).toBe("air");
  });

  it("stops at the ceiling rather than banking without limit", () => {
    // The reserve is capped at one full re-equip of the roster. A nation at peace builds
    // that buffer and no more, so a long war still drains it to nothing.
    const nearlyFull = { ground: { need: 0, ceiling: 40, stock: 39 } };
    expect(stateArmsAllocation(3, nearlyFull)).toEqual({ domain: "ground", lots: 1 });
  });

  it("produces nothing once every domain is at its ceiling", () => {
    const full = {
      ground: { need: 0, ceiling: 40, stock: 40 },
      air: { need: 0, ceiling: 10, stock: 10 },
    };
    expect(stateArmsAllocation(3, full)).toBeNull();
  });

  it("produces nothing for a country with no roster at all", () => {
    expect(stateArmsAllocation(3, {})).toBeNull();
  });

  it("is deterministic when two domains are equally hungry", () => {
    const tied = {
      air: { need: 5, ceiling: 10, stock: 0 },
      ground: { need: 5, ceiling: 10, stock: 0 },
    };
    expect(stateArmsAllocation(2, tied)).toEqual(stateArmsAllocation(2, tied));
    expect(stateArmsAllocation(2, tied)?.domain).toBe("air");
  });
});
