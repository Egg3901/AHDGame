/**
 * `ERA_COMPOSITION` resolved at a live year.
 *
 * WHY THIS NEEDED ITS OWN MODULE
 * ------------------------------
 * Every other era table is a tree of numbers and lerps directly. A composition
 * is not: each voter group's recipe is an ARRAY of `{dim, key, w}` weights, and
 * the array's shape changes between anchors — `college_liberals` gains a
 * bucket between 1953 and 1979, `evangelicals` between 1991 and 1999,
 * `union_trades` between 2019 and 2023. A structural lerp throws on all three,
 * which is why this table was the one piece of the era system that could not
 * simply be interpolated.
 *
 * THE FIX: CANONICALISE FIRST, THEN LERP
 * --------------------------------------
 * Weight vectors are widened to the UNION of every `{dim, key}` any era uses
 * for that group, with absent entries padded at `w: 0` and the whole vector
 * sorted deterministically. Padding is a true no-op — weights are normalised at
 * use time, so a zero-weight entry contributes nothing — which means a
 * canonicalised anchor derives exactly what the authored anchor derives. Once
 * every anchor has the same shape, the ordinary numeric lerp applies, and a
 * bucket entering a group's recipe fades in from zero rather than appearing
 * abruptly at an era boundary.
 *
 * The alternative considered and rejected was interpolating derived values and
 * keeping recipes discrete. It is less code, but it puts a step change in the
 * middle of the timeline: a world crossing 1979 would see `college_liberals`
 * jump. Fading a weight in from zero is both smoother and closer to what the
 * authored data means.
 *
 * SCOPE
 * -----
 * Compositions are read by SEED-TIME and tooling paths
 * (`stateDemographics.ts`, `stateDemographicsPure.ts`, `positionEditor`,
 * `seedDiagnostic`) — the granular vote path derives cells from census
 * marginals and positions and never reads this table. So this resolver exists
 * for reseeds and heals of a world that has drifted from its seed era, and for
 * the archetype work in the last phase of the program; it is deliberately not
 * on the per-turn hot path.
 */
import type { EraId } from "./presetSelector";
import {
  ERA_COMPOSITIONS,
  type EraComposition,
  type VoterGroupCompositionEntry,
} from "./demographicCategories";
import { ERA_IDS_ASC, lerpNumericTree, resolveEraBlend } from "./eraInterpolation";

/** Stable ordering for a canonicalised weight vector. */
function weightKey(w: { dim: string; key: string }): string {
  return `${w.dim}:${w.key}`;
}

/**
 * Every `{dim, key}` any era uses for each group, so a group's recipe can be
 * widened to a single shape. Computed once at module load — the table is
 * static.
 */
const UNION_WEIGHT_KEYS: Record<string, Array<{ dim: string; key: string }>> = (() => {
  const byGroup = new Map<string, Map<string, { dim: string; key: string }>>();
  for (const era of ERA_IDS_ASC) {
    const comp = ERA_COMPOSITIONS[era];
    if (!comp) continue;
    for (const [groupId, entry] of Object.entries(comp.voterGroupComposition)) {
      let keys = byGroup.get(groupId);
      if (!keys) {
        keys = new Map();
        byGroup.set(groupId, keys);
      }
      for (const w of entry.weights) keys.set(weightKey(w), { dim: w.dim, key: w.key });
    }
  }
  const out: Record<string, Array<{ dim: string; key: string }>> = {};
  for (const [groupId, keys] of byGroup) {
    out[groupId] = [...keys.values()].sort((a, b) => weightKey(a).localeCompare(weightKey(b)));
  }
  return out;
})();

/**
 * Widen one group's recipe to the canonical shape, padding absent buckets at
 * `w: 0`. Value-preserving: weights are normalised at use time, so the padded
 * entries change nothing about what the recipe derives.
 */
function canonicalizeEntry(
  groupId: string,
  entry: VoterGroupCompositionEntry
): VoterGroupCompositionEntry {
  // `civicMultiplier` is optional and authored on only some groups/eras, so it
  // is an extra key on one side of a blend. Every consumer reads it as
  // `civicMultiplier ?? 1`, so materialising the default is value-preserving
  // and makes the shape uniform.
  const civicMultiplier = entry.civicMultiplier ?? 1;
  const union = UNION_WEIGHT_KEYS[groupId];
  if (!union) return { ...entry, civicMultiplier, weights: [...entry.weights] };
  const authored = new Map(entry.weights.map((w) => [weightKey(w), w.w]));
  return {
    ...entry,
    civicMultiplier,
    weights: union.map(({ dim, key }) => ({
      dim: dim as VoterGroupCompositionEntry["weights"][number]["dim"],
      key,
      w: authored.get(`${dim}:${key}`) ?? 0,
    })),
  };
}

/** A whole composition widened to the canonical weight shape. */
export function canonicalizeComposition(comp: EraComposition): EraComposition {
  const voterGroupComposition: Record<string, VoterGroupCompositionEntry> = {};
  for (const [groupId, entry] of Object.entries(comp.voterGroupComposition)) {
    voterGroupComposition[groupId] = canonicalizeEntry(groupId, entry);
  }
  return { ...comp, voterGroupComposition };
}

const CANONICAL_BY_ERA: Partial<Record<EraId, EraComposition>> = {};
function canonicalAt(era: EraId): EraComposition | null {
  const authored = ERA_COMPOSITIONS[era];
  if (!authored) return null;
  const cached = CANONICAL_BY_ERA[era];
  if (cached) return cached;
  const built = canonicalizeComposition(authored);
  CANONICAL_BY_ERA[era] = built;
  return built;
}

/**
 * The composition at `year`, blended between the bracketing anchors.
 *
 * At an anchor this is that anchor's canonicalised composition, which derives
 * exactly what the authored one does. Groups present at only one anchor — a
 * genuine identity change rather than a shape mismatch — are taken from the
 * anchor that has them rather than dropped.
 */
export function getEraCompositionForYear(year: number): EraComposition {
  const available = ERA_IDS_ASC.filter((e) => ERA_COMPOSITIONS[e] != null);
  const { lo, hi, t } = resolveEraBlend(year, available);
  const atLo = canonicalAt(lo);
  if (!atLo) throw new Error(`getEraCompositionForYear: no composition for era ${lo}`);
  if (t === 0 || lo === hi) return atLo;
  const atHi = canonicalAt(hi);
  if (!atHi) return atLo;

  const groupIds = [...new Set([...atLo.groupIds, ...atHi.groupIds])];
  const voterGroupComposition: Record<string, VoterGroupCompositionEntry> = {};
  for (const groupId of new Set([
    ...Object.keys(atLo.voterGroupComposition),
    ...Object.keys(atHi.voterGroupComposition),
  ])) {
    const a = atLo.voterGroupComposition[groupId];
    const b = atHi.voterGroupComposition[groupId];
    if (!a || !b) {
      voterGroupComposition[groupId] = a ?? b;
      continue;
    }
    voterGroupComposition[groupId] = lerpNumericTree(a, b, t);
  }

  const blendRecord = <T>(a: Record<string, T>, b: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[key];
      const y = b[key];
      out[key] = x === undefined ? y : y === undefined ? x : lerpNumericTree(x, y, t);
    }
    return out;
  };

  return {
    groupIds,
    voterGroupComposition,
    turnoutRates: lerpNumericTree(atLo.turnoutRates, atHi.turnoutRates, t),
    defaultLeans: blendRecord(atLo.defaultLeans, atHi.defaultLeans),
    defaultTurnouts: blendRecord(atLo.defaultTurnouts, atHi.defaultTurnouts),
  };
}
