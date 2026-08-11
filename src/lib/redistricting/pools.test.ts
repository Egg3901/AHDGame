import { describe, it, expect } from "vitest";
import { getPartyPool, aggregatePoolPercents, derivePoolPercentsFromPvi } from "./pools";

describe("getPartyPool", () => {
  it("maps economicPosition to pools at the ±1 thresholds", () => {
    expect(getPartyPool({ economicPosition: -2 })).toBe("left");
    expect(getPartyPool({ economicPosition: -1 })).toBe("left");
    expect(getPartyPool({ economicPosition: 0 })).toBe("grey");
    expect(getPartyPool({ economicPosition: 1 })).toBe("right");
    expect(getPartyPool({ economicPosition: 3 })).toBe("right");
  });

  it("honors an explicit pool override", () => {
    expect(getPartyPool({ economicPosition: -3, pool: "grey" })).toBe("grey");
  });
});

describe("aggregatePoolPercents", () => {
  const poolOf = (id: string) => (id === "DEM" ? "left" : id === "GOP" ? "right" : "grey");

  it("sums party registration by pool and adds independents/unregistered to grey", () => {
    const rows = [
      { partyId: "DEM", registration: 45 },
      { partyId: "GOP", registration: 35 },
    ];
    const result = aggregatePoolPercents(rows, poolOf, {
      independent: 16,
      unregistered: 4,
    });
    expect(result).toEqual({ left: 45, right: 35, grey: 20 });
  });

  it("treats undefined registration as 0 and derives grey as the residual when no pool doc", () => {
    const rows = [
      { partyId: "DEM", registration: 50 },
      { partyId: "GOP" }, // undefined registration
    ];
    const result = aggregatePoolPercents(rows, poolOf, null);
    // left 50, right 0, grey = 100 - 50 - 0 = 50
    expect(result).toEqual({ left: 50, right: 0, grey: 50 });
  });

  it("normalizes to 100 when inputs overshoot", () => {
    const rows = [
      { partyId: "DEM", registration: 70 },
      { partyId: "GOP", registration: 70 },
    ];
    const result = aggregatePoolPercents(rows, poolOf, { independent: 0, unregistered: 0 });
    const total = result.left + result.right + result.grey;
    expect(total).toBeCloseTo(100, 5);
    expect(result.left).toBeCloseTo(50, 5);
    expect(result.right).toBeCloseTo(50, 5);
  });
});

describe("derivePoolPercentsFromPvi", () => {
  it("returns a neutral split (~5L/6G/5R) when PVI is missing", () => {
    const result = derivePoolPercentsFromPvi(null);
    expect(result.left + result.right + result.grey).toBeCloseTo(100, 5);
    expect(result.grey).toBeCloseTo(37.5, 5);
    expect(result.left).toBeCloseTo(result.right, 5);
    expect(result.left).toBeGreaterThan(0);
    expect(result.right).toBeGreaterThan(0);
  });

  it("tilts right for positive average PVI and left for negative", () => {
    const right = derivePoolPercentsFromPvi([15, 30, 9]);
    expect(right.right).toBeGreaterThan(right.left);
    const left = derivePoolPercentsFromPvi([-15, -30, -9]);
    expect(left.left).toBeGreaterThan(left.right);
  });

  it("clamps an extreme average PVI to a fully one-sided two-party share", () => {
    const result = derivePoolPercentsFromPvi([90, 90]);
    expect(result.left).toBeCloseTo(0, 5);
    expect(result.right).toBeCloseTo(62.5, 5);
  });

  it("ignores zero PVI entries when averaging", () => {
    const result = derivePoolPercentsFromPvi([0, 0, 0]);
    expect(result.left).toBeCloseTo(result.right, 5);
  });
});
