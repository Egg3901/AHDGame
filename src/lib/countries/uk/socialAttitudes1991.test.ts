import { describe, expect, it } from "vitest";
import { getUkModel } from "./layer1Model";
import { buildModelRegionDemographics } from "@/lib/seeds/international/derive";
import { ukDemographicCategories } from "@/lib/seeds/uk/ukDemographicCategories";
import { calculateStateLean } from "@/lib/utils/demographics";
import {
  computeDerivedCompositionGeneric,
  editorConfigFromCountryModel,
} from "@/lib/positionEditor/derive";

describe("UK 1991 social attitudes derive from demographic inputs", () => {
  const model = getUkModel("1991");

  it("keeps the published 1991 age and education gradients independent of party vote", () => {
    const { age, education, income } = model.positions;
    expect(age.young.socialLean).toBeLessThan(age.mid.socialLean);
    expect(age.mid.socialLean).toBeLessThan(age.mature.socialLean);
    expect(age.mature.socialLean).toBeLessThan(age.senior.socialLean);
    expect(education.degree_plus.socialLean).toBeLessThan(education.a_level_equivalent.socialLean);
    expect(education.a_level_equivalent.socialLean).toBeLessThan(
      education.gcse_equivalent.socialLean
    );
    expect(education.gcse_equivalent.socialLean).toBeLessThan(
      education.no_qualifications.socialLean
    );
    expect(income.high.socialLean).toBeLessThan(income.middle.socialLean);
    expect(income.middle.socialLean).toBeLessThan(income.low.socialLean);
  });

  it("responds to age and education share changes without a regional social offset", () => {
    function social(census: typeof model.census) {
      const doc = buildModelRegionDemographics({ ...model, census })[0];
      return calculateStateLean(doc, ukDemographicCategories).socialLean;
    }
    const london = structuredClone(model.census.LON);
    const baseline = social({ LON: london });
    const older = structuredClone(london);
    older.age.young -= 10;
    older.age.senior += 10;
    expect(social({ LON: older })).toBeGreaterThan(baseline);
    const fewerGraduates = structuredClone(london);
    fewerGraduates.education.degree_plus -= 10;
    fewerGraduates.education.no_qualifications += 10;
    expect(social({ LON: fewerGraduates })).toBeGreaterThan(baseline);
    for (const context of Object.values(model.regionalContext ?? {})) {
      expect(context.socialLean ?? 0).toBe(0);
    }
  });

  it("keeps every two-decimal editor aggregate equal to the persisted demographic mean", () => {
    for (const doc of buildModelRegionDemographics(model)) {
      const expected = calculateStateLean(doc, ukDemographicCategories);
      const editor = computeDerivedCompositionGeneric(
        editorConfigFromCountryModel(model, String(doc._id), "1991", {})
      );
      expect(editor.stateEconomicLean, String(doc._id)).toBe(expected.economicLean);
      expect(editor.stateSocialLean, String(doc._id)).toBe(expected.socialLean);
    }
  });
});
