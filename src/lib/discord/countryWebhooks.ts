import type { Db } from "mongodb";
import { COUNTRY_ORDER, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getEnabledCountryIdsFromDb } from "@/lib/countryAccess";
import { getGameStateCollection } from "@/lib/db/collections";
import {
  getBroadcastElectionTypes,
  type BroadcastElectionType,
} from "@/lib/legislature/broadcastElectionTypes";
import type { GameConfig } from "@/lib/db/types";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Everything the admin Integrations UI and the Discord test routes need to
 * render and exercise one country's game-events webhook. This is the single
 * shared shape that replaced the six hand-written per-country cards.
 */
export interface CountryWebhookDescriptor {
  countryId: CountryId;
  name: string;
  flagEmoji: string;
  /** Configured webhook URL, or "" when the country has none. */
  url: string;
  /** Country-specific copy tail (shared ECB, PBoC), when the config declares one. */
  note?: string;
  /** Election types this country can broadcast results for, in display order. */
  electionTypes: BroadcastElectionType[];
}

/**
 * Resolve one descriptor per player-enabled country, in COUNTRY_ORDER.
 *
 * Countries that are not enabled for players are omitted entirely — their
 * stored URL is left untouched in `discordCountryGameWebhookUrls` so that
 * re-enabling the country restores it.
 *
 * `preset` defaults to the live `gameState.preset` rather than to
 * "2019-default". Chamber models are era-conditional (FR loses its
 * directly-elected president in 1953, ES becomes the Francoist Cortes, TR is
 * unicameral), so a hardcoded default would render the wrong election-type
 * buttons in a cold-war-era game. Callers pass `preset` explicitly only in
 * tests or when previewing a specific era.
 */
export async function getCountryWebhookDescriptors(
  db: Db,
  preset?: string
): Promise<CountryWebhookDescriptor[]> {
  const enabled = new Set(await getEnabledCountryIdsFromDb(db));
  const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
  const urls = config?.discordCountryGameWebhookUrls ?? {};

  let activePreset = preset;
  if (activePreset === undefined) {
    const gameState = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { preset: 1 } });
    activePreset = gameState?.preset ?? DEFAULT_SEED_PRESET;
  }

  const ordered = [
    ...COUNTRY_ORDER.filter((id) => enabled.has(id)),
    ...[...enabled].filter((id) => !COUNTRY_ORDER.includes(id)).sort(),
  ];

  return ordered.map((countryId) => {
    const countryConfig = getCountryConfig(countryId, activePreset);
    return {
      countryId,
      name: countryConfig.name,
      flagEmoji: countryConfig.flagEmoji,
      url: urls[countryId] ?? "",
      note: countryConfig.discordWebhookNote,
      electionTypes: getBroadcastElectionTypes(countryId, activePreset),
    };
  });
}
