import { describe, expect, it } from "vitest";
import { ELECTION_1952_MARGIN } from "@/lib/data/1952ElectionResults";
import { deriveGranularElectorateUnits } from "@/lib/demographics/granularElectorate";
import { calculateStateLeanForCache } from "@/lib/demographics/cachedStateLean";
import { demographicCategories } from "@/lib/seeds/demographicCategories";
import { registerAndGenerate, stateCensusData } from "@/lib/seeds/stateDemographics";
import { stateCensusData1953 } from "@/lib/seeds/stateCensusData1953";

const VOTES_1952: Record<string, number> = {
  AL: 426120,
  AZ: 260570,
  AR: 404800,
  CA: 5341603,
  CO: 630103,
  CT: 1096911,
  DE: 174025,
  FL: 989337,
  GA: 655803,
  ID: 276231,
  IL: 4481058,
  IN: 1955325,
  IA: 1268773,
  KS: 896166,
  KY: 993148,
  LA: 651952,
  ME: 351786,
  MD: 902074,
  MA: 2383398,
  MI: 2798592,
  MN: 1379483,
  MS: 285532,
  MO: 1892062,
  MT: 265037,
  NE: 609660,
  NV: 82190,
  NH: 272950,
  NJ: 2419554,
  NM: 238608,
  NY: 7128241,
  NC: 1210910,
  ND: 270127,
  OH: 3700758,
  OK: 948984,
  OR: 695059,
  PA: 4580969,
  RI: 414498,
  SC: 341086,
  SD: 294283,
  TN: 892553,
  TX: 2075946,
  UT: 329554,
  VT: 153557,
  VA: 619689,
  WA: 1102708,
  WV: 873548,
  WI: 1607370,
  WY: 129251,
};

describe("calculateStateLeanForCache", () => {
  it("matches the calibrated granular electorate in every 1953 US state", () => {
    let nationalEconomic = 0;
    let nationalWeight = 0;

    for (const stateId of Object.keys(ELECTION_1952_MARGIN)) {
      const census = stateCensusData1953[stateId];
      expect(census, stateId).not.toBeNull();
      if (!census) continue;

      const demographics = registerAndGenerate(stateId, census, "1953");
      const cached = calculateStateLeanForCache(demographics, demographicCategories, {
        countryId: "US",
        stateId,
        preset: "1953-default",
      });
      const granular = deriveGranularElectorateUnits("US", stateId, "1953-default", null);
      expect(granular, stateId).not.toBeNull();
      if (!granular) continue;

      let economic = 0;
      let social = 0;
      let electorate = 0;
      for (const unit of granular.units) {
        const weight = unit.share * unit.turnout;
        economic += weight * unit.economicLean;
        social += weight * unit.socialLean;
        electorate += weight;
      }

      expect(cached.economicLean, `${stateId} economic`).toBeCloseTo(economic / electorate, 2);
      expect(cached.socialLean, `${stateId} social`).toBeCloseTo(social / electorate, 2);

      const votes = VOTES_1952[stateId];
      nationalEconomic += cached.economicLean * votes;
      nationalWeight += votes;
    }

    expect(Object.keys(ELECTION_1952_MARGIN)).toHaveLength(48);
    // 2026-08 compressed calibration: national tilt is a MILD Ike lean
    // (~+0.09), half the old full-margin R+10.9 reconstruction by design.
    expect(nationalEconomic / nationalWeight).toBeGreaterThanOrEqual(0.03);
    expect(nationalEconomic / nationalWeight).toBeLessThanOrEqual(0.2);
  });

  it("keeps the legacy cache derivation outside the audited 1953 US world", () => {
    const stateId = "CA";
    const census = stateCensusData[stateId];
    expect(census).not.toBeNull();
    if (!census) return;
    const demographics = registerAndGenerate(stateId, census, "2019");

    const cached = calculateStateLeanForCache(demographics, demographicCategories, {
      countryId: "US",
      stateId,
      preset: "2019-default",
    });

    expect(cached).toEqual(
      calculateStateLeanForCache(demographics, demographicCategories, {
        countryId: "US",
        stateId,
        preset: null,
      })
    );
  });
});
