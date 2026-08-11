/**
 * Granular-cell electorate substrate for the vote engine
 * The electorate. Not a flag any more — every country has a Layer-1 model.
 *
 * WHAT THIS IS
 * ------------
 * When the flag is ON, per-state vote-share computation runs over granular
 * demographic cells (the cross-product of Layer-1 census dimensions, IPF-raked
 * to state marginals — the same derivation the granular poll uses via
 * `deriveGranularCells[Generic]`) instead of the 12 mutually-exclusive voter
 * archetypes. This module builds a drop-in SUBSTRATE for the existing engines:
 * a synthetic `DemographicCategory[]` + `StateDemographics` + `liveTurnouts`
 * whose "groups" are coalesced cells, plus archetype-keyed inputs
 * (`archetypeApprovals`, `partyGroupFavorability`) remapped onto those cells
 * via the static `ARCHETYPE_BUCKET_MAP`.
 *
 * The vote-distribution engines (`voteDistribution.ts`,
 * `voteDistributionSwingFlow.ts`) are NOT modified: they iterate whatever
 * categories/groups they are handed, so feeding them cell-shaped inputs swaps
 * the electorate substrate while preserving the appeal formula's structure and
 * coefficients exactly (policy-distance appeal dominance, favorability
 * weighting, org/reg/support multipliers — all untouched). Flag OFF is
 * therefore byte-identical legacy behavior by construction.
 *
 * PERFORMANCE (hot loop is per-state per-turn)
 * --------------------------------------------
 * 1. PRUNE: cells below `ELECTORATE_PRUNE_FLOOR` (0.25% of the electorate) are
 *    dropped and the remainder renormalized (inside the cell derivation).
 * 2. COALESCE: surviving cells are merged into "units" on quantized
 *    (economicLean, socialLean, turnout) — `LEAN_QUANT` / `TURNOUT_QUANT`.
 *    Appeal only depends on a unit's leans, so coalescing IS the
 *    "memoize appeal on quantized leans" mitigation: each distinct quantized
 *    lean pair is evaluated once per candidate instead of once per cell.
 *    Merged units store share-WEIGHTED means (not bin centers) so the
 *    quantization error stays well under the bin width. Approval / favorability
 *    / turnout remaps are linear in bucket membership, so coalescing is exact
 *    for them: each unit carries the share-weighted `bucketWeights` of its
 *    member cells.
 * 3. MEMOIZE: the derived unit list is cached per
 *    (country, state, preset, turnout-modifier signature) — cell derivation
 *    (IPF) does not rerun for every election sharing a state on a turn.
 *
 * TURNOUT COMPOSITION (documented choice)
 * ---------------------------------------
 * Cell base turnout comes from `deriveGranularCellsGeneric`: the GEOMETRIC
 * MEAN of the cell's per-bucket `DEMOGRAPHIC_TURNOUT_RATES`, rescaled so the
 * population-weighted mean matches the marginal-weighted baseline (same
 * composition the granular poll ships with). GOTV/canvassing/suppression
 * modifiers fold in as:
 *  - US dim-keyed modifiers (`modifiers.race.white = -9.6`) — added directly
 *    to the bucket rate before cell derivation (native granularity).
 *  - Archetype-keyed modifiers (`modifiers.voterGroups.retirees = +4`) —
 *    projected onto buckets via `ARCHETYPE_BUCKET_MAP` (pp × weight), then
 *    added to bucket rates.
 *  - Non-US worlds — archetype ids have no bucket mapping, so the state's
 *    AGGREGATE live-vs-static turnout ratio (from the legacy resolver) scales
 *    every cell uniformly: total GOTV magnitude is preserved, per-group
 *    targeting granularity is not (documented limitation).
 *  - `ideology`-dim modifiers have no cell axis (ideology is non-exclusive and
 *    not part of the cross-product) and are dropped on the granular path
 *    (documented limitation).
 *
 * APPROVAL / FAVORABILITY COMPOSITION (documented choice)
 * -------------------------------------------------------
 * archetype value → buckets (× mapping weight, summed across archetypes) →
 * unit value = Σ over "dim:key" of bucketWeight × bucketValue, clamped to
 * [-100, 100]. Since each archetype's mapping weights sum to 1, a cell matching
 * ALL of an archetype's buckets receives the full archetype value; partial
 * matches receive a proportional fraction.
 *
 * LEGISLATION-DRIVEN LEAN DRIFT (documented choice)
 * -------------------------------------------------
 * The v2 legislation channel (`demographicEffects` lean targets) mutates the
 * live archetype doc's per-group leans, which the legacy engine reads
 * directly. Cell leans, by contrast, derive from era positions + census. To
 * keep that channel influential under the flag, the per-archetype lean DELTA
 * (live doc − `demographicDefaults` seeded snapshot) is projected onto
 * buckets via ARCHETYPE_BUCKET_MAP and added to unit leans (clamped to
 * [-5, 5]). Turnout drift on the live doc is deliberately NOT folded — for US
 * Layer-1 states the legacy `resolveTurnout` already rebuilds archetype
 * turnout from census baselines and ignores stored drift, so folding it would
 * DIVERGE from legacy, not match it. Population drift is not folded either
 * (cell shares are census-marginal-raked; the channel is capped at ~0.1%/turn
 * — documented limitation).
 *
 * DURABLE BASE-VALUE SHIFTS: ERA CHECKPOINTS (`layer1PositionOverrides`)
 * -----------------------------------------------------------------------
 * The lean-DELTA fold above is deliberately zero-sum-neutral for a shift that
 * moves both `stateDemographics` and `demographicDefaults` together (that's
 * exactly how `src/lib/demographics/eraCheckpoints.ts` avoids fighting the
 * decay-to-baseline channel) — so it is the WRONG channel for a realignment
 * to use, and historically was: it never reached this substrate through that
 * path. Checkpoints instead accumulate a separate, durable
 * `demographicDefaults.layer1PositionOverrides` overlay: a per-(dimension,
 * bucket) delta applied via `applyPositionOverlay` directly to the resolved
 * Layer-1 position table BEFORE `deriveGranularCells[Generic]` runs — i.e. to
 * the actual base value a cell's lean is averaged from, not a post-hoc fold
 * on the derived unit. It is threaded through `deriveGranularElectorateUnits`
 * (part of the unit-cache key, since it changes the derivation) rather than
 * folded post-derivation like the lean-delta channel, and it is never
 * decayed — see the type doc on `Layer1PositionOverlay`
 * (`src/lib/db/types/demographics.ts`).
 *
 * DURABLE BASE-VALUE SHIFTS: TURNOUT (`layer1TurnoutOverrides`)
 * ----------------------------------------------------------------
 * A durable TURNOUT shift (the Voting Rights Act's enfranchisement effect is
 * the worked example — see `src/lib/demographics/eraCheckpoints.ts` /
 * `DemographicEffect.permanent` in `src/lib/db/types/legislation.ts`) cannot
 * reuse the lean-DELTA fold OR `layer1PositionOverrides` for the same reason:
 * it needs its own overlay, `demographicDefaults.layer1TurnoutOverrides`, a
 * per-(dimension, bucket) turnout-RATE delta applied via
 * `applyTurnoutRateOverlay` to the composed bucket-rate table
 * `buildUsTurnoutRates` builds, BEFORE `deriveGranularCells[Generic]` runs —
 * i.e. to the actual bucket rate a cell's turnout is geometric-meaned from,
 * not a post-hoc fold on the derived unit's turnout (the TURNOUT DRIFT this
 * module already documents as "deliberately NOT folded" above is the
 * live-vs-defaults delta on `groups[id].turnout`; this overlay is a distinct,
 * separately-durable substrate, not a relaxation of that documented
 * exclusion). Threaded through `deriveGranularElectorateUnits` (part of the
 * unit-cache key) exactly like the position overlay, and never decayed — see
 * the type doc on `Layer1TurnoutOverlay` (`src/lib/db/types/demographics.ts`).
 */

