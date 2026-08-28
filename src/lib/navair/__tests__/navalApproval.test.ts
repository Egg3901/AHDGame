import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  navalStanding,
  navalApprovalEffect,
  navalApprovalLabel,
  NAVAL_APPROVAL_BOUND,
  FLEET_ALARM_THRESHOLD,
} from "../navalApproval";
import type { NavairUnit } from "../types";
import type { CountryId } from "@/lib/constants/countries";

function hull(integrity: number, over: Partial<NavairUnit> = {}): NavairUnit {
  return {
    _id: new ObjectId(),
    countryId: "US" as CountryId,
    branchId: "navy",
    domain: "naval",
    name: "Squadron",
    type: "Guided-Missile Destroyer",
    icon: "ship",
    posture: "standard",
    techTier: 1,
    personnel: 1000,
    readiness: 100,
    basePower: 64,
    upkeepBase: 100,
    vet: 2,
    xp: 0,
    equipment: { firepower: 50, protection: 50, support: 50 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
    station: "nat",
    integrity,
    supply: 100,
    ...over,
  } as NavairUnit;
}

describe("navalStanding", () => {
  it("reports a perfect fleet for a country with no navy", () => {
    // A landlocked power must not read as having a devastated fleet.
    expect(navalStanding([])).toEqual({ condition: 100, effective: 0, crippled: 0 });
  });

  it("ignores air formations", () => {
    const units = [hull(100), hull(0, { domain: "air", type: "Fighter Wing" })];
    expect(navalStanding(units).crippled).toBe(0);
  });

  it("counts crippled hulls separately from effective ones", () => {
    const s = navalStanding([hull(100), hull(0), hull(50)]);
    expect(s.effective).toBe(2);
    expect(s.crippled).toBe(1);
  });

  it("weights every hull equally, regardless of what it is", () => {
    // A political signal, not a military one. The public reaction to losing ships does
    // not scale with displacement, and weighting by combat value would make one carrier
    // read as the whole navy.
    const carrierHeavy = navalStanding([
      hull(0, { type: "Carrier Strike Group", basePower: 99 }),
      hull(100),
    ]);
    expect(carrierHeavy.condition).toBe(50);
  });
});

describe("navalApprovalEffect", () => {
  it("is nothing for a country with no navy", () => {
    expect(navalApprovalEffect([])).toBe(0);
  });

  it("is nothing while the fleet is in ordinary shape", () => {
    // Above the alarm threshold a navy is taking losses in the normal course of a war and
    // nobody at home is upset about it.
    expect(navalApprovalEffect([hull(FLEET_ALARM_THRESHOLD)])).toBe(0);
    expect(navalApprovalEffect([hull(100)])).toBe(0);
  });

  it("is never positive: holding the sea is already its own reward", () => {
    // Paying approval for sea control as well as the battles it wins would double-count.
    for (const integrity of [0, 25, 50, 75, 100]) {
      expect(navalApprovalEffect([hull(integrity)])).toBeLessThanOrEqual(0);
    }
  });

  it("bites once the fleet is visibly not coming back", () => {
    expect(navalApprovalEffect([hull(FLEET_ALARM_THRESHOLD - 20)])).toBeLessThan(0);
  });

  it("gets worse as the fleet gets worse", () => {
    const bad = navalApprovalEffect([hull(50)]);
    const worse = navalApprovalEffect([hull(10)]);
    expect(worse).toBeLessThan(bad);
  });

  it("never exceeds its bound, so it cannot swamp the ground war", () => {
    // A country winning on land while losing at sea must not be dragged under by this
    // term alone.
    expect(navalApprovalEffect([hull(0)])).toBeGreaterThanOrEqual(-NAVAL_APPROVAL_BOUND);
  });

  it("is bounded below the war effort term", () => {
    // WAR_EFFORT_BOUND is 2. The naval term must stay the smaller signal.
    expect(NAVAL_APPROVAL_BOUND).toBeLessThan(2);
  });
});

describe("navalApprovalLabel", () => {
  it("names losses when hulls have actually been lost", () => {
    expect(navalApprovalLabel([hull(0)])).toBe("Naval losses");
  });

  it("names condition when the fleet is merely worn", () => {
    expect(navalApprovalLabel([hull(40)])).toBe("Fleet condition");
  });
});
