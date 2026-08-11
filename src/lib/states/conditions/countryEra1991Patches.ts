import type { CountryId } from "@/lib/constants/countries";
import type { Condition } from "@/lib/utils/approvalModifiers";
import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";

const c = (category: string, metric: string, op: Condition["op"], value: number): Condition => ({
  category,
  metric,
  op,
  value,
});

/**
 * Additional per-country overrides applied only in 1991-default worlds, after
 * global ERA1991 patches and country modern patches.
 */
export const COUNTRY_ERA1991_PATCHES: Partial<
  Record<CountryId, Record<string, CountryModifierPatch>>
> = {
  UK: {
    free_press: { suppress: true },
    slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", -0.5)] },
    affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 4.5)] },
    affordable_living: { conditions: [c("economic", "costOfLiving", "<=", 45)] },
    heavy_public_debt: { suppress: true },
    research_hub: { suppress: true },
    high_violent_crime: { conditions: [c("publicSafety", "violentCrimeRate", ">=", 500)] },
  },

  JP: {
    housing_stress: { conditions: [c("social", "housingAffordability", ">=", 90)] },
    affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 79)] },
    free_press: { conditions: [c("mediaInformation", "pressFreedom", ">=", 84)] },
    slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", -1.5)] },
    research_hub: { suppress: true },
    affordable_living: { conditions: [c("economic", "costOfLiving", "<=", 48)] },
  },

  DE: {
    slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", -0.8)] },
    heavy_public_debt: { suppress: true },
    high_violent_crime: { suppress: true },
    affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 35)] },
    housing_stress: { conditions: [c("social", "housingAffordability", ">=", 44)] },
    research_hub: { conditions: [c("economic", "rdIntensity", ">=", 2.8)] },
  },

  IE: {
    affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 28)] },
    housing_stress: { conditions: [c("social", "housingAffordability", ">=", 38)] },
    heavy_public_debt: { conditions: [c("governance", "debtToGdp", ">=", 98)] },
    slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", 0.5)] },
    research_hub: { suppress: true },
  },

  BR: {
    affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 34)] },
    high_poverty: { conditions: [c("economic", "povertyRate", ">=", 22)] },
    slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", 1.0)] },
    research_hub: { suppress: true },
    low_life_expectancy: { suppress: true },
    infrastructure_crisis: { suppress: true },
  },

  CN: {
    affordable_housing: { suppress: true },
    low_life_expectancy: { suppress: true },
    strong_growth: { conditions: [c("economic", "gdpGrowth", ">=", 4.5)] },
    slow_growth: { suppress: true },
    research_hub: { suppress: true },
    heavy_public_debt: { suppress: true },
    low_social_mobility: { suppress: true },
    informed_society: {
      conditions: [
        c("mediaInformation", "newsTrust", ">=", 68),
        c("mediaInformation", "mediaPolarization", "<=", 32),
      ],
    },
  },

  US: {
    affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 38)] },
    corruption_concerns: { conditions: [c("governance", "corruptionIndex", ">=", 56)] },
    information_disorder: { suppress: true },
    media_polarization: { suppress: true },
  },
};
