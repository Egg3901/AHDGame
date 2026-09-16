import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";
import { condition as c } from "@/lib/states/conditions/condition";

/**
 * Japan's per-modifier threshold overrides and suppressions.
 *
 * Moved out of `src/lib/states/conditions/countryPatches.ts`, which now
 * forwards to this. Values unchanged.
 *
 * ⚠ `suppress` AND `conditions` MEAN DIFFERENT THINGS. `suppress: true`
 * removes the modifier for Japan entirely; a `conditions` list re-thresholds it.
 * Most of Japan's suppressions are there because the seed input is nationally
 * flat -- a metric identical in all 8 regions cannot differentiate them, so the
 * modifier would fire everywhere or nowhere and say nothing either way.
 *
 * Patches apply AFTER the global and era1991 definitions, and a named modifier
 * replaces that definition's thresholds wholesale rather than merging with them.
 */
export const JP_MODIFIER_PATCHES: Record<string, CountryModifierPatch> = {
  // Nationally low / flat baselines — only fire on meaningful regional spread.
  universal_healthcare: { suppress: true },
  low_unemployment: { suppress: true },
  heavy_public_debt: { suppress: true },
  high_broadband: { suppress: true },
  low_broadband: { suppress: true },
  infrastructure_boom: { suppress: true },
  balanced_budget: { suppress: true },
  corruption_concerns: { suppress: true },
  high_corruption: { suppress: true },
  high_life_expectancy: { suppress: true },
  longevity: { suppress: true },
  aging_population: { suppress: true },
  safe_streets: {
    conditions: [
      c("publicSafety", "violentCrimeRate", "<=", 18),
      c("publicSafety", "publicSafetyConfidence", ">=", 72),
    ],
  },
  falling_crime: { conditions: [c("publicSafety", "violentCrimeRate", "<=", 17)] },
  crime_wave: {
    conditions: [
      c("publicSafety", "violentCrimeRate", ">=", 26),
      c("publicSafety", "publicSafetyConfidence", "<=", 58),
    ],
  },
  high_violent_crime: { conditions: [c("publicSafety", "violentCrimeRate", ">=", 27)] },
  poor_air_quality: { conditions: [c("environment", "airQuality", ">=", 84)] },
  slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", 0.2)] },
  research_hub: { conditions: [c("economic", "rdIntensity", ">=", 3.45)] },
  housing_stress: { conditions: [c("social", "housingAffordability", ">=", 75)] },
  affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 52)] },
  high_poverty: { conditions: [c("economic", "povertyRate", ">=", 15)] },
  green_transition: { conditions: [c("environment", "renewableEnergy", ">=", 32)] },
  free_press: { conditions: [c("mediaInformation", "pressFreedom", ">=", 74)] },
  innovation_economy: {
    conditions: [
      c("economic", "smallBusinessFormation", ">=", 6),
      c("education", "workforceSkill", ">=", 82),
    ],
  },
};
