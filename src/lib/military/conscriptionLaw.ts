import type { Db } from "mongodb";
import { getEnactedLevel } from "@/lib/politicalLegislation/enactedLevels";
import type { LawCountryId } from "@/lib/politicalLegislation/types";
import {
  RESERVE_LAW_BY_COUNTRY,
  stanceForReserveLevel,
  resolveConscriptionStance,
  type ConscriptionStance,
} from "./manpower";

/**
 * The stance actually in force: a playable nation's enacted reserve-forces law, else the
 * default stance table.
 *
 * The short-circuit matters. `getEnactedLevel` returns the law's authored `baselineLevel`
 * when a nation simply has not legislated yet (good), but returns 0 for an *unknown* law
 * id — so calling it for a nation that has no such law would read as "No Reserve System"
 * and silently strip its manpower instead of falling back.
 *
 * Server-only: this reaches the law catalogue. Client surfaces import the pure ladder
 * (`stanceForReserveLevel`) from `manpower.ts` instead.
 */
export async function resolveConscriptionStanceFor(
  db: Db,
  countryId: string
): Promise<ConscriptionStance> {
  const lawId = RESERVE_LAW_BY_COUNTRY[countryId];
  if (!lawId) return resolveConscriptionStance(countryId);
  const level = await getEnactedLevel(db, countryId as LawCountryId, lawId);
  return stanceForReserveLevel(level);
}
