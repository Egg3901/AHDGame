/**
 * The map from political families to the macroMetrics paths that inform them.
 *
 * Lives in its own module because it has TWO consumers with very different
 * lifetimes: the offline non-playable derivation (tier 2) and the per-turn
 * Bridge B macro residual. Keeping it here means the turn phase does not import
 * the derivation library — which is offline-only — just to read one constant.
 *
 * Paths verified against src/lib/db/types/stateMetrics.ts: `socialMobility`
 * lives under `social`, not `economic`, and budgetBalance/debtToGdp under
 * `governance`. Those two categories are POLITICAL, so for a non-playable they
 * sit on stateMetrics while the rest sit on macroMetrics — consumers that can
 * see both should look up in a merged map.
 *
 * All SEVEN economy families must appear here: `economic` is excluded from
 * ADAPTER_TIER1 (survivor category) and has no ADAPTER_TIER2_CATEGORY entry
 * either, so a family missing from this table has NO fallback at all.
 */
export const TIER2_SOURCES: Record<string, string[]> = {
  "economy.workerSecurity": ["economic.unemploymentRate", "economic.matchingFriction"],
  "economy.mobility": ["social.socialMobility", "economic.laborParticipation"],
  "economy.householdIncome": ["economic.medianIncome"],
  "economy.stability": ["economic.unemploymentRate", "economic.costOfLiving"],
  "economy.productivity": ["economic.productivityGrowth", "economic.rdIntensity"],
  "economy.fiscal": ["governance.budgetBalance", "governance.debtToGdp"],
  "economy.competition": ["economic.smallBusinessFormation", "economic.economicFreedom"],
  "society.demography": ["population.birthRate", "population.populationGrowth"],
};
