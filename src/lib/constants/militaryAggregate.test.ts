import { describe, it, expect } from "vitest";
import { aggregateForce } from "./military";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

function u(p: Partial<MilitaryUnit>): MilitaryUnit {
  return {
    _id: undefined as never,
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "x",
    type: "Infantry Division",
    icon: "soldier",
    posture: "standard",
    techTier: 1,
    personnel: 1000,
    readiness: 70,
    basePower: 50,
    upkeepBase: 100,
    vet: 1,
    xp: 0,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
    ...p,
  };
}

describe("aggregateForce", () => {
  it("sums power/personnel/upkeep and averages readiness", () => {
    const agg = aggregateForce([u({ readiness: 60 }), u({ readiness: 80 })], "US", "standard");
    expect(agg.unitCount).toBe(2);
    expect(agg.totalPersonnel).toBe(2000);
    expect(agg.avgReadiness).toBe(70);
    expect(agg.totalPower).toBeGreaterThan(0);
    expect(agg.totalUpkeep).toBeGreaterThan(0);
  });

  it("computes forward/alert posture share", () => {
    const agg = aggregateForce(
      [u({ posture: "forward" }), u({ posture: "garrison" })],
      "US",
      "standard"
    );
    expect(agg.forwardShare).toBeCloseTo(0.5, 5);
  });

  it("empty force is all zeros", () => {
    const agg = aggregateForce([], "US", "standard");
    expect(agg).toEqual({
      unitCount: 0,
      totalPower: 0,
      totalPersonnel: 0,
      totalUpkeep: 0,
      avgReadiness: 0,
      forwardShare: 0,
    });
  });
});
