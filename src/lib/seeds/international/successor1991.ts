import type { CountryLayer1Model } from "./types";
import {
  EASTERN_BLOC_COMPOSITION,
  EASTERN_BLOC_GROUP_IDS,
} from "@/lib/seeds/shared/easternBlocModel";
import { demographicAnchor1991 } from "@/lib/seeds/reference/successorDemographicAnchors1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";
import { SUCCESSOR_REGION_POPULATION_1991 } from "@/lib/seeds/reference/successorPopulation1991";
import { ruRegions1991 } from "@/lib/countries/ru/data/ruRegions1991";
import { plRegions1991 } from "@/lib/countries/pl/data/plRegions1991";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { huRegions1991 } from "@/lib/countries/hu/data/huRegions1991";
import { roRegions1991 } from "@/lib/countries/ro/data/roRegions1991";
import { bgRegions1991 } from "@/lib/countries/bg/data/bgRegions1991";
import { yuRegions1991 } from "@/lib/countries/yu/data/yuRegions1991";

const regions = {
  RU: ruRegions1991,
  PL: plRegions1991,
  CS: csRegions1991,
  HU: huRegions1991,
  RO: roRegions1991,
  BG: bgRegions1991,
  YU: yuRegions1991,
} as const;

export type Successor1991CountryId = keyof typeof regions;

const nationalTurnout = { RU: 75, PL: 63, CS: 85, HU: 65, RO: 85, BG: 85, YU: 75 } as const;
const universityShare = { RU: 12, PL: 9, CS: 12, HU: 11, RO: 8, BG: 10, YU: 8 } as const;
const primaryShare = { RU: 29, PL: 34, CS: 24, HU: 33, RO: 40, BG: 36, YU: 39 } as const;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * A 1991 transition model independent of the 1953/1979 position tables.
 * Region populations, Hungarian regional age, Yugoslav republic age/urban and
 * national age/urban controls are period census or WDI observations. Other
 * regional age/urban deviations and income/education buckets are transparent
 * estimates from the authored 1991 regional GDP per resident. The standard six
 * occupational archetypes retain their stable IDs for existing voter logic;
 * ethnicity is omitted because it did not enter their composition formula.
 * The 1990/91 multiparty election turnout baselines are scenario values and
 * remain capped at 85 by the voter derivation helper.
 */
export function getSuccessor1991Model(countryId: Successor1991CountryId): CountryLayer1Model {
  const states = regions[countryId];
  const population = Object.values(SUCCESSOR_REGION_POPULATION_1991[countryId]).reduce(
    (sum, count) => sum + count,
    0
  );
  const nationalGdpPerResident = SUCCESSOR_NOMINAL_GDP_1991[countryId] / population;
  const measured = states.map((state) => {
    const anchor = demographicAnchor1991(countryId, state._id);
    const incomeRatio = (state.gdp * 1_000_000) / state.population / nationalGdpPerResident;
    return {
      state,
      anchor,
      incomeRatio,
      rawUrban: countryId === "YU" ? anchor.urban : anchor.urban + 8 * Math.log(incomeRatio),
    };
  });
  // Keep the WDI national urban share exactly when its regions share one control.
  const urbanOffset =
    countryId === "YU" || countryId === "CS"
      ? 0
      : measured.reduce(
          (sum, row) => sum + (row.rawUrban - row.anchor.urban) * row.state.population,
          0
        ) / population;

  const census = Object.fromEntries(
    measured.map(({ state, anchor, incomeRatio, rawUrban }) => {
      // Hungary's regional KSH and Yugoslavia's successor-republic age series
      // are direct observations; only national-control countries need a
      // modeled regional deviation.
      const ageDeviation = countryId === "HU" || countryId === "YU" ? 0 : Math.log(incomeRatio);
      const young = clamp(anchor.young - 1.5 * ageDeviation, 10, 42);
      const senior = clamp(anchor.senior + ageDeviation, 3, 25);
      const working = 100 - young - senior;
      const urban = clamp(rawUrban - urbanOffset, 20, 95);
      const coreUrban = urban * 0.8;
      const suburban = urban - coreUrban;
      const university = clamp(universityShare[countryId] + 3 * Math.log(incomeRatio), 3, 25);
      const primary = clamp(primaryShare[countryId] - 5 * Math.log(incomeRatio), 12, 55);
      const vocational = countryId === "RO" || countryId === "YU" ? 24 : 29;
      const highIncome = clamp(11 + 5 * Math.log(incomeRatio), 4, 25);
      const lowIncome = clamp(29 - 8 * Math.log(incomeRatio), 12, 50);
      return [
        state._id,
        {
          age: { young, mid: working * 0.47, mature: working * 0.53, senior },
          urbanization: { urban: coreUrban, suburban, rural: 100 - urban },
          education: {
            primary_or_below: primary,
            secondary: 100 - primary - vocational - university,
            vocational,
            university,
          },
          income: { low: lowIncome, middle: 100 - lowIncome - highIncome, high: highIncome },
        },
      ];
    })
  );
  const turnout = nationalTurnout[countryId];
  const turnoutRates = {
    age: { young: turnout - 10, mid: turnout, mature: turnout + 3, senior: turnout + 1 },
    education: {
      primary_or_below: turnout - 3,
      secondary: turnout,
      vocational: turnout + 1,
      university: turnout + 4,
    },
    income: { low: turnout - 5, middle: turnout, high: turnout + 3 },
    urbanization: { urban: turnout, suburban: turnout + 1, rural: turnout - 1 },
  };
  return {
    countryId,
    categoryId: `${countryId.toLowerCase()}_voterGroups`,
    groupIds: [...EASTERN_BLOC_GROUP_IDS],
    dims: ["age", "education", "income", "urbanization"],
    census,
    composition: EASTERN_BLOC_COMPOSITION,
    turnoutRates,
    positions: {
      age: {
        young: { economicLean: 1.2, socialLean: -1.2 },
        mid: { economicLean: 0.7, socialLean: -0.3 },
        mature: { economicLean: -0.2, socialLean: 0.8 },
        senior: { economicLean: -0.8, socialLean: 1.5 },
      },
      education: {
        primary_or_below: { economicLean: -0.9, socialLean: 1.4 },
        secondary: { economicLean: 0.2, socialLean: 0.4 },
        vocational: { economicLean: -0.5, socialLean: 0.2 },
        university: { economicLean: 1.6, socialLean: -1.2 },
      },
      income: {
        low: { economicLean: -1.6, socialLean: 0.5 },
        middle: { economicLean: 0.1, socialLean: 0.2 },
        high: { economicLean: 1.8, socialLean: -0.3 },
      },
      urbanization: {
        urban: { economicLean: 0.9, socialLean: -0.9 },
        suburban: { economicLean: 0.6, socialLean: 0.1 },
        rural: { economicLean: -0.7, socialLean: 1.5 },
      },
    },
    defaultLeans: {
      party_nomenklatura: { economicLean: -0.8, socialLean: 0.3 },
      industrial_worker: { economicLean: -0.5, socialLean: 0.1 },
      collective_farmer: { economicLean: -0.5, socialLean: 1.2 },
      intelligentsia: { economicLean: 1.3, socialLean: -0.9 },
      religious_traditional: { economicLean: -0.7, socialLean: 1.8 },
      youth: { economicLean: 1.0, socialLean: -1.1 },
    },
  };
}
