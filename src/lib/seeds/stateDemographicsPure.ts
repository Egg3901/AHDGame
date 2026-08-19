import { getEraComposition, getEraPositions } from "./demographicCategories";
import type { EraId } from "./presetSelector";

/** Authored global override of the era's position/turnout tables, consumed by
 *  the gated seed path (see DemographicConfigOverride). Per-state Layer-1
 *  `share` is never overridden here; it stays census-driven. The archetype
 *  composition table is no longer overridable: it is derived from the census,
 *  and the Position Editor tabs that authored it were removed. */
export interface Layer1SeedOverride {
  positions?: Record<string, Record<string, { economicLean: number; socialLean: number }>>;
  turnout?: Record<string, Record<string, number>>;
}

/**
 * Resolve the era composition with any authored turnout override applied:
 * baseline turnout rates are merged per dim/key. Returns the static era
 * composition untouched when there is nothing to apply.
 */
function resolveComposition(
  era: EraId,
  override?: Layer1SeedOverride
): ReturnType<typeof getEraComposition> {
  const comp = getEraComposition(era);
  if (!override?.turnout) return comp;

  const voterGroupComposition = comp.voterGroupComposition;

  let turnoutRates = comp.turnoutRates;
  if (override.turnout) {
    const merged = {
      ...(comp.turnoutRates as unknown as Record<string, Record<string, number>>),
    };
    for (const [dim, keys] of Object.entries(override.turnout)) {
      merged[dim] = { ...(merged[dim] ?? {}), ...keys };
    }
    turnoutRates = merged as unknown as typeof comp.turnoutRates;
  }

  return { ...comp, voterGroupComposition, turnoutRates };
}

/** Layer 1 config — census-style characteristics per state (used to derive 12 voter groups).
 *  Optionally includes state-specific positions for each demographic dimension,
 *  allowing whites in MA to lean Democratic while whites in GA lean Republican. */
export interface Layer1Config {
  race: { white: number; black: number; hispanic: number; asian: number; other: number };
  education: { no_college: number; college: number; graduate: number };
  wealth: { low: number; middle: number; high: number };
  age: { young: number; mid: number; mature: number; senior: number };
  ideology: {
    evangelicals: number;
    environmentalists: number;
    libertarians: number;
    progressives: number;
    patriots: number;
    gunowners: number;
  };
  /** State-specific layer-1 demo positions. If provided, these override the era-global positions. */
  positions?: Record<string, Record<string, { economicLean: number; socialLean: number }>>;
}

/**
 * Derive voter-weighted score (0–100) for each voter group from Layer 1. Normalized to sum 100.
 *
 * Each Layer-1 demographic share is multiplied by its national turnout rate before use,
 * so groups composed of higher-turnout demographics receive a proportionally larger share
 * of the modeled electorate. The result reflects VOTER presence, not raw population share.
 *
 * Ideology drives lean; census factors (race, education, wealth, age) drive composition.
 */
export function deriveGroupPopulations(
  config: Layer1Config,
  era: EraId,
  override?: Layer1SeedOverride
): Record<string, number> {
  const comp = resolveComposition(era, override);
  const t = comp.turnoutRates;

  // Build turnout-weighted lookup: voter_share ∝ population_pct × turnout_rate
  const vw: Record<string, Record<string, number>> = {};
  for (const [dim, groups] of Object.entries(config)) {
    if (dim === "positions") continue; // skip state-specific positions metadata
    vw[dim] = {};
    const rates = t[dim as keyof typeof t] as Record<string, number>;
    for (const [key, pct] of Object.entries(groups as Record<string, number>)) {
      vw[dim][key] = (pct * (rates[key] ?? 55)) / 100;
    }
  }

  // Derive raw scores from voter group composition (single source of truth)
  const raw: Record<string, number> = {};
  for (const [groupId, composition] of Object.entries(comp.voterGroupComposition)) {
    let score = 0;
    for (const { dim, key, w } of composition.weights) {
      score += (vw[dim]?.[key] ?? 0) * w;
    }
    score *= composition.civicMultiplier ?? 1.0;
    raw[groupId] = score;
  }

  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  for (const id of comp.groupIds) {
    raw[id] = total > 0 ? (raw[id] / total) * 100 : 100 / 12;
  }
  return raw;
}

function clampLean(v: number): number {
  return Math.max(-5, Math.min(5, Math.round(v * 10) / 10));
}

/**
 * Derive an archetype's econ/social position as the state-share-weighted average
 * of its constituent Layer-1 positions. Selected at seed time when the
 * demographicsLayer1PositionsEnabled flag is on. State sensitivity emerges from
 * the state's own Layer-1 shares — no ad-hoc ideology nets.
 * NOTE: a lean is a weighted AVERAGE — do NOT apply civicMultiplier here.
 */
