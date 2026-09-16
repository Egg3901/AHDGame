import { describe, it, expect } from "vitest";
import { jpLegislationTypes } from "./jpLegislationTypes";
import type { LegislationType } from "@/lib/db/types";

/**
 * P6.2b — JP both-law audit. Of the 45 effectively-`both` JP laws, most
 * genuinely span both axes (welfare/health/education/pension = spending +
 * social provision). These five are genuinely SOCIAL (auth↔lib) — policing
 * and criminal justice are civil-liberties questions whose budget is
 * incidental; gender equality is a civil-rights matter; digital governance is
 * surveillance/e-gov. Effective axis is derived from option scores.
 */

function effectiveAxis(t: LegislationType): "economic" | "social" | "both" | "none" {
  const opts = t.policyOptions ?? [];
  const hasEcon = opts.some((o) => (o.economic ?? 0) !== 0);
  const hasSoc = opts.some((o) => (o.social ?? 0) !== 0);
  return hasEcon && hasSoc ? "both" : hasEcon ? "economic" : hasSoc ? "social" : "none";
}

const byId = new Map(jpLegislationTypes.map((t) => [t._id, t]));
function axisOf(id: string): string {
  const t = byId.get(id);
  expect(t, `law ${id} must exist`).toBeDefined();
  return effectiveAxis(t!);
}

describe("P6.2b JP axis re-tags", () => {
  it("re-tags genuinely-social JP laws to the social axis", () => {
    for (const id of [
      "jp_policing_public_safety",
      "jp_criminal_justice",
      "jp_regional_policing",
      "jp_gender_equality",
      "jp_digital_governance",
    ]) {
      expect(axisOf(id), id).toBe("social");
    }
  });

  it("keeps genuinely-both JP laws on both axes (control set)", () => {
    for (const id of [
      "jp_national_health_insurance",
      "jp_family_policy",
      "jp_foreign_worker_policy",
    ]) {
      expect(axisOf(id), id).toBe("both");
    }
  });
});