import type {
  DemographicCategory,
  Layer1PositionOverlay,
  Layer1TurnoutOverlay,
  StateDemographics,
} from "@/lib/db/types";
import type { StateDemographicTurnout } from "@/lib/db/types/stateDemographicTurnout";
import type { EnrichedCandidate } from "@/lib/electionEngine/types";
import type { CountryId } from "@/lib/constants/countries";
import type { EraId } from "@/lib/seeds/presetSelector";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { DEMOGRAPHIC_TURNOUT_RATES } from "@/lib/seeds/demographicCategories";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { stateCensusData } from "@/lib/seeds/stateDemographics";
import type { Layer1Config } from "@/lib/seeds/stateDemographicsPure";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { resolveGranularPositions } from "@/lib/actions/granularPollPayload";
import {
  deriveGranularCells,
  deriveGranularCellsGeneric,
  COUNTRY_PRIORS,
  GRANULAR_DIMENSIONS,
  type GenericGranularCell,
  type GenericGranularDimInput,
  type GranularDim,
} from "./granularCells";
import { archetypeValuesToBuckets } from "./archetypeBucketMap";
import {
  getCountrySubstrateForYear,
  getUsSubstrateForYear,
  type CountryLayer1Substrate,
} from "@/lib/seeds/eraSubstrateForYear";
import { recordEraInterpolationFallback } from "@/lib/seeds/eraInterpolation";
import { getUsTurnoutRatesForYear } from "@/lib/seeds/eraSubstrateForYear";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Live-clock context for Layer-1 derivation. `year` null means "the era system
 * is off for this world" and every path below stays byte-identical to the
 * legacy preset-driven behavior.
 */
export interface EraYearContext {
  year?: number | null;
  startingYear?: number | null;
}