export function deriveGroupLeanFromLayer1(
  groupId: string,
  config: Layer1Config,
  era: EraId,
  positionsOverride?: Record<string, Record<string, { economicLean: number; socialLean: number }>>,
  override?: Layer1SeedOverride,
  stateId?: string
): { economicLean: number; socialLean: number } {
  const comp = resolveComposition(era, override);
  // Layered per-key merge: the era-wide table (with any per-state era overrides
  // from STATE_POSITION_OVERRIDES applied when `stateId` is passed — e.g. the
  // 1953 Solid-South/Plains white leans) fills every dim/key, state-authored
  // positions override per-key, and an explicit caller override wins on top.
  // (Previously `config.positions ?? {}` shadowed the era table entirely, so any
  // key missing from a state's partial positions block was silently dropped from
  // the weighted blend — the "wSum biased" bias the calibration suite exists to catch.)
  const positions: Record<
    string,
    Record<string, { economicLean: number; socialLean: number }>
  > = {};
  for (const layer of [getEraPositions(era, stateId), config.positions, positionsOverride]) {
    if (!layer) continue;
    for (const [dim, keys] of Object.entries(layer)) {
      positions[dim] = { ...positions[dim], ...keys };
    }
  }
  const composition = comp.voterGroupComposition[groupId];
  const fallback = comp.defaultLeans[groupId] ?? { economicLean: 0, socialLean: 0 };
  if (!composition) return fallback;

  let wSum = 0;
  let e = 0;
  let s = 0;
  for (const { dim, key, w } of composition.weights) {
    const share = (config[dim] as Record<string, number>)?.[key] ?? 0;
    const pos = positions[dim]?.[key];
    if (!pos) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[Layer1] No position for ${dim}.${key} in era ${era} — weight dropped (wSum biased)`
        );
      }
      continue;
    }
    const weight = w * (share / 100);
    wSum += weight;
    e += weight * pos.economicLean;
    s += weight * pos.socialLean;
  }
  if (wSum <= 0) return fallback;
  return { economicLean: clampLean(e / wSum), socialLean: clampLean(s / wSum) };
}

/**
 * Derive ideology-modulated group lean from Layer 1 composition.
 *
 * Most groups' leanings shift based on state ideological culture so that
 * the same archetype in WY behaves differently from the same archetype in MA.
 *
 * conservativeNet = (patriots + gunowners) − (progressives + environmentalists)
 *   ≈ +25 in WY/WV, ≈ −24 in CA/MA, ≈ 0 in purple states
 * progressiveNet  = (progressives + environmentalists) − (evangelicals + patriots)
 *   ≈ +20 in MA/VT, ≈ −30 in AL/AR, ≈ 0 in purple states
 * evangelicalNet  = evangelicals − environmentalists
 *   ≈ +30 in AL, ≈ −12 in MA, drives social axis for faith-adjacent groups
 */
export function deriveGroupLean(
  groupId: string,
  config: Layer1Config,
  era: EraId
): { economicLean: number; socialLean: number } {
  const { ideology } = config;
  const comp = getEraComposition(era);
  const def = comp.defaultLeans[groupId] ?? { economicLean: 0, socialLean: 0 };

  // net: positive = conservative-dominant state, negative = progressive-dominant
  const conservativeNet =
    ideology.patriots + ideology.gunowners - (ideology.progressives + ideology.environmentalists);
  // progressive dominance signal (positive = blue state)
  const progressiveNet =
    ideology.progressives +
    ideology.environmentalists -
    (ideology.evangelicals + ideology.patriots);
  // religious vs secular signal
  const evangelicalNet = ideology.evangelicals - ideology.environmentalists;

  switch (groupId) {
    case "retirees":
      // Seniors mirror state culture moderately; stay center-right even in blue states.
      // CA/NY seniors lean left of national retirees but right of their state overall.
      return {
        economicLean: clampLean(def.economicLean + conservativeNet * 0.05),
        socialLean: clampLean(def.socialLean + conservativeNet * 0.05),
      };

    case "soccer_moms":
      // Suburban women: genuine swing group, moderately sensitive to state culture
      return {
        economicLean: clampLean(def.economicLean - progressiveNet * 0.04),
        socialLean: clampLean(def.socialLean - progressiveNet * 0.04),
      };

    case "union_trades":
      // Working-class: economically left everywhere, but drift right in patriot states
      // Social lean tracks progressive signal — left in blue states, right in red
      return {
        economicLean: clampLean(
          def.economicLean - (ideology.progressives - ideology.patriots) * 0.05
        ),
        socialLean: clampLean(def.socialLean - progressiveNet * 0.03),
      };

    case "rural_traditionalists":
      // Both axes track conservative culture
      return {
        economicLean: clampLean(def.economicLean + conservativeNet * 0.04),
        socialLean: clampLean(def.socialLean + conservativeNet * 0.05),
      };

    case "evangelicals":
      // Evangelicals are right everywhere but more extreme in evangelical-heavy states
      return {
        economicLean: clampLean(def.economicLean + evangelicalNet * 0.04),
        socialLean: clampLean(def.socialLean + evangelicalNet * 0.03),
      };

    case "small_business":
      // Small business leans right, but more so in libertarian-heavy states
      return {
        economicLean: clampLean(
          def.economicLean + (ideology.libertarians - ideology.progressives) * 0.04
        ),
        socialLean: clampLean(def.socialLean + conservativeNet * 0.02),
      };

    case "college_liberals":
      // More progressive in progressive states, moderate in conservative states
      // Sign: progressiveNet > 0 in blue states should amplify leftward (more negative)
      return {
        economicLean: clampLean(def.economicLean - progressiveNet * 0.04),
        socialLean: clampLean(def.socialLean - progressiveNet * 0.04),
      };

    case "secular_professionals":
      // Strongly track progressivism signal — amplify left in blue states
      return {
        economicLean: clampLean(def.economicLean - progressiveNet * 0.04),
        socialLean: clampLean(def.socialLean - progressiveNet * 0.04),
      };

    case "public_sector":
      // Government workers lean left, more so in blue states
      return {
        economicLean: clampLean(def.economicLean - progressiveNet * 0.04),
        socialLean: clampLean(def.socialLean - progressiveNet * 0.04),
      };

    default:
      return def;
  }
}

/**
 * Derive voter group turnout from its demographic composition.
 * Base turnout = weighted average of Layer 1 turnout rates for each composition factor.
 * A civic engagement multiplier is applied for groups with structural participation barriers.
 * State-specific adjustments modulate the base for key groups based on Layer-1 deviations.
 *
 * @param groupId - Voter group ID (e.g., "young_renters", "evangelicals")
 * @param config - State's Layer 1 demographic configuration
 * @param _baseTurnout - Fallback base turnout if no composition defined
 * @param era - Era identifier for composition lookup
 * @param stateSpecificTurnout - Optional state-specific Layer 1 turnout rates (baseline + modifiers)
 * @returns Calculated turnout percentage for the voter group
 */
export function deriveGroupTurnout(
  groupId: string,
  config: Layer1Config,
  _baseTurnout: number,
  era: EraId = "2019",
  stateSpecificTurnout?: {
    race: Record<string, number>;
    age: Record<string, number>;
    education: Record<string, number>;
    wealth: Record<string, number>;
    ideology: Record<string, number>;
  },
  override?: Layer1SeedOverride
): number {
  const comp = resolveComposition(era, override);
  const composition = comp.voterGroupComposition[groupId];
  if (!composition) return _baseTurnout;

  const totalWeight = composition.weights.reduce((s, c) => s + c.w, 0);
  let base = 0;
  for (const { dim, key, w } of composition.weights) {
    // Use state-specific turnout if provided, otherwise use baseline
    let turnoutRate;
    if (stateSpecificTurnout && stateSpecificTurnout[dim]) {
      turnoutRate = stateSpecificTurnout[dim][key] ?? 55;
    } else {
      const rates = comp.turnoutRates[dim] as Record<string, number>;
      turnoutRate = rates[key] ?? 55;
    }
    base += turnoutRate * (w / totalWeight);
  }

  // Apply civic engagement multiplier for groups with structural participation barriers
  const multiplier = composition.civicMultiplier ?? 1.0;
  base *= multiplier;

  // State-level modulation: dominant demographic deviation from national average
  const { age, education, race } = config;
  switch (groupId) {
    case "young_renters":
      // More young people in state → more first-timers, slightly lower engagement
      return Math.round(Math.max(28, Math.min(48, base - (age.young - 24) * 0.4)));
    case "retirees":
      // Seniors: highest-turnout cohort; floor raised to reflect CPS data
      return Math.round(Math.max(70, Math.min(82, base + (age.senior - 24) * 0.3)));
    case "secular_professionals":
      // Well-educated but not structurally the highest-turnout group
      return Math.round(Math.max(62, Math.min(76, base + (education.graduate - 14) * 0.15)));
    case "new_immigrants":
      // Larger immigrant community → better support infrastructure, marginal boost
      return Math.round(
        Math.max(30, Math.min(52, base + (race.hispanic + race.asian - 24) * 0.05))
      );
    default:
      return Math.round(Math.max(25, Math.min(85, base)));
  }
}
