/**
 * Resolve a country's executive leader profile for the NPC scoring algorithm.
 *
 * Strategy:
 *   1. Find the country's executive office types (`isExecutive: true,
 *      isSubNational: false`) in country config order — earlier entries win
 *      ties (US: president before vicePresident).
 *   2. Look first for a player Character holding any executive office.
 *   3. Else look for an NPP holding the office.
 *   4. Else return centrist + democracy (per design Section 6.7 fallback).
 *
 * Ideology derivation: AHD's PolicyPositions { economic, social } numeric axes
 * map to one of six discrete buckets via `deriveIdeology`. Government type:
 * AHD only has presidential/parliamentary, both democracies. The Npc
 * "authoritarian"/"hybrid" buckets are reserved for future regime types.
 */

import type { Db, ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { NPP } from "@/lib/db/types/npp";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { NpcGovernmentType, NpcIdeology } from "./npcConstants";
import type { NpcExecutiveProfile } from "./types";

type PolicyPositionsLike = { economic?: number; social?: number };

export function deriveIdeology(positions: PolicyPositionsLike | undefined): NpcIdeology {
  const e = positions?.economic ?? 0;
  const s = positions?.social ?? 0;
  // Far-left economic + liberal social → socialist
  if (e < -40 && s < 20) return "socialist";
  // Free-market + traditional → conservative
  if (e > 40 && s > 30) return "conservative";
  // Free-market + socially-open / moderate → technocrat
  if (e > 30 && s < -10) return "technocrat";
  // Strongly traditional → nationalist (regardless of economic)
  if (s > 60) return "nationalist";
  // Extremes on either axis without fitting above → populist
  if (Math.abs(e) > 55 || Math.abs(s) > 55) return "populist";
  return "centrist";
}

export function deriveGovernmentType(countryCode: CountryId): NpcGovernmentType {
  const config = COUNTRY_CONFIGS[countryCode];
  if (!config) return "democracy";
  // AHD currently maps both presidential and parliamentary to democracy. The
  // hybrid/authoritarian buckets are placeholders for future regime types.
  return "democracy";
}

function getExecutiveOfficeKeys(countryCode: CountryId): string[] {
  const config = getCountryConfig(countryCode);
  return config.officeTypes
    .filter((cfg) => cfg.isExecutive && !cfg.isSubNational)
    .map((cfg) => cfg.key);
}

export async function getExecutiveLeaderProfile(
  db: Db,
  countryCode: CountryId
): Promise<NpcExecutiveProfile> {
  const execKeys = getExecutiveOfficeKeys(countryCode);
  const governmentType = deriveGovernmentType(countryCode);
  if (execKeys.length === 0) {
    return { characterId: null, ideology: "centrist", governmentType, kind: "none" };
  }

  // Player Character first. We restrict to live (not retired) characters by
  // requiring `currentOffice.type` to be one of the executive keys.
  const character = await db.collection<Character>("characters").findOne({
    countryId: countryCode,
    "currentOffice.type": { $in: execKeys },
  });
  if (character) {
    return {
      characterId: character._id,
      ideology: deriveIdeology(character.policies),
      governmentType,
      kind: "player",
    };
  }

  // Else NPP holding the executive office. NPP `currentOffice` mirrors
  // Character's `OfficeType` discriminated union (per npp.ts), so we filter
  // on the `type` discriminant to match across all variants.
  const npp = await db.collection<NPP>("npps").findOne({
    countryId: countryCode,
    "currentOffice.type": { $in: execKeys },
    retiredAt: null,
  } as never);
  if (npp) {
    return {
      characterId: npp._id as ObjectId,
      ideology: deriveIdeology(npp.policies),
      governmentType,
      kind: "npp",
    };
  }

  return { characterId: null, ideology: "centrist", governmentType, kind: "none" };
}
