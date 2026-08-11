import { describe, it, expect } from "vitest";
import { INTEL, control, liveOps, oppInf, playerTotal, standing } from "./intel";

const afg = INTEL.west.nations.afg; // playerBase 18, oppBase 24, ops 40 + 20

describe("oppInf", () => {
  it("sums baseline + every un-exposed op", () => {
    expect(oppInf(afg, {})).toBe(84); // 24 + 40 + 20
    expect(oppInf(afg, { army: true })).toBe(44); // 24 + 20
    expect(oppInf(afg, { army: true, khad: true })).toBe(24); // baseline only
  });
});

describe("playerTotal", () => {
  it("adds the recruited network to the baseline", () => {
    expect(playerTotal(afg, 0)).toBe(18);
    expect(playerTotal(afg, 8)).toBe(26);
  });
});

describe("control", () => {
  it("is playerTotal / (playerTotal + oppInf), exposure swings it", () => {
    expect(control(afg, 0, {})).toBe(18); // 18 / 102
    expect(control(afg, 0, { army: true })).toBe(29); // 18 / 62
    expect(control(afg, 0, { army: true, khad: true })).toBe(43); // 18 / 42
    expect(control(afg, 8, {})).toBe(24); // recruiting lifts it
  });
});

describe("liveOps", () => {
  it("counts only un-exposed operations", () => {
    expect(liveOps(afg, {})).toBe(2);
    expect(liveOps(afg, { army: true })).toBe(1);
    expect(liveOps(afg, { army: true, khad: true })).toBe(0);
  });
});

describe("standing", () => {
  it("bleeds 6 per exposed op, floored at 0", () => {
    expect(standing(0)).toBe(100);
    expect(standing(3)).toBe(82);
    expect(standing(20)).toBe(0);
  });
});

describe("INTEL config", () => {
  it("each side lists 8 nations matching its order", () => {
    for (const side of ["west", "east"] as const) {
      const c = INTEL[side];
      expect(c.order).toHaveLength(8);
      expect(Object.keys(c.nations).sort()).toEqual([...c.order].sort());
      expect(c.nations[c.defaultSelected]).toBeDefined();
    }
  });
  it("orients the player bloc per side", () => {
    expect(INTEL.west.player.short).toBe("WEST");
    expect(INTEL.east.player.short).toBe("EAST");
  });
});
