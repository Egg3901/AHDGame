import { describe, it, expect } from "vitest";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { computeEffectivePower } from "@/lib/constants/military";
import { theaterPool, engageablePool } from "../theaterPool";

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

const hull = (type: string, over: Partial<MilitaryUnit> = {}) =>
  ({
    _id: `u-${type}`,
    countryId: "US",
    domain: "naval",
    type,
    basePower: 90,
    personnel: 1000,
    posture: "standard",
    techTier: 2,
    vet: 1,
    readiness: 80,
    equipment: { firepower: 1, protection: 1, support: 1 },
    ...over,
  }) as unknown as MilitaryUnit;

describe("engageablePool", () => {
  it("matches theaterPool exactly when nothing is naval", () => {
    const army = [hull("Armored Division", { domain: "ground" })];
    expect(engageablePool(army, false)).toBe(theaterPool(army));
    expect(engageablePool(army, true)).toBe(theaterPool(army));
  });

  it("discounts a fleet that cannot reach an inland front", () => {
    const fleet = [hull("Frigate Squadron"), hull("Guided-Missile Destroyer")];
    expect(engageablePool(fleet, false)).toBeLessThan(engageablePool(fleet, true));
    expect(engageablePool(fleet, false)).toBeLessThan(theaterPool(fleet));
  });

  it("keeps a carrier at full weight on a coastal front", () => {
    const cvn = [hull("Carrier Strike Group")];
    expect(engageablePool(cvn, true)).toBe(theaterPool(cvn));
  });

  it("degrades a carrier less than an escort inland", () => {
    const cvn = [hull("Carrier Strike Group")];
    const frigate = [hull("Frigate Squadron")];
    const keeps = (us: MilitaryUnit[]) => engageablePool(us, false) / engageablePool(us, true);
    expect(keeps(cvn)).toBeGreaterThan(keeps(frigate));
  });
});
