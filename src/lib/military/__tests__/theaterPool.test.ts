import { describe, it, expect } from "vitest";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { computeEffectivePower } from "@/lib/constants/military";
import { theaterPool } from "../theaterPool";

function unit(basePower: number): MilitaryUnit {
  return {
    _id: "x" as never,
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "u",
    type: "Infantry Division",
    icon: "soldier",
    posture: "standard",
    techTier: 1,
    // Full establishment for an Infantry Division — personnel now scales combat power,
    // so a placeholder headcount would read as a near-destroyed unit.
    personnel: 12000,
    readiness: 70,
    basePower,
    upkeepBase: 1,
    vet: 1,
    xp: 0,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
  };
}

describe("theaterPool", () => {
  it("sums effective power across units", () => {
    const units = [unit(48), unit(92)];
    const expected = units.reduce((a, u) => a + computeEffectivePower(u), 0);
    expect(theaterPool(units)).toBe(expected);
    expect(theaterPool(units)).toBeGreaterThan(0);
  });

  it("is zero for an empty force", () => {
    expect(theaterPool([])).toBe(0);
  });
});
