/**
 * Per-metric two-axis affinity — which voters weight a metric's approval
 * contribution MORE (P6d). This does NOT change a metric's good/bad direction
 * (that stays isHigherBetter-correct); it scales WHO cares, by ideology:
 *
 *   econ:   +1 = economic-right voters weight it more (high economicLean)
 *           −1 = economic-left voters weight it more (low economicLean)
 *   social: +1 = authoritarian voters weight it more (high socialLean)
 *           −1 = libertarian voters weight it more (low socialLean)
 *
 * (Lean signs verified against the demographics SSOT: +economicLean = right,
 * +socialLean = authoritarian.) Unlisted metrics are universal goods every
 * electorate wants equally → {0, 0}. First-pass values, flagged for the
 * balance pass.
 */

export interface AxisAffinity {
  econ: number;
  social: number;
}

const ZERO: AxisAffinity = { econ: 0, social: 0 };

export const METRIC_AXIS_AFFINITY: Record<string, AxisAffinity> = {
  // ── Economic-right: growth, freedom, low debt/cost (right voters weight more)
  gdpGrowth: { econ: 1, social: 0 },
  economicFreedom: { econ: 1, social: 0 },
  regulatoryBurden: { econ: 1, social: 0 },
  smallBusinessFormation: { econ: 1, social: 0 },
  debtToGdp: { econ: 1, social: 0 },
  costOfLiving: { econ: 1, social: 0 },
  // High firearmRights (fewer restrictions, isHigherBetter=true) is weighted by
  // economically-right voters; left electorates down-weight it toward 0 rather
  // than invert it (the P6d floor rule). Not auth-coded: a rights framing splits
  // the authoritarian and libertarian ends of the right, so social stays 0.
  firearmRights: { econ: 1, social: 0 },

  // ── Economic-left: poverty, inequality, joblessness (left voters weight more)
  povertyRate: { econ: -1, social: 0 },
  childPoverty: { econ: -1, social: 0 },
  incomeInequality: { econ: -1, social: 0 },
  unemploymentRate: { econ: -1, social: 0 },
  homelessnessRate: { econ: -1, social: 0 },
  socialMobility: { econ: -1, social: 0 },

  // ── Authoritarian social: order, security, pride, control (auth voters weight more)
  nationalPride: { econ: 0, social: 1 },
  militaryReadiness: { econ: 0, social: 1 },
  // Low control is a libertarian good (isHigherBetter=false), so socially-liberal
  // voters weight it — not authoritarians. (#2897: was social:+1, which punished
  // an auth-right governor's own base for reducing media control.)
  stateMediaControl: { econ: 0, social: -1 },
  crimeRate: { econ: 0, social: 1 },
  // Tight entry control (isHigherBetter=true) is an order/control good weighted
  // by authority-leaning voters, mirroring crimeRate/militaryReadiness. Socially
  // liberal electorates down-weight it toward 0 (never inverted).
  borderSecurity: { econ: 0, social: 1 },
  // Low incarceration is a justice-reform/libertarian good (isHigherBetter=false);
  // the order/safety signal is already carried by crimeRate (social:+1). Reform
  // voters weight it, not authoritarians. (#2897: was social:+1.)
  incarcerationRate: { econ: 0, social: -1 },

  // ── Libertarian social: liberties, free press (lib voters weight more)
  civilLiberties: { econ: 0, social: -1 },
  pressFreedom: { econ: 0, social: -1 },

  // ── Phase C: contested metrics — conservatives weight fiscal health more,
  //    libertarians weight transparency more, greens are left/lib priority.
  budgetBalance: { econ: 1, social: 0 },
  governmentTransparency: { econ: 0, social: -1 },
  renewableEnergy: { econ: -1, social: -1 },
};

/** Affinity for a metric; universal goods (unlisted) → {0, 0}. */
export function axisAffinityFor(metricId: string): AxisAffinity {
  return METRIC_AXIS_AFFINITY[metricId] ?? ZERO;
}
