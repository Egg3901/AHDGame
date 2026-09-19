import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import type { DemographicPosition } from "@/lib/seeds/demographicCategories";

/** The four partition dimensions that define the US granular cell model. */
export const GRANULAR_DIMENSIONS = ["race", "age", "education", "wealth"] as const;
export type GranularDim = (typeof GRANULAR_DIMENSIONS)[number];

/** Numeric fields shared by every cell shape. */
export interface BaseGranularCell {
  id: string;
  share: number;
  economicLean: number;
  socialLean: number;
  turnout: number;
}

/** A single cross-product cell from an arbitrary set of dimensions. */
export interface GenericGranularCell extends BaseGranularCell {
  buckets: Record<string, string>;
}

/** A single cross-product cell of the US Layer-1 electorate. */
export interface GranularCell extends BaseGranularCell {
  race: string;
  age: string;
  education: string;
  wealth: string;
}

/** Input description for one partition dimension in the generic model. */
export interface GenericGranularDimInput {
  name: string;
  marginals: Record<string, number>;
  positions?: Record<string, { economicLean: number; socialLean: number }>;
  turnoutRates?: Record<string, number>;
}

/** Options for {@link deriveGranularCells} and {@link deriveGranularCellsGeneric}. */
export type DeriveGranularCellsOpts = {
  /** Cells with a share below this threshold are dropped and the remainder
   *  renormalized. Default = 0.001 (0.1% of the electorate). */
  pruneFloor?: number;
  /** Number of IPF rake passes. Default = 3. */
  rakePasses?: number;
  /** Optional override of the association-prior table. Used by tests to compare
   *  against the pure-independence baseline without mutating the global table. */
  priors?: Record<string, number>;
};

/** Pairwise association priors that nudge the joint distribution away from pure
 *  independence. Stored with dimensions sorted alphabetically so order of lookup
 *  does not matter. Values are multipliers centered at 1.0 (no association). */
export const COUNTRY_PRIORS: Record<string, Record<string, number>> = {
  US: {
    // Education x wealth: income tracks education tightly.
    "education:no_college|wealth:low": 1.25, // no-college voters more likely to be low income
    "education:no_college|wealth:high": 0.6, // no-college voters rarely high income
    "education:college|wealth:middle": 1.15, // college graduates cluster in middle income
    "education:graduate|wealth:high": 1.5, // graduate degrees strongly predict high income

    // Race x education (strongest): educational attainment correlates strongly with race.
    "race:white|education:graduate": 1.45, // white voters more likely to hold graduate degrees
    "race:white|education:no_college": 0.85, // white voters modestly under-index no-college
    "race:black|education:no_college": 1.35, // Black voters over-index in no-college attainment
    "race:hispanic|education:no_college": 1.3, // Hispanic voters over-index in no-college attainment
    "race:asian|education:graduate": 1.35, // Asian voters over-index in graduate attainment

    // Race x wealth: wealth gaps persist across racial groups.
    "race:white|wealth:high": 1.2, // white households over-index in high wealth
    "race:black|wealth:low": 1.35, // Black households over-index in low wealth
    "race:hispanic|wealth:low": 1.3, // Hispanic households over-index in low wealth
    "race:asian|wealth:high": 1.25, // Asian households over-index in high wealth

    // Age x wealth: earnings and wealth accumulate with age.
    "age:young|wealth:low": 1.2, // young voters more likely to be low income
    "age:senior|wealth:high": 1.25, // senior households accumulated more wealth
  },
};

/** Backward-compatible alias for the US association table. */
export const ASSOCIATION_PRIORS = COUNTRY_PRIORS["US"];

