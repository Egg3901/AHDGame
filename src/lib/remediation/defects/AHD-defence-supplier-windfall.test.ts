import { describe, expect, it } from "vitest";
import {
  LEGACY_CONTRACT_GROSS,
  OPERATING_RESERVE,
  RECORDED_LEGACY_PRODUCTION_COST,
  RETAINED_LEGACY_PROFIT,
  RETAINED_MARGIN_RATE,
  SOURCE_CONTRACT_IDS,
  TOTAL_ASSESSMENT,
  computeRecoveryTranche,
  defect,
} from "./AHD-defence-supplier-windfall";

describe("legacy defence supplier windfall settlement", () => {
  it("pins the five audited contracts and retains a generous 20 percent margin", () => {
    expect(SOURCE_CONTRACT_IDS).toHaveLength(5);
    expect(LEGACY_CONTRACT_GROSS).toBe(11_443_922_106);
    expect(RECORDED_LEGACY_PRODUCTION_COST).toBe(5_455);
    expect(RETAINED_MARGIN_RATE).toBe(0.2);
    expect(RETAINED_LEGACY_PROFIT).toBeCloseTo(2_288_784_421.2, 2);
    expect(TOTAL_ASSESSMENT).toBeCloseTo(9_155_132_229.8, 2);
  });

  it("collects only cash above the operating reserve", () => {
    expect(computeRecoveryTranche(7_036_739_423.88, TOTAL_ASSESSMENT)).toBe(6_536_739_423.88);
    expect(computeRecoveryTranche(OPERATING_RESERVE, TOTAL_ASSESSMENT)).toBe(0);
    expect(computeRecoveryTranche(OPERATING_RESERVE - 1, TOTAL_ASSESSMENT)).toBe(0);
    expect(computeRecoveryTranche(20_000_000_000, TOTAL_ASSESSMENT)).toBe(TOTAL_ASSESSMENT);
  });

  it("is production-only, idempotent, and money-conserving", () => {
    expect(defect.envs).toEqual(["prod"]);
    expect(defect.idempotent).toBe(true);
    expect(defect.guards).toContain("turn-lock-free");
    expect(defect.guards).toContain("money-conserving");
  });
});
