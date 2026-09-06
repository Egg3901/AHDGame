/**
 * Server half of the public-copy source of truth: resolve the marketed world
 * from the RUNNING game rather than from authored config.
 *
 * Split from `marketedWorld.ts` for the usual reason — that module is imported
 * by the landing client bundle for its formatters, and this one pulls in the
 * Mongo driver.
 */
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { getEnabledCountryIdsFromDb } from "@/lib/countryAccess";
import type { GameConfig, GameState } from "@/lib/db/types";
import {
  DEFAULT_SEED_YEAR,
  GAME_VERSION,
  REGISTERED_COUNTRY_COUNT,
  eraRoster,
  fallbackMarketedWorld,
  toEraId,
  toNations,
  type MarketedWorld,
} from "./marketedWorld";

/**
 * Five minutes. The root layout asks on every request, so this must not be a
 * per-request Mongo read; a country opening is an admin action measured in
 * weeks, so five minutes of staleness costs nothing.
 */
const CACHE_TTL_MS = 300_000;

let cached: { data: MarketedWorld; expiresAt: number } | null = null;
let inflight: Promise<MarketedWorld> | null = null;

/** Test seam: drop the in-process snapshot. */
export function invalidateMarketedWorldCache(): void {
  cached = null;
}

async function loadMarketedWorld(db: Db): Promise<MarketedWorld> {
  const [config, gs] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { seedYear: 1 } }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { startingYear: 1 } }),
  ]);

  const seedYear = config?.seedYear ?? gs?.startingYear ?? DEFAULT_SEED_YEAR;
  const eraId = toEraId(seedYear);
  const presetId = `${eraId}-default`;
  const roster = eraRoster(eraId);

  // A fresh world writes `countryGameStates` lazily, so an empty result means
  // "nobody has toggled anything", not "nothing is playable". Falling back to
  // the era roster stops a marketing page rendering an empty country list.
  const enabled = await getEnabledCountryIdsFromDb(db);
  const playableIds = enabled.length > 0 ? enabled : roster.player;
  const playableSet = new Set<CountryId>(playableIds);

  return {
    version: GAME_VERSION,
    eraId,
    seedYear,
    presetId,
    // COUNTRY_ORDER, not the DB's order, so the list reads the same on every
    // surface and on every request.
    playable: toNations(
      COUNTRY_ORDER.filter((id) => playableSet.has(id)),
      presetId
    ),
    economy: toNations(
      roster.econ.filter((id) => !playableSet.has(id)),
      presetId
    ),
    registeredCountryCount: REGISTERED_COUNTRY_COUNT,
  };
}

/** What the public should be told, resolved from the running world. */
export async function getMarketedWorld(dbArg?: Db): Promise<MarketedWorld> {
  if (dbArg) return loadMarketedWorld(dbArg);

  const now = Date.now();
  if (cached && now < cached.expiresAt) return cached.data;
  if (inflight) return inflight;

  inflight = getDb()
    .then(loadMarketedWorld)
    .then((data) => {
      cached = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/**
 * Never let a marketing page or a metadata export fail because the database
 * blinked. Falls back to the authored era roster.
 */
export async function getMarketedWorldSafe(dbArg?: Db): Promise<MarketedWorld> {
  try {
    return await getMarketedWorld(dbArg);
  } catch {
    return fallbackMarketedWorld();
  }
}
