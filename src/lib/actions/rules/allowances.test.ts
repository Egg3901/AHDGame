import { describe, expect, it } from "vitest";
import { getActionBreakdown } from "../actionBreakdown";
import { resolveOfficeActionBonus } from "../officeActionBonus";
import { energyActionLimits } from "@/lib/stats/statDrift";
import {
  partyActionAllowance,
  playerActionAllowance,
  playerBaseActionGain,
  refreshPersonalActionBank,
} from "./allowances";

describe("player action allowance trajectories", () => {
  it("keeps an idle ordinary player near the scaled soft cap over 1008 turns", () => {
    const { cap, threshold } = energyActionLimits(1);
    let actions = 0;
    for (let turn = 0; turn < 1008; turn++) {
      actions = refreshPersonalActionBank(actions, playerBaseActionGain(4), cap, threshold);
    }
    expect(actions).toBe(130);
    expect(actions).toBeLessThan(cap);
  });

  it("retains quarter actions while an active office holder spends whole actions", () => {
    let actions = 0;
    let spent = 0;
    const office = resolveOfficeActionBonus({
      currentOfficeType: "house",
      electedSeatOfficeType: "house",
      isCabinetMember: false,
      cabinetOfficeType: undefined,
      officeActionBonus: { house: 1 },
      countryId: "US",
    });
    for (let turn = 0; turn < 4; turn++) {
      actions = refreshPersonalActionBank(actions, playerBaseActionGain(4) + office, 250, 125);
      const available = Math.floor(actions);
      spent += available;
      actions -= available;
    }
    expect(spent).toBe(25);
    expect(actions).toBe(0);
  });

  it("makes the displayed cabinet, seat, chair and party grants equal the accrued total", () => {
    const office = {
      currentOfficeType: "parliamentaryCabinet",
      electedSeatOfficeType: "bundestag",
      isCabinetMember: true,
      cabinetOfficeType: "parliamentaryCabinet",
      officeActionBonus: { bundestag: 1, parliamentaryCabinet: 1 },
      countryId: "DE" as const,
    };
    const base = playerBaseActionGain(4);
    const chair = playerActionAllowance(3);
    const party = partyActionAllowance(10, 10, 3, 1, 4);
    const lines = getActionBreakdown({
      ...office,
      cabinetPositionId: "defense_minister",
      baseActionsPerTurn: base,
      chairActionBonus: chair,
      bonusActionsFromParty: party,
    });
    const accrued =
      refreshPersonalActionBank(0, base + resolveOfficeActionBonus(office) + chair, 250, 125) +
      party;
    expect(accrued).toBe(15);
    expect(lines.reduce((total, line) => total + line.amount, 0)).toBe(accrued);
  });
});
