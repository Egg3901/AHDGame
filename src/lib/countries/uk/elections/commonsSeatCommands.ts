/**
 * Player-facing Commons seat commands (epic #856, #860).
 *
 * Strategic resignation (quit the seat so your party can contest it) and
 * defection (cross the floor, vacating the seat behind you) both tombstone
 * the MP's `commons` official row and record a durable vacancy the watcher
 * turns into a `special_commons` by-election. Rows are tombstoned, never
 * deleted, so the vacancy shell and the additive resolver keep their anchor.
 */

import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { Character, ElectedOfficial, ElectionCandidate } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { vacateCommonsSeat } from "@/lib/uk/elections/commonsVacancyShell";

export type CommonsSeatCommandResult =
  | { ok: true; officialId: ObjectId; vacancyId: ObjectId; label: string }
  | { ok: false; status: 400 | 404 | 409; error: string };

async function findHeldCommonsSeat(db: Db, character: Character): Promise<ElectedOfficial | null> {
  return await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType: "commons",
    countryId: "UK",
    characterId: character._id,
  });
}

async function hasActiveCandidacy(db: Db, characterId: ObjectId): Promise<boolean> {
  const row = await db.collection<ElectionCandidate>("electionCandidates").findOne({
    characterId,
    status: "active",
  });
  return row != null;
}

async function clearCommonsCurrentOffice(db: Db, character: Character, now: Date): Promise<void> {
  if (character.currentOffice?.type !== "commons") return;
  await db
    .collection<Character>("characters")
    .updateOne({ _id: character._id }, { $set: { currentOffice: null, updatedAt: now } });
}

/**
 * Resign the caller's Commons seat. Idempotent: when the seat is already
 * vacant but a live vacancy tracks it, returns the live vacancy instead of
 * failing, so retried requests converge.
 */
export async function resignCommonsSeat(
  db: Db,
  character: Character,
  now: Date = new Date()
): Promise<CommonsSeatCommandResult> {
  const official = await findHeldCommonsSeat(db, character);
  if (!official) {
    return { ok: false, status: 404, error: "You do not hold a Commons seat." };
  }
  if (await hasActiveCandidacy(db, character._id)) {
    return {
      ok: false,
      status: 400,
      error: "Cannot resign while actively running in an election.",
    };
  }
  const currentTurn = await getCurrentTurn(db);
  const vacancy = await vacateCommonsSeat(db, official, "resignation", currentTurn, now);
  if (!vacancy) {
    return { ok: false, status: 409, error: "That seat changed. Refresh and try again." };
  }
  await clearCommonsCurrentOffice(db, character, now);
  return {
    ok: true,
    officialId: official._id,
    vacancyId: vacancy._id,
    label: "Member of Parliament",
  };
}

/**
 * Defect to another party, vacating the Commons seat behind you. The seat
 * goes to by-election; the character keeps playing under the new party.
 */
export async function defectCommonsSeat(
  db: Db,
  character: Character,
  toParty: string,
  now: Date = new Date()
): Promise<CommonsSeatCommandResult> {
  const official = await findHeldCommonsSeat(db, character);
  if (!official) {
    return { ok: false, status: 404, error: "You do not hold a Commons seat." };
  }
  if (!toParty || toParty === character.party) {
    return { ok: false, status: 400, error: "Choose a different party to defect to." };
  }
  if (await hasActiveCandidacy(db, character._id)) {
    return {
      ok: false,
      status: 400,
      error: "Cannot defect while actively running in an election.",
    };
  }
  const currentTurn = await getCurrentTurn(db);
  await db
    .collection<Character>("characters")
    .updateOne(
      { _id: character._id },
      { $set: { party: toParty, partyInfluence: 0, updatedAt: now } }
    );
  const vacancy = await vacateCommonsSeat(db, official, "defection", currentTurn, now);
  if (!vacancy) {
    return { ok: false, status: 409, error: "That seat changed. Refresh and try again." };
  }
  await clearCommonsCurrentOffice(db, character, now);
  return {
    ok: true,
    officialId: official._id,
    vacancyId: vacancy._id,
    label: "Member of Parliament",
  };
}
