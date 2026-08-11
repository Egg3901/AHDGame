/**
 * The complete Layer-1 substrate — census marginals, positions, turnout rates —
 * resolved at the live in-game year rather than the frozen seed preset.
 *
 * This is what the granular vote path consumes. It follows the program's
 * standing rule (never lerp a sparse override table; lerp the fully-resolved
 * substrate) by building the whole substrate at each bracketing anchor and
 * blending those.
 *
 * WHAT INTERPOLATES AND WHAT DOES NOT
 * -----------------------------------
 * Census marginals interpolate freely: a country genuinely does get older,
 * more educated and more diverse whether or not anything happens in the game,
 * and no mechanism owns that drift. Positions come from
 * `eraPositionsForYear.ts`, which carries regional character forward and
 * subtracts what the era checkpoints already own — see that module for why
 * both corrections are load-bearing.
 *
 * IDENTITY CHANGES ACROSS ANCHORS
 * -------------------------------
 * A tree lerp requires both anchors to have the same shape, and two authored
 * anchors genuinely do not, in ways that are correct rather than mistakes:
 *
 *  - **Germany, 1979 → 1991.** The census gains BB/MV/SN/ST/TH. Those regions
 *    did not exist in the Federal Republic before reunification, so there is
 *    nothing to blend from.
 *  - **Japan, 1953 → 1979.** `positions.education` drops `primary_or_below`.
 *    The bucket was retired, not renamed.
 *
 * Both are handled by union semantics at the leaf level: a region or bucket
 * present in only ONE anchor holds that anchor's value instead of vanishing or
 * throwing. This is exactly the "caller-level decision" `lerpNumericTree`'s
 * doc comment reserves for callers — the lerp itself stays strict, and the
 * judgment about what an absent key MEANS lives here, where the domain is
 * known.
 *
 * FAILURE POLICY
 * --------------
 * Nothing in here may throw into the vote path. `deriveCellsForState` catches
 * and degrades to `null`, which silently costs a state its entire granular
 * electorate on election night. Any structural surprise therefore falls back
 * to the discrete anchor bundle and records the fallback via
 * `recordEraInterpolationFallback`, so the gap is countable instead of
 * invisible.
 */
import type { EraId } from "./presetSelector";
import { presetForEra } from "./presetSelector";
import { getRegionCensusData } from "./regionCensusData";
import { stateCensusData } from "./stateDemographics";
import type { Layer1Config } from "./stateDemographicsPure";
import { getCountryLayer1Model } from "./international";
import {
  lerpNumericTree,
  recordEraInterpolationFallback,
  resolveEraBlend,
} from "./eraInterpolation";
import {
  resolveEraPositionsAtAnchor,
  type EraPositionYearOptions,
  type PositionTable,
} from "./eraPositionsForYear";
import {
  ERA_TURNOUT_RATES,
  type DemographicPosition,
  type DemographicTurnoutRates,
} from "./demographicCategories";
import { bakedCheckpointBucketShifts } from "@/lib/demographics/checkpointBakedShifts";

/** Layer-1 census dimensions carried on a `Layer1Config`. */
const CONFIG_DIMS = ["race", "age", "education", "wealth", "ideology"] as const;

export interface UsLayer1Substrate {
  /** Census marginals (percentages) for the year, plus the ideology dimension. */
  config: Layer1Config;
  /** Fully-resolved position table: era base, regional character, census overrides. */
  positions: PositionTable;
}

export interface CountryLayer1Substrate {
  dims: string[];
  marginals: Record<string, Record<string, number>>;
  positions: Record<string, Record<string, DemographicPosition>>;
  turnoutRates: Record<string, Record<string, number>>;
}

// ─── Union-semantics leaf blends ────────────────────────────────────────────

/**
 * Blend two numeric records where a key may exist in only one anchor. Shared
 * keys interpolate; a key present on one side only holds its authored value
 * (see the module doc — this is the reunification / retired-bucket case).
 */
function unionLerpNumbers(
  lo: Record<string, number> | undefined,
  hi: Record<string, number> | undefined,
  t: number
): Record<string, number> {
  if (!lo) return { ...(hi ?? {}) };
  if (!hi) return { ...lo };
  const out: Record<string, number> = {};
  for (const key of new Set([...Object.keys(lo), ...Object.keys(hi)])) {
    const a = lo[key];
    const b = hi[key];
    if (a === undefined) out[key] = b;
    else if (b === undefined) out[key] = a;
    else out[key] = a + (b - a) * t;
  }
  return out;
}

