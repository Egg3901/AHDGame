/**
 * UK Government Turn Processing
 *
 * Thin wrapper around the shared parliamentary government system.
 * Delegates to parliamentaryGovernment.ts with countryId: "UK".
 *
 * Maintains the original exported function signatures so that existing
 * imports in API routes and admin tools continue to work.
 */

import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import {
  appointPrimeMinister,
  autoAyeNPPsForParliamentaryAppointment,
  resolveParliamentaryAppointmentVote,
  resolveParliamentaryNoConfidenceVote,
  processParliamentaryGovernmentVotes,
  processParliamentaryNPPAutoAye,
} from "./parliamentaryGovernment";

/**
 * Appoint a character (player or NPP) as UK Prime Minister.
 * Delegates to shared appointPrimeMinister with countryId: "UK".
 */
export async function appointUKPrimeMinister(
  characterId: ObjectId | null,
  nppId: ObjectId | null | undefined,
  characterName: string,
  now: Date
): Promise<void> {
  const db = await getDb();
  await appointPrimeMinister(db, "UK", characterId, nppId, characterName, now);
}

/**
 * Auto-aye NPPs from qualifying parties on a PM appointment vote.
 * Delegates to shared autoAyeNPPsForParliamentaryAppointment with countryId: "UK".
 */
export async function autoAyeNPPsForAppointment(db: Db, voteId: ObjectId): Promise<void> {
  await autoAyeNPPsForParliamentaryAppointment(db, "UK", voteId);
}

/**
 * Resolve a PM appointment vote after its window closes.
 * Delegates to shared resolveParliamentaryAppointmentVote with countryId: "UK".
 */
export async function resolvePMAppointmentVote(voteId: ObjectId, now: Date): Promise<void> {
  const db = await getDb();
  await resolveParliamentaryAppointmentVote(db, "UK", voteId, now);
}

/**
 * Resolve a no-confidence vote.
 * Delegates to shared resolveParliamentaryNoConfidenceVote with countryId: "UK".
 */
export async function resolveNoConfidenceVote(voteId: ObjectId, now: Date): Promise<void> {
  const db = await getDb();
  await resolveParliamentaryNoConfidenceVote(db, "UK", voteId, now);
}

/**
 * Process expired votes for UK parliamentary government.
 * Delegates to shared processParliamentaryGovernmentVotes with countryId: "UK".
 * FIXED: now filters by countryId (previously had no filter).
 */
export async function processGovernmentVotes(now: Date): Promise<void> {
  const db = await getDb();
  await processParliamentaryGovernmentVotes(db, "UK", now);
}

/**
 * Every-4-turn NPP auto-aye for active PM appointment votes.
 * Delegates to shared processParliamentaryNPPAutoAye with countryId: "UK".
 * FIXED: now filters by countryId (previously had no filter).
 */
export async function processNPPAutoAye(_now: Date, currentTurn: number): Promise<void> {
  const db = await getDb();
  await processParliamentaryNPPAutoAye(db, "UK", _now, currentTurn);
}