/** Normalize a pair of dimension keys so prior lookup is order-independent. */
function priorKey(aDim: string, aKey: string, bDim: string, bKey: string): string {
  const left = `${aDim}:${aKey}`;
  const right = `${bDim}:${bKey}`;
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

/** Product of all applicable pairwise association priors for a generic cell. */
function cellPriorGeneric(buckets: Record<string, string>, priors: Record<string, number>): number {
  const dimNames = Object.keys(buckets);
  let p = 1;
  for (let i = 0; i < dimNames.length; i++) {
    const dimA = dimNames[i];
    const keyA = buckets[dimA];
    for (let j = i + 1; j < dimNames.length; j++) {
      const dimB = dimNames[j];
      const keyB = buckets[dimB];
      p *= priors[priorKey(dimA, keyA, dimB, keyB)] ?? 1;
    }
  }
  return p;
}

/** Clamp a lean value to the game range [-5, 5] and round to one decimal. */
function clampLean(v: number): number {
  // + 0 normalizes -0 (Math.round of a small negative) so serialized
  // fixtures and strict equality never see a signed zero.
  return Math.max(-5, Math.min(5, Math.round(v * 10) / 10)) + 0;
}

/** Clamp a turnout percentage to the valid cell range [15, 95]. */
function clampTurnout(v: number): number {
  return Math.max(15, Math.min(95, Math.round(v * 10) / 10));
}

/** Geometric mean of an arbitrary list of turnout rates. */
function geoMeanTurnout(rates: number[]): number {
  if (rates.length === 0) return 55;
  const product = rates.reduce((s, r) => s * r, 1);
  return Math.pow(product, 1 / rates.length);
}

/** Iterative proportional fitting: adjust cell shares so each dimension's
 *  marginal sums match the input marginals. */
function rakeCellsGeneric(
  cells: GenericGranularCell[],
  targets: Record<string, Record<string, number>>,
  dimNames: string[],
  passes: number
): void {
  for (let pass = 0; pass < passes; pass++) {
    for (const dim of dimNames) {
      for (const key of Object.keys(targets[dim])) {
        const target = targets[dim][key];
        const current = cells.reduce((s, c) => (c.buckets[dim] === key ? s + c.share : s), 0);
        if (current > 0) {
          const factor = target / current;
          for (const c of cells) {
            if (c.buckets[dim] === key) c.share *= factor;
          }
        }
      }
    }
  }
}

/** Recursively build every combination of bucket keys across dimensions. */
function buildCombinations(dimNames: string[], buckets: Record<string, string[]>): string[][] {
  if (dimNames.length === 0) return [[]];
  const [first, ...rest] = dimNames;
  const restCombos = buildCombinations(rest, buckets);
  const combos: string[][] = [];
  for (const key of buckets[first]) {
    for (const combo of restCombos) {
      combos.push([key, ...combo]);
    }
  }
  return combos;
}

/** Derive a full set of granular electorate cells from arbitrary Layer-1 census marginals.
 *
 *  Share derivation:
 *    1. Start with the independence product of every dimension's marginal shares.
 *    2. Multiply by the product of applicable pairwise priors.
 *    3. Normalize to sum to 1.
 *    4. Run IPF rake passes so each dimension's marginal totals match the inputs.
 *    5. Drop cells below pruneFloor and renormalize.
 *
 *  Lean derivation:
 *    For each cell, average the economic/social positions of every bucket that has
 *    an entry in its dimension's positions table. Dimensions without positions, or
 *    buckets missing from a positions table, contribute nothing. If no positions
 *    are available for a cell, both leans default to 0. Result is clamped to [-5, 5].
 *
 *  Turnout derivation:
 *    For each cell, take the geometric mean of the turnout rates for every dimension
 *    that provides turnoutRates. Missing rates within a provided table fall back to 55.
 *    If no dimension provides turnout rates, the cell defaults to 55. The cell-level
 *    rates are then scaled so the population-weighted mean equals the average of each
 *    dimension's marginal-weighted mean turnout. Result is clamped to [15, 95].
 */
export function deriveGranularCellsGeneric(input: {
  dims: GenericGranularDimInput[];
  priors?: Record<string, number>;
  opts?: DeriveGranularCellsOpts;
}): GenericGranularCell[] {
  const { dims } = input;
  if (dims.length === 0) return [];

  const priors = input.priors ?? {};
  const pruneFloor = input.opts?.pruneFloor ?? 0.001;
  const rakePasses = input.opts?.rakePasses ?? 3;

  const dimNames = dims.map((d) => d.name);

  // Convert percentage marginals to proportions that sum to 1 per dimension.
  const targets: Record<string, Record<string, number>> = {};
  const buckets: Record<string, string[]> = {};
  for (const dim of dims) {
    const src = dim.marginals;
    const tgt: Record<string, number> = {};
    for (const [key, pct] of Object.entries(src)) {
      tgt[key] = pct / 100;
    }
    targets[dim.name] = tgt;
    buckets[dim.name] = Object.keys(tgt);
  }

  // Build raw cells from the independence product × priors.
  const combos = buildCombinations(dimNames, buckets);
  const cells: GenericGranularCell[] = [];
  for (const combo of combos) {
    const cellBuckets: Record<string, string> = {};
    let raw = 1;
    for (let i = 0; i < dimNames.length; i++) {
      const dimName = dimNames[i];
      const key = combo[i];
      cellBuckets[dimName] = key;
      raw *= targets[dimName][key];
    }
    raw *= cellPriorGeneric(cellBuckets, priors);
    cells.push({
      id: combo.join("|"),
      buckets: cellBuckets,
      share: raw,
      economicLean: 0,
      socialLean: 0,
      turnout: 0,
    });
  }

  // Normalize and rake.
  const totalRaw = cells.reduce((s, c) => s + c.share, 0);
  if (totalRaw > 0) {
    for (const c of cells) c.share /= totalRaw;
  }
  rakeCellsGeneric(cells, targets, dimNames, rakePasses);

  // Prune and renormalize.
  const kept = cells.filter((c) => c.share >= pruneFloor);
  const keptTotal = kept.reduce((s, c) => s + c.share, 0);
  if (keptTotal > 0) {
    for (const c of kept) c.share /= keptTotal;
  }

  // Dimensions that participate in lean/turnout calculations.
  const dimsWithPositions = dims.filter((d) => d.positions);
  const dimsWithTurnout = dims.filter((d) => d.turnoutRates);

  // Compute leans for remaining cells.
  for (const c of kept) {
    const bucketPositions: { economicLean: number; socialLean: number }[] = [];
    for (const dim of dimsWithPositions) {
      const pos = dim.positions![c.buckets[dim.name]];
      if (pos) bucketPositions.push(pos);
    }

    if (bucketPositions.length === 0) {
      c.economicLean = 0;
      c.socialLean = 0;
    } else {
      const eSum = bucketPositions.reduce((s, p) => s + p.economicLean, 0);
      const sSum = bucketPositions.reduce((s, p) => s + p.socialLean, 0);
      c.economicLean = clampLean(eSum / bucketPositions.length);
      c.socialLean = clampLean(sSum / bucketPositions.length);
    }
  }

  // Marginal-weighted baseline turnout: average across dims that have rates.
  const baseline =
    dimsWithTurnout.length > 0
      ? dimsWithTurnout.reduce((sum, dim) => {
          const rates = dim.turnoutRates!;
          const weighted = Object.entries(targets[dim.name]).reduce(
            (s, [key, share]) => s + share * (rates[key] ?? 55),
            0
          );
          return sum + weighted;
        }, 0) / dimsWithTurnout.length
      : 55;

  // Compute raw cell turnout via geometric mean.
  for (const c of kept) {
    const rates = dimsWithTurnout.map((dim) => dim.turnoutRates![c.buckets[dim.name]] ?? 55);
    c.turnout = geoMeanTurnout(rates);
  }

  // Normalize turnout so population-weighted mean equals the marginal-weighted baseline.
  const currentWeighted = kept.reduce((s, c) => s + c.share * c.turnout, 0);
  if (currentWeighted > 0) {
    const factor = baseline / currentWeighted;
    for (const c of kept) {
      c.turnout = clampTurnout(c.turnout * factor);
    }
  } else {
    for (const c of kept) {
      c.turnout = clampTurnout(c.turnout);
    }
  }

  return kept.sort((a, b) => b.share - a.share);
}

/** Derive the full set of US granular electorate cells from Layer-1 census marginals.
 *
 *  This is a thin wrapper around {@link deriveGranularCellsGeneric} that preserves
 *  the original four-dimension shape used by the poll payload and UI.
 */
export function deriveGranularCells(
  config: Layer1Config,
  positions: Record<GranularDim, Record<string, DemographicPosition>>,
  turnoutRates: Record<GranularDim, Record<string, number>>,
  opts: DeriveGranularCellsOpts = {}
): GranularCell[] {
  const dims: GenericGranularDimInput[] = GRANULAR_DIMENSIONS.map((name) => ({
    name,
    marginals: config[name] as Record<string, number>,
    positions: positions[name],
    turnoutRates: turnoutRates[name],
  }));

  const generic = deriveGranularCellsGeneric({
    dims,
    priors: opts.priors ?? COUNTRY_PRIORS["US"],
    opts,
  });

  return generic.map((cell) => ({
    id: cell.id,
    race: cell.buckets.race,
    age: cell.buckets.age,
    education: cell.buckets.education,
    wealth: cell.buckets.wealth,
    share: cell.share,
    economicLean: cell.economicLean,
    socialLean: cell.socialLean,
    turnout: cell.turnout,
  }));
}

/** Aggregate a subset of cells by share-weighted averages. */
export function aggregateCells<T extends BaseGranularCell>(
  cells: T[],
  predicate: (cell: T) => boolean
): { share: number; economicLean: number; socialLean: number; turnout: number } {
  const subset = cells.filter(predicate);
  const share = subset.reduce((s, c) => s + c.share, 0);
  if (share <= 0) {
    return { share: 0, economicLean: 0, socialLean: 0, turnout: 0 };
  }
  const economicLean = subset.reduce((s, c) => s + c.share * c.economicLean, 0) / share;
  const socialLean = subset.reduce((s, c) => s + c.share * c.socialLean, 0) / share;
  const turnout = subset.reduce((s, c) => s + c.share * c.turnout, 0) / share;
  return { share, economicLean, socialLean, turnout };
}
