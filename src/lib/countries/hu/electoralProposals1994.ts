/**
 * Hungary's 1994 electoral amendment opens a normal parliamentary bill after
 * its date. Only its bound enacted vote authorizes the new threshold and list
 * capacity; rejected decisions remain visible and can be revised by legislators.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Bill,
  Character,
  CountryGameState,
  Election,
  ElectionVoteTally,
  GameState,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { calendarTurn } from "@/lib/utils/gameDate";
import { hu1994DecisionAvailability, passesHuElectoralAmendment } from "./rules/electoralLaw";
import type { CountryState } from "@/lib/db/types/countryState";

export const HU_1994_PROPOSALS_COLLECTION = "hu1994ElectoralProposals";
const ID = "1991-default:hu-electoral:threshold1994";
type Calendar = Pick<
  GameState,
  "preset" | "preIteration" | "preIterationTurns" | "huAssemblyReformedAtYear"
>;
export interface Hu1994ElectoralProposal {
  _id: string;
  billId: ObjectId;
  revision: number;
  openedOnTurn: number;
  status: "open" | "authorized";
  reason: "legislator_proposal" | "npc_government_threshold_mandate";
  authorizedOnTurn?: number;
  createdAt: Date;
}
export class Hu1994ElectoralConflict extends Error {}

async function availability(db: Db, game: Calendar, turn: number, session?: ClientSession) {
  const current = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, huAssemblyReformedAtYear: 1 } }
    );
  const runtime = await db
    .collection<CountryState>("countryState")
    .findOne({ _id: "HU" }, { session, projection: { governmentType: 1 } });
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "HU" }, { session, projection: { huElectoralLaw1994SinceTurn: 1 } });
  return hu1994DecisionAvailability({
    preset: current?.preset,
    calendarTurn: calendarTurn(turn, {
      preIterationActive: game.preIteration?.active,
      preIterationTurns: game.preIterationTurns,
    }),
    authorizedTurn: country?.huElectoralLaw1994SinceTurn,
    modernAssemblyYear: current?.huAssemblyReformedAtYear ?? game.huAssemblyReformedAtYear,
    hasParliament: !runtime || runtime.governmentType === "parliamentaryRepublic",
  });
}

export async function materializeHu1994ElectoralProposal(input: {
  db: Db;
  session: ClientSession;
  game: Calendar;
  turn: number;
  now: Date;
  sponsor: Pick<Character, "_id" | "name"> | null;
  sponsorParty?: string;
  reason?: Hu1994ElectoralProposal["reason"];
  newBillId?: ObjectId;
}): Promise<Hu1994ElectoralProposal> {
  const { db, session, game, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Hungarian electoral proposal needs a transaction, turn and time");
  const allowed = await availability(db, game, turn, session);
  if (!allowed.available) throw new Hu1994ElectoralConflict(allowed.reason);
  const proposals = db.collection<Hu1994ElectoralProposal>(HU_1994_PROPOSALS_COLLECTION);
  const prior = await proposals.findOne({ _id: ID }, { session });
  if (prior) {
    if (!Number.isSafeInteger(prior.revision) || prior.revision < 1)
      throw new Hu1994ElectoralConflict("Invalid electoral proposal revision");
    const bill = await db
      .collection<Bill>("bills")
      .findOne(
        { _id: prior.billId },
        { session, projection: { countryId: 1, status: 1, hungarianElectoralMandate: 1 } }
      );
    if (
      !bill ||
      bill.countryId !== "HU" ||
      bill.hungarianElectoralMandate?.proposalId !== ID ||
      bill.hungarianElectoralMandate.revision !== prior.revision ||
      bill.hungarianElectoralMandate.kind !== "threshold1994"
    )
      throw new Hu1994ElectoralConflict("Electoral proposal no longer matches its bill");
    if (bill.status !== "failed") return prior;
  }
  const proposal: Hu1994ElectoralProposal = {
    _id: ID,
    billId: input.newBillId ?? new ObjectId(),
    revision: (prior?.revision ?? 0) + 1,
    openedOnTurn: turn,
    status: "open",
    reason: input.reason ?? "legislator_proposal",
    createdAt: now,
  };
  const bill: Bill = {
    _id: proposal.billId,
    countryId: "HU",
    stateId: "hu_national",
    title: "Hungarian 1994 Electoral Amendment",
    summary:
      "Require more than five percent of national territorial-list votes and permit three times the statutory list capacity in nominees. Two-thirds of attending deputies must approve, with more than half the 386-seat Assembly attending. Existing general ballots and certified results retain their frozen rules.",
    originChamber: "nationalAssembly",
    currentChamber: "nationalAssembly",
    sponsorId: input.sponsor?._id ?? null,
    sponsorName: input.sponsor?.name ?? "Hungarian Government",
    ...(input.sponsorParty ? { sponsorParty: input.sponsorParty } : {}),
    status: "proposed",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: "government",
    provisions: [],
    hungarianElectoralMandate: {
      proposalId: ID,
      revision: proposal.revision,
      kind: "threshold1994",
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
    throw new Hu1994ElectoralConflict("Electoral proposal changed");
  await db.collection<Bill>("bills").insertOne(bill, { session });
  return proposal;
}

export async function openHu1994ElectoralProposal(
  input: Omit<Parameters<typeof materializeHu1994ElectoralProposal>[0], "session">
) {
  const newBillId = input.newBillId ?? new ObjectId();
  return runRequiredTransaction(
    (session) => materializeHu1994ElectoralProposal({ ...input, newBillId, session }),
    { client: input.db.client }
  );
}

export async function authorizeHu1994ElectoralProposal(
  db: Db,
  game: Calendar,
  turn: number,
  now: Date,
  session: ClientSession
) {
  if (!session.inTransaction())
    throw new Error("Hungarian electoral authorization needs a transaction");
  const proposals = db.collection<Hu1994ElectoralProposal>(HU_1994_PROPOSALS_COLLECTION);
  const proposal = await proposals.findOne({ _id: ID, status: "open" }, { session });
  if (!proposal || !(await availability(db, game, turn, session)).available) return false;
  if (
    !Number.isSafeInteger(proposal.revision) ||
    proposal.revision < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Hu1994ElectoralConflict("Invalid electoral authorization revision or clock");
  const bill = await db.collection<Bill>("bills").findOne(
    {
      _id: proposal.billId,
      countryId: "HU",
      stateId: "hu_national",
      status: "signed",
      enactedAt: { $type: "date" },
    },
    { session, projection: { hungarianElectoralMandate: 1, voteSnapshot: 1 } }
  );
  if (
    !bill ||
    bill.hungarianElectoralMandate?.proposalId !== ID ||
    bill.hungarianElectoralMandate.revision !== proposal.revision ||
    bill.hungarianElectoralMandate.kind !== "threshold1994"
  )
    return false;
  if (!bill.voteSnapshot || !passesHuElectoralAmendment(bill.voteSnapshot.totals, 386))
    throw new Hu1994ElectoralConflict(
      "Enacted amendment lacks a quorate frozen parliamentary result"
    );
  await rebindHu1994PrimaryCohorts(db, turn, now, session);
  await db
    .collection<CountryGameState>("countryGameStates")
    .updateOne(
      { _id: "HU", huElectoralLaw1994SinceTurn: { $exists: false } },
      { $set: { huElectoralLaw1994SinceTurn: turn } },
      { session, upsert: true }
    );
  const updated = await proposals.updateOne(
    { _id: ID, status: "open", revision: proposal.revision },
    { $set: { status: "authorized", authorizedOnTurn: turn } },
    { session }
  );
  if (updated.modifiedCount !== 1)
    throw new Hu1994ElectoralConflict("Electoral authorization changed");
  return true;
}

/** An existing primary can adopt the law only before any general ballot exists. */
async function rebindHu1994PrimaryCohorts(db: Db, turn: number, now: Date, session: ClientSession) {
  const polls = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        cycle: { $gte: 1 },
        status: { $in: ["upcoming", "active"] },
        "hungarianAssemblyRound.round": 1,
        "hungarianAssemblyRound.byElection": { $exists: false },
      },
      {
        session,
        projection: {
          cycle: 1,
          state: 1,
          primaryEndTurn: 1,
          primaryEndTime: 1,
          hungarianAssemblyRound: 1,
        },
      }
    )
    .toArray();
  const candidates = [...new Set(polls.map((row) => row.cycle))].flatMap((cycle) => {
    const cohort = polls.filter((row) => row.cycle === cycle);
    return cohort.length === 6 &&
      new Set(cohort.map((row) => row.state)).size === 6 &&
      cohort.every((row) =>
        row.primaryEndTurn != null
          ? row.primaryEndTurn > turn
          : row.primaryEndTime != null && row.primaryEndTime > now
      )
      ? cohort
      : [];
  });
  if (!candidates.length) return;
  const receipts = await db
    .collection<{ _id: string }>("hu1991AssemblyCounts")
    .find(
      {
        _id: { $in: candidates.map((row) => row.hungarianAssemblyRound!.receiptId) },
      },
      { session, projection: { _id: 1 } }
    )
    .toArray();
  const frozen = new Set(receipts.map((row) => String(row._id)));
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find(
      {
        electionId: { $in: candidates.map((row) => row._id) },
      },
      {
        session,
        projection: { electionId: 1, finalized: 1, totalVotes: 1, turnSnapshots: { $slice: -1 } },
      }
    )
    .toArray();
  const withVotes = new Set(
    tallies
      .filter(
        (row) =>
          row.finalized ||
          Object.values(row.totalVotes ?? {}).some((votes) => votes > 0) ||
          Object.values(row.turnSnapshots?.at(-1)?.cumulativeVotes ?? {}).some((votes) => votes > 0)
      )
      .map((row) => row.electionId.toHexString())
  );
  const eligibleCycles = [...new Set(candidates.map((row) => row.cycle))].filter((cycle) =>
    candidates
      .filter((row) => row.cycle === cycle)
      .every(
        (row) =>
          !frozen.has(row.hungarianAssemblyRound!.receiptId) &&
          !withVotes.has(row._id.toHexString())
      )
  );
  const eligible = candidates.filter((row) => eligibleCycles.includes(row.cycle));
  if (!eligible.length) return;
  await db.collection<ElectionVoteTally>("electionVoteTallies").updateMany(
    {
      electionId: { $in: eligible.map((row) => row._id) },
    },
    { $set: { updatedAt: now } },
    { session }
  );
  const changed = await db.collection<Election>("elections").updateMany(
    {
      _id: { $in: eligible.map((row) => row._id) },
      status: { $in: ["active", "upcoming"] },
      "hungarianAssemblyRound.round": 1,
    },
    { $set: { "hungarianAssemblyRound.electoralLaw": "mixed-1994-v1", updatedAt: now } },
    { session }
  );
  if (changed.matchedCount !== eligible.length)
    throw new Hu1994ElectoralConflict("Primary cohort changed during electoral authorization");
}

