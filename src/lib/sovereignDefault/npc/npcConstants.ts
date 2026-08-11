/**
 * Sovereign-default NPC algorithm — calibrated tunables.
 *
 * Kept separate from the broader sovereignDefault/constants.ts so the
 * Phase 10 calibration loop can iterate without polluting unrelated
 * subsystem tunables. Values are first-draft per design Section 6.3 and
 * are deliberately conservative — NPC defaults are rare and the algorithm
 * exists primarily as a safety net.
 *
 * Calibration provenance:
 *   - Baseline preferences (bailout > restructure > monetize > repudiate):
 *     reflects real-world frequency. Bailouts and restructures are far
 *     more common historically than outright repudiation.
 *   - Government modifiers: democracies favor bailout/restructure (rule
 *     of law, IMF relationships, market reputation matter). Authoritarians
 *     more willing to repudiate/monetize (less accountability for
 *     consequences).
 *   - Ideology modifiers: technocrats favor restructure (Brady-bond style
 *     orderly workout); populists/nationalists favor repudiate
 *     (anti-creditor rhetoric); conservatives favor bailout (preserve
 *     creditor reputation); socialists mixed (anti-IMF + pro-monetize).
 *   - State modifiers (D/GDP > 2.0 → +0.15 repudiate bump, doubled at
 *     3.0): reflects diminishing returns to debt-sustainability — at
 *     extreme D/GDP the only credible path is haircut/repudiation. Reserve
 *     currency monetize bump captures the "inflate-our-way-out" privilege
 *     historically available to USD/JPY/etc. issuers.
 *   - Recent-default penalty (-0.3 repudiate / -0.15 bailout for first
 *     100 turns): countries that just defaulted face additional reputation
 *     damage if they default again immediately, and IMF is reluctant to
 *     re-bail.
 *
 * Constants here are imported by `scoreNpcOption.ts`. The full algorithm
 * is documented in design Section 6.
 */

import type { SovereignResolutionChoice } from "@/lib/db/types/budget";

export type NpcGovernmentType = "authoritarian" | "democracy" | "hybrid";

export type NpcIdeology =
  "populist" | "technocrat" | "nationalist" | "centrist" | "socialist" | "conservative";

export const NPC_BASELINE_PREFERENCE: Record<SovereignResolutionChoice, number> = {
  bailout: 0.7,
  restructure: 0.6,
  monetize: 0.4,
  repudiate: 0.3,
};

export const NPC_GOVERNMENT_MODIFIER: Record<
  NpcGovernmentType,
  Record<SovereignResolutionChoice, number>
> = {
  authoritarian: { bailout: -0.1, restructure: -0.05, monetize: 0.1, repudiate: 0.15 },
  democracy: { bailout: 0.1, restructure: 0.1, monetize: -0.05, repudiate: -0.1 },
  hybrid: { bailout: -0.05, restructure: 0.0, monetize: 0.05, repudiate: 0.05 },
};

export const NPC_IDEOLOGY_MODIFIER: Record<
  NpcIdeology,
  Record<SovereignResolutionChoice, number>
> = {
  populist: { bailout: -0.1, restructure: -0.05, monetize: 0.15, repudiate: 0.2 },
  technocrat: { bailout: 0.15, restructure: 0.2, monetize: -0.05, repudiate: -0.1 },
  nationalist: { bailout: -0.1, restructure: -0.05, monetize: 0.1, repudiate: 0.25 },
  centrist: { bailout: 0.1, restructure: 0.05, monetize: 0.0, repudiate: -0.05 },
  socialist: { bailout: -0.05, restructure: 0.05, monetize: 0.1, repudiate: 0.05 },
  conservative: { bailout: 0.15, restructure: 0.1, monetize: -0.1, repudiate: -0.1 },
};

// State-modifier tunables — design Section 6.3.

export const NPC_DGDP_HIGH_THRESHOLD = 2.0;
export const NPC_DGDP_VERY_HIGH_THRESHOLD = 3.0;
export const NPC_DGDP_REPUDIATE_BUMP = 0.15;

export const NPC_RESERVE_CURRENCY_MONETIZE_BUMP = 0.15;

export const NPC_LOW_INFLATION_THRESHOLD_PCT = 2.0;
export const NPC_LOW_INFLATION_MONETIZE_BUMP = 0.1;

export const NPC_RECENT_DEFAULT_TURNS = 100;
export const NPC_RECENT_DEFAULT_REPUDIATE_PENALTY = 0.3;
export const NPC_RECENT_DEFAULT_BAILOUT_PENALTY = 0.15;

export const NPC_FX_DEPRECIATION_THRESHOLD = 0.1;
export const NPC_FX_DEPRECIATION_MONETIZE_PENALTY = 0.1;
