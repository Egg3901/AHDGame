import { describe, it, expect } from "vitest";
import {
  unitLoad,
  forceLoad,
  overBy,
  effectiveness,
  effectivenessBreakdown,
  uncoveredRegions,
  overlappingRegions,
  globalEffectiveness,
  coverageStatus,
  effIntent,
  logisticsCoverageByRegion,
  hasSameTypeOverlap,
} from "../calc";
import type { MilitaryCommand, MilitaryState, MilitaryOperation } from "../types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

function unit(id: string, basePower: number): MilitaryUnit {
  return {
    _id: id as unknown as MilitaryUnit["_id"],
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: id,
    type: "Infantry Division",
    icon: "soldier",
    posture: "standard",
    techTier: 1,
    personnel: 12000,
    readiness: 70,
    basePower,
    upkeepBase: 70,
    vet: 1,
    xp: 0,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
  };
}

function cmd(over: Partial<MilitaryCommand> = {}): MilitaryCommand {
  return {
    id: "c1",
    name: "Test Command",
    type: "REGIONAL",
    commanderIds: ["hale"],
    commandingGeneralId: null,
    regionIds: [],
    spec: "Joint Operations",
    posture: "Deterrence",
    supply: "High",
    readiness: "Alert",
    cap: 20,
    base: 80,
    political: "Low",
    branchFocus: "Army",
    unitIds: [],
    role: "role",
    ...over,
  };
}

const UNITS = { a: unit("a", 48), b: unit("b", 92), c: unit("c", 4) };

describe("unit load + capacity", () => {
  it("unitLoad scales with basePower, floored at 1", () => {
    expect(unitLoad(UNITS.a)).toBe(4); // round(48/12)
    expect(unitLoad(UNITS.b)).toBe(8); // round(92/12)
    expect(unitLoad(UNITS.c)).toBe(1); // round(4/12)=0 → floored to 1
  });

  it("forceLoad sums assigned units' loads via the units map", () => {
    expect(forceLoad(cmd({ unitIds: ["a", "b"] }), UNITS)).toBe(12);
    expect(forceLoad(cmd({ unitIds: ["missing"] }), UNITS)).toBe(0);
  });

  it("over-capacity is load minus cap, floored at 0", () => {
    expect(overBy(cmd({ unitIds: ["a", "b"], cap: 8 }), UNITS)).toBe(4); // 12 - 8
    expect(overBy(cmd({ unitIds: ["a"], cap: 20 }), UNITS)).toBe(0);
  });
});

describe("effectiveness", () => {
  it("applies the over-capacity penalty (1.6 per point)", () => {
    // base 80, has commander, overBy 4 → 80 - 6.4 → round(73.6) = 74
    expect(effectiveness(cmd({ unitIds: ["a", "b"], cap: 8, base: 80 }), UNITS)).toBe(74);
  });

  it("subtracts the no-commander penalty", () => {
    // base 80, no commander, within cap → 80 - 10 = 70
    expect(effectiveness(cmd({ unitIds: ["a"], commanderIds: [] }), UNITS)).toBe(70);
  });

  it("breakdown reconciles to the final value", () => {
    const b = effectivenessBreakdown(cmd({ unitIds: ["a", "b"], cap: 8 }), UNITS);
    expect(b.finalValue).toBe(74);
    expect(b.negatives.length).toBeGreaterThan(0);
  });
});

describe("logistics command supply", () => {
  it("reports effectiveness as a 0..1 coverage only in covered regions", () => {
    const coverage = logisticsCoverageByRegion(
      [
        cmd({ type: "LOGISTICS", regionIds: ["eeu"], base: 100 }),
        cmd({ id: "regional", type: "REGIONAL", regionIds: ["weu"], base: 100 }),
      ],
      UNITS
    );

    expect(coverage).toEqual({ eeu: 1 });
  });

  it("uses the strongest overlapping Logistics command instead of stacking", () => {
    const coverage = logisticsCoverageByRegion(
      [
        cmd({ id: "weak", type: "LOGISTICS", regionIds: ["eeu"], base: 50 }),
        cmd({ id: "strong", type: "LOGISTICS", regionIds: ["eeu"], base: 100 }),
      ],
      UNITS
    );

    expect(coverage.eeu).toBe(1);
  });

  it("never reports more than full coverage, whatever the command's base", () => {
    // A command base arrives from the commands route unbounded; coverage now multiplies the
    // force's own demand, so an unclamped 500 would be five times the intended share.
    const coverage = logisticsCoverageByRegion(
      [cmd({ type: "LOGISTICS", regionIds: ["eeu"], base: 500 })],
      UNITS
    );
    expect(coverage.eeu).toBe(1);
  });
});

