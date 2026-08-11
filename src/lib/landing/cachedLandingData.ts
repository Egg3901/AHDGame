import { getDb } from "@/lib/mongodb";
import { getEnabledCountryIdsFromDb } from "@/lib/countryAccess";
import type { GovernmentType } from "@/lib/constants/countries";
import type { GameState, GameConfig } from "@/lib/db/types";
import type { CountryState } from "@/lib/db/types/countryState";
import { listCrises } from "@/lib/crises/queries/crisisQueries";
import { buildGovernmentTypeMap } from "@/lib/landing/governmentTypeMap";

/** Crisis fields the marketing landing consumes (serializable). */
export type LandingCrisisSnapshot = {
  _id: string;
  name: string;
  description: string;
  heroImage?: string;
  scope: "global" | "country" | "region";
  countryIds: string[];
};

export type LandingDataSnapshot = {
  seedYear: number;
  crises: LandingCrisisSnapshot[];
  playerCounts: Record<string, number>;
  governmentTypes: Record<string, GovernmentType>;
};

/** 60s is enough to collapse anonymous stampedes; still fresh for repeat visitors. */
const LANDING_DATA_TTL_MS = 60_000;

let cached: { data: LandingDataSnapshot; expiresAt: number } | null = null;
let inflight: Promise<LandingDataSnapshot> | null = null;

/** Test / admin seam: drop the in-process landing snapshot. */
export function invalidateLandingDataCache(): void {
  cached = null;
}

async function loadLandingData(): Promise<LandingDataSnapshot> {
  const db = await getDb();
  const [config, gs, crisisList, enabledIds, countRows, countryStateDocs] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { seedYear: 1 } }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { startingYear: 1 } }),
    listCrises(db, null, "active"),
    getEnabledCountryIdsFromDb(db),
    db
      .collection("characters")
      .aggregate<{ _id: string | null; count: number }>([
        { $match: { retiredAt: { $exists: false } } },
        { $group: { _id: "$countryId", count: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection<CountryState>("countryState")
      .find({}, { projection: { _id: 1, governmentType: 1 } })
      .toArray(),
  ]);

  const seedYear = config?.seedYear ?? gs?.startingYear ?? 1979;

  // Live player counts per playable country. Default every enabled country to 0
  // so a freshly-reset world still renders a marker that reads "0 playing".
  const playerCounts: Record<string, number> = {};
  for (const id of enabledIds) playerCounts[id] = 0;
  for (const row of countRows) {
    if (row._id && row._id in playerCounts) playerCounts[row._id] = row.count;
  }

  const governmentTypes = buildGovernmentTypeMap(countryStateDocs);
  const crises = crisisList.crises.map((c) => ({
    _id: String(c._id),
    name: c.name,
    description: c.description,
    heroImage: c.heroImage,
    scope: c.scope,
    countryIds: c.countryIds,
  }));

  return { seedYear, crises, playerCounts, governmentTypes };
}

/**
 * Process-local, short-TTL cache for anonymous landing Mongo reads.
 *
 * The page stays `force-dynamic` so `getAuthUser()` can still redirect signed-in
 * visitors, but concurrent anonymous hits share one snapshot for ~60s (including
 * the characters `$group` aggregation) instead of each paying a fresh round-trip.
 * In-flight requests coalesce on a single promise to avoid thundering herds at
 * TTL expiry.
 */
export async function getCachedLandingData(): Promise<LandingDataSnapshot> {
  const now = Date.now();
  if (cached && now < cached.expiresAt) {
    return cached.data;
  }

  if (inflight) return inflight;

  inflight = loadLandingData()
    .then((data) => {
      cached = { data, expiresAt: Date.now() + LANDING_DATA_TTL_MS };
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
