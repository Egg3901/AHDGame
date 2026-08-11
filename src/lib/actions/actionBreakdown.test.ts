/**
 * Unit tests for getActionBreakdown — the labeled per-source action breakdown
 * rendered in the Political Standing tooltip. Uses real country/cabinet config
 * for label resolution.
 */
import { describe, it, expect } from "vitest";
import { getActionBreakdown } from "./actionBreakdown";

const OAB = {
  bundestag: 1,
  ministerPresident: 2,
  parliamentaryCabinet: 1,
  usCabinet: 1,
};

describe("getActionBreakdown", () => {
  it("splits office and cabinet onto labeled lines for a DE cabinet minister", () => {
    const lines = getActionBreakdown({
      currentOfficeType: "parliamentaryCabinet",
      electedSeatOfficeType: "bundestag",
      isCabinetMember: true,
      cabinetPositionId: "defense_minister",
      countryId: "DE",
      officeActionBonus: OAB,
      baseActionsPerTurn: 4,
      chairActionBonus: 0,
      bonusActionsFromParty: 3,
    });
    expect(lines).toEqual([
      { label: "Base", amount: 4 },
      { label: "Office (Member of Bundestag)", amount: 1 },
      { label: "Cabinet (Federal Minister of Defence)", amount: 1 },
      { label: "Party influence", amount: 3 },
    ]);
  });

  it("omits zero-value sources (no chair, no party)", () => {
    const lines = getActionBreakdown({
      currentOfficeType: "bundestag",
      electedSeatOfficeType: "bundestag",
      isCabinetMember: false,
      cabinetPositionId: undefined,
      countryId: "DE",
      officeActionBonus: OAB,
      baseActionsPerTurn: 4,
      chairActionBonus: 0,
      bonusActionsFromParty: 0,
    });
    expect(lines).toEqual([
      { label: "Base", amount: 4 },
      { label: "Office (Member of Bundestag)", amount: 1 },
    ]);
  });

  it("includes the chair line and stacks a real office with cabinet (Minister-President case)", () => {
    const lines = getActionBreakdown({
      currentOfficeType: "ministerPresident",
      electedSeatOfficeType: "ministerPresident",
      isCabinetMember: true,
      cabinetPositionId: "environment_minister",
      countryId: "DE",
      officeActionBonus: OAB,
      baseActionsPerTurn: 4,
      chairActionBonus: 3,
      bonusActionsFromParty: 0,
    });
    expect(lines).toEqual([
      { label: "Base", amount: 4 },
      { label: "Office (Minister-President)", amount: 2 },
      { label: "Cabinet (Federal Minister for the Environment)", amount: 1 },
      { label: "Central Bank Chair", amount: 3 },
    ]);
  });

  it("shows only Base and Party for a backbencher with no office", () => {
    const lines = getActionBreakdown({
      currentOfficeType: undefined,
      electedSeatOfficeType: undefined,
      isCabinetMember: false,
      cabinetPositionId: undefined,
      countryId: "DE",
      officeActionBonus: OAB,
      baseActionsPerTurn: 4,
      chairActionBonus: 0,
      bonusActionsFromParty: 2,
    });
    expect(lines).toEqual([
      { label: "Base", amount: 4 },
      { label: "Party influence", amount: 2 },
    ]);
  });
});