/** Cells below this electorate share are pruned + renormalized (0.25%). */
export const ELECTORATE_PRUNE_FLOOR = 0.0025;
/** Lean quantization step for coalescing cells into units. */
export const LEAN_QUANT = 0.5;
/** Turnout quantization step (percentage points) for coalescing. */
export const TURNOUT_QUANT = 5;
/** Synthetic category id the engines iterate when the flag is on. */
export const GRANULAR_CATEGORY_ID = "granularCells";

/** A coalesced group of granular cells sharing quantized lean/turnout. */
export interface GranularElectorateUnit {
  id: string;
  /** Electorate share (0..1) of the merged cells. */
  share: number;
  /** Share-weighted mean leans of member cells. */
  economicLean: number;
  socialLean: number;
  /** Share-weighted mean turnout (0..100) of member cells. */
  turnout: number;
  /** Share-weighted bucket membership ("dim:key" → 0..1) of member cells. */
  bucketWeights: Record<string, number>;
}

export interface GranularSubstrateInput {
  countryId: CountryId | string;
  stateId: string;
  preset?: string;
  /** GOTV/canvassing/suppression modifiers doc for the state (may be null). */
  turnoutDoc?: StateDemographicTurnout | null;
  statePopulation: number;
  /** Legacy archetype demographics (for the non-US aggregate GOTV ratio). */
  demographics: StateDemographics;
  /** Legacy category list (for the non-US aggregate GOTV baseline). */
  categories: DemographicCategory[];
  /** Archetype-keyed resolved live turnouts from `resolveTurnout` (optional). */
  liveTurnouts?: Record<string, number>;
  /** Candidates whose `archetypeApprovals` should be remapped onto units. */
  enriched: EnrichedCandidate[];
  /** Address-driven `${partyId}:${archetypeId}` favorability deltas (optional). */
  partyGroupFavorabilityByKey?: Map<string, number>;
  /**
   * Seeded per-state snapshot (`demographicDefaults` collection). When
   * provided, legislation-driven lean drift (live − seeded, per archetype) is
   * folded onto unit leans via the bucket map. Omitted/null = no drift folded.
   */
  demographicDefaults?: StateDemographics | null;
  /**
   * Live in-game year (`gameState.currentYear`). When set, the Layer-1
   * substrate is resolved from the YEAR — census marginals and positions slide
   * between the bracketing era anchors — instead of from the frozen seed
   * `preset`. Null/undefined keeps the legacy preset-driven resolution exactly,
   * which is what the `eraSystemEnabled` flag gate passes while it is off.
   */
  year?: number | null;
  /**
   * World `gameState.startingYear`. Only used to gate era-checkpoint
   * de-duplication to the worlds that actually run checkpoints — see
   * `checkpointBakedShifts.ts`.
   */
  startingYear?: number | null;
}

/** Drop-in replacements for the legacy engine inputs. */
export interface GranularSubstrate {
  demographics: StateDemographics;
  categories: DemographicCategory[];
  liveTurnouts: Record<string, number>;
  /** Weighted turnout pool over units (replaces `resolveTurnout().totalPool`). */
  totalPool: number;
  enriched: EnrichedCandidate[];
  partyGroupFavorabilityByKey?: Map<string, number>;
  units: GranularElectorateUnit[];
}

// ─── Cell → unit derivation (memoized) ──────────────────────────────────────

const UNIT_CACHE = new Map<string, GranularElectorateUnit[] | null>();
const UNIT_CACHE_MAX = 800;

/** Test seam: clear the memoized unit cache. */
export function clearGranularElectorateCache(): void {
  UNIT_CACHE.clear();
}

function clampTurnout(v: number): number {
  return Math.max(5, Math.min(95, v));
}

function clampLeanAxis(v: number): number {
  return Math.max(-5, Math.min(5, v));
}

/**
 * Additive overlay of a durable per-(dimension, bucket) position delta
 * (era checkpoints — see the module doc above and `eraCheckpoints.ts`) onto a
 * resolved Layer-1 position table, clamped to the shared −5..+5 lean axis.
 *
 * This modifies the actual BASE VALUE `deriveGranularCellsGeneric` averages a
 * cell's lean from (`dim.positions[bucket]`), not a post-hoc fold on derived
 * units — so a checkpoint's pull lands exactly where "move the electorate's
 * resting point" has to land for this substrate to see it. Pure / side-effect
 * free: returns `base` unchanged (no clone) when there is nothing to apply.
 */
