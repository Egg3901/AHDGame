/**
 * Persistence shell for durable UK Commons vacancies (epic #856, #860).
 *
 * A vacancy doc is the durable WHY/HOW-MANY behind a holder-less `commons`
 * official row. Every write is idempotent so turn retries and concurrent
 * triggers converge: one open-or-scheduled vacancy per official row, claims
 * only move `open -> scheduled`, and terminal states are never reopened.
 */

import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { ElectedOfficial } from "@/lib/db/types";
import { getUkCommonsVacanciesCollection } from "@/lib/db/collections/ukByElection";
import type {
  CommonsVacancyReason,
  CommonsVacancyStatus,
  UkCommonsVacancy,
} from "@/lib/db/types/ukByElection";

export interface VacateCommonsSeatInput {
  officialId: ObjectId;
  state: string;
  seats?: number;
  reason: CommonsVacancyReason;
  priorCharacterId?: ObjectId | null;
  priorNppId?: ObjectId | null;
  priorCharacterName?: string;
  priorParty?: string;
  constituency?: string;
  constituencyId?: string;
  vacatedTurn: number;
  now: Date;
}

/** Non-terminal vacancy states: at most one of these may exist per official row. */
const LIVE_STATUSES: CommonsVacancyStatus[] = ["open", "scheduled"];

export async function findLiveVacancyForOfficial(
  db: Db,
  officialId: ObjectId
): Promise<UkCommonsVacancy | null> {
  return await getUkCommonsVacanciesCollection(db).findOne({
    officialId,
    status: { $in: LIVE_STATUSES },
  });
}

/**
 * Create a vacancy doc, or return the live one when this row is already
 * tracked. Never creates a second live vacancy for the same official row.
 */
export async function createCommonsVacancy(
  db: Db,
  input: VacateCommonsSeatInput
): Promise<UkCommonsVacancy> {
  const existing = await findLiveVacancyForOfficial(db, input.officialId);
  if (existing) return existing;
  const doc: UkCommonsVacancy = {
    _id: new ObjectId(),
    countryId: "UK",
    state: input.state,
    officialId: input.officialId,
    ...(input.constituency ? { constituency: input.constituency } : {}),
    ...(input.constituencyId ? { constituencyId: input.constituencyId } : {}),
    seats: Math.max(1, Math.floor(input.seats ?? 1)),
    reason: input.reason,
    ...(input.priorCharacterId ? { priorCharacterId: input.priorCharacterId } : {}),
    ...(input.priorNppId ? { priorNppId: input.priorNppId } : {}),
    ...(input.priorCharacterName ? { priorCharacterName: input.priorCharacterName } : {}),
    ...(input.priorParty ? { priorParty: input.priorParty } : {}),
    vacatedTurn: input.vacatedTurn,
    vacatedAt: input.now,
    status: "open",
    createdAt: input.now,
    updatedAt: input.now,
  };
  await getUkCommonsVacanciesCollection(db).insertOne(doc);
  return doc;
}

/**
 * Tombstone a held `commons` official row and record the vacancy behind it.
 * When the row is already holder-less (death/retirement paths tombstone
 * first), only the vacancy doc is ensured. Idempotent: repeated calls return
 * the same live vacancy and never clear a newly seated holder.
 */
