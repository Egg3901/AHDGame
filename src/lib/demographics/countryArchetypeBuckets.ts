import type { ArchetypeBucketWeight } from "./archetypeBucketMap";
import { COMPOSITION_WEIGHTS } from "./compositionWeights.generated";

/**
 * Per-country archetype → Layer-1 bucket weights, taken from the country's own
 * seeded model rather than hand-authored here.
 *
 * Each international seed already carries a `composition` table: the very same
 * "this archetype is 35% no_qualifications, 30% low income, …" decomposition,
 * authored in that country's OWN bucket vocabulary, with weights that sum to 1.
 * It is the authoritative answer to the question this map asks, so reading it is
 * strictly better than restating it — a hand-written second copy can drift from
 * the seed, and the one in `archetypeBucketMap.ts` did: it expressed UK, JP and
 * DE groups in the US vocabulary (`education:no_college`, `wealth:low`), which
 * the international models do not have. Only the `age` dimension collided, so
 * roughly 70-80% of every non-US archetype's weight landed on no bucket at all.
 *
 * Composition is era-stable by design — an archetype's defining demographics do
 * not move between eras, only its political position does (those live in the
 * per-era POSITIONS tables) — so a single table serves every era.
 *
 * The weights are read from `compositionWeights.generated.ts` rather than from
 * the seed directly: the seed module also carries every region's census
 * marginals (~460KB), which a client component projecting a bill's effects
 * cannot pull into the browser. The generated file is derived FROM the seed and
 * a test fails if the two ever disagree, so this is still one source of truth.
 */

/**
 * Archetype→bucket weights for a country, or null when it has no Layer-1 model
 * (callers fall back to the US table).
 */
export function getCountryArchetypeBuckets(
  countryId: string
): Record<string, ArchetypeBucketWeight[]> | null {
  return COMPOSITION_WEIGHTS[countryId.toUpperCase()] ?? null;
}

/**
 * Retained as a no-op seam. The table is a static import now, so there is
 * nothing to invalidate; tests that cleared a cache keep working.
 */
export function clearCountryArchetypeBucketCache(): void {}
