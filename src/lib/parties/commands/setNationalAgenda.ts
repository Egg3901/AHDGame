import type { Db, ObjectId } from "mongodb";
import { ObjectId as ObjectIdCtor } from "mongodb";
import type { PartyAgenda, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Chair-only command to set the National Agenda for a party.
 *
 * Per Phase 3 D4: one active agenda per (countryId, partyId, iterationId).
 * Setting a new agenda automatically expires the previous one by writing
 * its `expiresAtTurn` to the new agenda's `setAtTurn`. History is
 * preserved; only the most recent unexpired row is "active".
 *
 * Caller is responsible for verifying the actor is the party chair (or
 * vice-chair if your authorization layer permits). This command does not
 * re-check — it trusts the caller. The route handler is the chair-gate.
 */

export interface SetNationalAgendaInput {
  countryId: CountryId;
  partyId: string;
  iterationId: string;
  headline: string;
  detail: string;
  setBy: ObjectId;
  setAtTurn: number;
}

export type SetNationalAgendaResult =
  { ok: true; agendaId: ObjectId } | { ok: false; reason: "missing-party" | "blank-headline" };

export async function setNationalAgenda(
  input: SetNationalAgendaInput,
  db: Db
): Promise<SetNationalAgendaResult> {
  const headline = input.headline.trim();
  if (!headline) return { ok: false, reason: "blank-headline" };

  const party = await db.collection<PoliticalParty>("politicalParties").findOne({
    countryId: input.countryId,
    sequentialId: Number(input.partyId),
  });
  if (!party) return { ok: false, reason: "missing-party" };

  // Expire any active agenda for this party + iteration.
  await db.collection<PartyAgenda>("partyAgendas").updateMany(
    {
      countryId: input.countryId,
      partyId: input.partyId,
      iterationId: input.iterationId,
      $or: [{ expiresAtTurn: { $exists: false } }, { expiresAtTurn: { $gt: input.setAtTurn } }],
    },
    { $set: { expiresAtTurn: input.setAtTurn } }
  );

  const newAgenda: PartyAgenda = {
    _id: new ObjectIdCtor(),
    countryId: input.countryId,
    partyId: input.partyId,
    iterationId: input.iterationId,
    headline,
    detail: input.detail,
    setBy: input.setBy,
    setAtTurn: input.setAtTurn,
  };
  await db.collection<PartyAgenda>("partyAgendas").insertOne(newAgenda);

  return { ok: true, agendaId: newAgenda._id };
}