function applyPositionOverlay(
  base: Record<string, Record<string, { economicLean: number; socialLean: number }>>,
  overlay: Layer1PositionOverlay | null | undefined
): Record<string, Record<string, { economicLean: number; socialLean: number }>> {
  if (!overlay) return base;
  let out: Record<string, Record<string, { economicLean: number; socialLean: number }>> | null =
    null;
  for (const [dim, buckets] of Object.entries(overlay)) {
    const baseDim = base[dim];
    if (!baseDim) continue; // dimension not part of this cell model (e.g. non-US) — nothing to shift
    for (const [key, delta] of Object.entries(buckets)) {
      if (!delta) continue;
      const dEcon = delta.economicLean ?? 0;
      const dSoc = delta.socialLean ?? 0;
      if (dEcon === 0 && dSoc === 0) continue;
      if (!out) out = { ...base };
      if (out[dim] === base[dim]) out[dim] = { ...baseDim };
      const cur = out[dim][key] ?? { economicLean: 0, socialLean: 0 };
      out[dim][key] = {
        economicLean: clampLeanAxis(cur.economicLean + dEcon),
        socialLean: clampLeanAxis(cur.socialLean + dSoc),
      };
    }
  }
  return out ?? base;
}

/**
 * Bounds for a composed Layer-1 turnout-RATE bucket value fed into cell
 * derivation. `deriveGranularCells[Generic]`'s geometric mean
 * (`geoMeanTurnout`) is undefined for a zero/negative rate (a fractional
 * power of a negative product is NaN), so a bucket rate must stay strictly
 * positive and comfortably below 100 even under an extreme durable overlay
 * or a stacked suppression modifier — this is a defensive final clamp, not a
 * gameplay-meaningful bound (individual cell/unit turnout is already clamped
 * tighter downstream, [15, 95] / [5, 95]).
 */
const BUCKET_TURNOUT_RATE_MIN = 1;
const BUCKET_TURNOUT_RATE_MAX = 99;

function clampBucketTurnoutRate(v: number): number {
  return Math.max(BUCKET_TURNOUT_RATE_MIN, Math.min(BUCKET_TURNOUT_RATE_MAX, v));
}

/**
 * Additive overlay of a durable per-(dimension, bucket) TURNOUT-RATE delta
 * (era checkpoints / durable "permanent" legislation — see
 * `Layer1TurnoutOverlay`'s doc comment in `src/lib/db/types/demographics.ts`)
 * onto an already-composed bucket-rate table, clamped to stay a valid
 * percentage. The turnout counterpart of `applyPositionOverlay`, but applied
 * as a separate post-composition step (not folded into `buildUsTurnoutRates`'
 * own baseline+modifier sum) so the existing GOTV/canvassing computation
 * above is untouched byte-for-byte when no durable overlay is present. Pure /
 * side-effect free: returns `rates` unchanged (no clone) when there is
 * nothing to apply.
 */
function applyTurnoutRateOverlay(
  rates: Record<string, number>,
  overlayDim: Record<string, number> | undefined
): Record<string, number> {
  if (!overlayDim) return rates;
  let out: Record<string, number> | null = null;
  for (const [key, delta] of Object.entries(overlayDim)) {
    if (!delta) continue;
    const base = rates[key];
    if (base === undefined) continue; // bucket not part of this dim/model — nothing to shift
    if (!out) out = { ...rates };
    out[key] = clampBucketTurnoutRate(base + delta);
  }
  return out ?? rates;
}

/**
 * Bucket-rate table for US cells: era baselines + turnout-doc modifiers +
 * durable overlay.
 *
 * The baselines are year-resolved when the era clock is live — `race.black`
 * participation in 1953 is not 2020's, and modelling it as such gave every
 * historical world a modern electorate. With no year (flag off) this reads the
 * single modern table exactly as before.
 */
function buildUsTurnoutRates(
  stateId: string,
  turnoutDoc: StateDemographicTurnout | null | undefined,
  turnoutOverlay?: Layer1TurnoutOverlay | null,
  yearCtx?: EraYearContext
): Record<GranularDim, Record<string, number>> {
  // Archetype-keyed modifiers (current US format) → bucket pp deltas.
  const archetypeModifiers = turnoutDoc?.modifiers?.voterGroups ?? {};
  const bucketDeltas = archetypeValuesToBuckets(archetypeModifiers);

  let eraRates: Record<string, Record<string, number>> | null = null;
  if (yearCtx?.year != null) {
    try {
      eraRates = getUsTurnoutRatesForYear(stateId, yearCtx.year, {
        startingYear: yearCtx.startingYear ?? null,
      }) as unknown as Record<string, Record<string, number>>;
    } catch (err) {
      recordEraInterpolationFallback(
        `turnoutRates:US/${stateId}`,
        `@${yearCtx.year}: ${(err as Error).message}`
      );
    }
  }

  const rates = {} as Record<GranularDim, Record<string, number>>;
  for (const dim of GRANULAR_DIMENSIONS) {
    const baselines = (eraRates?.[dim] ??
      (DEMOGRAPHIC_TURNOUT_RATES[dim] as Record<string, number>)) as Record<string, number>;
    // Legacy dim-keyed modifiers (`modifiers.race.white`) apply natively.
    const dimModifiers = turnoutDoc?.modifiers?.[dim] ?? {};
    const out: Record<string, number> = {};
    for (const [key, baseline] of Object.entries(baselines)) {
      out[key] = baseline + (dimModifiers[key] ?? 0) + (bucketDeltas[`${dim}:${key}`] ?? 0);
    }
    rates[dim] = applyTurnoutRateOverlay(out, turnoutOverlay?.[dim]);
  }
  return rates;
}

