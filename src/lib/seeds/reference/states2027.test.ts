import { describe, expect, it } from "vitest";
import { states2027 } from "./states2027";

describe("states2027", () => {
  it("contains every state plus DC exactly once", () => {
    expect(states2027).toHaveLength(51);
    expect(new Set(states2027.map((state) => state._id)).size).toBe(51);
  });

  it("matches the Census Vintage 2025 national resident estimate", () => {
    expect(states2027.reduce((total, state) => total + state.population, 0)).toBe(341_784_857);
  });

  it("preserves the current 435-seat congressional apportionment", () => {
    expect(states2027.reduce((total, state) => total + state.houseDistricts, 0)).toBe(435);
  });

  it("carries positive population and GDP values for every jurisdiction", () => {
    for (const state of states2027) {
      expect(state.population, `${state._id} population`).toBeGreaterThan(0);
      expect(state.gdp, `${state._id} GDP`).toBeGreaterThan(0);
    }
  });
});
