import { describe, it, expect } from "vitest";
import {
  iterationLabel,
  compareIterations,
  iterationKey,
  orderIterations,
  weekYearFromTurn,
  weekYearFromFields,
} from "./officeIteration";

const A1 = { type: "Alpha", number: 1 } as const;
const B1 = { type: "Beta", number: 1 } as const;
const B2 = { type: "Beta", number: 2 } as const;
const I1 = { type: "Iteration", number: 1 } as const;

describe("iterationLabel", () => {
  it("renders type and number", () => {
    expect(iterationLabel(B2)).toBe("Beta 2");
  });
});

describe("compareIterations", () => {
  it("orders Alpha < Beta < Iteration", () => {
    expect(compareIterations(A1, B1)).toBeLessThan(0);
    expect(compareIterations(B1, I1)).toBeLessThan(0);
  });
  it("orders by number within a type", () => {
    expect(compareIterations(B1, B2)).toBeLessThan(0);
    expect(compareIterations(B2, B1)).toBeGreaterThan(0);
  });
  it("equal iterations compare 0", () => {
    expect(compareIterations(B2, { type: "Beta", number: 2 })).toBe(0);
  });
});

describe("orderIterations", () => {
  it("returns registry order, deduped, with extras folded in by priority", () => {
    const result = orderIterations([B2, A1, B1], [I1, B2]);
    expect(result.map(iterationKey)).toEqual([
      iterationKey(A1),
      iterationKey(B1),
      iterationKey(B2),
      iterationKey(I1),
    ]);
  });
});

describe("weekYearFromTurn", () => {
  it("matches turnToLarpDate semantics", () => {
    expect(weekYearFromTurn(1, 2019)).toBe("January, Week 1, 2019");
    expect(weekYearFromTurn(48, 2019)).toBe("December, Week 4, 2019");
    expect(weekYearFromTurn(49, 2019)).toBe("January, Week 1, 2020");
  });
});

describe("weekYearFromFields", () => {
  it("formats explicit week/year", () => {
    expect(weekYearFromFields(12, 2020)).toBe("Week 12, 2020");
  });
});
