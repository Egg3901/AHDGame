/**
 * Warsaw-Pact seed + international-organization contract.
 *
 * Three things this pins:
 *
 * 1. **Census keys must be region ids.** `buildModelRegionDemographics` stamps
 *    the census key straight onto the generated `stateDemographics._id`, and the
 *    per-country seed config keys its metric/baseline overrides off the same id.
 *    A key that is not a real region silently produces orphan rows and leaves the
 *    actual region with no demographics, metrics or baselines at all — which is
 *    exactly what `BY_BEL` (the old Belarus country code) did to `BLR_BEL`.
 *
 * 2. **1953 is authored, not aliased.** Every bloc member had a 1953 region
 *    bundle but no 1953 census, so a 1953 world was seeded with 1979
 *    demographics — a quarter-century of urbanisation and mass schooling applied
 *    to Stalin's last year. Same for the shared metric baseline.
 *
 * 3. **The pact's org roster matches the world that actually seeds.** Every
 *    Warsaw Pact founding member must be a country the Cold-War presets enable,
 *    and the pact must not survive into the post-Soviet presets.
 */

import { describe, expect, it } from "vitest";
import { ROSTER_BY_KEY } from "@/lib/constants/alignmentRoster";
import type { EraId } from "@/lib/seeds/presetSelector";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import {
  resolveSeedRoster,
  isOrganizationFounded,
} from "@/lib/internationalOrganizations/founding";
import { getPresetEnablementCountries } from "@/lib/admin/seed/seedCountryGameStates";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { getPlSeedConfig } from "@/lib/seeds/pl/plSeed";
import { getHuSeedConfig } from "@/lib/seeds/hu/huSeed";
import { getRoSeedConfig } from "@/lib/seeds/ro/roSeed";
import { getBgSeedConfig } from "@/lib/seeds/bg/bgSeed";
import { getCsSeedConfig } from "@/lib/seeds/cs/csSeed";
import { getYuSeedConfig } from "@/lib/seeds/yu/yuSeed";
import { getUaSeedConfig } from "@/lib/seeds/ua/uaSeed";
import { getBlrSeedConfig } from "@/lib/seeds/blr/blrSeed";
import { getBalSeedConfig } from "@/lib/seeds/bal/balSeed";
import type { EasternBlocSeedConfig } from "@/lib/admin/seed/seedEasternBloc";

const BLOC: Array<{ id: string; getConfig: (preset: string) => EasternBlocSeedConfig }> = [
  { id: "PL", getConfig: getPlSeedConfig },
  { id: "HU", getConfig: getHuSeedConfig },
  { id: "RO", getConfig: getRoSeedConfig },
  { id: "BG", getConfig: getBgSeedConfig },
  { id: "CS", getConfig: getCsSeedConfig },
  { id: "YU", getConfig: getYuSeedConfig },
  { id: "BLR", getConfig: getBlrSeedConfig },
  { id: "BAL", getConfig: getBalSeedConfig },
  { id: "UKR", getConfig: getUaSeedConfig },
];

const ERA_PRESETS: Array<{ era: EraId; preset: string }> = [
  { era: "1953", preset: "1953-default" },
  { era: "1979", preset: "1979-default" },
];