/** Derive pruned granular cells for a state, or null when no census exists. */
function deriveCellsForState(
  countryId: string,
  stateId: string,
  preset: string | undefined,
  turnoutDoc: StateDemographicTurnout | null | undefined,
  positionOverlay?: Layer1PositionOverlay | null,
  turnoutOverlay?: Layer1TurnoutOverlay | null,
  yearCtx?: EraYearContext
): { cells: GenericGranularCell[]; modifiersNative: boolean } | null {
  const era: EraId = eraForPreset(preset ?? DEFAULT_SEED_PRESET);
  const year = yearCtx?.year ?? null;

  // eslint-disable-next-line local/no-country-literals -- US census path is separate from international models
  if (countryId === "US") {
    // Year-driven substrate when the era clock is live; otherwise the legacy
    // preset lookup, byte-identical. A structural surprise in the year path
    // must never cost this state its electorate, so it degrades to the legacy
    // path with the fallback recorded (see `eraSubstrateForYear.ts`).
    let config: Layer1Config | null = null;
    let resolvedPositions: ReturnType<typeof resolveGranularPositions> | null = null;
    if (year != null) {
      try {
        const substrate = getUsSubstrateForYear(stateId, year, {
          startingYear: yearCtx?.startingYear ?? null,
        });
        if (substrate) {
          config = substrate.config;
          resolvedPositions = substrate.positions as ReturnType<typeof resolveGranularPositions>;
        }
      } catch (err) {
        recordEraInterpolationFallback(
          `granularElectorate:US/${stateId}`,
          `@${year}: ${(err as Error).message}`
        );
      }
    }
    if (!config) {
      config =
        (getRegionCensusData("US", stateId, preset) as Layer1Config | null) ??
        stateCensusData[stateId] ??
        null;
      if (!config || !("race" in config)) return null;
      resolvedPositions = resolveGranularPositions(config, era, stateId);
    }
    if (!config || !("race" in config) || !resolvedPositions) return null;
    const positions = applyPositionOverlay(
      resolvedPositions,
      positionOverlay
    ) as typeof resolvedPositions;
    const usCells = deriveGranularCells(
      config,
      positions,
      buildUsTurnoutRates(stateId, turnoutDoc, turnoutOverlay, yearCtx),
      { pruneFloor: ELECTORATE_PRUNE_FLOOR }
    );
    const cells: GenericGranularCell[] = usCells.map((cell) => ({
      id: cell.id,
      buckets: {
        race: cell.race,
        age: cell.age,
        education: cell.education,
        wealth: cell.wealth,
      },
      share: cell.share,
      economicLean: cell.economicLean,
      socialLean: cell.socialLean,
      turnout: cell.turnout,
    }));
    return { cells, modifiersNative: true };
  }

  // Same shape as the US branch: year-driven when the clock is live, legacy
  // era lookup otherwise, and never a throw into the vote path.
  let substrate: CountryLayer1Substrate | null = null;
  if (year != null) {
    try {
      substrate = getCountrySubstrateForYear(countryId, stateId, year);
    } catch (err) {
      recordEraInterpolationFallback(
        `granularElectorate:${countryId}/${stateId}`,
        `@${year}: ${(err as Error).message}`
      );
    }
  }
  if (!substrate) {
    const model = getCountryLayer1Model(countryId, era);
    const regionCensus = model?.census[stateId];
    if (!model || !regionCensus) return null;
    substrate = {
      dims: [...model.dims],
      marginals: regionCensus,
      positions: model.positions,
      turnoutRates: model.turnoutRates,
    };
  }

  const mergedPositions = applyPositionOverlay(substrate.positions, positionOverlay);
  const dims: GenericGranularDimInput[] = substrate.dims.map((name) => ({
    name,
    marginals: substrate.marginals[name],
    positions: mergedPositions[name],
    // Dim-keyed turnout modifiers (`modifiers.race.black`) apply natively here,
    // exactly as they do on the US path — this is where bucket-targeted GOTV
    // and Governor's Addresses land. Archetype-keyed modifiers cannot leak in:
    // they live under `modifiers.voterGroups`, which is never a dimension name,
    // and they keep going through the aggregate ratio below. Applied before the
    // durable overlay so a permanent era shift composes on top of the temporary
    // one, matching the US ordering.
    turnoutRates: applyTurnoutRateOverlay(
      applyTurnoutRateOverlay(substrate.turnoutRates[name], turnoutDoc?.modifiers?.[name]),
      turnoutOverlay?.[name]
    ),
  }));
  const cells = deriveGranularCellsGeneric({
    dims,
    priors: COUNTRY_PRIORS[countryId] ?? {},
    opts: { pruneFloor: ELECTORATE_PRUNE_FLOOR },
  });
  if (cells.length === 0) return null;
  // Non-US archetype-keyed GOTV modifiers have no bucket mapping — the caller-
  // supplied aggregate ratio handles them (modifiersNative: false).
  return { cells, modifiersNative: false };
}

