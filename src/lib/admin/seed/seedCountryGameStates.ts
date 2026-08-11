import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CountryGameState } from "@/lib/db/types/gameState";
import type { CountryStatus } from "@/lib/constants/countries";
import {
  getWorldEntityPresetManifest,
  type LegacyCountryAccess,
  type WorldEntityManifestEntry,
} from "@/lib/world/worldEntityManifest";
import { assertCanOpenCountryToPlayers } from "@/lib/world/countryReadinessContract";

/**
 * Per-preset country enablement. `countryGameStates` rows are normally written
 * only by the admin panel; without this, a reset/bootstrap leaves enablement at
 * each country's CONFIG status, so era-specific countries (USSR, the bloc) never
 * turn on. This seeder writes the access tier (enabledForPlayers / economyPreview
 * / status) for the chosen preset so the era is playable straight after reset.
 *
 * Only presets with an explicit map here write rows; others are left to the
 * config-status fallback (so 2019 behaviour is unchanged). US is omitted — it
 * runs off the global GameState, not a CountryGameState row.
 *
 * Player tiers are gated by the archetype-aware readiness contract (#3722): a
 * manifest `player` legacyAccess that still has hard blockers fails loudly
 * rather than shipping an incomplete player launch.
 */
export type Tier = {
  enabledForPlayers: boolean;
  economyPreview: boolean;
  status: CountryStatus;
};

const PLAYER: Tier = { enabledForPlayers: true, economyPreview: false, status: "active" };
const ECON: Tier = { enabledForPlayers: false, economyPreview: true, status: "beta" };
const NPP: Tier = { enabledForPlayers: false, economyPreview: false, status: "coming-soon" };
const GLOBAL_GAME_STATE_COUNTRY_ID = COUNTRY_CONFIGS.US.id;

function tierFromLegacyAccess(access: LegacyCountryAccess): Tier | null {
  if (access === "player") return PLAYER;
  if (access === "economy-preview") return ECON;
  if (access === "hidden") return NPP;
  return null;
}

/**
 * The legacy countryGameStates write set represented by the new manifest.
 * US remains excluded because it is still backed by the global GameState.
 * A manifest containing only config-fallback entries (2019) intentionally
 * returns null so admin-managed rows keep winning exactly as before.
 */
function explicitCountryEntries(preset: string): WorldEntityManifestEntry[] | null {
  const entries = getWorldEntityPresetManifest(preset).entries.filter(
    (entry) =>
      entry.countryId !== undefined &&
      entry.countryId !== GLOBAL_GAME_STATE_COUNTRY_ID &&
      entry.legacyAccess !== "config-fallback"
  );
  return entries.length > 0 ? entries : null;
}

/**
 * Countries with an explicit enablement row for this preset (excludes US, which
 * runs off the global GameState). Returns null when the preset has no map
 * (e.g. 2019-default — admin-managed / config-status fallback).
 */
export function getPresetEnablementCountries(preset: string): CountryId[] | null {
  const entries = explicitCountryEntries(preset);
  return entries?.map((entry) => entry.countryId!) ?? null;
}

/** Per-country access tier for a preset, or null when the preset has no map. */
export function getPresetEnablementTier(preset: string, countryId: CountryId): Tier | null {
  if (countryId === GLOBAL_GAME_STATE_COUNTRY_ID) return null;
  const entry = explicitCountryEntries(preset)?.find(
    (candidate) => candidate.countryId === countryId
  );
  return entry ? tierFromLegacyAccess(entry.legacyAccess) : null;
}

export async function seedCountryGameStates(
  db: Db,
  preset: string,
  startingYear: number,
  log: (msg: string) => void = () => {}
) {
  const entries = explicitCountryEntries(preset);
  if (!entries) {
    log(
      `[countryGameStates] no enablement map for preset ${preset} — using config-status fallback`
    );
    return;
  }
  const now = new Date();
  let n = 0;
  for (const entry of entries) {
    const cid = entry.countryId!;
    const tier = tierFromLegacyAccess(entry.legacyAccess);
    if (!tier) {
      throw new Error(
        `World entity ${entry.entityId} has no explicit legacy access tier for ${preset}.`
      );
    }
    if (tier.enabledForPlayers) {
      assertCanOpenCountryToPlayers(cid, preset);
    }
    await db.collection<CountryGameState>("countryGameStates").updateOne(
      { _id: cid },
      {
        $set: {
          enabledForPlayers: tier.enabledForPlayers,
          economyPreview: tier.economyPreview,
          status: tier.status,
          updatedAt: now,
        },
        $setOnInsert: {
          currentTurn: 1,
          currentYear: startingYear,
          cycleStartTurn: 1,
          snapElectionPending: false,
          isActive: false,
          lastTurnProcessed: now,
          nextScheduledTurn: null,
          createdAt: now,
        },
      },
      { upsert: true }
    );
    n++;
  }
  log(`[countryGameStates] seeded ${n} country enablement rows for preset ${preset}`);
}
