import { describe, expect, it } from "vitest";
import {
  DEFENCE_CONTRACT_WINDOW_TURNS,
  defenceContractLotCaps,
  defenceContractWindow,
} from "./defenceContractLimits";

describe("defence contract limits", () => {
  it("turns the live US budget into a 19-lot country tranche and 6-lot supplier cap (ticket 1108)", () => {
    // A hard country ceiling of 3 lots collapses the 1/3 supplier share to 1 lot
    // per company, which is what made DoD awards unusable. The window is budget-
    // scaled; the supplier share is the anti-dumping cap.
    expect(defenceContractLotCaps(65_081_266_164.8, 372_025_176)).toMatchObject({
      countryLots: 19,
      supplierLots: 6,
    });
  });

  it("uses fixed quarter-year windows", () => {
    expect(DEFENCE_CONTRACT_WINDOW_TURNS).toBe(12);
    expect(defenceContractWindow("US", 1)).toMatchObject({
      id: "US:0",
      startTurn: 1,
      endTurn: 12,
    });
    expect(defenceContractWindow("US", 13)).toMatchObject({
      id: "US:1",
      startTurn: 13,
      endTurn: 24,
    });
  });

  it("closes procurement when either the budget or lot price is unusable", () => {
    expect(defenceContractLotCaps(0, 100).countryLots).toBe(0);
    expect(defenceContractLotCaps(100, 0).supplierLots).toBe(0);
  });
});
