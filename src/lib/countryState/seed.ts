import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, getCountryConfig } from "@/lib/constants/countries";
import type { CountryState } from "@/lib/db/types/countryState";
import { getCountryStateCollection } from "@/lib/db/collections/countryState";
import { getGameStatePreset } from "@/lib/db/collections/gameState";

/**
 * Build a fresh CountryState document for a country from its compile-time
 * config. Used by the migration script and by new-game country init.
 *
 * Pure function — no DB access. Caller is responsible for inserting.
 * Pass `preset` so era-conditional government types seed correctly
 * (e.g. France 1953-default → parliamentaryRepublic via
 * {@link getCountryConfig}).
 */
export function seedCountryStateFromConfig(
  countryId: CountryId,
  at: Date,
  preset?: string
): CountryState {
  const cfg = getCountryConfig(countryId, preset);
  if (!COUNTRY_CONFIGS[countryId]) {
    throw new Error(`seedCountryStateFromConfig: unknown countryId "${countryId}"`);
  }

  return {
    _id: countryId,
    countryId,
    governmentType: cfg.governmentType,
    rulingPartyId: cfg.rulingPartyId ?? null,
    opsVoteMultipliers: cfg.opsVoteMultipliers ?? null,
    hasLeaderConfidenceModel: cfg.hasLeaderConfidenceModel ?? false,
    socialAxisPosition: cfg.socialAxisBaseline ?? 0,
    reformCooldowns: {},
    popularBoostModifiers: [],
    createdAt: at,
    updatedAt: at,
  };
}

export interface SeedCountryStateResult {
  created: number;
  skipped: number;
}

/**
 * Ensure every country in COUNTRY_CONFIGS has a runtime countryState
 * document. Idempotent — skips countries that already have a doc, so
 * safe to call from new-game initialization paths (runSeed,
 * resetGameWorld) without clobbering in-flight runtime state.
 *
 * When `preset` is supplied (or readable from gameState), era overlays
 * such as France's Fourth Republic governmentType are applied at insert.
 */
export async function seedAllCountryStates(
  db: Db,
  preset?: string
): Promise<SeedCountryStateResult> {
  const coll = getCountryStateCollection(db);
  const existing = await coll.find({}).toArray();
  const existingIds = new Set(existing.map((doc) => doc._id));

  let activePreset = preset;
  if (activePreset === undefined) {
    activePreset = await getGameStatePreset(db);
  }

  const now = new Date();
  let created = 0;
  let skipped = 0;

  for (const countryId of COUNTRY_ORDER) {
    if (existingIds.has(countryId)) {
      skipped++;
      continue;
    }
    await coll.insertOne(seedCountryStateFromConfig(countryId, now, activePreset));
    created++;
  }

  return { created, skipped };
}