/** Population-weighted share of a census dimension bucket across all regions. */
function meanShare(
  census: Record<string, Record<string, Record<string, number>>>,
  dim: string,
  bucket: string
): number {
  const values = Object.values(census).map((region) => region[dim]?.[bucket] ?? 0);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

describe("Eastern-bloc seed: region-id integrity", () => {
  for (const { id, getConfig } of BLOC) {
    for (const { era, preset } of ERA_PRESETS) {
      it(`${id} ${era}: census keys, metric ids and baseline ids are all real regions`, () => {
        const config = getConfig(preset);
        const regionIds = new Set(config.regions.map((r) => r._id));
        expect(regionIds.size).toBeGreaterThan(0);

        const model = getCountryLayer1Model(id, era);
        expect(model).not.toBeNull();
        for (const censusKey of Object.keys(model!.census)) {
          expect(regionIds, `${id} ${era} census key ${censusKey}`).toContain(censusKey);
        }
        // Every region must be covered, not merely every key valid — a missing
        // entry leaves that region with no demographics.
        expect(new Set(Object.keys(model!.census))).toEqual(regionIds);

        for (const metric of config.metrics) {
          expect(regionIds, `${id} ${era} metrics id ${metric._id}`).toContain(metric._id);
        }
        for (const baseline of config.baselines) {
          expect(regionIds, `${id} ${era} baseline id ${baseline._id}`).toContain(baseline._id);
        }
      });
    }
  }

  // Byelorussia is now a six-oblast republic rather than the single-region stub
  // it was while it lived inside the USSR, but the point of this test is
  // unchanged: every id carries the `BLR_` country prefix, never the legacy
  // `BY_` code, because region ids share one global namespace.
  it("Belarus keys every region on the BLR_ prefix, never the legacy BY_ code", () => {
    const expected = ["BLR_BRE", "BLR_GRO", "BLR_HOM", "BLR_MIN", "BLR_MOG", "BLR_VIT"];
    const config = getBlrSeedConfig("1979-default");
    expect(config.regions.map((r) => r._id).sort()).toEqual(expected);
    expect(config.metrics.map((m) => m._id).sort()).toEqual(expected);
    expect(Object.keys(getCountryLayer1Model("BLR", "1979")!.census).sort()).toEqual(expected);
    for (const id of config.regions.map((r) => r._id)) {
      expect(id.startsWith("BLR_"), `${id} is not country-prefixed`).toBe(true);
    }
  });

  it("the Baltics key every region on the BAL_ prefix", () => {
    const expected = ["BAL_EST", "BAL_LTU", "BAL_LVA"];
    const config = getBalSeedConfig("1979-default");
    expect(config.regions.map((r) => r._id).sort()).toEqual(expected);
    expect(config.metrics.map((m) => m._id).sort()).toEqual(expected);
    expect(Object.keys(getCountryLayer1Model("BAL", "1979")!.census).sort()).toEqual(expected);
  });

  it("Ukraine keys every region on the UKR_ prefix", () => {
    const expected = ["UKR_DNI", "UKR_DON", "UKR_KYI", "UKR_POD", "UKR_SOU", "UKR_WES"];
    const config = getUaSeedConfig("1979-default");
    expect(config.regions.map((r) => r._id).sort()).toEqual(expected);
    expect(config.metrics.map((m) => m._id).sort()).toEqual(expected);
    expect(Object.keys(getCountryLayer1Model("UKR", "1979")!.census).sort()).toEqual(expected);
  });
});

describe("Eastern-bloc seed: 1953 is authored, not a 1979 alias", () => {
  for (const { id } of BLOC) {
    it(`${id}: the 1953 census is a distinct bundle from 1979`, () => {
      const c1953 = getCountryLayer1Model(id, "1953")!.census;
      const c1979 = getCountryLayer1Model(id, "1979")!.census;
      expect(c1953).not.toEqual(c1979);
    });

    it(`${id}: 1953 is less urban and less schooled than 1979`, () => {
      const c1953 = getCountryLayer1Model(id, "1953")!.census;
      const c1979 = getCountryLayer1Model(id, "1979")!.census;
      // The bloc urbanised hard between Stalin's death and the Brezhnev years,
      // and mass secondary schooling is a 1960s-70s achievement everywhere in it.
      expect(meanShare(c1953, "urbanization", "urban")).toBeLessThan(
        meanShare(c1979, "urbanization", "urban")
      );
      expect(meanShare(c1953, "education", "primary_or_below")).toBeGreaterThan(
        meanShare(c1979, "education", "primary_or_below")
      );
      expect(meanShare(c1953, "education", "university")).toBeLessThan(
        meanShare(c1979, "education", "university")
      );
    });

    it(`${id}: the 1953 model uses the Stalinist position table, not the 1979 one`, () => {
      const m1953 = getCountryLayer1Model(id, "1953")!;
      const m1979 = getCountryLayer1Model(id, "1979")!;
      // 1979 flattened all three urbanization buckets to the same economic lean,
      // so regions were politically indistinguishable. 1953 spreads them: the
      // countryside is uncollectivised and therefore the most market-minded.
      expect(m1953.positions.urbanization.rural.economicLean).toBeGreaterThan(
        m1953.positions.urbanization.urban.economicLean
      );
      expect(m1953.positions.urbanization.rural.economicLean).toBeGreaterThan(
        m1979.positions.urbanization.rural.economicLean
      );
      // Single-list elections under terror reported near-total turnout.
      expect(m1953.turnoutRates.age.mid).toBeGreaterThan(m1979.turnoutRates.age.mid);
    });
  }

  for (const { id, getConfig } of BLOC) {
    it(`${id}: the 1953 metric baseline is authored for 1953, not the 1979 profile`, () => {
      const region1953 = getConfig("1953-default").metrics[0];
      const region1979 = getConfig("1979-default").metrics[0];
      // Reconstruction growth off a war-destroyed base, against 1979 stagnation.
      expect(region1953.economic.gdpGrowth.value).toBeGreaterThan(
        region1979.economic.gdpGrowth.value
      );
      // Mass secondary schooling, the health network and the road network are
      // all things the bloc built AFTER 1953.
      expect(region1953.education.highSchoolGradRate!.value).toBeLessThan(
        region1979.education.highSchoolGradRate!.value
      );
      expect(region1953.healthcare.physicianRate.value).toBeLessThan(
        region1979.healthcare.physicianRate.value
      );
      expect(region1953.infrastructure.roadCondition.value).toBeLessThan(
        region1979.infrastructure.roadCondition.value
      );
      // The terror state at full extent.
      expect(region1953.publicSafety.incarcerationRate.value).toBeGreaterThan(
        region1979.publicSafety.incarcerationRate.value
      );
      expect(region1953.governance.governmentTransparency.value).toBeLessThan(
        region1979.governance.governmentTransparency.value
      );
      // Postwar baby boom against the 1979 demographic plateau.
      expect(region1953.population.populationGrowth.value).toBeGreaterThan(
        region1979.population.populationGrowth.value
      );
    });
  }
});

describe("Warsaw Pact: international-organization setup", () => {
  const wp = INTERNATIONAL_ORGANIZATIONS.WARSAW_PACT;

  it("is Soviet-led, security-category, and never holds an election for its command", () => {
    expect(wp.category).toBe("security");
    expect(wp.permanentLeadership).toEqual({ countryId: "RU" });
    expect(wp.leadership.title).toBe("Supreme Commander of the Unified Command");
  });

  for (const { preset } of ERA_PRESETS) {
    it(`${preset}: every founding member is an entity this world contains`, () => {
      // The guard still matters — seating a member the world does not contain
      // would put a nameless row on every roster. What widened is "contains":
      // membership is entity-wide, so a background entity like Albania is a
      // legitimate member even though the preset seeds no country for it. A
      // seeded country is the stronger case and is checked first.
      const enabled = new Set(getPresetEnablementCountries(preset) ?? []);
      for (const member of resolveSeedRoster(wp, preset)) {
        const known =
          enabled.has(member as never) ||
          ROSTER_BY_KEY[member as keyof typeof ROSTER_BY_KEY] != null;
        expect(known, `${member} is modelled in ${preset}`).toBe(true);
      }
    });

    it(`${preset}: the pact exists`, () => {
      expect(
        isOrganizationFounded({
          def: wp,
          liveYear: getStartingYearForPreset(preset),
          hasMembers: false,
        })
      ).toBe(true);
    });
  }

  it("does not exist in the post-Soviet presets", () => {
    for (const preset of ["1991-default", "2019-default"]) {
      expect(
        isOrganizationFounded({
          def: wp,
          liveYear: getStartingYearForPreset(preset),
          hasMembers: false,
        }),
        preset
      ).toBe(false);
    }
  });

  it("excludes the Soviet union republics and non-aligned Yugoslavia", () => {
    // BLR/BAL sat inside the USSR's own membership, and Yugoslavia has been
    // outside the bloc since the 1948 Tito-Stalin split.
    for (const nonMember of ["BLR", "BAL", "YU"]) {
      expect(wp.foundingMembers).not.toContain(nonMember);
    }
  });
});
