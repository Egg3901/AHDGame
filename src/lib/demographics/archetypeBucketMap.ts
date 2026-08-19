/**
 * Static archetype → Layer-1 bucket mapping for the granular-electorate engine
 * (the granular vote path).
 *
 * WHY THIS EXISTS
 * ---------------
 * Several gameplay systems author their effects against the 12 mutually-
 * exclusive US voter ARCHETYPES (character/NPP `archetypeApprovals`,
 * legislation `demographicEffects` that land on those approvals, Address-driven
 * `partyGroupFavorability` rows, GOTV/canvassing turnout modifiers on non-US
 * worlds). When the vote engine runs over granular demographic CELLS instead of
 * archetypes, those archetype-keyed values still need to influence the result.
 *
 * This table projects each archetype onto 2–3 constituent Layer-1 census
 * buckets (race / age / education / wealth — the cell dimensions), with weights
 * that sum to exactly 1.0 per archetype. An archetype-keyed value V is
 * distributed onto buckets as `V × w`, and a cell then picks up the SUM of the
 * bucket values matching its own bucket per dimension. Because each archetype's
 * weights sum to 1, a cell that matches ALL of an archetype's buckets receives
 * the full value V, partial matches receive a proportional fraction, and
 * unrelated cells receive 0 — fuzzy membership semantics.
 *
 * AUTHORING NOTES
 * ---------------
 * - Derived from (but deliberately simpler than) the seed-time
 *   `VOTER_GROUP_COMPOSITION` in `src/lib/seeds/demographicCategories.ts`:
 *   that table mixes in the `ideology` dimension, which is NOT a cell
 *   dimension (ideology scores are non-exclusive and never enter the
 *   cross-product). Ideology-dominant archetypes (evangelicals, libertarians,
 *   rural_traditionalists) are therefore approximated by their strongest
 *   census correlates.
 * - Weights are judgment calls, not census facts — they only shape how
 *   archetype-targeted effects diffuse across cells, never the cells' shares
 *   or leans (those come from the IPF-raked census marginals).
 * - This table is the US vocabulary only. Non-US archetypes project through
 *   their own country's seeded `composition` table instead — see
 *   `countryArchetypeBuckets.ts`. Do not add foreign groups here: their buckets
 *   would name dimensions the international models do not have.
 *
 * Keys use the `"dim:key"` form matching the cell `buckets` record
 * (e.g. `"age:senior"`).
 */

import { getCountryArchetypeBuckets } from "./countryArchetypeBuckets";
import { isBucketTarget } from "./turnoutTarget";

export interface ArchetypeBucketWeight {
  /** Layer-1 cell dimension ("race" | "age" | "education" | "wealth"). */
  dim: string;
  /** Bucket key within the dimension (e.g. "senior", "no_college"). */
  key: string;
  /** Fraction of the archetype's effect allocated to this bucket. */
  w: number;
}

/*
 * The hand-authored UK / JP / DE / other-country tables that used to live here
 * are gone. They expressed non-US archetypes in the US bucket vocabulary
 * (`education:no_college`, `wealth:low`), which the international Layer-1 models
 * do not have — those use `ethnicity / age / education / income / urbanization`
 * with their own keys. Only `age` collided, so roughly 70-80% of every non-US
 * archetype's weight projected onto no bucket at all.
 *
 * Each country's seed already carries the authoritative decomposition in its own
 * vocabulary (`CountryLayer1Model.composition`), so `archetypeValuesToBuckets`
 * reads that instead — see `countryArchetypeBuckets.ts`. One source, no second
 * copy to drift.
 */

/** 12 US archetypes → 2-3 Layer-1 census buckets each; weights sum to 1.0. */
export const ARCHETYPE_BUCKET_MAP: Record<string, ArchetypeBucketWeight[]> = {
  young_renters: [
    { dim: "age", key: "young", w: 0.5 },
    { dim: "wealth", key: "low", w: 0.3 },
    { dim: "education", key: "no_college", w: 0.2 },
  ],
  // Ideology-dominant; approximated by strongest census correlates.
  evangelicals: [
    { dim: "race", key: "white", w: 0.6 },
    { dim: "education", key: "no_college", w: 0.4 },
  ],
  rural_traditionalists: [
    { dim: "education", key: "no_college", w: 0.5 },
    { dim: "race", key: "white", w: 0.3 },
    { dim: "age", key: "mature", w: 0.2 },
  ],
  union_trades: [
    { dim: "education", key: "no_college", w: 0.4 },
    { dim: "wealth", key: "low", w: 0.35 },
    { dim: "race", key: "black", w: 0.25 },
  ],
  soccer_moms: [
    { dim: "age", key: "mid", w: 0.5 },
    { dim: "wealth", key: "middle", w: 0.4 },
    { dim: "race", key: "white", w: 0.1 },
  ],
  college_liberals: [
    { dim: "education", key: "college", w: 0.4 },
    { dim: "education", key: "graduate", w: 0.3 },
    { dim: "age", key: "young", w: 0.3 },
  ],
  small_business: [
    { dim: "wealth", key: "high", w: 0.5 },
    { dim: "age", key: "mature", w: 0.3 },
    { dim: "race", key: "white", w: 0.2 },
  ],
  public_sector: [
    { dim: "education", key: "college", w: 0.4 },
    { dim: "wealth", key: "middle", w: 0.4 },
    { dim: "education", key: "graduate", w: 0.2 },
  ],
  retirees: [
    { dim: "age", key: "senior", w: 0.7 },
    { dim: "age", key: "mature", w: 0.3 },
  ],
  // Ideology-dominant; census proxy skews middle-income college-educated white.
  libertarians: [
    { dim: "race", key: "white", w: 0.4 },
    { dim: "education", key: "college", w: 0.3 },
    { dim: "wealth", key: "middle", w: 0.3 },
  ],
  new_immigrants: [
    { dim: "race", key: "hispanic", w: 0.5 },
    { dim: "race", key: "asian", w: 0.3 },
    { dim: "race", key: "other", w: 0.2 },
  ],
  secular_professionals: [
    { dim: "education", key: "graduate", w: 0.5 },
    { dim: "wealth", key: "high", w: 0.3 },
    { dim: "age", key: "mid", w: 0.2 },
  ],
};

