import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { orgBuildSizeMultiplier } from "./buildOrgFunding";

/**
 * Resolves Build Org's per-state price multiplier from live population.
 *
 * Separate from `buildOrgFunding` so that module stays pure and importable by
 * client components; everything needing a database lives here.
 *
 * The multiplier is `sqrt(state population) / countryMeanOfSqrtPopulation`,
 * clamped — see `ORG_BUILD_SIZE_MULTIPLIER_MIN`/`_MAX` for why the curve is a
 * square root and why it is normalized to average 1.
 *
 * ## Why the normalizer is cached
 *
 * It is a mean over every region in the country, so computing it per click would
 * add a collection scan to an action a busy party fires thousands of times a
 * week. Populations move slowly (demographics drift over turns, and a region set
 * only changes on secession or reunification), so a stale normalizer shifts a
 * price by a fraction of a percent — far cheaper than the scan. The per-state
 * population is still read fresh on every call; only the country aggregate is
 * cached.
 */

interface CachedNormalizer {
  /** Country mean of `sqrt(population)`, or `null` when it cannot be formed. */
  value: number | null;
  expiresAt: number;
}

const NORMALIZER_TTL_MS = 10 * 60 * 1000;

const cache = new Map<CountryId, CachedNormalizer>();

/** Drop cached country normalizers. Exposed for tests and admin reseeds. */
export function clearOrgBuildSizeCache(): void {
  cache.clear();
}

async function countryNormalizer(db: Db, countryId: CountryId): Promise<number | null> {
  const hit = cache.get(countryId);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value;

  const rows = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { population: 1 } })
    .toArray();

  const roots = rows
    .map((r) => r.population ?? 0)
    .filter((p) => Number.isFinite(p) && p > 0)
    .map((p) => Math.sqrt(p));

  // A single region has nothing to be large or small relative to, so it prices
  // neutrally rather than always landing on exactly 1 by construction.
  const value = roots.length > 1 ? roots.reduce((sum, r) => sum + r, 0) / roots.length : null;

  cache.set(countryId, { value, expiresAt: now + NORMALIZER_TTL_MS });
  return value;
}

/**
 * Price multiplier for organizing `stateId`. Returns a neutral `1` whenever the
 * data cannot support a ratio, so a world with no demographics seeded prices
 * exactly as it did before per-state scaling existed.
 */
export async function resolveOrgBuildSizeMultiplier(
  db: Db,
  countryId: CountryId,
  stateId: string
): Promise<number> {
  const normalizer = await countryNormalizer(db, countryId);
  if (normalizer === null) return 1;

  const state = await db
    .collection<State>("states")
    .findOne({ _id: stateId, countryId }, { projection: { population: 1 } });
  if (!state) return 1;

  return orgBuildSizeMultiplier(state.population, normalizer);
}
