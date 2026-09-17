/**
 * UK Commons by-election watcher (epic #856, #860).
 *
 * Fills Commons seats that go vacant mid-term (death, retirement, resignation,
 * defection, recall) with an off-calendar `special_commons` race that contests
 * ONLY the vacated seat(s): the regional electorate scaled to
 * vacatedSeats / totalRegionSeats (see `byElectionCarve.ts`).
 *
 * Runs AFTER `byElectionWatcher` so US/RU governor specials settle first;
 * both watchers read settled seat state. Like its governor sibling it is
 * suppressed during founding (every seat is being elected, so there are no
 * mid-term vacancies to backfill).
 *
 * Non-interference mirrors `byElections.ts`: `special_commons` lands in its
 * own group in `cleanupDuplicateElections`, is invisible to the perpetual
 * spawner (which keys off `commons`), seats winners as plain `commons`, and
 * resolves additively (sitting MPs keep their rows).
 */

import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { withCampaignRules } from "@/lib/campaignTargeting/rules";
import type { Character, ElectedOfficial, Election } from "@/lib/db/types";
import { officialsCountryScope } from "@/lib/db/electedOfficialScope";
import { getSeatIdFromElection } from "@/lib/seats/seatId";
import { turnToWallClock } from "@/lib/elections/canonicalCycle";
import { getUkCommonsSeats } from "@/lib/constants/states";
import { getGameStateCollection } from "@/lib/db/collections";
import { getUkCommonsVacanciesCollection } from "@/lib/db/collections/ukByElection";
import {
  COMMONS_BY_ELECTION_FILING_TURNS,
  COMMONS_BY_ELECTION_GENERAL_TURNS,
  COMMONS_BY_ELECTION_RETRY_COOLDOWN_TURNS,
} from "@/lib/uk/elections/commonsRecallRules";
import { computeByElectionCarveFraction } from "@/lib/uk/elections/byElectionCarve";
import {
  claimVacanciesForElection,
  createCommonsVacancy,
  findLiveVacancyForOfficial,
  markVacanciesFilled,
} from "@/lib/uk/elections/commonsVacancyShell";
import {
  advanceRecallPetition,
  ensureRecallWatch,
  evaluatePetitionTriggers,
  getActivePetitionForOfficial,
} from "@/lib/uk/elections/recallPetitionShell";
import type { UkCommonsVacancy } from "@/lib/db/types/ukByElection";

export const SPECIAL_COMMONS_ELECTION_TYPE = "special_commons";

/** Regular Commons races whose live presence suppresses a by-election. */
const REGULAR_COMMONS_TYPES: readonly Election["electionType"][] = ["commons", "snap_commons"];

/** Election statuses that count as a live, seat-filling race. */
const LIVE_ELECTION_STATUSES: readonly Election["status"][] = ["active", "upcoming"];

/** Election statuses that count as a finished race for reconciliation. */
const FINISHED_ELECTION_STATUSES: readonly Election["status"][] = ["completed", "resolved"];

export interface SpawnSpecialCommonsInput {
  state: string;
  /** Open vacancy docs this race claims (one race may fill several). */
  vacancyIds: ObjectId[];
  /** Seats contested (sum of claimed vacancy seats). */
  seats: number;
  /** Regional Commons delegation size for the carve fraction. */
  totalRegionSeats: number;
  currentTurn: number;
  now: Date;
}

/**
 * Spawn one `special_commons` by-election for a region's claimed vacancies.
 * Persists the carve fraction and claimed vacancy ids on the race so tally
 * invariants and the UI can prove the scaled pool. Claims only `open`
 * vacancies, so a retried spawn with the same ids converges.
 */
export async function spawnSpecialCommons(
  db: Db,
  input: SpawnSpecialCommonsInput
): Promise<ObjectId> {
  const primaryEndTurn = input.currentTurn + COMMONS_BY_ELECTION_FILING_TURNS;
  const endTurn = primaryEndTurn + COMMONS_BY_ELECTION_GENERAL_TURNS;
  const carve = computeByElectionCarveFraction(input.seats, input.totalRegionSeats);
  const doc: Election = {
    _id: new ObjectId(),
    electionType: SPECIAL_COMMONS_ELECTION_TYPE,
    state: input.state,
    countryId: "UK",
    seatId: getSeatIdFromElection({
      countryId: "UK",
      electionType: SPECIAL_COMMONS_ELECTION_TYPE,
      state: input.state,
    }),
    cycle: input.currentTurn,
    status: "active",
    totalSeats: Math.max(1, Math.floor(input.seats)),
    startTurn: input.currentTurn,
    primaryEndTurn,
    endTurn,
    startTime: input.now,
    primaryEndTime: turnToWallClock(primaryEndTurn, input.now, input.currentTurn),
    endTime: turnToWallClock(endTurn, input.now, input.currentTurn),
    durationHours: COMMONS_BY_ELECTION_FILING_TURNS + COMMONS_BY_ELECTION_GENERAL_TURNS,
    primaryDurationHours: COMMONS_BY_ELECTION_FILING_TURNS,
    byElectionCarve: carve,
    byElectionVacancyIds: input.vacancyIds,
    createdAt: input.now,
    updatedAt: input.now,
  };
  await db.collection<Election>("elections").insertOne(withCampaignRules(doc));
  await claimVacanciesForElection(db, input.vacancyIds, doc._id, input.currentTurn, input.now);
  return doc._id;
}

