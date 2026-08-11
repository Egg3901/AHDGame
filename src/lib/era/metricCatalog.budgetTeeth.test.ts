import { describe, expect, it } from "vitest";
import { getEraBand } from "./metricCatalog";
import { THRESHOLDS } from "@/lib/utils/metricScoring";

describe("Spec B fiscal teeth — budgetBalance era band", () => {
  it("flag on (year set): tighter worst than the global THRESHOLDS", () => {
    const band = getEraBand("budgetBalance", undefined, 2019);
    expect(band).not.toBeNull();
    expect(band!.worst).toBe(-6);
    expect(band!.best).toBe(3);
    // THRESHOLDS (flag-off) is the looser -8.
    expect(THRESHOLDS.budgetBalance.worst).toBe(-8);
    expect(band!.worst).toBeGreaterThan(THRESHOLDS.budgetBalance.worst);
  });

  it("flag off (year null): no era band ⇒ scoring uses THRESHOLDS", () => {
    expect(getEraBand("budgetBalance", undefined, null)).toBeNull();
  });
});