export async function loadHu1994ElectoralDecision(db: Db, game: Calendar, turn: number) {
  if (game.preset !== "1991-default") return null;
  const allowed = await availability(db, game, turn);
  const proposal = await db
    .collection<Hu1994ElectoralProposal>(HU_1994_PROPOSALS_COLLECTION)
    .findOne({ _id: ID });
  const bill = proposal
    ? await db
        .collection<Bill>("bills")
        .findOne({ _id: proposal.billId }, { projection: { status: 1 } })
    : null;
  return {
    kind: "threshold1994" as const,
    ...allowed,
    proposal: proposal
      ? {
          billId: proposal.billId.toHexString(),
          revision: proposal.revision,
          status: proposal.status,
          reason: proposal.reason,
          billStatus: bill?.status ?? null,
          canRevise: allowed.available && bill?.status === "failed",
        }
      : null,
  };
}

export async function processHu1994ElectoralMandate(
  db: Db,
  game: Calendar,
  turn: number,
  now: Date
) {
  if (game.preset !== "1991-default") return false;
  const proposal = await db
    .collection<Hu1994ElectoralProposal>(HU_1994_PROPOSALS_COLLECTION)
    .findOne({ _id: ID, status: "open" }, { projection: { billId: 1 } });
  if (
    !proposal ||
    !(await db
      .collection<Bill>("bills")
      .findOne({ _id: proposal.billId, status: "signed" }, { projection: { _id: 1 } }))
  )
    return false;
  return runRequiredTransaction(
    (session) => authorizeHu1994ElectoralProposal(db, game, turn, now, session),
    { client: db.client }
  );
}
