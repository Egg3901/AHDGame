/**
 * Bridge A — TFP for playable regions.
 *
 * 4 of the 6 tfpBasket inputs (workforceSkill, transportEfficiency,
 * broadbandAccess, powerGridReliability) live on demolished stateMetrics
 * categories, so before the bridge every playable region resolved them to
 * TFP_REFERENCE_INPUTS and potential growth was near-uniform.
 */
import { describe, expect, it } from "vitest";
import { tfpBasket } from "./potentialGrowth";
import { legacyUnitFromPoliticalScore } from "@/lib/politicalLegislation/legacyUnitBands";

const basketFromScore = (score: number) =>
  tfpBasket({
    rdIntensity: undefined,
    workforceSkill: legacyUnitFromPoliticalScore("education.workforceSkill", score) ?? undefined,
    transportEfficiency:
      legacyUnitFromPoliticalScore("infrastructure.transportEfficiency", score) ?? undefined,
    broadbandAccess:
      legacyUnitFromPoliticalScore("infrastructure.broadbandAccess", score) ?? undefined,
    powerGridReliability:
      legacyUnitFromPoliticalScore("infrastructure.powerGridReliability", score) ?? undefined,
    urbanizationRate: undefined,
  });

describe("TFP responds to the political board", () => {
  it("a strong board yields higher TFP than a weak one", () => {
    expect(basketFromScore(95)).toBeGreaterThan(basketFromScore(5));
  });

  it("the political neutral reproduces the all-absent reference basket", () => {
    const allAbsent = tfpBasket({
      rdIntensity: undefined,
      workforceSkill: undefined,
      transportEfficiency: undefined,
      broadbandAccess: undefined,
      powerGridReliability: undefined,
      urbanizationRate: undefined,
    });
    expect(basketFromScore(50)).toBeCloseTo(allAbsent, 10);
  });
});
