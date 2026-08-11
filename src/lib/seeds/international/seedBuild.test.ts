/**
 * Smoke tests for the Layer-1 seed build path.
 *
 * For each supported international country, verifies that
 * `buildModelRegionDemographics(getCountryLayer1Model(cc, "2019")!)` returns a
 * non-empty array of StateDemographics with valid invariants:
 *   - categoryWeights sums to 100
 *   - every group's economicLean and socialLean are within [-5, 5]
 *   - every group's population >= 0
 *
 * Also verifies that "US" (not in the registry) returns null.
 */

import { describe, it, expect } from "vitest";
import { getCountryLayer1Model, buildModelRegionDemographics } from "./index";

const COUNTRIES = ["UK", "DE", "JP", "IE", "BR", "CN"] as const;

describe("buildModelRegionDemographics — seed build smoke tests", () => {
  for (const cc of COUNTRIES) {
    describe(`${cc}`, () => {
      it("returns a non-empty array for era 2019", () => {
        const model = getCountryLayer1Model(cc, "2019");
        expect(model).not.toBeNull();
        const regions = buildModelRegionDemographics(model!);
        expect(regions.length).toBeGreaterThan(0);
      });

      it("every region has categoryWeights summing to 100", () => {
        const model = getCountryLayer1Model(cc, "2019");
        const regions = buildModelRegionDemographics(model!);
        for (const region of regions) {
          const total = (Object.values(region.categoryWeights) as number[]).reduce(
            (sum: number, w: number) => sum + w,
            0
          );
          expect(total, `${cc} region ${region._id} categoryWeights sum = ${total}`).toBe(100);
        }
      });

      it("every group's economicLean and socialLean are within [-5, 5]", () => {
        const model = getCountryLayer1Model(cc, "2019");
        const regions = buildModelRegionDemographics(model!);
        for (const region of regions) {
          for (const [gid, group] of Object.entries(region.groups)) {
            expect(
              group.economicLean,
              `${cc} ${region._id}.${gid} economicLean out of range`
            ).toBeGreaterThanOrEqual(-5);
            expect(
              group.economicLean,
              `${cc} ${region._id}.${gid} economicLean out of range`
            ).toBeLessThanOrEqual(5);
            expect(
              group.socialLean,
              `${cc} ${region._id}.${gid} socialLean out of range`
            ).toBeGreaterThanOrEqual(-5);
            expect(
              group.socialLean,
              `${cc} ${region._id}.${gid} socialLean out of range`
            ).toBeLessThanOrEqual(5);
          }
        }
      });

      it("every group's population is >= 0", () => {
        const model = getCountryLayer1Model(cc, "2019");
        const regions = buildModelRegionDemographics(model!);
        for (const region of regions) {
          for (const [gid, group] of Object.entries(region.groups)) {
            expect(
              group.population,
              `${cc} ${region._id}.${gid} population < 0`
            ).toBeGreaterThanOrEqual(0);
          }
        }
      });
    });
  }

  it('getCountryLayer1Model("US", "2019") returns null (US not in registry)', () => {
    expect(getCountryLayer1Model("US", "2019")).toBeNull();
  });
});

describe("buildModelRegionDemographics — override merge", () => {
  it("no override is byte-identical to passing undefined", () => {
    const model = getCountryLayer1Model("UK", "2019")!;
    const base = buildModelRegionDemographics(model);
    const same = buildModelRegionDemographics(model, undefined, undefined);
    expect(JSON.stringify(same.map((r) => ({ ...r, lastUpdated: 0 })))).toBe(
      JSON.stringify(base.map((r) => ({ ...r, lastUpdated: 0 })))
    );
  });

  it("composition override (civicMultiplier) changes that archetype's population/turnout", () => {
    const model = getCountryLayer1Model("UK", "2019")!;
    // Pick an archetype with a real composition entry to perturb.
    const gid = model.groupIds.find((g) => (model.composition[g]?.weights.length ?? 0) > 0)!;
    expect(gid).toBeDefined();
    const base = buildModelRegionDemographics(model);
    const orig = model.composition[gid];

    const overridden = buildModelRegionDemographics(model, undefined, {
      composition: {
        [gid]: { weights: orig.weights, civicMultiplier: (orig.civicMultiplier ?? 1) + 3 },
      },
    });

    const region = base[0]._id;
    const baseGroup = base.find((r) => r._id === region)!.groups[gid];
    const ovGroup = overridden.find((r) => r._id === region)!.groups[gid];
    // Raising civicMultiplier raises this archetype's relative weight (population)
    // and its derived turnout.
    expect(ovGroup.population).toBeGreaterThan(baseGroup.population);
    expect(ovGroup.turnout ?? 0).toBeGreaterThan(baseGroup.turnout ?? 0);
  });

  it("turnout override changes derived archetype turnout", () => {
    const model = getCountryLayer1Model("UK", "2019")!;
    const gid = model.groupIds.find((g) => (model.composition[g]?.weights.length ?? 0) > 0)!;
    const { dim, key } = model.composition[gid].weights[0];

    const base = buildModelRegionDemographics(model);
    const overridden = buildModelRegionDemographics(model, undefined, {
      turnout: { [dim]: { [key]: 90 } },
    });

    const region = base[0]._id;
    const baseGroup = base.find((r) => r._id === region)!.groups[gid];
    const ovGroup = overridden.find((r) => r._id === region)!.groups[gid];
    expect(ovGroup.turnout).not.toBe(baseGroup.turnout);
  });
});