/**
 * Distribute archetype-keyed numeric values onto Layer-1 buckets.
 *
 * Returns a sparse `"dim:key" → value` record where each archetype's value is
 * split across its mapped buckets by weight and summed across archetypes.
 * Archetypes missing from the map (non-US groups) contribute nothing.
 */
/**
 * Archetype ids seen with a real value but no bucket mapping, with the total
 * magnitude that was dropped on the floor.
 *
 * `ARCHETYPE_BUCKET_MAP` covers the 12 US archetypes only. On a UK, JP or DE
 * world every archetype-keyed approval and favorability effect therefore
 * projects onto nothing and vanishes — a Governor's Address can be delivered,
 * charged and expired while moving no votes at all, with no error anywhere.
 * (The GOTV path degrades more gracefully: it preserves total magnitude via an
 * aggregate ratio, losing only per-group targeting.)
 *
 * This is the measurement half of retiring archetypes: the effects that need
 * re-authoring into Layer-1 bucket space are exactly the ones counted here, and
 * a silent drop cannot be prioritised or regression-tested.
 */
const unmappedArchetypeDrops = new Map<string, { count: number; magnitude: number }>();

/** Record of archetype values dropped for want of a bucket mapping. */
export function getUnmappedArchetypeDrops(): Array<{
  archetypeId: string;
  count: number;
  magnitude: number;
}> {
  return [...unmappedArchetypeDrops.entries()]
    .map(([archetypeId, v]) => ({ archetypeId, ...v }))
    .sort((a, b) => b.magnitude - a.magnitude);
}

/** Clear the drop record. Call per run/per turn so counts stay scoped. */
export function resetUnmappedArchetypeDrops(): void {
  unmappedArchetypeDrops.clear();
}

/**
 * Project archetype-keyed values onto Layer-1 buckets.
 *
 * `countryId` selects the bucket vocabulary. Outside the US the country's own
 * seeded `composition` table is authoritative — it decomposes each archetype in
 * that country's dimensions and keys — so passing the country is what makes the
 * projection land on real voters. Omitting it (or passing US) uses the US table,
 * which is the historical behaviour.
 */
export function archetypeValuesToBuckets(
  valuesByArchetype: Record<string, number>,
  countryId?: string
): Record<string, number> {
  const countryTable =
    countryId && countryId.toUpperCase() !== "US" ? getCountryArchetypeBuckets(countryId) : null;
  const bucketValues: Record<string, number> = {};
  for (const [archetypeId, value] of Object.entries(valuesByArchetype)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value === 0) continue;
    // A key that is ALREADY a bucket passes through at full weight rather than
    // being counted as an unmapped drop. This is what lets a caller author in
    // the bucket vocabulary without every consumer of the projection having to
    // learn a second code path: an approval, a favorability delta or a lean
    // delta keyed `"education:no_college"` reaches the cells exactly, while one
    // keyed `"union_trades"` still fans out through the table below. Same loose
    // union `DemographicEffect` and `turnoutTarget` already carry.
    if (isBucketTarget(archetypeId)) {
      bucketValues[archetypeId] = (bucketValues[archetypeId] ?? 0) + value;
      continue;
    }
    const weights =
      countryTable?.[archetypeId] ?? (countryTable ? undefined : ARCHETYPE_BUCKET_MAP[archetypeId]);
    if (!weights) {
      const prev = unmappedArchetypeDrops.get(archetypeId) ?? { count: 0, magnitude: 0 };
      unmappedArchetypeDrops.set(archetypeId, {
        count: prev.count + 1,
        magnitude: prev.magnitude + Math.abs(value),
      });
      continue;
    }
    for (const { dim, key, w } of weights) {
      const k = `${dim}:${key}`;
      bucketValues[k] = (bucketValues[k] ?? 0) + value * w;
    }
  }
  return bucketValues;
}