function unionLerpPositions(
  lo: Record<string, DemographicPosition> | undefined,
  hi: Record<string, DemographicPosition> | undefined,
  t: number
): Record<string, DemographicPosition> {
  if (!lo) return { ...(hi ?? {}) };
  if (!hi) return { ...lo };
  const out: Record<string, DemographicPosition> = {};
  for (const key of new Set([...Object.keys(lo), ...Object.keys(hi)])) {
    const a = lo[key];
    const b = hi[key];
    if (!a) out[key] = { ...b };
    else if (!b) out[key] = { ...a };
    else {
      out[key] = {
        economicLean: a.economicLean + (b.economicLean - a.economicLean) * t,
        socialLean: a.socialLean + (b.socialLean - a.socialLean) * t,
      };
    }
  }
  return out;
}

/**
 * Rescale a marginal vector to sum to 100. Interpolating two vectors that each
 * sum to 100 keeps the sum, but a union blend across an identity change does
 * not (a bucket that exists on one side only contributes its full authored
 * share), and authored tables round. The IPF rake downstream needs valid
 * marginals, so this runs on every blended vector. A zero-sum vector is left
 * alone — there is nothing meaningful to scale.
 */
function renormalizeMarginals(marginals: Record<string, number>): Record<string, number> {
  let sum = 0;
  for (const v of Object.values(marginals)) sum += v;
  if (sum <= 0) return { ...marginals };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(marginals)) out[k] = (v / sum) * 100;
  return out;
}

// ─── United States ──────────────────────────────────────────────────────────

/** The census config for one anchor era, or null when the state has no Layer-1 census. */
function usConfigAtAnchor(era: EraId, stateId: string): Layer1Config | null {
  const config =
    (getRegionCensusData("US", stateId, presetForEra(era)) as Layer1Config | null) ??
    stateCensusData[stateId] ??
    null;
  if (!config || !("race" in config)) return null;
  return config;
}

/**
 * The fully-resolved US substrate at one anchor era: era positions with the
 * state's regional character and checkpoint de-duplication applied, then the
 * census bundle's own position overrides layered on top (the same order
 * `resolveGranularPositions` uses).
 */
export function resolveUsSubstrateAtAnchor(
  era: EraId,
  stateId: string,
  opts: EraPositionYearOptions = {}
): UsLayer1Substrate | null {
  const config = usConfigAtAnchor(era, stateId);
  if (!config) return null;

  const positions = resolveEraPositionsAtAnchor(era, stateId, opts);
  if (config.positions) {
    for (const dim of Object.keys(config.positions)) {
      const overrides = config.positions[dim];
      if (!overrides) continue;
      const target = positions[dim as keyof PositionTable];
      if (!target) continue;
      for (const [key, pos] of Object.entries(overrides)) {
        target[key] = { economicLean: pos.economicLean, socialLean: pos.socialLean };
      }
    }
  }
  return { config, positions };
}

/**
 * The US Layer-1 substrate for `stateId` at the live `year`.
 *
 * At an anchor year this is the anchor's own substrate, untouched — so a world
 * seeded at an anchor is a no-op on day one and every per-era calibration test
 * stays green. Between anchors the marginals blend (and renormalise) and the
 * resolved position tables blend.
 */
export function getUsSubstrateForYear(
  stateId: string,
  year: number,
  opts: EraPositionYearOptions = {}
): UsLayer1Substrate | null {
  const { lo, hi, t } = resolveEraBlend(year);
  const atLo = resolveUsSubstrateAtAnchor(lo, stateId, opts);
  if (t === 0 || lo === hi) return atLo;
  const atHi = resolveUsSubstrateAtAnchor(hi, stateId, opts);
  if (!atLo || !atHi) return atLo ?? atHi;

  const config = { ...atLo.config } as Layer1Config;
  for (const dim of CONFIG_DIMS) {
    const loDim = atLo.config[dim] as Record<string, number> | undefined;
    const hiDim = atHi.config[dim] as Record<string, number> | undefined;
    if (!loDim && !hiDim) continue;
    (config as unknown as Record<string, Record<string, number>>)[dim] = renormalizeMarginals(
      unionLerpNumbers(loDim, hiDim, t)
    );
  }
  // `positions` on the blended config would be stale (its overrides are already
  // folded into the resolved tables below); drop it so nothing re-applies them.
  delete config.positions;

  const positions = {} as PositionTable;
  for (const dim of new Set([...Object.keys(atLo.positions), ...Object.keys(atHi.positions)])) {
    positions[dim as keyof PositionTable] = unionLerpPositions(
      atLo.positions[dim as keyof PositionTable],
      atHi.positions[dim as keyof PositionTable],
      t
    );
  }
  return { config, positions };
}

