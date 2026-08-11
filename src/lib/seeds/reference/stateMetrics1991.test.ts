import { describe, expect, it } from "vitest";
import { applyEra1991Adjustments } from "./stateMetrics1991";
import { applyEra1991BaselineAdjustments } from "./stateBaselines1991";
import { deStateMetrics } from "@/lib/seeds/de/deStateMetrics";
import { deStateBaselines } from "@/lib/seeds/de/deStateBaselines";
import type { StateMetrics } from "@/lib/db/types";

describe("1991 era adjustment — per-region population anchors", () => {
  // Full top-level category set: applyEra1991Adjustments' country-specific blocks
  // dereference economic/healthcare/environment/social unguarded (real StateMetrics
  // always have them).
  const baseMetrics = (
    id: string,
    countryId: string,
    medianAge: number,
    birthRate: number
  ): StateMetrics =>
    ({
      _id: id,
      countryId,
      economic: {},
      education: {},
      healthcare: {},
      infrastructure: {},
      publicSafety: {},
      environment: {},
      social: {},
      governance: {},
      mediaInformation: {},
      population: { medianAge: { value: medianAge }, birthRate: { value: birthRate } },
    }) as unknown as StateMetrics;

  it("uses the per-region 1991 anchor for medianAge + birthRate (IE DUB)", () => {
    const out = applyEra1991Adjustments(baseMetrics("DUB", "IE", 36, 52));
    // iePopulationAnchors1991.DUB = { medianAge: 29, birthRate: 70 }
    expect(out.population!.medianAge!.value).toBe(29);
    expect(out.population!.birthRate!.value).toBe(70);
  });

  it("falls back to the blanket medianAge shift when no anchor exists for the region", () => {
    const out = applyEra1991Adjustments(baseMetrics("UNKNOWN_REGION", "IE", 40, 50));
    expect(out.population!.medianAge!.value).toBe(35); // 40 − 5 blanket
    expect(out.population!.birthRate!.value).toBe(50); // unchanged (no anchor)
  });
});

/**
 * Schuldenbremse (Art. 109 GG debt brake) was constitutionalized in 2009 — an
 * anachronism in a 1991 world. Under the metric era catalog the field STAYS on
 * DE docs (read-time-gate contract): the era window (from 2009) hides it from
 * display and approval, and the budget-sync fiscalMirror re-derives the value
 * era-consistently each turn. Deleting it (the old behavior) broke field
 * presence and left activation with no value behind it (spec supersedes-#2).
 */
describe("1991 era adjustment — schuldenbremse anachronism", () => {
  it("KEEPS schuldenbremseHeadroom on DE metrics (era window hides it instead)", () => {
    const de = deStateMetrics[0]!;
    expect(de.governance.schuldenbremseHeadroom).toBeDefined(); // precondition: 2019 DE has it
    const adjusted = applyEra1991Adjustments(de);
    expect(adjusted.governance.schuldenbremseHeadroom).toBeDefined();
  });

  it("KEEPS schuldenbremseHeadroom on DE baselines", () => {
    const base = deStateBaselines[0]!;
    const baselineGov = (base.baselines as Record<string, Record<string, number>>).governance;
    expect(baselineGov.schuldenbremseHeadroom).toBeDefined(); // precondition
    const adjusted = applyEra1991BaselineAdjustments(base);
    const adjGov = (adjusted.baselines as Record<string, Record<string, number>>).governance;
    expect(adjGov.schuldenbremseHeadroom).toBeDefined();
  });
});
