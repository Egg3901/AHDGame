import type { StateMetrics } from "@/lib/db/types";
import { makeEasternBlocStateMetrics } from "@/lib/seeds/shared/easternBlocMetrics";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "./successorGdp1991";
import { SUCCESSOR_REGION_POPULATION_1991 } from "./successorPopulation1991";
import { ruRegions1991 } from "@/lib/countries/ru/data/ruRegions1991";
import { plRegions1991 } from "@/lib/countries/pl/data/plRegions1991";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { huRegions1991 } from "@/lib/countries/hu/data/huRegions1991";
import { roRegions1991 } from "@/lib/countries/ro/data/roRegions1991";
import { bgRegions1991 } from "@/lib/countries/bg/data/bgRegions1991";
import { yuRegions1991 } from "@/lib/countries/yu/data/yuRegions1991";

/**
 * 1991 national anchors: World Bank WDI annual indicators, with CS weighted
 * from Czech/Slovak WDI by census population. YU is a 1990 opening estimate
 * because the SFRY series ends before this scenario's January start. The
 * baseline builder supplies the metric schema and plausible infrastructure/
 * health priors; the transition economy, election and media indicators below
 * replace its 1979 command-system values. `governance.voterTurnout` is the
 * last-election/scenario metric; it is distinct from the demographic model's
 * capped turnout propensity for future simulated elections. Regional income and urbanization
 * differences are transparent GDP-per-resident estimates, not claimed census
 * observations. Sources (replace country and indicator in the URL):
 * https://api.worldbank.org/v2/country/POL/indicator/SP.DYN.LE00.IN?date=1991&format=json
 * https://api.worldbank.org/v2/country/POL/indicator/SP.URB.TOTL.IN.ZS?date=1991&format=json
 * https://api.worldbank.org/v2/country/POL/indicator/SL.UEM.TOTL.ZS?date=1991&format=json
 * https://api.worldbank.org/v2/country/POL/indicator/SP.DYN.CBRT.IN?date=1991&format=json
 * https://api.worldbank.org/v2/country/POL/indicator/NY.GDP.MKTP.KD.ZG?date=1991&format=json
 */
const profiles = {
  RU: {
    growth: -5.05,
    unemployment: 5.11,
    life: 68.47,
    urban: 73.71,
    births: 12.1,
    freedom: 30,
    press: 40,
    turnout: 75,
  },
  PL: {
    growth: -7.02,
    unemployment: 13.62,
    life: 70.59,
    urban: 61.37,
    births: 14.3,
    freedom: 47,
    press: 68,
    turnout: 63,
  },
  CS: {
    growth: -12.5,
    unemployment: 5.5,
    life: 71.47,
    urban: 68.5,
    births: 13.6,
    freedom: 43,
    press: 72,
    turnout: 95,
  },
  HU: {
    growth: -11.89,
    unemployment: 8.5,
    life: 69.38,
    urban: 61.32,
    births: 12.3,
    freedom: 49,
    press: 72,
    turnout: 65,
  },
  RO: {
    growth: -12.92,
    unemployment: 8.23,
    life: 69.78,
    urban: 54.31,
    births: 12,
    freedom: 30,
    press: 55,
    turnout: 86,
  },
  BG: {
    growth: -8.45,
    unemployment: 11.1,
    life: 71.56,
    urban: 67.09,
    births: 11.1,
    freedom: 35,
    press: 65,
    turnout: 91,
  },
  YU: {
    growth: -7,
    unemployment: 16,
    life: 72,
    urban: 50,
    births: 17,
    freedom: 38,
    press: 40,
    turnout: 75,
  },
} as const;

const regions = {
  RU: ruRegions1991,
  PL: plRegions1991,
  CS: csRegions1991,
  HU: huRegions1991,
  RO: roRegions1991,
  BG: bgRegions1991,
  YU: yuRegions1991,
} as const;

function metric(value: number) {
  return { value };
}
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export const SUCCESSOR_STATE_METRICS_1991: StateMetrics[] = (
  Object.keys(profiles) as Array<keyof typeof profiles>
).flatMap((countryId) => {
  const profile = profiles[countryId];
  const states = regions[countryId];
  const population = Object.values(SUCCESSOR_REGION_POPULATION_1991[countryId]).reduce(
    (sum, count) => sum + count,
    0
  );
  const nationalGdpPerResident = SUCCESSOR_NOMINAL_GDP_1991[countryId] / population;
  const overrides = Object.fromEntries(
    states.map((state) => {
      const relative = (state.gdp * 1_000_000) / state.population / nationalGdpPerResident;
      const regionalUrban = clamp(profile.urban + 8 * Math.log(relative), 20, 95);
      return [
        state._id,
        {
          medianIncome: Math.round(nationalGdpPerResident * 0.42 * relative),
          gdpGrowth: profile.growth,
          unemploymentRate: profile.unemployment,
          lifeExpectancy: profile.life,
          urbanizationRate: regionalUrban,
          pressFreedom: profile.press,
          birthRate: clamp((profile.births / 30) * 100, 0, 100),
        },
      ];
    })
  );
  return makeEasternBlocStateMetrics(
    countryId,
    Math.round(nationalGdpPerResident * 0.42),
    overrides,
    "1979"
  ).map((row) => ({
    ...row,
    economic: {
      ...row.economic,
      smallBusinessFormation: metric(countryId === "PL" || countryId === "HU" ? 4 : 2),
      matchingFriction: metric(6),
      laborParticipation: metric(68),
      economicFreedom: metric(profile.freedom),
    },
    governance: {
      ...row.governance,
      voterTurnout: metric(profile.turnout),
      governmentTransparency: metric(profile.press * 0.6),
      civilLiberties: metric(profile.press * 0.8),
    },
    mediaInformation: {
      ...row.mediaInformation,
      stateMediaControl: metric(100 - profile.press),
    },
  }));
});
