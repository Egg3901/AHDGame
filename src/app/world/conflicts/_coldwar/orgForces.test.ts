import { describe, it, expect } from "vitest";
import {
  type Member,
  aggregates,
  cohColor,
  cohesionFrom,
  combatPower,
  commitColor,
  composition,
  fmtN,
  fmtTroops,
  pcCostFor,
  upkeepFor,
} from "./orgForces";

const m = (over: Partial<Member>): Member => ({
  flag: "🏳",
  name: "X",
  short: "X",
  troops: 0,
  commit: 0,
  div: 0,
  air: 0,
  tanks: 0,
  ships: 0,
  warheads: 0,
  ...over,
});
const two: Member[] = [
  m({
    short: "A",
    troops: 1000,
    commit: 100,
    div: 10,
    air: 300,
    tanks: 1500,
    ships: 5,
    warheads: 100,
  }),
  m({ short: "B", troops: 500, commit: 50, div: 4, air: 0, tanks: 0, ships: 1, warheads: 0 }),
];
const commitOf = (x: Member) => x.commit;

describe("cohesion", () => {
  it("moves 0.26 per point of commitment delta, clamped", () => {
    expect(cohesionFrom(84, 0)).toBe(84);
    expect(cohesionFrom(84, 15)).toBe(88); // +3.9 → 88
    expect(cohesionFrom(84, -30)).toBe(76); // −7.8 → 76
    expect(cohesionFrom(98, 40)).toBe(100); // clamp
  });
  it("colors by band", () => {
    expect(cohColor(84)).toBe("#86d978");
    expect(cohColor(50)).toBe("#eab308");
    expect(cohColor(40)).toBe("#ff5a3c");
  });
});

describe("commitColor", () => {
  it("green committed → red holdout", () => {
    expect(commitColor(85)).toBe("#86d978");
    expect(commitColor(60)).toBe("#eab308");
    expect(commitColor(30)).toBe("#ff7849");
    expect(commitColor(0)).toBe("#7a4a4a");
  });
});

describe("pcCostFor", () => {
  it("cheap to reinforce, dear to withhold, 1.4× for HoG", () => {
    expect(pcCostFor(15, false)).toBe(6); // 3 + 3
    expect(pcCostFor(-20, false)).toBe(15); // 5 + 10
    expect(pcCostFor(15, true)).toBe(8); // 6 × 1.4 → 8.4 → 8
    expect(pcCostFor(0, false)).toBe(0);
  });
});

describe("combatPower", () => {
  it("committed personnel + equipment, scaled by cohesion", () => {
    const cp = combatPower(two, commitOf, 80);
    expect(cp.totalCommK).toBe(1250); // 1000 + 250
    expect(cp.rawCP).toBe(1450); // + equip (1500/15 + 300/3 = 200)
    expect(cp.cohFactor).toBeCloseTo(0.92, 2);
    expect(cp.effCP).toBe(1334); // 1450 × 0.92
  });
});

describe("composition", () => {
  it("sorts by committed personnel desc with shares", () => {
    const c = composition(two, commitOf);
    expect(c.map((x) => x.short)).toEqual(["A", "B"]);
    expect(c[0].pctNum).toBeCloseTo(80, 1);
    expect(c[1].pctNum).toBeCloseTo(20, 1);
  });
});

describe("aggregates + formatting", () => {
  it("sums the six force columns", () => {
    const a = aggregates(two, commitOf);
    expect(a.find((x) => x.label === "DIVISIONS")?.value).toBe("14");
    expect(a.find((x) => x.label === "TANKS")?.value).toBe("1,500");
  });
  it("formats troops and numbers", () => {
    expect(fmtTroops(3658)).toBe("3.7M");
    expect(fmtTroops(500)).toBe("500K");
    expect(fmtTroops(50000)).toBe("50M");
    expect(fmtN(50000)).toBe("50,000");
    expect(upkeepFor(1000)).toBeCloseTo(85, 5);
  });
});
