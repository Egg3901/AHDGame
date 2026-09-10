import { describe, it, expect } from "vitest";
import {
  STATE_ARMS_INDUSTRY,
  stateArmsLotsPerTurn,
  stateArmsAllocation,
  materielFloor,
  MATERIEL_FLOOR_LOTS,
  type DomainDemand,
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

describe("materielFloor", () => {
  const domains = (over: Record<string, Partial<DomainDemand>> = {}) => {
    const base: Record<string, DomainDemand> = {
      ground: { need: 10, ceiling: 40, stock: 0 },
      naval: { need: 4, ceiling: 20, stock: 6 },
    };
    for (const [k, v] of Object.entries(over)) base[k] = { ...base[k], ...v };
    return base;
  };

  it("gives a market economy one lot when a store has reached zero", () => {
    const f = materielFloor("US", domains());
    expect(f.lots).toBe(MATERIEL_FLOOR_LOTS);
    expect(Object.keys(f.domains)).toEqual(["ground"]);
  });

  it("reaches only the empty domains, so it cannot fill a store", () => {
    // The allocator fills toward a domain's CEILING. Handing it the stocked naval domain
    // would turn one lot a turn into a second supply line, which is the thing the defence
    // contract pipeline exists to be.
    const f = materielFloor("US", domains());
    expect(f.domains.naval).toBeUndefined();
    const alloc = stateArmsAllocation(f.lots, f.domains);
    expect(alloc).toEqual({ domain: "ground", lots: 1 });
  });

  it("switches itself off once the store is no longer empty", () => {
    // One lot arrives, and next turn there is nothing for the floor to do. This is what
    // makes it a floor rather than a rate.
    const f = materielFloor("US", domains({ ground: { stock: 1 } }));
    expect(f.lots).toBe(0);
  });

  it("does not fire for a domain that needs nothing", () => {
    const f = materielFloor("US", domains({ ground: { stock: 0, need: 0 } }));
    expect(f.lots).toBe(0);
  });

  it("leaves the planned economies entirely alone", () => {
    // RU and DD have their own rate and must not also draw the floor.
    for (const c of ["RU", "DD"]) {
      expect(materielFloor(c, domains()).lots).toBe(0);
      expect(stateArmsLotsPerTurn(c)).toBeGreaterThan(0);
    }
  });

  it("is a third of the Soviet rate, so planned production keeps its advantage", () => {
    expect(MATERIEL_FLOOR_LOTS).toBeLessThan(stateArmsLotsPerTurn("RU"));
  });
});