/** Coalesce pruned cells into quantized-lean units (see module header). */
function coalesceCells(cells: GenericGranularCell[]): GranularElectorateUnit[] {
  interface Acc {
    share: number;
    ep: number;
    sp: number;
    turnout: number;
    bucketWeights: Record<string, number>;
  }
  const byKey = new Map<string, Acc>();
  for (const cell of cells) {
    const key = [
      Math.round(cell.economicLean / LEAN_QUANT),
      Math.round(cell.socialLean / LEAN_QUANT),
      Math.round(cell.turnout / TURNOUT_QUANT),
    ].join("|");
    let acc = byKey.get(key);
    if (!acc) {
      acc = { share: 0, ep: 0, sp: 0, turnout: 0, bucketWeights: {} };
      byKey.set(key, acc);
    }
    acc.share += cell.share;
    acc.ep += cell.share * cell.economicLean;
    acc.sp += cell.share * cell.socialLean;
    acc.turnout += cell.share * cell.turnout;
    for (const [dim, bucket] of Object.entries(cell.buckets)) {
      const k = `${dim}:${bucket}`;
      acc.bucketWeights[k] = (acc.bucketWeights[k] ?? 0) + cell.share;
    }
  }

  const units: GranularElectorateUnit[] = [];
  let i = 0;
  for (const acc of byKey.values()) {
    const bucketWeights: Record<string, number> = {};
    for (const [k, v] of Object.entries(acc.bucketWeights)) {
      bucketWeights[k] = v / acc.share;
    }
    units.push({
      id: `gcell_${i++}`,
      share: acc.share,
      economicLean: acc.ep / acc.share,
      socialLean: acc.sp / acc.share,
      turnout: clampTurnout(acc.turnout / acc.share),
      bucketWeights,
    });
  }
  // Stable order (largest first) so unit ids are deterministic per derivation.
  return units.sort((a, b) => b.share - a.share);
}

/**
 * Derive (memoized) the coalesced unit list for a state, or null when the
 * state has no Layer-1 census. `modifiersNative` tells the caller whether
 * GOTV modifiers are already folded into unit turnout (US) or still need the
 * aggregate ratio (non-US).
 */
export function deriveGranularElectorateUnits(
  countryId: string,
  stateId: string,
  preset: string | undefined,
  turnoutDoc: StateDemographicTurnout | null | undefined,
  /**
   * Durable per-(dimension, bucket) position overlay (era checkpoints — see
   * the module doc above). Included in the cache key: unlike the
   * legislation-lean-delta fold (applied post-derivation in
   * `buildGranularElectorateSubstrate`), this overlay changes the derivation
   * itself, so a stale cache entry would silently hide a checkpoint's pull.
   */
  positionOverlay?: Layer1PositionOverlay | null,
  /**
   * Durable per-(dimension, bucket) TURNOUT-RATE overlay (era checkpoints /
   * durable "permanent" legislation — see `Layer1TurnoutOverlay`'s doc
   * comment). Included in the cache key for the SAME reason `positionOverlay`
   * is: it changes the derivation itself (a bucket rate `deriveGranularCells`
   * averages from), so a stale cache entry would silently hide the shift.
   */
  turnoutOverlay?: Layer1TurnoutOverlay | null,
  /**
   * Live-year context. Part of the cache key for the same reason the overlays
   * are: it changes the derivation itself. Without the year here, the first
   * derivation of a state would be reused for every later year and its cells
   * would stay frozen at whatever year happened to be asked for first — the
   * era clock would advance while the electorate silently did not.
   */
  yearCtx?: EraYearContext
): { units: GranularElectorateUnit[]; modifiersNative: boolean } | null {
  const modifiersSig = turnoutDoc?.modifiers ? JSON.stringify(turnoutDoc.modifiers) : "";
  const overlaySig = positionOverlay ? JSON.stringify(positionOverlay) : "";
  const turnoutOverlaySig = turnoutOverlay ? JSON.stringify(turnoutOverlay) : "";
  const yearSig = yearCtx?.year != null ? `${yearCtx.year}:${yearCtx.startingYear ?? ""}` : "";
  const cacheKey = `${countryId}|${stateId}|${preset ?? ""}|${modifiersSig}|${overlaySig}|${turnoutOverlaySig}|${yearSig}`;
  if (UNIT_CACHE.has(cacheKey)) {
    const cached = UNIT_CACHE.get(cacheKey) ?? null;
    if (cached === null) return null;
    // eslint-disable-next-line local/no-country-literals -- cache stores the derivation output; nativeness is structural
    return { units: cached, modifiersNative: countryId === "US" };
  }

  let derived: { cells: GenericGranularCell[]; modifiersNative: boolean } | null = null;
  try {
    derived = deriveCellsForState(
      countryId,
      stateId,
      preset,
      turnoutDoc,
      positionOverlay,
      turnoutOverlay,
      yearCtx
    );
  } catch {
    derived = null;
  }

  if (UNIT_CACHE.size >= UNIT_CACHE_MAX) UNIT_CACHE.clear();
  if (!derived) {
    UNIT_CACHE.set(cacheKey, null);
    return null;
  }
  const units = coalesceCells(derived.cells);
  UNIT_CACHE.set(cacheKey, units);
  return { units, modifiersNative: derived.modifiersNative };
}