export async function vacateCommonsSeat(
  db: Db,
  official: ElectedOfficial,
  reason: CommonsVacancyReason,
  vacatedTurn: number,
  now: Date
): Promise<UkCommonsVacancy | null> {
  if (official.officeType !== "commons") return null;
  const state = typeof official.state === "string" ? official.state : null;
  if (!state) return null;

  const held = official.characterId != null || official.nppId != null;
  const priorCharacterId = official.characterId ?? undefined;
  const priorNppId = official.nppId ?? undefined;

  if (held) {
    const result = await db.collection<ElectedOfficial>("electedOfficials").updateOne(
      {
        _id: official._id,
        $or: [{ characterId: { $ne: null } }, { nppId: { $ne: null } }],
      },
      {
        $set: { characterId: null, nppId: null, isNPP: false, updatedAt: now },
        $unset: { characterName: "", party: "", electedAt: "" },
      }
    );
    // Lost the race to a concurrent vacate (or a seating): ensure the doc but
    // never touch the row again.
    if (result.matchedCount === 0) {
      const live = await findLiveVacancyForOfficial(db, official._id);
      if (live) return live;
      if (official.characterId != null || official.nppId != null) return null;
    }
  }

  const officialDoc = (await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne({ _id: official._id })) as
    (ElectedOfficial & { constituency?: string; constituencyId?: string }) | null;

  return await createCommonsVacancy(db, {
    officialId: official._id,
    state,
    seats: 1,
    reason,
    priorCharacterId: priorCharacterId ?? officialDoc?.characterId ?? undefined,
    priorNppId: priorNppId ?? officialDoc?.nppId ?? undefined,
    priorCharacterName: official.characterName ?? officialDoc?.characterName ?? undefined,
    priorParty: typeof official.party === "string" ? official.party : undefined,
    constituency: officialDoc?.constituency ?? undefined,
    constituencyId: officialDoc?.constituencyId ?? undefined,
    vacatedTurn,
    now,
  });
}

/** Open vacancies in a region that a new by-election may claim. */
export async function listClaimableVacancies(db: Db, state: string): Promise<UkCommonsVacancy[]> {
  return await getUkCommonsVacanciesCollection(db)
    .find({ countryId: "UK", state, status: "open" })
    .toArray();
}

/**
 * Claim open vacancies for a spawned by-election. Only `open` rows move, so
 * a retried spawn with the same election id converges instead of double
 * claiming. Returns the number newly claimed.
 */
export async function claimVacanciesForElection(
  db: Db,
  vacancyIds: ObjectId[],
  electionId: ObjectId,
  scheduledTurn: number,
  now: Date
): Promise<number> {
  if (vacancyIds.length === 0) return 0;
  const result = await getUkCommonsVacanciesCollection(db).updateMany(
    { _id: { $in: vacancyIds }, status: "open" },
    { $set: { status: "scheduled", electionId, scheduledTurn, updatedAt: now } }
  );
  return result.modifiedCount ?? 0;
}

/**
 * Reopen every vacancy a by-election claimed when the race resolved empty
 * (no tally, no votes, or no candidates): the seats are still vacant, so the
 * docs go back to `open` and the watcher retries after the cooldown. Only
 * `scheduled` rows claimed by this election move, so a regular sweep that
 * already subsumed the seat is never resurrected.
 */
export async function reopenCommonsVacanciesForRetry(
  db: Db,
  electionId: ObjectId,
  now: Date
): Promise<number> {
  const result = await getUkCommonsVacanciesCollection(db).updateMany(
    { electionId, status: "scheduled" },
    { $set: { status: "open", updatedAt: now }, $unset: { electionId: "", scheduledTurn: "" } }
  );
  return result.modifiedCount ?? 0;
}

/** Mark every vacancy a resolved by-election claimed as filled. */
export async function markVacanciesFilled(
  db: Db,
  electionId: ObjectId,
  resolvedTurn: number,
  now: Date
): Promise<number> {
  const result = await getUkCommonsVacanciesCollection(db).updateMany(
    { electionId, status: "scheduled" },
    { $set: { status: "filled", resolvedTurn, updatedAt: now } }
  );
  return result.modifiedCount ?? 0;
}

/**
 * A regular Commons sweep (general or snap) fills the whole regional
 * delegation, so vacancies it overtakes are subsumed, not filled. Only rows
 * still claimed by a live election move; already-filled rows are untouched.
 */
export async function markVacanciesSubsumed(
  db: Db,
  state: string,
  resolvedTurn: number,
  now: Date
): Promise<number> {
  const result = await getUkCommonsVacanciesCollection(db).updateMany(
    { countryId: "UK", state, status: { $in: LIVE_STATUSES } },
    { $set: { status: "subsumed", resolvedTurn, updatedAt: now } }
  );
  return result.modifiedCount ?? 0;
}
