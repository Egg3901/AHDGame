import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types";
import { getUKPartyConferencesCollection } from "@/lib/db/collections/ukPartyConferences";
import { CONFERENCE_HISTORY_CAP } from "@/lib/uk/conference/rules";
import type {
  ConferenceHistoryEntry,
  ConferenceHistoryKind,
  UKPartyConference,
} from "@/lib/uk/conference/types";

export function conferenceDocId(countryId: CountryId, partySeqId: string, year: number): string {
  return `${countryId}:${partySeqId}:${year}`;
}

/** Append a history entry, keeping the trail bounded and append-only. */
export function pushConferenceHistory(
  history: ConferenceHistoryEntry[],
  entry: Omit<ConferenceHistoryEntry, "at"> & { at?: Date }
): ConferenceHistoryEntry[] {
  const next = [...history, { at: new Date(), ...entry } as ConferenceHistoryEntry];
  return next.length > CONFERENCE_HISTORY_CAP
    ? next.slice(next.length - CONFERENCE_HISTORY_CAP)
    : next;
}

export function conferenceHistoryEntry(
  turn: number,
  kind: ConferenceHistoryKind,
  detail: string,
  actor?: { characterId?: import("mongodb").ObjectId; actorName?: string },
  at?: Date
): ConferenceHistoryEntry {
  return {
    turn,
    at: at ?? new Date(),
    kind,
    ...(actor?.characterId ? { actorCharacterId: actor.characterId } : {}),
    ...(actor?.actorName ? { actorName: actor.actorName } : {}),
    detail,
  };
}

/** Load a conference row by id (null when this party/year was never seeded). */
export async function getConference(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  year: number
): Promise<UKPartyConference | null> {
  return getUKPartyConferencesCollection(db).findOne({
    _id: conferenceDocId(countryId, partySeqId, year),
  });
}

/**
 * Seed the conference row for a party/year. Atomic via $setOnInsert so
 * concurrent turn retries cannot duplicate the row; returns the row either
 * way so the driver is idempotent.
 */
export async function getOrSeedConference(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  year: number,
  opensAtTurn: number,
  votingClosesTurn: number,
  now: Date,
  currentTurn: number
): Promise<UKPartyConference> {
  const partySeqId = String(party.sequentialId);
  const _id = conferenceDocId(countryId, partySeqId, year);
  await getUKPartyConferencesCollection(db).updateOne(
    { _id },
    {
      $setOnInsert: {
        _id,
        countryId,
        partyId: partySeqId,
        partyName: party.name,
        conferenceYear: year,
        status: "scheduled",
        opensAtTurn,
        votingClosesTurn,
        openedAtTurn: null,
        proposal: null,
        motions: [],
        ratified: false,
        outcome: null,
        payoffDue: false,
        payoffAppliedTurn: null,
        eligibleMemberIds: null,
        eligibleCommitteeIds: null,
        appliedMotionIds: [],
        platformAppliedTurn: null,
        payoffCohesionPs: null,
        payoffCohesionAppliedTurn: null,
        payoffApprovalGroups: [],
        payoffSettledTurn: null,
        history: [
          conferenceHistoryEntry(
            currentTurn,
            "scheduled",
            `${party.name} conference ${year} scheduled (opens turn ${opensAtTurn}, voting closes turn ${votingClosesTurn})`,
            undefined,
            now
          ),
        ],
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  const doc = await getUKPartyConferencesCollection(db).findOne({ _id });
  if (!doc) throw new Error("Failed to seed UK party conference state");
  return doc;
}