/**
 * National Layer-1 turnout RATES for `stateId` at the live `year`.
 *
 * Blends the era anchors, then subtracts whatever the checkpoints have already
 * delivered onto turnout for this state — the Voting Rights Act's +40pp on
 * `race:black` in MS/AL and +20pp in LA/GA/SC/VA. The authored era tables and
 * the checkpoint both describe that enfranchisement, so without the
 * subtraction the covered states would be enfranchised twice. Same reasoning,
 * and the same gate, as the position tables; see `checkpointBakedShifts.ts`.
 *
 * Rates are clamped to stay a valid percentage: cell turnout is a geometric
 * mean downstream, which is undefined for a non-positive rate.
 */
export function getUsTurnoutRatesForYear(
  stateId: string,
  year: number,
  opts: EraPositionYearOptions = {}
): DemographicTurnoutRates {
  const { lo, hi, t } = resolveEraBlend(year);
  const loRates = ERA_TURNOUT_RATES[lo];
  const blended = (
    t === 0 || lo === hi ? loRates : lerpNumericTree(loRates, ERA_TURNOUT_RATES[hi], t)
  ) as DemographicTurnoutRates;

  const baked = bakedCheckpointBucketShifts(stateId, "turnout", year, opts.startingYear);
  const out = {} as Record<string, Record<string, number>>;
  for (const [dim, buckets] of Object.entries(
    blended as unknown as Record<string, Record<string, number>>
  )) {
    const d: Record<string, number> = {};
    for (const [key, rate] of Object.entries(buckets)) {
      const delta = baked[`${dim}:${key}`] ?? 0;
      d[key] = Math.max(1, Math.min(99, rate - delta));
    }
    out[dim] = d;
  }
  return out as unknown as DemographicTurnoutRates;
}

// ─── Everyone else ──────────────────────────────────────────────────────────

function countrySubstrateAtAnchor(
  countryId: string,
  stateId: string,
  era: EraId
): CountryLayer1Substrate | null {
  const model = getCountryLayer1Model(countryId, era);
  const census = model?.census[stateId];
  if (!model || !census) return null;
  return {
    dims: [...model.dims],
    marginals: census,
    positions: model.positions,
    turnoutRates: model.turnoutRates,
  };
}

/**
 * The international Layer-1 substrate for one region at the live `year`.
 *
 * Returns null when the country has no model or the region has no census at
 * EITHER anchor. When a region exists at only one anchor — reunification
 * Germany's eastern Länder are the worked example — that anchor's substrate is
 * used whole rather than blended, and the fallback is recorded.
 */
export function getCountrySubstrateForYear(
  countryId: string,
  stateId: string,
  year: number
): CountryLayer1Substrate | null {
  const { lo, hi, t } = resolveEraBlend(year);
  const atLo = countrySubstrateAtAnchor(countryId, stateId, lo);
  if (t === 0 || lo === hi) return atLo;
  const atHi = countrySubstrateAtAnchor(countryId, stateId, hi);

  if (!atLo || !atHi) {
    const present = atLo ?? atHi;
    if (present) {
      recordEraInterpolationFallback(
        `layer1:${countryId}/${stateId}`,
        `region authored at only one of ${lo}/${hi} (@${year}) — holding the authored anchor`
      );
    }
    return present;
  }

  const dims = atLo.dims.filter((d) => atHi.dims.includes(d));
  if (dims.length !== atLo.dims.length || dims.length !== atHi.dims.length) {
    recordEraInterpolationFallback(
      `layer1:${countryId}/${stateId}`,
      `dimension set differs ${lo}(${atLo.dims.join(",")}) vs ${hi}(${atHi.dims.join(",")}) @${year} — using the intersection`
    );
  }
  if (dims.length === 0) return atLo;

  const marginals: Record<string, Record<string, number>> = {};
  const positions: Record<string, Record<string, DemographicPosition>> = {};
  const turnoutRates: Record<string, Record<string, number>> = {};
  for (const dim of dims) {
    marginals[dim] = renormalizeMarginals(
      unionLerpNumbers(atLo.marginals[dim], atHi.marginals[dim], t)
    );
    positions[dim] = unionLerpPositions(atLo.positions[dim], atHi.positions[dim], t);
    turnoutRates[dim] = unionLerpNumbers(atLo.turnoutRates[dim], atHi.turnoutRates[dim], t);
  }
  return { dims, marginals, positions, turnoutRates };
}