// The one place the same-type rule is decided. It had been written out by hand in
// three places (overlappingRegions, coverageStatus, and the detail panel's region
// rows), and the original bug was exactly two of those copies disagreeing.
describe("hasSameTypeOverlap", () => {
  it("is false for no owners, one owner, or owners that are all different types", () => {
    expect(hasSameTypeOverlap([])).toBe(false);
    expect(hasSameTypeOverlap([cmd({ id: "a", type: "REGIONAL" })])).toBe(false);
    expect(
      hasSameTypeOverlap([
        cmd({ id: "a", type: "REGIONAL" }),
        cmd({ id: "b", type: "LOGISTICS" }),
        cmd({ id: "c", type: "HOMELAND_DEFENSE" }),
      ])
    ).toBe(false);
  });

  it("is true as soon as one type repeats, whoever else is present", () => {
    expect(
      hasSameTypeOverlap([cmd({ id: "a", type: "REGIONAL" }), cmd({ id: "b", type: "REGIONAL" })])
    ).toBe(true);
    expect(
      hasSameTypeOverlap([
        cmd({ id: "a", type: "REGIONAL" }),
        cmd({ id: "b", type: "LOGISTICS" }),
        cmd({ id: "c", type: "LOGISTICS" }),
      ])
    ).toBe(true);
  });
});

describe("coverage", () => {
  const state = (): MilitaryState => ({
    commands: [cmd({ id: "a", regionIds: ["mea", "naf"] }), cmd({ id: "b", regionIds: ["naf"] })],
    selectedId: "a",
    selectedRegionId: null,
    filter: "coverage",
    assignMode: false,
  });
  const ops: MilitaryOperation[] = [
    { id: "o1", name: "Op", cmd: "a", region: "mea", type: "x", risk: "Low", progress: 10 },
  ];

  it("finds uncovered and overlapping regions", () => {
    expect(uncoveredRegions(state()).some((r) => r.id === "arc")).toBe(true);
    expect(overlappingRegions(state()).some((r) => r.id === "naf")).toBe(true);
  });

  it("does not flag regions covered by commands of different types", () => {
    const s: MilitaryState = {
      commands: [
        cmd({ id: "a", type: "HOMELAND_DEFENSE", regionIds: ["mea"] }),
        cmd({ id: "b", type: "LOGISTICS", regionIds: ["mea"] }),
      ],
      selectedId: "a",
      selectedRegionId: null,
      filter: "coverage",
      assignMode: false,
    };
    expect(overlappingRegions(s).length).toBe(0);
  });

  it("labels coverage status", () => {
    expect(coverageStatus(state(), "arc", ops)).toBe("UNASSIGNED");
    expect(coverageStatus(state(), "naf", ops)).toBe("OVERLAPPING");
    expect(coverageStatus(state(), "mea", ops)).toBe("ACTIVE_CONFLICT");
  });

  // A Regional command paired with a Logistics command over the same region is the
  // supported setup for fighting overseas, and the one the wiki recommends. It read
  // as UNASSIGNED because only a single owner counted as covered, so the builder
  // told players the pairing had not taken.
  it("labels a region covered by commands of different types as assigned", () => {
    const s: MilitaryState = {
      commands: [
        cmd({ id: "a", type: "REGIONAL", regionIds: ["weu"] }),
        cmd({ id: "b", type: "LOGISTICS", regionIds: ["weu"] }),
      ],
      selectedId: "a",
      selectedRegionId: null,
      filter: "coverage",
      assignMode: false,
    };
    expect(coverageStatus(s, "weu", [])).toBe("ASSIGNED");
  });

  // The ops branch sits between OVERLAPPING and the owner count, so widening the
  // owner count to "any owner" must not let a covered region outrank a live war in
  // the chip. Locks the documented precedence for the multi-owner case specifically.
  it("still reports an active conflict in a region covered by different command types", () => {
    const s: MilitaryState = {
      commands: [
        cmd({ id: "a", type: "REGIONAL", regionIds: ["weu"] }),
        cmd({ id: "b", type: "LOGISTICS", regionIds: ["weu"] }),
      ],
      selectedId: "a",
      selectedRegionId: null,
      filter: "coverage",
      assignMode: false,
    };
    const live: MilitaryOperation[] = [
      { id: "o1", name: "Op", cmd: "a", region: "weu", type: "x", risk: "Low", progress: 10 },
    ];
    expect(coverageStatus(s, "weu", live)).toBe("ACTIVE_CONFLICT");
  });

  // A duplicate type is still a conflict even when a third command of another type
  // shares the region, so the overlap branch must not be weakened by the widening.
  it("still flags an overlap when a duplicate type shares a region with another type", () => {
    const s: MilitaryState = {
      commands: [
        cmd({ id: "a", type: "REGIONAL", regionIds: ["weu"] }),
        cmd({ id: "b", type: "REGIONAL", regionIds: ["weu"] }),
        cmd({ id: "c", type: "LOGISTICS", regionIds: ["weu"] }),
      ],
      selectedId: "a",
      selectedRegionId: null,
      filter: "coverage",
      assignMode: false,
    };
    expect(coverageStatus(s, "weu", [])).toBe("OVERLAPPING");
  });
});

describe("effIntent + global effectiveness", () => {
  it("maps thresholds", () => {
    expect(effIntent(85)).toBe("success");
    expect(effIntent(72)).toBe("warn");
    expect(effIntent(60)).toBe("error");
  });
  it("averages command effectiveness across the nation", () => {
    const state: MilitaryState = {
      commands: [cmd({ id: "a", unitIds: ["a"] }), cmd({ id: "b", unitIds: ["b"] })],
      selectedId: "a",
      selectedRegionId: null,
      filter: "coverage",
      assignMode: false,
    };
    expect(globalEffectiveness(state, UNITS)).toBeGreaterThan(0);
  });
});
