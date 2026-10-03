/**
 * Romania's 1992 electoral system opens a normal parliamentary bill after
 * its date. Only its bound enacted vote authorizes the later Parliament
 * for later campaigns; both chambers and presidential promulgation are required.
 */
import { ObjectId, type AnyBulkWriteOperation, type ClientSession, type Db } from "mongodb";
import type {
  Bill,
  Character,
  CountryGameState,
  GameState,
  Election,
  ElectionVoteTally,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { TALLY_WITH_LATEST_SNAPSHOT_ONLY } from "@/lib/electionEngine/tallyProjections";
import { calendarTurn } from "@/lib/utils/gameDate";
import {
  passesRoElectoralAmendment,
  ro1992DecisionAvailability,
} from "./rules/electoralDecision1992";

import { RO_1992_DEPUTIES_BY_REGION, RO_1992_SENATORS_BY_REGION } from "./rules/parliament1992";
import type { CountryState } from "@/lib/db/types/countryState";

export const RO_1992_PROPOSALS_COLLECTION = "ro1992ElectoralProposals";
const ID = "1991-default:ro-electoral:parliament1992";
type Calendar = Pick<GameState, "preset" | "preIteration" | "preIterationTurns">;
export interface Ro1992ElectoralProposal {
  _id: string;
  billId: ObjectId;
  revision: number;
  openedOnTurn: number;
  status: "open" | "authorized";
  reason: "legislator_proposal" | "npc_government_bicameral_mandate";
  authorizedOnTurn?: number;
  capacities: { deputies: number; senate: number };
  createdAt: Date;
}
export class Ro1992ElectoralConflict extends Error {}

async function availability(db: Db, game: Calendar, turn: number, session?: ClientSession) {
  const current = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  const runtime = await db
    .collection<CountryState>("countryState")
    .findOne({ _id: "RO" }, { session, projection: { governmentType: 1 } });
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne(
      { _id: "RO" },
      { session, projection: { roElectoralLaw1992SinceTurn: 1, roParliament1992SinceTurn: 1 } }
    );
  return ro1992DecisionAvailability({
    preset: current?.preset,
    calendarTurn: calendarTurn(turn, {
      preIterationActive: game.preIteration?.active,
      preIterationTurns: game.preIterationTurns,
    }),
    authorizedTurn: country?.roElectoralLaw1992SinceTurn,
    completedTurn: country?.roParliament1992SinceTurn,
    hasParliament: !runtime || runtime.governmentType === "presidential",
  });
}

export async function materializeRo1992ElectoralProposal(input: {
  db: Db;
  session: ClientSession;
  game: Calendar;
  turn: number;
  now: Date;
  sponsor: Pick<Character, "_id" | "name"> | null;
  sponsorParty?: string;
  reason?: Ro1992ElectoralProposal["reason"];
  newBillId?: ObjectId;
}): Promise<Ro1992ElectoralProposal> {
  const { db, session, game, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Romanian electoral proposal needs a transaction, turn and time");
  const allowed = await availability(db, game, turn, session);
  if (!allowed.available) throw new Ro1992ElectoralConflict(allowed.reason);
  const proposals = db.collection<Ro1992ElectoralProposal>(RO_1992_PROPOSALS_COLLECTION);
  const prior = await proposals.findOne({ _id: ID }, { session });
  if (prior) {
    if (!Number.isSafeInteger(prior.revision) || prior.revision < 1)
      throw new Ro1992ElectoralConflict("Invalid electoral proposal revision");
    const bill = await db
      .collection<Bill>("bills")
      .findOne(
        { _id: prior.billId },
        { session, projection: { countryId: 1, status: 1, romanianElectoralMandate: 1 } }
      );
    if (
      !bill ||
      bill.countryId !== "RO" ||
      bill.romanianElectoralMandate?.proposalId !== ID ||
      bill.romanianElectoralMandate.revision !== prior.revision ||
      bill.romanianElectoralMandate.kind !== "parliament1992"
    )
      throw new Ro1992ElectoralConflict("Electoral proposal no longer matches its bill");
    if (!["failed", "vetoed", "override_failed"].includes(bill.status)) return prior;
  }
  const regions = await db
    .collection("states")
    .find({ countryId: "RO" }, { session, projection: { houseDistricts: 1, stateSenateSeats: 1 } })
    .toArray();
  const capacities = {
    deputies: regions.reduce((n, row) => n + (row.houseDistricts ?? 0), 0),
    senate: regions.reduce((n, row) => n + (row.stateSenateSeats ?? 0), 0),
  };
  if (
    [capacities.deputies, capacities.senate].some(
      (seats) => !Number.isSafeInteger(seats) || seats < 1
    )
  )
    throw new Ro1992ElectoralConflict("Romanian parliamentary capacity is missing");
  const proposal: Ro1992ElectoralProposal = {
    _id: ID,
    billId: input.newBillId ?? new ObjectId(),
    revision: (prior?.revision ?? 0) + 1,
    openedOnTurn: turn,
    status: "open",
    reason: input.reason ?? "legislator_proposal",
    capacities,
    createdAt: now,
  };
  const bill: Bill = {
    _id: proposal.billId,
    countryId: "RO",
    stateId: "ro_national",
    title: "Romanian 1992 Electoral System Decision",
    summary:
      "Authorize the 1992 parliamentary framework with 341 deputy and 143 Senate mandates. Each chamber must approve by a majority of its full membership, followed by presidential promulgation. Existing general ballots retain their frozen capacities.",
    originChamber: "chamberOfDeputies",
    currentChamber: "chamberOfDeputies",
    sponsorId: input.sponsor?._id ?? null,
    sponsorName: input.sponsor?.name ?? "Romanian Government",
    ...(input.sponsorParty ? { sponsorParty: input.sponsorParty } : {}),
    status: "proposed",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: "government",
    provisions: [],
    romanianElectoralMandate: {
      proposalId: ID,
      revision: proposal.revision,
      kind: "parliament1992",
    },
    proposedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const claim = await proposals.updateOne(
    { _id: ID, ...(prior ? { revision: prior.revision } : {}) },
    { $set: proposal },
    { session, upsert: !prior }
  );
  if (prior && claim.matchedCount !== 1)
    throw new Ro1992ElectoralConflict("Electoral proposal changed");
  await db.collection<Bill>("bills").insertOne(bill, { session });
  return proposal;
}

export async function openRo1992ElectoralProposal(
  input: Omit<Parameters<typeof materializeRo1992ElectoralProposal>[0], "session">
) {
  const newBillId = input.newBillId ?? new ObjectId();
  return runRequiredTransaction(
    (session) => materializeRo1992ElectoralProposal({ ...input, newBillId, session }),
    { client: input.db.client }
  );
}

export async function authorizeRo1992ElectoralProposal(
  db: Db,
  game: Calendar,
  turn: number,
  now: Date,
  session: ClientSession
) {
  if (!session.inTransaction())
    throw new Error("Romanian electoral authorization needs a transaction");
  const proposals = db.collection<Ro1992ElectoralProposal>(RO_1992_PROPOSALS_COLLECTION);
  const proposal = await proposals.findOne({ _id: ID, status: "open" }, { session });
  if (!proposal || !(await availability(db, game, turn, session)).available) return false;
  if (
    !Number.isSafeInteger(proposal.revision) ||
    proposal.revision < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Ro1992ElectoralConflict("Invalid electoral authorization revision or clock");
  const bill = await db.collection<Bill>("bills").findOne(
    {
      _id: proposal.billId,
      countryId: "RO",
      stateId: "ro_national",
      status: "signed",
      enactedAt: { $type: "date" },
    },
    {
      session,
      projection: {
        romanianElectoralMandate: 1,
        "voteSnapshot.totals": 1,
        "otherChamberVoteSnapshot.totals": 1,
      },
    }
  );
  if (
    !bill ||
    bill.romanianElectoralMandate?.proposalId !== ID ||
    bill.romanianElectoralMandate.revision !== proposal.revision ||
    bill.romanianElectoralMandate.kind !== "parliament1992"
  )
    return false;
  if (
    !bill.voteSnapshot ||
    !bill.otherChamberVoteSnapshot ||
    !passesRoElectoralAmendment(bill.voteSnapshot.totals, proposal.capacities.deputies) ||
    !passesRoElectoralAmendment(bill.otherChamberVoteSnapshot.totals, proposal.capacities.senate)
  )
    throw new Ro1992ElectoralConflict(
      "Enacted amendment lacks a quorate frozen parliamentary result"
    );
  await rebindRo1992PrimaryCohort(db, turn, now, session);
  await db
    .collection<CountryGameState>("countryGameStates")
    .updateOne(
      { _id: "RO", roElectoralLaw1992SinceTurn: { $exists: false } },
      { $set: { roElectoralLaw1992SinceTurn: turn } },
      { session, upsert: true }
    );
  const updated = await proposals.updateOne(
    { _id: ID, status: "open", revision: proposal.revision },
    { $set: { status: "authorized", authorizedOnTurn: turn } },
    { session }
  );
  if (updated.modifiedCount !== 1)
    throw new Ro1992ElectoralConflict("Electoral authorization changed");
  return true;
}

export async function loadRo1992ElectoralDecision(db: Db, game: Calendar, turn: number) {
  if (game.preset !== "1991-default") return null;
  const allowed = await availability(db, game, turn);
  const proposal = await db
    .collection<Ro1992ElectoralProposal>(RO_1992_PROPOSALS_COLLECTION)
    .findOne({ _id: ID });
  const bill = proposal
    ? await db
        .collection<Bill>("bills")
        .findOne({ _id: proposal.billId }, { projection: { status: 1 } })
    : null;
  return {
    kind: "parliament1992" as const,
    ...allowed,
    proposal: proposal
      ? {
          billId: proposal.billId.toHexString(),
          revision: proposal.revision,
          status: proposal.status,
          reason: proposal.reason,
          billStatus: bill?.status ?? null,
          canRevise:
            allowed.available &&
            !!bill &&
            ["failed", "vetoed", "override_failed"].includes(bill.status),
        }
      : null,
  };
}

export async function processRo1992ElectoralMandate(
  db: Db,
  game: Calendar,
  turn: number,
  now: Date
) {
  if (game.preset !== "1991-default") return false;
  const proposal = await db
    .collection<Ro1992ElectoralProposal>(RO_1992_PROPOSALS_COLLECTION)
    .findOne({ _id: ID, status: "open" }, { projection: { billId: 1 } });
  if (
    !proposal ||
    !(await db
      .collection<Bill>("bills")
      .findOne({ _id: proposal.billId, status: "signed" }, { projection: { _id: 1 } }))
  )
    return false;
  return runRequiredTransaction(
    (session) => authorizeRo1992ElectoralProposal(db, game, turn, now, session),
    { client: db.client }
  );
}

/** Only an untouched complete bicameral primary cohort may accept new capacity. */
async function rebindRo1992PrimaryCohort(db: Db, turn: number, now: Date, session: ClientSession) {
  const polls = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "RO",
        electionType: { $in: ["chamberOfDeputies", "senat"] },
        cycle: { $gte: 1 },
        status: { $in: ["active", "upcoming"] },
      },
      {
        session,
        projection: { cycle: 1, state: 1, electionType: 1, primaryEndTurn: 1, primaryEndTime: 1 },
      }
    )
    .toArray();
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find(
      { electionId: { $in: polls.map((row) => row._id) } },
      { session, projection: TALLY_WITH_LATEST_SNAPSHOT_ONLY }
    )
    .toArray();
  const byPoll = new Map(tallies.map((row) => [row.electionId.toHexString(), row]));
  const updates: AnyBulkWriteOperation<Election>[] = [
    ...new Set(polls.map((row) => row.cycle)),
  ].flatMap((cycle) => {
    const cohort = polls.filter((row) => row.cycle === cycle);
    if (
      cohort.length !== 2 * Object.keys(RO_1992_DEPUTIES_BY_REGION).length ||
      cohort.some((row) => {
        const tally = byPoll.get(row._id.toHexString());
        return row.primaryEndTurn != null
          ? row.primaryEndTurn <= turn ||
              !tally ||
              tally.finalized ||
              Object.values(tally.totalVotes ?? {}).some((votes) => votes !== 0) ||
              Object.values(tally.turnSnapshots?.[0]?.cumulativeVotes ?? {}).some(
                (votes) => votes !== 0
              )
          : !row.primaryEndTime ||
              row.primaryEndTime <= now ||
              !tally ||
              tally.finalized ||
              Object.values(tally.totalVotes ?? {}).some((votes) => votes !== 0) ||
              Object.values(tally.turnSnapshots?.[0]?.cumulativeVotes ?? {}).some(
                (votes) => votes !== 0
              );
      })
    )
      return [];
    for (const chamber of ["chamberOfDeputies", "senat"]) {
      const regions = cohort.filter((row) => row.electionType === chamber).map((row) => row.state);
      if (
        new Set(regions).size !== Object.keys(RO_1992_DEPUTIES_BY_REGION).length ||
        regions.some((id) => RO_1992_DEPUTIES_BY_REGION[id] == null)
      )
        return [];
    }
    return cohort.map((row) => ({
      updateOne: {
        filter: { _id: row._id, status: { $in: ["active", "upcoming"] } },
        update: {
          $set: {
            totalSeats: (row.electionType === "senat"
              ? RO_1992_SENATORS_BY_REGION
              : RO_1992_DEPUTIES_BY_REGION)[row.state],
            updatedAt: now,
          },
        },
      },
    }));
  });
  if (updates.length) await db.collection<Election>("elections").bulkWrite(updates, { session });
}