// ─── Archetype-keyed → unit-keyed remapping ─────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Remap archetype-keyed values (approvals, favorability deltas) onto units.
 * Linear in bucket membership, so it is exact under cell coalescing.
 */
export function remapArchetypeValuesToUnits(
  valuesByArchetype: Record<string, number>,
  units: GranularElectorateUnit[],
  /** Selects the bucket vocabulary — see `archetypeValuesToBuckets`. */
  countryId?: string
): Record<string, number> {
  const bucketValues = archetypeValuesToBuckets(valuesByArchetype, countryId);
  const keys = Object.keys(bucketValues);
  const out: Record<string, number> = {};
  if (keys.length === 0) return out;
  for (const unit of units) {
    let v = 0;
    for (const k of keys) {
      const w = unit.bucketWeights[k];
      if (w) v += w * bucketValues[k];
    }
    if (v !== 0) out[unit.id] = clamp(v, -100, 100);
  }
  return out;
}

/**
 * Per-archetype lean deltas: live doc − seeded snapshot. Captures the v2
 * legislation lean channel (plus any admin edit) so it can be projected onto
 * cell buckets. Groups missing from either doc, or with non-finite values,
 * contribute nothing.
 */
function computeArchetypeLeanDeltas(
  live: StateDemographics,
  defaults: StateDemographics | null | undefined
): { economic: Record<string, number>; social: Record<string, number> } {
  const economic: Record<string, number> = {};
  const social: Record<string, number> = {};
  if (!defaults?.groups) return { economic, social };
  for (const [groupId, liveGroup] of Object.entries(live.groups)) {
    const defGroup = defaults.groups[groupId];
    if (!defGroup) continue;
    const dEcon = (liveGroup.economicLean ?? 0) - (defGroup.economicLean ?? 0);
    const dSoc = (liveGroup.socialLean ?? 0) - (defGroup.socialLean ?? 0);
    if (Number.isFinite(dEcon) && dEcon !== 0) economic[groupId] = dEcon;
    if (Number.isFinite(dSoc) && dSoc !== 0) social[groupId] = dSoc;
  }
  return { economic, social };
}

/** Aggregate live-vs-static turnout ratio over the legacy archetype groups. */
function aggregateTurnoutRatio(
  demographics: StateDemographics,
  categories: DemographicCategory[],
  liveTurnouts: Record<string, number> | undefined
): number {
  if (!liveTurnouts) return 1;
  let staticPool = 0;
  let livePool = 0;
  for (const category of categories) {
    const categoryWeight = demographics.categoryWeights[category._id] ?? 0;
    if (categoryWeight <= 0) continue;
    for (const group of category.groups) {
      const stateGroup = demographics.groups[group.id];
      const populationPct = stateGroup?.population ?? 0;
      if (populationPct <= 0) continue;
      const staticTurnout =
        (typeof stateGroup?.turnout === "number" ? stateGroup.turnout : group.defaultTurnout) ?? 55;
      const liveTurnout = liveTurnouts[group.id] ?? staticTurnout;
      staticPool += populationPct * staticTurnout * categoryWeight;
      livePool += populationPct * liveTurnout * categoryWeight;
    }
  }
  if (staticPool <= 0 || livePool <= 0) return 1;
  return livePool / staticPool;
}

// ─── Substrate builder ──────────────────────────────────────────────────────

/**
 * Build the granular-cell substrate for one state's vote distribution, or
 * null when the state has no Layer-1 census (callers fall back to the legacy
 * archetype path — the substrate never hard-fails a turn).
 */
