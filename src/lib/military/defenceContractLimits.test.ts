import { describe, expect, it } from "vitest";
import {
  DEFENCE_CONTRACT_WINDOW_TURNS,
  defenceContractLotCaps,
  defenceContractWindow,
} from "./defenceContractLimits";

describe("defence contract limits", () => {
  it("caps the live US budget at three country lots and one lot per supplier", () => {
    expect(defenceContractLotCaps(65_081_266_164.8, 372_025_176)).toMatchObject({
      countryLots: 3,
      supplierLots: 1,
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
