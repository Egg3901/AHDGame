import { describe, it, expect } from "vitest";
import type { ForceAggregate } from "@/lib/constants/military";
import { forceDefenseContribution } from "./forceDefense";
import { addContributions } from "./cabinetResidual";

const agg = (over: Partial<ForceAggregate>): ForceAggregate => ({
  unitCount: 10,
  totalPower: 1500, // == POWER_NORM → powerSig 1
  totalPersonnel: 100_000,
  totalUpkeep: 500,
  avgReadiness: 60, // readySig 0
  forwardShare: 0,
  ...over,
});

describe("forceDefenseContribution", () => {
  it("drives armedForces from force strength", () => {
    const strong = forceDefenseContribution(agg({ totalPower: 3000 }), 0.55, 0);
    const weak = forceDefenseContribution(agg({ totalPower: 300 }), 0.55, 0);
    expect(strong["defense.armedForces"]).toBeGreaterThan(weak["defense.armedForces"]);
  });

  it("pushes security negative when readiness is below baseline", () => {
    // Low readiness + minimal strength → security should be negative.
    const out = forceDefenseContribution(agg({ avgReadiness: 20, totalPower: 0 }), 0.55, 0);
    expect(out["defense.security"]).toBeLessThan(0);
  });

  it("drives projection from forward-posture share", () => {
    const fwd = forceDefenseContribution(agg({ forwardShare: 0.8 }), 0.55, 0);
    const home = forceDefenseContribution(agg({ forwardShare: 0 }), 0.55, 0);
    expect(fwd["defense.projection"]).toBeGreaterThan(0);
    expect(home["defense.projection"] ?? 0).toBe(0);
  });

  it("drives defenseIndustry from spend + modernization", () => {
    const modern = forceDefenseContribution(agg({ totalUpkeep: 1000 }), 0.9, 3);
    const legacy = forceDefenseContribution(agg({ totalUpkeep: 0 }), 0.2, 0);
    expect(modern["defense.defenseIndustry"]).toBeGreaterThan(
      legacy["defense.defenseIndustry"] ?? 0
    );
  });

  it("returns only defense-family keys", () => {
    const out = forceDefenseContribution(agg({}), 0.55, 1);
    expect(Object.keys(out).every((k) => k.startsWith("defense."))).toBe(true);
  });
});

describe("addContributions", () => {
  it("merges disjoint maps and sums overlaps", () => {
    expect(
      addContributions(
        { "defense.armedForces": 1, "order.safety": 2 },
        { "defense.armedForces": 3 }
      )
    ).toEqual({ "defense.armedForces": 4, "order.safety": 2 });
  });
});

describe("forceDefenseContribution — burden null vs zero", () => {
  // The counterpart to the budgetBalance guard. Here 0 and null both drive `spendSig` to 0,
  // but they must stay DISTINCT in the signature: a burden of 0 is a real measurement (a
  // force that costs nothing to sustain) while null means the country has no defence line at
  // all. Narrowing this parameter to `number` is what would let an unfunded country be scored
  // as if it had been measured.
  it("accepts an absent burden without inventing a spend signal", () => {
    const absent = forceDefenseContribution(agg({}), null, 1);
    const measuredZero = forceDefenseContribution(agg({}), 0, 1);
    expect(absent["defense.defenseIndustry"]).toBe(measuredZero["defense.defenseIndustry"]);
  });

  it("scores a heavily-funded force above an unfunded one", () => {
    const heavy = forceDefenseContribution(agg({}), 1, 1);
    const none = forceDefenseContribution(agg({}), null, 1);
    expect(heavy["defense.defenseIndustry"]).toBeGreaterThan(none["defense.defenseIndustry"] ?? 0);
  });
});
