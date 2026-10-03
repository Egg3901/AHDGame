/**
 * Bulgaria's 1991 constitution opens a normal parliamentary bill after
 * its date. Only its bound enacted vote authorizes the later Parliament
 * for later campaigns; full constituent membership is required.
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
  passesBgConstitution1991,
  bg1991DecisionAvailability,
} from "./rules/constitutionalDecision1991";

import { BG_ORDINARY_ASSEMBLY_SEATS } from "./rules/assemblyTransition";
import type { CountryState } from "@/lib/db/types/countryState";

export const BG_1991_PROPOSALS_COLLECTION = "bg1991ConstitutionalProposals";
const ID = "1991-default:bg-constitutional:constitution1991";
type Calendar = Pick<GameState, "preset" | "preIteration" | "preIterationTurns">;
export interface Bg1991ConstitutionalProposal {
  _id: string;
  billId: ObjectId;
  revision: number;
  openedOnTurn: number;
  status: "open" | "authorized";
  reason: "executive_proposal" | "npc_government_constituent_mandate";
  authorizedOnTurn?: number;
  capacity: number;
  createdAt: Date;
}
export class Bg1991ConstitutionalConflict extends Error {}

async function availability(db: Db, game: Calendar, turn: number, session?: ClientSession) {
  const current = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  const runtime = await db
    .collection<CountryState>("countryState")
    .findOne({ _id: "BG" }, { session, projection: { governmentType: 1 } });
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne(
      { _id: "BG" },
      { session, projection: { bgConstitution1991SinceTurn: 1, bgOrdinaryAssemblySinceTurn: 1 } }
    );
  return bg1991DecisionAvailability({
    preset: current?.preset,
    calendarTurn: calendarTurn(turn, {
      preIterationActive: game.preIteration?.active,
      preIterationTurns: game.preIterationTurns,
    }),
    authorizedTurn: country?.bgConstitution1991SinceTurn,
    completedTurn: country?.bgOrdinaryAssemblySinceTurn,
    hasParliament: !runtime || runtime.governmentType === "parliamentaryRepublic",
  });
}

export async function materializeBg1991ConstitutionalProposal(input: {
  db: Db;
  session: ClientSession;
  game: Calendar;
  turn: number;
  now: Date;
  sponsor: Pick<Character, "_id" | "name"> | null;
  sponsorParty?: string;
  reason?: Bg1991ConstitutionalProposal["reason"];
  newBillId?: ObjectId;
}): Promise<Bg1991ConstitutionalProposal> {
  const { db, session, game, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Bulgarian electoral proposal needs a transaction, turn and time");
  const allowed = await availability(db, game, turn, session);
  if (!allowed.available) throw new Bg1991ConstitutionalConflict(allowed.reason);
  const proposals = db.collection<Bg1991ConstitutionalProposal>(BG_1991_PROPOSALS_COLLECTION);
  const prior = await proposals.findOne({ _id: ID }, { session });
  if (prior) {
    if (!Number.isSafeInteger(prior.revision) || prior.revision < 1)
      throw new Bg1991ConstitutionalConflict("Invalid electoral proposal revision");
    const bill = await db
      .collection<Bill>("bills")
      .findOne(
        { _id: prior.billId },
        { session, projection: { countryId: 1, status: 1, bulgarianConstitutionalMandate: 1 } }
      );
    if (
      !bill ||
      bill.countryId !== "BG" ||
      bill.bulgarianConstitutionalMandate?.proposalId !== ID ||
      bill.bulgarianConstitutionalMandate.revision !== prior.revision ||
      bill.bulgarianConstitutionalMandate.kind !== "constitution1991"
    )
      throw new Bg1991ConstitutionalConflict("Electoral proposal no longer matches its bill");
    if (!["failed", "vetoed", "override_failed"].includes(bill.status)) return prior;
  }
  const regions = await db
    .collection("states")
    .find({ countryId: "BG" }, { session, projection: { houseDistricts: 1 } })
    .toArray();
  const capacity = regions.reduce((n, row) => n + (row.houseDistricts ?? 0), 0);
  if (capacity !== 400)
    throw new Bg1991ConstitutionalConflict(
      "The constituent decision needs the full 400-seat Grand Assembly"
    );
  if (input.sponsor) {
    const office = await db.collection("electedOfficials").findOne(
      {
        countryId: "BG",
        characterId: input.sponsor._id,
        officeType: { $in: ["primeMinister", "president"] },
      },
      { session, projection: { _id: 1 } }
    );
    if (!office)
      throw new Bg1991ConstitutionalConflict(
        "The government or President must introduce this draft"
      );
  }
  const proposal: Bg1991ConstitutionalProposal = {
    _id: ID,
    billId: input.newBillId ?? new ObjectId(),
    revision: (prior?.revision ?? 0) + 1,
    openedOnTurn: turn,
    status: "open",
    reason: input.reason ?? "executive_proposal",
    capacity,
    createdAt: now,
  };
  const bill: Bill = {
    _id: proposal.billId,
    countryId: "BG",
    stateId: "bg_national",
    title: "Bulgarian 1991 Constitution Decision",
    summary:
      "Authorize the ordinary 240-seat National Assembly with a two-thirds vote of all 400 constituent deputies. The government or President introduces the draft. Existing cast ballots retain their frozen rules.",
    originChamber: "nationalAssembly",
    currentChamber: "nationalAssembly",
    sponsorId: input.sponsor?._id ?? null,
    sponsorName: input.sponsor?.name ?? "Bulgarian Government",
    ...(input.sponsorParty ? { sponsorParty: input.sponsorParty } : {}),
    status: "proposed",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: "government",
    provisions: [],
    bulgarianConstitutionalMandate: {
      proposalId: ID,
      revision: proposal.revision,
      kind: "constitution1991",
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
    throw new Bg1991ConstitutionalConflict("Electoral proposal changed");
  await db.collection<Bill>("bills").insertOne(bill, { session });
  return proposal;
}

export async function openBg1991ConstitutionalProposal(
  input: Omit<Parameters<typeof materializeBg1991ConstitutionalProposal>[0], "session">
) {
  const newBillId = input.newBillId ?? new ObjectId();
  return runRequiredTransaction(
    (session) => materializeBg1991ConstitutionalProposal({ ...input, newBillId, session }),
    { client: input.db.client }
  );
}

export async function authorizeBg1991ConstitutionalProposal(
  db: Db,
  game: Calendar,
  turn: number,
  now: Date,
  session: ClientSession
) {
  if (!session.inTransaction())
    throw new Error("Bulgarian electoral authorization needs a transaction");
  const proposals = db.collection<Bg1991ConstitutionalProposal>(BG_1991_PROPOSALS_COLLECTION);
  const proposal = await proposals.findOne({ _id: ID, status: "open" }, { session });
  if (!proposal || !(await availability(db, game, turn, session)).available) return false;
  if (
    !Number.isSafeInteger(proposal.revision) ||
    proposal.revision < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Bg1991ConstitutionalConflict("Invalid electoral authorization revision or clock");
  const bill = await db.collection<Bill>("bills").findOne(
    {
      _id: proposal.billId,
      countryId: "BG",
      stateId: "bg_national",
      status: "signed",
      enactedAt: { $type: "date" },
    },
    {
      session,
      projection: { bulgarianConstitutionalMandate: 1, "voteSnapshot.totals": 1 },
    }
  );
  if (
    !bill ||
    bill.bulgarianConstitutionalMandate?.proposalId !== ID ||
    bill.bulgarianConstitutionalMandate.revision !== proposal.revision ||
    bill.bulgarianConstitutionalMandate.kind !== "constitution1991"
  )
    return false;
  if (!bill.voteSnapshot || !passesBgConstitution1991(bill.voteSnapshot.totals, proposal.capacity))
    throw new Bg1991ConstitutionalConflict(
      "Enacted amendment lacks a frozen full-membership constituent result"
    );
  await rebindBg1991PrimaryCohort(db, turn, now, session);
  await db
    .collection<CountryGameState>("countryGameStates")
    .updateOne(
      { _id: "BG", bgConstitution1991SinceTurn: { $exists: false } },
      { $set: { bgConstitution1991SinceTurn: turn } },
      { session, upsert: true }
    );
  const updated = await proposals.updateOne(
    { _id: ID, status: "open", revision: proposal.revision },
    { $set: { status: "authorized", authorizedOnTurn: turn } },
    { session }
  );
  if (updated.modifiedCount !== 1)
    throw new Bg1991ConstitutionalConflict("Electoral authorization changed");
  return true;
}

export async function loadBg1991ConstitutionalDecision(db: Db, game: Calendar, turn: number) {
  if (game.preset !== "1991-default") return null;
  const allowed = await availability(db, game, turn);
  const proposal = await db
    .collection<Bg1991ConstitutionalProposal>(BG_1991_PROPOSALS_COLLECTION)
    .findOne({ _id: ID });
  const bill = proposal
    ? await db
        .collection<Bill>("bills")
        .findOne({ _id: proposal.billId }, { projection: { status: 1 } })
    : null;
  return {
    kind: "constitution1991" as const,
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

export async function processBg1991ConstitutionalMandate(
  db: Db,
  game: Calendar,
  turn: number,
  now: Date
) {
  if (game.preset !== "1991-default") return false;
  const proposal = await db
    .collection<Bg1991ConstitutionalProposal>(BG_1991_PROPOSALS_COLLECTION)
    .findOne({ _id: ID, status: "open" }, { projection: { billId: 1 } });
  if (
    !proposal ||
    !(await db
      .collection<Bill>("bills")
      .findOne({ _id: proposal.billId, status: "signed" }, { projection: { _id: 1 } }))
  )
    return false;
  return runRequiredTransaction(
    (session) => authorizeBg1991ConstitutionalProposal(db, game, turn, now, session),
    { client: db.client }
  );
}

/** Only a complete untouched primary cohort may accept the new ordinary capacity. */
async function rebindBg1991PrimaryCohort(db: Db, turn: number, now: Date, session: ClientSession) {
  const polls = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "BG",
        electionType: "nationalAssembly",
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
      cohort.length !== Object.keys(BG_ORDINARY_ASSEMBLY_SEATS).length ||
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
    const regions = cohort.map((row) => row.state);
    if (
      new Set(regions).size !== Object.keys(BG_ORDINARY_ASSEMBLY_SEATS).length ||
      regions.some((id) => BG_ORDINARY_ASSEMBLY_SEATS[id] == null)
    )
      return [];
    return cohort.map((row) => ({
      updateOne: {
        filter: { _id: row._id, status: { $in: ["active", "upcoming"] } },
        update: {
          $set: {
            totalSeats: BG_ORDINARY_ASSEMBLY_SEATS[row.state],
            updatedAt: now,
          },
        },
      },
    }));
  });
  if (updates.length) await db.collection<Election>("elections").bulkWrite(updates, { session });
}
