import { describe, expect, it } from "vitest";
import {
  enforcementApprovalModifier,
  enforcementTreasuryCostPerTurn,
  undergroundUnrestVisible,
} from "./enforcementCosts";

describe("union enforcement posture costs", () => {
  it("charges a bounded GDP-indexed treasury cost only for an active crackdown", () => {
    expect(enforcementTreasuryCostPerTurn(48_000_000, true, "crackdown")).toBe(1_000);
    expect(enforcementTreasuryCostPerTurn(48_000_000, true, "normal")).toBe(0);
    expect(enforcementTreasuryCostPerTurn(48_000_000, false, "crackdown")).toBe(0);
    expect(enforcementTreasuryCostPerTurn(Number.NaN, true, "crackdown")).toBe(0);
  });

  it("applies and removes the visible approval cost with the standing posture", () => {
    expect(enforcementApprovalModifier(true, "crackdown")).toEqual({
      id: "union_crackdown",
      label: "Union crackdown",
      effect: -2,
    });
    expect(enforcementApprovalModifier(true, "tolerant")).toBeNull();
    expect(enforcementApprovalModifier(false, "crackdown")).toBeNull();
  });

  it("reports strong underground unrest publicly only during a ban", () => {
    expect(undergroundUnrestVisible(true, 20)).toBe(true);
    expect(undergroundUnrestVisible(true, 19.9)).toBe(false);
    expect(undergroundUnrestVisible(false, 40)).toBe(false);
  });
});
