import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { ScotusNomination, SupremeCourtSeat } from "@/lib/db/types/scotus";
import type { Character, NPP } from "@/lib/db/types";
import { createNPP } from "@/lib/npp/generator";
import { getGameTime } from "@/lib/time/gameTime";

const VOTING_DURATION_HOURS = 24;
const VOTING_DURATION_MS = VOTING_DURATION_HOURS * 60 * 60 * 1000;

export interface NominateJusticeParams {
  countryId: "US";
  seatNumber: number;
  proposedByPresidentId: ObjectId;
  proposedByPresidentName: string;
  /** Existing player character path (per #3598, no eligibility restriction). */
  nomineeCharacterId?: ObjectId;
  /**
   * Generated NPP "legal scholar" path (per #3598, no eligibility restriction).
   * Party affiliation is the president's choice — reuses the existing
   * NPP-generation machinery (`createNPP`, party position + random variance)
   * exactly as any other NPP candidate is generated. The resulting Justice
   * Ideology is computed later from the NPP's own generated values, never
   * from the president's own position.
   */
  generateNppLegalScholar?: { party: string };
}

export type NominateJusticeResult =
  { ok: true; nominationId: ObjectId; nomineeName: string } | { ok: false; error: string };

/**
 * Create a SCOTUS nomination for a vacant seat. Mirrors the cabinet-nomination
 * proposal flow (`POST /api/whitehouse/cabinet/nominations`) — same 24-hour
 * voting window keyed off the game clock — extended to also accept a
 * generated NPP nominee, which cabinet nominations don't support today.
 */
export async function createJusticeNomination(
  db: Db,
  params: NominateJusticeParams
): Promise<NominateJusticeResult> {
  const seat = await db
    .collection<SupremeCourtSeat>("supremeCourtSeats")
    .findOne({ countryId: params.countryId, seatNumber: params.seatNumber });
  if (!seat) return { ok: false, error: "Unknown seat" };
  if (seat.justiceCharacterId || seat.justiceNppId || seat.justiceMode === "historical") {
    return { ok: false, error: "Seat is not vacant" };
  }

  const existingActive = await db.collection<ScotusNomination>("scotusNominations").findOne({
    countryId: params.countryId,
    seatNumber: params.seatNumber,
    status: "active",
  });
  if (existingActive) {
    return { ok: false, error: "An active nomination for this seat already exists" };
  }

  const now = new Date();
  let nomineeMode: "character" | "npp";
  let nomineeCharacterId: ObjectId | null = null;
  let nomineeNppId: ObjectId | null = null;
  let nomineeName: string;
  let nomineeParty: string | undefined;

  if (params.nomineeCharacterId) {
    const nominee = await db
      .collection<Character>("characters")
      .findOne({ _id: params.nomineeCharacterId });
    if (!nominee) return { ok: false, error: "Nominee character not found" };
    if (nominee.countryId !== params.countryId) {
      return { ok: false, error: "Nominee must be a politician of this country" };
    }
    nomineeMode = "character";
    nomineeCharacterId = nominee._id;
    nomineeName = nominee.name;
    nomineeParty = nominee.party;
  } else if (params.generateNppLegalScholar) {
    // Reuses the existing NPP-generation machinery as-is (party position +
    // random variance) — see src/lib/npp/generator.ts `generatePolicyPositions`.
    // targetOffice: null keeps this NPP out of election-candidate pools.
    const npp = await createNPP({
      state: "",
      party: params.generateNppLegalScholar.party,
      countryId: params.countryId,
      targetOffice: null,
      quality: 0,
    });
    nomineeMode = "npp";
    nomineeNppId = npp._id;
    nomineeName = npp.name;
    nomineeParty = npp.party;
  } else {
    return { ok: false, error: "Must supply either nomineeCharacterId or generateNppLegalScholar" };
  }

  const gameTimeForVote = await getGameTime();
  const votingEndsAt = new Date(gameTimeForVote.effectiveNow.getTime() + VOTING_DURATION_MS);
  const votingEndsOnTurn = gameTimeForVote.currentTurn + VOTING_DURATION_HOURS;

  const nomination: Omit<ScotusNomination, "_id"> = {
    countryId: params.countryId,
    seatNumber: params.seatNumber,
    nomineeMode,
    nomineeCharacterId,
    nomineeNppId,
    nomineeName,
    nomineeParty,
    proposedByPresidentId: params.proposedByPresidentId,
    proposedByPresidentName: params.proposedByPresidentName,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    votingStartedAt: now,
    votingEndsAt,
    votingEndsOnTurn,
    proposedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db
    .collection<ScotusNomination>("scotusNominations")
    .insertOne({ _id: new ObjectId(), ...nomination } as ScotusNomination);

  return { ok: true, nominationId: result.insertedId, nomineeName };
}

/** Fetch the nominee's personal PolicyPositions + party, for ideology computation at confirmation. */
export async function loadNomineePersonalPositions(
  db: Db,
  nomination: Pick<ScotusNomination, "nomineeMode" | "nomineeCharacterId" | "nomineeNppId">
): Promise<{ economic: number; social: number } | null> {
  if (nomination.nomineeMode === "character" && nomination.nomineeCharacterId) {
    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: nomination.nomineeCharacterId });
    return character?.policies ?? null;
  }
  if (nomination.nomineeMode === "npp" && nomination.nomineeNppId) {
    const npp = await db.collection<NPP>("npps").findOne({ _id: nomination.nomineeNppId });
    return npp?.policies ?? null;
  }
  return null;
}