export function buildGranularElectorateSubstrate(
  input: GranularSubstrateInput
): GranularSubstrate | null {
  const derived = deriveGranularElectorateUnits(
    input.countryId,
    input.stateId,
    input.preset,
    input.turnoutDoc,
    // Durable era-checkpoint position overlay — piggybacks on the seeded
    // snapshot doc callers already fetch for the lean-delta fold below (see
    // `Layer1PositionOverlay`'s doc comment for why it lives there).
    input.demographicDefaults?.layer1PositionOverrides,
    // Durable turnout-rate overlay (era checkpoints / durable "permanent"
    // legislation) — same snapshot doc, see `Layer1TurnoutOverlay`'s doc
    // comment for why turnout needs its own overlay rather than reusing the
    // lean-delta fold below (that fold is deliberately zero-sum for a durable
    // shift, and legacy `resolveTurnout` ignores stored turnout drift anyway).
    input.demographicDefaults?.layer1TurnoutOverrides,
    { year: input.year ?? null, startingYear: input.startingYear ?? null }
  );
  if (!derived || derived.units.length === 0) return null;
  const { units, modifiersNative } = derived;

  // Non-US: apply the state's aggregate GOTV ratio uniformly (see header).
  const ratio = modifiersNative
    ? 1
    : aggregateTurnoutRatio(input.demographics, input.categories, input.liveTurnouts);

  // Legislation-driven lean drift (live − seeded, see module header) projected
  // onto buckets, then folded into unit leans below.
  const leanDeltas = computeArchetypeLeanDeltas(input.demographics, input.demographicDefaults);
  const econBucketDeltas = archetypeValuesToBuckets(leanDeltas.economic, input.countryId);
  const socBucketDeltas = archetypeValuesToBuckets(leanDeltas.social, input.countryId);
  const econDeltaKeys = Object.keys(econBucketDeltas);
  const socDeltaKeys = Object.keys(socBucketDeltas);
  const foldLean = (
    base: number,
    unit: GranularElectorateUnit,
    keys: string[],
    deltas: Record<string, number>
  ) => {
    if (keys.length === 0) return base;
    let v = base;
    for (const k of keys) {
      const w = unit.bucketWeights[k];
      if (w) v += w * deltas[k];
    }
    return clamp(v, -5, 5);
  };

  const liveTurnouts: Record<string, number> = {};
  const groups: StateDemographics["groups"] = {};
  const categoryGroups: DemographicCategory["groups"] = [];
  let pool = 0;
  for (const unit of units) {
    const turnout = ratio === 1 ? unit.turnout : clampTurnout(unit.turnout * ratio);
    const economicLean = foldLean(unit.economicLean, unit, econDeltaKeys, econBucketDeltas);
    const socialLean = foldLean(unit.socialLean, unit, socDeltaKeys, socBucketDeltas);
    const populationPct = unit.share * 100;
    liveTurnouts[unit.id] = turnout;
    groups[unit.id] = {
      population: populationPct,
      economicLean,
      socialLean,
      turnout,
    };
    categoryGroups.push({
      id: unit.id,
      name: unit.id,
      defaultEconomicLean: economicLean,
      defaultSocialLean: socialLean,
      defaultTurnout: turnout,
    });
    pool += input.statePopulation * (populationPct / 100) * (turnout / 100);
  }

  const categories: DemographicCategory[] = [
    {
      _id: GRANULAR_CATEGORY_ID,
      name: "Granular Electorate",
      defaultWeight: 100,
      groups: categoryGroups,
    },
  ];
  const demographics: StateDemographics = {
    ...input.demographics,
    categoryWeights: { [GRANULAR_CATEGORY_ID]: 100 },
    groups,
  };

  // Candidate archetype approvals → unit approvals.
  const enriched = input.enriched.map((ec) => {
    if (!ec.archetypeApprovals || Object.keys(ec.archetypeApprovals).length === 0) return ec;
    return {
      ...ec,
      archetypeApprovals: remapArchetypeValuesToUnits(
        ec.archetypeApprovals,
        units,
        input.countryId
      ),
    };
  });

  // Address-driven `${party}:${archetype}` favorability deltas → `${party}:${unit}`.
  let partyGroupFavorabilityByKey = input.partyGroupFavorabilityByKey;
  if (partyGroupFavorabilityByKey && partyGroupFavorabilityByKey.size > 0) {
    const byParty = new Map<string, Record<string, number>>();
    for (const [key, delta] of partyGroupFavorabilityByKey) {
      const sep = key.indexOf(":");
      if (sep <= 0) continue;
      const party = key.slice(0, sep);
      const archetypeId = key.slice(sep + 1);
      const rec = byParty.get(party) ?? {};
      rec[archetypeId] = (rec[archetypeId] ?? 0) + delta;
      byParty.set(party, rec);
    }
    const remapped = new Map<string, number>();
    for (const [party, valuesByArchetype] of byParty) {
      const unitValues = remapArchetypeValuesToUnits(valuesByArchetype, units, input.countryId);
      for (const [unitId, v] of Object.entries(unitValues)) {
        remapped.set(`${party}:${unitId}`, v);
      }
    }
    partyGroupFavorabilityByKey = remapped;
  }

  return {
    demographics,
    categories,
    liveTurnouts,
    totalPool: Math.round(pool),
    enriched,
    partyGroupFavorabilityByKey,
    units,
  };
}