export interface CommonsWatcherResult {
  spawned: number;
  vacanciesEnsured: number;
  petitionsAdvanced: number;
  reconciled: number;
}

/**
 * Turn phase: backstop vacancies, advance the recall pipeline, reconcile
 * scheduled vacancies against finished races, and spawn by-elections for
 * open vacancies grouped per region.
 *
 * Every write is idempotent: vacancy creation dedupes per official row,
 * petition evaluation is guarded by lastEvaluatedTurn, claims only move
 * `open -> scheduled`, and spawn is suppressed by live races + cooldown —
 * so turn retries and simultaneous vacancies converge instead of doubling.
 */
export async function processCommonsByElectionWatcher(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<CommonsWatcherResult> {
  const result: CommonsWatcherResult = {
    spawned: 0,
    vacanciesEnsured: 0,
    petitionsAdvanced: 0,
    reconciled: 0,
  };
  const scope = officialsCountryScope("UK");
  const officials = db.collection<ElectedOfficial>("electedOfficials");
  const elections = db.collection<Election>("elections");
  const vacancies = getUkCommonsVacanciesCollection(db);

  const gameState = await (await getGameStateCollection(db)).findOne({ _id: "current" });
  const seatMap = getUkCommonsSeats(gameState?.preset);

  // ── 1. Backstop: every holder-less `commons` row needs a live vacancy. ──
  // Death, bans, and admin removals tombstone the row without recording a
  // reason; hooked paths (retirement, resignation, recall) write a precise
  // reason instead, so this only fires for unhooked paths (`removal`).
  const commonsRows = await officials.find({ officeType: "commons", ...scope }).toArray();
  const tombstones = commonsRows.filter((o) => o.state && o.characterId == null && o.nppId == null);
  for (const row of tombstones) {
    const live = await findLiveVacancyForOfficial(db, row._id);
    if (live) continue;
    await createCommonsVacancy(db, {
      officialId: row._id,
      state: row.state as string,
      seats: Math.max(1, row.seatsHeld ?? 1),
      reason: "removal",
      priorCharacterName: row.characterName ?? undefined,
      priorParty: typeof row.party === "string" ? row.party : undefined,
      vacatedTurn: currentTurn,
      now,
    });
    result.vacanciesEnsured++;
  }

  // ── 2. Recall pipeline: ensure watches for seated MPs, evaluate triggers,
  // advance open/check petitions. Favorability + infamy load in one batch. ──
  const seated = commonsRows.filter((o) => o.state && (o.characterId != null || o.nppId != null));
  const characterIds = seated.map((o) => o.characterId).filter((id): id is ObjectId => id != null);
  const characters =
    characterIds.length > 0
      ? await db
          .collection<Character>("characters")
          .find(
            { _id: { $in: characterIds } },
            { projection: { _id: 1, name: 1, party: 1, favorability: 1, infamy: 1 } }
          )
          .toArray()
      : [];
  const characterById = new Map(characters.map((c) => [c._id.toString(), c]));
  for (const row of seated) {
    if (row.characterId == null) continue;
    const character = characterById.get(row.characterId.toString());
    if (!character) continue;
    const petition =
      (await getActivePetitionForOfficial(db, row._id)) ??
      (await ensureRecallWatch(db, { official: row, target: character, currentTurn, now }));
    if (petition.status === "watch") {
      const { action } = await evaluatePetitionTriggers(
        db,
        petition,
        character.favorability ?? 50,
        character.infamy ?? 0,
        currentTurn,
        now
      );
      if (action !== "none") result.petitionsAdvanced++;
    } else {
      const { action } = await advanceRecallPetition(
        db,
        petition,
        currentTurn,
        character.favorability ?? 50,
        now
      );
      if (action !== "wait") result.petitionsAdvanced++;
    }
  }

  // ── 3. Reconcile scheduled vacancies against finished races. ──
  const liveVacancies = await vacancies
    .find({ countryId: "UK", status: { $in: ["open", "scheduled"] } })
    .toArray();
  const scheduled = liveVacancies.filter((v) => v.status === "scheduled" && v.electionId);
  const electionIds = [...new Set(scheduled.map((v) => v.electionId as ObjectId))];
  const scheduledElections =
    electionIds.length > 0 ? await elections.find({ _id: { $in: electionIds } }).toArray() : [];
  const electionById = new Map(scheduledElections.map((e) => [e._id.toString(), e]));
  const statesWithVacancies = [...new Set(liveVacancies.map((v) => v.state))];
  const finishedRegular =
    statesWithVacancies.length > 0
      ? await elections
          .find({
            countryId: "UK",
            state: { $in: statesWithVacancies },
            electionType: { $in: REGULAR_COMMONS_TYPES },
            status: { $in: FINISHED_ELECTION_STATUSES },
          })
          .toArray()
      : [];
  const regularEndByState = new Map<string, number>();
  for (const e of finishedRegular) {
    if (typeof e.endTurn !== "number") continue;
    const prev = regularEndByState.get(e.state);
    if (prev === undefined || e.endTurn > prev) regularEndByState.set(e.state, e.endTurn);
  }
  const reopenIds: ObjectId[] = [];
  const subsumeIds: ObjectId[] = [];
  const filledByElection = new Map<string, UkCommonsVacancy[]>();
  for (const v of scheduled) {
    const race = electionById.get((v.electionId as ObjectId).toString());
    if (!race) {
      reopenIds.push(v._id);
      continue;
    }
    if (FINISHED_ELECTION_STATUSES.includes(race.status)) {
      const list = filledByElection.get(race._id.toString()) ?? [];
      list.push(v);
      filledByElection.set(race._id.toString(), list);
      continue;
    }
    if (race.status === "cancelled") {
      reopenIds.push(v._id);
      continue;
    }
    // A regular general/snap that resolved after this race was scheduled
    // re-elects the whole delegation: the vacancy is subsumed, not filled.
    const regularEnd = regularEndByState.get(v.state);
    if (
      typeof regularEnd === "number" &&
      typeof v.scheduledTurn === "number" &&
      regularEnd >= v.scheduledTurn
    ) {
      subsumeIds.push(v._id);
    }
  }
  // Open vacancies overtaken by a finished regular race are subsumed too —
  // but only when the race resolved after the seat went vacant.
  for (const v of liveVacancies) {
    if (v.status !== "open") continue;
    const regularEnd = regularEndByState.get(v.state);
    if (typeof regularEnd === "number" && regularEnd >= v.vacatedTurn) {
      subsumeIds.push(v._id);
    }
  }
  for (const [electionId] of filledByElection) {
    result.reconciled += await markVacanciesFilled(db, new ObjectId(electionId), currentTurn, now);
  }
  if (reopenIds.length > 0) {
    const reopened = await vacancies.updateMany(
      { _id: { $in: reopenIds }, status: "scheduled" },
      { $set: { status: "open", updatedAt: now }, $unset: { electionId: "", scheduledTurn: "" } }
    );
    result.reconciled += reopened.modifiedCount ?? 0;
  }
  if (subsumeIds.length > 0) {
    const subsumed = await vacancies.updateMany(
      { _id: { $in: subsumeIds }, status: { $in: ["open", "scheduled"] } },
      { $set: { status: "subsumed", resolvedTurn: currentTurn, updatedAt: now } }
    );
    result.reconciled += subsumed.modifiedCount ?? 0;
  }

  // ── 4. Spawn: one `special_commons` per region over its open vacancies. ──
  const openByState = new Map<string, UkCommonsVacancy[]>();
  const freshOpen = await vacancies.find({ countryId: "UK", status: "open" }).toArray();
  for (const v of freshOpen) {
    const list = openByState.get(v.state) ?? [];
    list.push(v);
    openByState.set(v.state, list);
  }
  if (openByState.size > 0) {
    const liveRaces = await elections
      .find({
        countryId: "UK",
        state: { $in: [...openByState.keys()] },
        electionType: {
          $in: [SPECIAL_COMMONS_ELECTION_TYPE, ...REGULAR_COMMONS_TYPES],
        },
        status: { $in: LIVE_ELECTION_STATUSES },
      })
      .toArray();
    const liveByState = new Map<string, Election[]>();
    for (const e of liveRaces) {
      const list = liveByState.get(e.state) ?? [];
      list.push(e);
      liveByState.set(e.state, list);
    }
    const finishedSpecials = await elections
      .find({
        countryId: "UK",
        state: { $in: [...openByState.keys()] },
        electionType: SPECIAL_COMMONS_ELECTION_TYPE,
        status: { $nin: LIVE_ELECTION_STATUSES },
      })
      .toArray();
    const cooldownEndByState = new Map<string, number>();
    for (const e of finishedSpecials) {
      if (typeof e.endTurn !== "number") continue;
      const prev = cooldownEndByState.get(e.state);
      if (prev === undefined || e.endTurn > prev) cooldownEndByState.set(e.state, e.endTurn);
    }
    for (const [state, claims] of openByState) {
      const live = liveByState.get(state) ?? [];
      // A live regular race fills the seat on schedule; a live special is
      // already filling it. Either way there is nothing to spawn.
      if (live.length > 0) continue;
      const lastEnd = cooldownEndByState.get(state);
      if (
        typeof lastEnd === "number" &&
        lastEnd > currentTurn - COMMONS_BY_ELECTION_RETRY_COOLDOWN_TURNS
      ) {
        continue;
      }
      const seats = claims.reduce((n, v) => n + Math.max(1, v.seats), 0);
      await spawnSpecialCommons(db, {
        state,
        vacancyIds: claims.map((v) => v._id),
        seats,
        totalRegionSeats: seatMap[state] ?? seats,
        currentTurn,
        now,
      });
      result.spawned++;
    }
  }

  if (result.spawned > 0) {
    console.log(`[Turn] Spawned ${result.spawned} Commons by-election(s)`);
  }
  return result;
}
