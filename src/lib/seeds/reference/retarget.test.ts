import { describe, expect, it } from "vitest";
import { legislationTypes } from "./legislationTypes";
import { METRIC_ERA_WINDOWS } from "@/lib/era/metricCatalog";
import { LEGISLATION_ERA } from "@/lib/era/legislationCatalog";

const byId = new Map(legislationTypes.map((t) => [t._id, t]));

/**
 * RETARGET types re-pointed in Spec B (8 of the 11 flagged). The three CN
 * pension/internet-governance flags were considered and REVERTED in the audit:
 * rentenStabilitaet is the functionally-correct structural pension metric (any
 * income/poverty cluster target double-counts the spending channel — §4.7), and
 * cn_internet_governance is designed to co-drive socialCreditCoverage (its window
 * is handled by Spec A's WAIVER). Name-only smells, kept as-is.
 */
const RETARGETED: Record<string, string> = {
  jp_rd_investment: "rdIntensity",
  de_family_policy: "birthRate",
  ie_immigration_asylum: "migrationRate",
  ie_regional_health: "physicianRate",
  ie_peat_bog_policy: "protectedLand",
  cn_un_security_council_posture: "nationalPride",
  cn_diaspora_engagement: "nationalPride",
  cn_provincial_environmental_policy: "airQuality",
};

describe("RETARGET (Spec B clean subset)", () => {
  it("each type's primary weight-1.0 target is the re-pointed metric", () => {
    for (const [id, metric] of Object.entries(RETARGETED)) {
      const lt = byId.get(id);
      const primary =
        lt?.effectTargetsWeighted?.find((t) => t.weight === 1.0) ?? lt?.effectTargetsWeighted?.[0];
      expect(primary?.metricId, id).toBe(metric);
      // effectTarget (single) should agree with the weighted primary.
      expect(lt?.effectTarget?.metricId, id).toBe(metric);
    }
  });

  it("each re-pointed primary respects rule #2 (from >= metric window)", () => {
    for (const [id, metric] of Object.entries(RETARGETED)) {
      const from = LEGISLATION_ERA[id];
      const mw = METRIC_ERA_WINDOWS[metric];
      if (mw && typeof from === "number") expect(from, id).toBeGreaterThanOrEqual(mw.from);
    }
  });
});
