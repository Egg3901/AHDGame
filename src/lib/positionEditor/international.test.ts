import { describe, it, expect } from "vitest";
import { getCountryLayer1Model, buildModelRegionDemographics } from "@/lib/seeds/international";
import { editorConfigFromCountryModel, computeDerivedCompositionGeneric } from "./derive";
import { ukDemographicCategories } from "@/lib/seeds/uk/ukDemographicCategories";
import { deDemographicCategories } from "@/lib/seeds/de/deDemographicCategories";
import { jpDemographicCategories } from "@/lib/seeds/jp/jpDemographicCategories";
import { ieDemographicCategories } from "@/lib/seeds/ie/ieDemographicCategories";
import { brDemographicCategories } from "@/lib/seeds/br/brDemographicCategories";
import { cnDemographicCategories } from "@/lib/seeds/cn/cnDemographicCategories";
import type { DemographicCategory } from "@/lib/db/types";

const COUNTRIES: Array<{
  id: string;
  era: string;
  categories: DemographicCategory[];
}> = [
  { id: "UK", era: "2019", categories: ukDemographicCategories },
  { id: "DE", era: "2019", categories: deDemographicCategories },
  { id: "JP", era: "2019", categories: jpDemographicCategories },
  { id: "IE", era: "2019", categories: ieDemographicCategories },
  { id: "BR", era: "2019", categories: brDemographicCategories },
  { id: "CN", era: "2019", categories: cnDemographicCategories },
];

describe("international positionEditor", () => {
  for (const { id, era, categories } of COUNTRIES) {
    describe(`${id} era=${era}`, () => {
      it("getCountryLayer1Model returns non-null", () => {
        const model = getCountryLayer1Model(id, era as "2019");
        expect(model).not.toBeNull();
      });

      it("editorConfigFromCountryModel returns valid config with correct dims and layer1", () => {
        const model = getCountryLayer1Model(id, era as "2019")!;
        const firstRegionId = Object.keys(model.census)[0];
        expect(firstRegionId).toBeDefined();

        const archetypeNames: Record<string, string> = {};
        for (const cat of categories) {
          for (const g of cat.groups) archetypeNames[g.id] = g.name;
        }

        const config = editorConfigFromCountryModel(
          model,
          firstRegionId,
          era as "2019",
          archetypeNames
        );
        expect(config.dims).toEqual(model.dims);
        expect(config.countryId).toBe(id);
        expect(config.stateId).toBe(firstRegionId);

        // layer1 should have entries for each dim
        for (const dim of model.dims) {
          expect(config.layer1[dim]).toBeDefined();
          expect(Object.keys(config.layer1[dim]).length).toBeGreaterThan(0);
        }
      });

      it("computeDerivedCompositionGeneric returns archetypes and state lean in [-5,5]", () => {
        const model = getCountryLayer1Model(id, era as "2019")!;
        const firstRegionId = Object.keys(model.census)[0];

        const archetypeNames: Record<string, string> = {};
        for (const cat of categories) {
          for (const g of cat.groups) archetypeNames[g.id] = g.name;
        }

        const config = editorConfigFromCountryModel(
          model,
          firstRegionId,
          era as "2019",
          archetypeNames
        );
        const derived = computeDerivedCompositionGeneric(config);

        expect(derived.archetypes.length).toBe(model.groupIds.length);
        expect(derived.stateEconomicLean).toBeGreaterThanOrEqual(-5);
        expect(derived.stateEconomicLean).toBeLessThanOrEqual(5);
        expect(derived.stateSocialLean).toBeGreaterThanOrEqual(-5);
        expect(derived.stateSocialLean).toBeLessThanOrEqual(5);
      });
    });
  }
});

describe("buildModelRegionDemographics with positionsOverride", () => {
  it("override changes archetype leans for at least one region", () => {
    const model = getCountryLayer1Model("UK", "2019");
    expect(model).not.toBeNull();
    if (!model) return;

    const baseline = buildModelRegionDemographics(model);

    // Build an override that pins ALL positions in the first dim to extreme values
    const firstDim = model.dims[0];
    const extremeOverride: Record<
      string,
      Record<string, { economicLean: number; socialLean: number }>
    > = {
      [firstDim]: Object.fromEntries(
        Object.keys(model.positions[firstDim] ?? {}).map((key) => [
          key,
          { economicLean: 5, socialLean: 5 },
        ])
      ),
    };

    const overridden = buildModelRegionDemographics(model, extremeOverride);

    // At least one region should have a different lean after the override
    const anyDiffers = overridden.some((region, i) => {
      const base = baseline[i];
      return Object.keys(region.groups).some(
        (gid) =>
          region.groups[gid].economicLean !== base.groups[gid].economicLean ||
          region.groups[gid].socialLean !== base.groups[gid].socialLean
      );
    });

    expect(anyDiffers).toBe(true);
  });
});
