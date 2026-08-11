import type { Db } from "mongodb";
import type { PartyAgenda } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Read the active National Agenda for a party. Active = no `expiresAtTurn`
 * set, or `expiresAtTurn > currentTurn`. Per Phase 3 D4: one active agenda
 * per (countryId, partyId, iterationId) at a time.
 *
 * Returns `null` when no active agenda exists. Callers (the AgendaBanner
 * mounted on 4 surfaces) render nothing when null.
 */
export async function getCurrentAgenda(
  db: Db,
  countryId: CountryId,
  partyId: string,
  iterationId: string,
  currentTurn: number
): Promise<PartyAgenda | null> {
  const agenda = await db.collection<PartyAgenda>("partyAgendas").findOne(
    {
      countryId,
      partyId,
      iterationId,
      $or: [{ expiresAtTurn: { $exists: false } }, { expiresAtTurn: { $gt: currentTurn } }],
    },
    { sort: { setAtTurn: -1 } }
  );
  return agenda ?? null;
}
