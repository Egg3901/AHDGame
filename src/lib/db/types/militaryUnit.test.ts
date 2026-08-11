import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { MilitaryUnit } from "./militaryUnit";

describe("MilitaryUnit unified shape", () => {
  it("accepts the unified field set and no longer carries location", () => {
    const u: MilitaryUnit = {
      _id: new ObjectId(),
      countryId: "US",
      branchId: "army",
      domain: "ground",
      name: "1st Vanguard Armored Division",
      type: "Armored Division",
      icon: "tank",
      posture: "standard",
      techTier: 1,
      personnel: 15000,
      readiness: 70,
      basePower: 92,
      upkeepBase: 180,
      vet: 1,
      xp: 0,
      equipment: { firepower: 1, protection: 1, support: 1 },
      drill: null,
      theaterId: "reserve",
      assignedGeneralId: null,
      createdTurn: 1,
    };
    expect(u.theaterId).toBe("reserve");
    expect(u.equipment.firepower).toBe(1);
    // @ts-expect-error location was removed from the unified schema
    expect(u.location).toBeUndefined();
  });
});
