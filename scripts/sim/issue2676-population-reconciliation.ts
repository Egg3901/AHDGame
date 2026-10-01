/** Compare population totals, regional shares and actual spending-cost inputs under the six-country repair. */
import assert from "node:assert/strict";
import { selectPresetBundle } from "../../src/lib/seeds/presetSelector";
import { getNationalBudgetSeedConfigsForPreset } from "../../src/lib/seeds/reference/budgets";
import { POPULATION_TOTALS_1991 } from "../../src/lib/seeds/reference/populationTotals1991";
import {
  calculatePolicyOptionAnnualCost,
  getGdpIndexedCostScale,
} from "../../src/lib/budget/costs";
import { CN_GEOGRAPHY } from "../../src/lib/countries/cn/geography";
import { NG_GEOGRAPHY } from "../../src/lib/countries/ng/geography";
import { FR_GEOGRAPHY } from "../../src/lib/countries/fr/geography";
import { ES_GEOGRAPHY } from "../../src/lib/countries/es/geography";
import { SE_GEOGRAPHY } from "../../src/lib/countries/se/geography";
import { TR_GEOGRAPHY } from "../../src/lib/countries/tr/geography";

// Independent pre-repair inputs recorded from the old country bundles and issue2676.
const legacyPopulations: Record<string, Record<string, number>> = {
  CN: {
    DB: 99840000,
    HB: 120000000,
    HD: 312000000,
    HZ: 152000000,
    HN: 113000000,
    XN: 192000000,
    XB: 130000000,
  },
  NG: {
    NORTH_WEST: 22913412,
    NORTH_EAST: 11900913,
    NORTH_CENTRAL: 12554912,
    SOUTH_WEST: 17455043,
    SOUTH_SOUTH: 13392943,
    SOUTH_EAST: 10774977,
  },
  FR: {
    FR_IDF: 9900000,
    FR_NOR: 5700000,
    FR_EST: 6000000,
    FR_OUE: 8600000,
    FR_SOU: 6400000,
    FR_ARA: 6300000,
    FR_MED: 5800000,
    FR_CEN: 4600000,
  },
  ES: {
    ES_MAD: 4700000,
    ES_CAT: 5900000,
    ES_AND: 6400000,
    ES_VAL: 4500000,
    ES_PVB: 2600000,
    ES_GAL: 2800000,
    ES_NOR: 3300000,
    ES_CEN: 6800000,
  },
  SE: {
    SE_STH: 1500000,
    SE_GOT: 1400000,
    SE_SKA: 1000000,
    SE_EAS: 900000,
    SE_SML: 900000,
    SE_VML: 800000,
    SE_NOR: 1200000,
    SE_UPP: 600000,
  },
  TR: {
    TR_IST: 6500000,
    TR_ANK: 4500000,
    TR_IZM: 5000000,
    TR_MED: 5500000,
    TR_BLA: 6500000,
    TR_ESA: 4500000,
    TR_SEA: 4000000,
    TR_CEN: 7000000,
  },
};
const legacyNational: Record<string, number> = {
  CN: 1158000000,
  NG: 95000000,
  FR: 57000000,
  ES: 38900000,
  SE: 8600000,
  TR: 57300000,
};
const geographies = {
  CN: CN_GEOGRAPHY,
  NG: NG_GEOGRAPHY,
  FR: FR_GEOGRAPHY,
  ES: ES_GEOGRAPHY,
  SE: SE_GEOGRAPHY,
  TR: TR_GEOGRAPHY,
};
const configs = getNationalBudgetSeedConfigsForPreset("1991-default");
const perPersonOption = {
  id: "comparison",
  name: "100 local units per person",
  stance: "center",
  effectDirection: 0,
  economic: 0,
  social: 0,
  annualCostPerCapita: 100,
} as const;
const results = Object.entries(geographies).map(([country, geography]) => {
  const bundle = selectPresetBundle("1991-default", geography.regionBundles, "issue2676");
  const national = configs.find((config) => config.countryId === country);
  assert(national);
  const anchor = POPULATION_TOTALS_1991[country as keyof typeof POPULATION_TOTALS_1991];
  const before = legacyPopulations[country];
  const oldRegionalTotal = Object.values(before).reduce((sum, pop) => sum + pop, 0);
  const newRegionalTotal = bundle.reduce((sum, region) => sum + region.population, 0);
  assert.equal(newRegionalTotal, national.population);
  assert.equal(national.population, anchor.population);
  const rows = bundle.map((region) => {
    const oldShare = before[region._id] / oldRegionalTotal;
    const newShare = region.population / newRegionalTotal;
    assert(Math.abs(region.population - oldShare * newRegionalTotal) < 1);
    return {
      id: region._id,
      before: before[region._id],
      after: region.population,
      shareDrift: newShare - oldShare,
    };
  });
  const scale = getGdpIndexedCostScale(country, national.gdp / newRegionalTotal);
  const cost = calculatePolicyOptionAnnualCost(perPersonOption, {
    countryId: country,
    gdp: national.gdp,
    population: newRegionalTotal,
    budgetCapacity: 0,
    nationalGdpPerCapita: national.gdp / newRegionalTotal,
  });
  assert.equal(cost, newRegionalTotal * 100 * scale);
  assert(Number.isFinite(cost) && cost > 0);
  return {
    country,
    referenceDate: anchor.referenceDate,
    source: anchor.source,
    scope: anchor.scope,
    oldNational: legacyNational[country],
    oldRegionalTotal,
    nationalPopulation: national.population,
    newRegionalTotal,
    nationalGdp: national.gdp,
    nationalGdpPerCapita: national.gdp / national.population,
    costScale: scale,
    annualCostFor100PerPerson: cost,
    rows,
  };
});
console.log(
  JSON.stringify(
    {
      scope:
        "Actual region selectors, national budget configs and per-capita policy cost path; national observations and estimated regional shares are distinct.",
      results,
    },
    null,
    2
  )
);
