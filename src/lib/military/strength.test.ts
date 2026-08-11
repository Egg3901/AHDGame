import { describe, it, expect } from "vitest";
import { strengthOf, strengthPct } from "./strength";

const u = (over: Record<string, unknown> = {}) =>
  ({
    domain: "ground",
    type: "Infantry Division", // establishment 12000
    personnel: 6000,
    ...over,
  }) as Parameters<typeof strengthOf>[0];

describe("strengthOf", () => {
  it("reports headcount against establishment", () => {
    expect(strengthOf(u())).toEqual({ personnel: 6000, establishment: 12000, ratio: 0.5 });
  });

  it("clamps an over-strength unit to 1", () => {
    expect(strengthOf(u({ personnel: 99999 }))?.ratio).toBe(1);
  });

  it("is null for an unknown archetype rather than inventing a ratio", () => {
    expect(strengthOf(u({ type: "Not A Real Unit" }))).toBeNull();
    expect(strengthPct(u({ type: "Not A Real Unit" }))).toBeNull();
  });

  it("rounds a percentage for display", () => {
    expect(strengthPct(u())).toBe(50);
    expect(strengthPct(u({ personnel: 0 }))).toBe(0);
  });
});
