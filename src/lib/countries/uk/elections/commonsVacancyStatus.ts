/**
 * Read model for the UK Commons vacancy/recall status surface (ticket #860).
 *
 * Loads the player-reachable slice in a fixed order with one query per
 * collection (no per-row reads): live vacancies, active recall petitions,
 * the `special_commons` races covering the vacancy states, their candidates,
 * and the viewer's own held Commons seat. Plain JSON-safe data out so both
 * the GET route and tests can consume it without touching BSON.
 */

import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { Character, ElectedOfficial, Election, ElectionCandidate } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  getUkCommonsVacanciesCollection,
  getUkRecallPetitionsCollection,
} from "@/lib/db/collections/ukByElection";
import { RECALL_SIGNATURES_REQUIRED } from "@/lib/uk/elections/commonsRecallRules";
import { SPECIAL_COMMONS_ELECTION_TYPE } from "@/lib/turn/commonsByElections";

export interface CommonsVacancyDto {
  id: string;
  state: string;
  constituency: string | null;
  seats: number;
  reason: string;
  status: string;
  vacatedTurn: number;
  electionId: string | null;
  scheduledTurn: number | null;
  priorCharacterName: string | null;
  priorParty: string | null;
}

export interface RecallPetitionDto {
  id: string;
  officialId: string;
  state: string;
  targetCharacterName: string;
  targetParty: string | null;
  status: string;
  trigger: string;
  signatures: number;
  signaturesRequired: number;
  openedTurn: number | null;
  checkStartTurn: number | null;
  checkEndTurn: number | null;
  turnsRemaining: number | null;
  removeDeclarations: number;
  retainDeclarations: number;
  outcome: string | null;
  vacancyId: string | null;
}

export interface CommonsElectionDto {
  id: string;
  state: string;
  status: string;
  endTurn: number | null;
  totalSeats: number | null;
  carve: number | null;
  vacancyIds: string[];
  candidates: Array<{
    id: string;
    characterName: string;
    party: string;
    status: string;
  }>;
}

export interface CommonsVacancyStatus {
  currentTurn: number;
  vacancies: CommonsVacancyDto[];
  petitions: RecallPetitionDto[];
  elections: CommonsElectionDto[];
  viewer: { officialId: string | null; state: string | null };
}

export async function loadCommonsVacancyStatus(
  db: Db,
  options?: { state?: string; viewer?: Character | null }
): Promise<CommonsVacancyStatus> {
  const currentTurn = await getCurrentTurn(db);
  const stateFilter =
    typeof options?.state === "string" && options.state.length > 0 ? { state: options.state } : {};

  const vacancies = await getUkCommonsVacanciesCollection(db)
    .find({ countryId: "UK", status: { $in: ["open", "scheduled"] }, ...stateFilter })
    .toArray();
  const petitions = await getUkRecallPetitionsCollection(db)
    .find({ countryId: "UK", status: { $in: ["watch", "open", "check"] }, ...stateFilter })
    .toArray();

  const states = [...new Set([...vacancies.map((v) => v.state), ...petitions.map((p) => p.state)])];
  const elections =
    states.length > 0
      ? await db
          .collection<Election>("elections")
          .find({
            countryId: "UK",
            electionType: SPECIAL_COMMONS_ELECTION_TYPE,
            state: { $in: states },
          })
          .toArray()
      : [];
  const electionIds = elections.map((e) => e._id);
  const candidates =
    electionIds.length > 0
      ? await db
          .collection<ElectionCandidate>("electionCandidates")
          .find({ electionId: { $in: electionIds } })
          .toArray()
      : [];
  const candidatesByElection = new Map<string, ElectionCandidate[]>();
  for (const c of candidates) {
    const key = c.electionId.toString();
    const list = candidatesByElection.get(key) ?? [];
    list.push(c);
    candidatesByElection.set(key, list);
  }

  let viewer: CommonsVacancyStatus["viewer"] = { officialId: null, state: null };
  if (options?.viewer) {
    const held = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      officeType: "commons",
      countryId: "UK",
      characterId: options.viewer._id,
    });
    if (held) {
      viewer = {
        officialId: held._id.toString(),
        state: typeof held.state === "string" ? held.state : null,
      };
    }
  }

  return {
    currentTurn,
    vacancies: vacancies.map((v) => ({
      id: v._id.toString(),
      state: v.state,
      constituency: v.constituency ?? null,
      seats: v.seats,
      reason: v.reason,
      status: v.status,
      vacatedTurn: v.vacatedTurn,
      electionId: v.electionId ? (v.electionId as ObjectId).toString() : null,
      scheduledTurn: v.scheduledTurn ?? null,
      priorCharacterName: v.priorCharacterName ?? null,
      priorParty: v.priorParty ?? null,
    })),
    petitions: petitions.map((p) => ({
      id: p._id.toString(),
      officialId: (p.officialId as ObjectId).toString(),
      state: p.state,
      targetCharacterName: p.targetCharacterName,
      targetParty: p.targetParty ?? null,
      status: p.status,
      trigger: p.trigger,
      signatures: p.signatures.length,
      signaturesRequired: RECALL_SIGNATURES_REQUIRED,
      openedTurn: p.openedTurn ?? null,
      checkStartTurn: p.checkStartTurn ?? null,
      checkEndTurn: p.checkEndTurn ?? null,
      turnsRemaining:
        p.status === "check" && typeof p.checkEndTurn === "number"
          ? Math.max(0, p.checkEndTurn - currentTurn)
          : null,
      removeDeclarations: p.declarations.filter((d) => d.side === "remove").length,
      retainDeclarations: p.declarations.filter((d) => d.side === "retain").length,
      outcome: p.outcome ?? null,
      vacancyId: p.vacancyId ? (p.vacancyId as ObjectId).toString() : null,
    })),
    elections: elections.map((e) => ({
      id: e._id.toString(),
      state: e.state,
      status: e.status,
      endTurn: e.endTurn ?? null,
      totalSeats: e.totalSeats ?? null,
      carve: e.byElectionCarve ?? null,
      vacancyIds: (e.byElectionVacancyIds ?? []).map((id) => (id as ObjectId).toString()),
      candidates: (candidatesByElection.get(e._id.toString()) ?? []).map((c) => ({
        id: c._id.toString(),
        characterName: c.characterName,
        party: c.party,
        status: c.status,
      })),
    })),
    viewer,
  };
}
