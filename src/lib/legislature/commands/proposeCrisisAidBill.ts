// src/lib/legislature/commands/proposeCrisisAidBill.ts
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameState } from "@/lib/gameState";
import type { Bill, BillChamber } from "@/lib/db/types";

const VOTING_DURATION_HOURS = 24;
const VOTING_DURATION_MS = VOTING_DURATION_HOURS * 60 * 60 * 1000;

export interface ProposeCrisisAidBillInput {
  countryId: CountryId;
  crisisAidId: ObjectId;
  sponsorId: ObjectId;
  sponsorName: string;
  sponsorParty?: string;
  title: string;
  summary: string;
}

/**
 * Insert an emergency appropriation bill for a crisis aid pledge into the
 * sender's lower chamber. Provision-less and category "foreign policy" with a
 * `crisisAidId` marker — it votes via the normal NPP cross-pressure engine but
 * is a no-op for policy enactment, and the per-turn crisis-aid sweep finalizes
 * it on resolution. No NPI/action cost (executive emergency appropriation).
 */
export async function proposeCrisisAidBill(
  db: Db,
  input: ProposeCrisisAidBillInput
): Promise<ObjectId> {
  const config = COUNTRY_CONFIGS[input.countryId];
  const chamberKey = config.legislature.lowerChamber.key as BillChamber;
  const now = new Date();
  const gameState = await getGameState(db);
  const currentTurn = gameState?.currentTurn ?? 0;
  const stateId = getNationalDocId(input.countryId) ?? `${input.countryId.toLowerCase()}_national`;

  const bill: Omit<Bill, "_id"> = {
    countryId: input.countryId,
    stateId,
    title: input.title.trim(),
    summary: input.summary.trim(),
    originChamber: chamberKey,
    currentChamber: chamberKey,
    sponsorId: input.sponsorId,
    sponsorName: input.sponsorName,
    sponsorParty: input.sponsorParty,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: "foreign policy",
    provisions: [],
    crisisAidId: input.crisisAidId,
    proposedAt: now,
    votingStartedAt: now,
    votingEndsAt: new Date(now.getTime() + VOTING_DURATION_MS),
    votingEndsOnTurn: currentTurn + VOTING_DURATION_HOURS,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection<Omit<Bill, "_id">>("bills").insertOne(bill);
  return result.insertedId;
}
