/**
 * Hungary's 2011 electoral system opens a normal parliamentary bill after
 * its date. Only its bound enacted vote authorizes the smaller Assembly
 * for later campaigns; rejected decisions remain visible and can be revised by legislators.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Bill, Character, CountryGameState, GameState } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { calendarTurn } from "@/lib/utils/gameDate";
import { passesHuElectoralAmendment } from "./rules/electoralLaw";
import { hu2011DecisionAvailability } from "./rules/electoralTransition2011";
import type { CountryState } from "@/lib/db/types/countryState";

export const HU_2011_PROPOSALS_COLLECTION = "hu2011ElectoralProposals";
const ID = "1991-default:hu-electoral:system2011";
type Calendar = Pick<
  GameState,
  "preset" | "preIteration" | "preIterationTurns" | "huAssemblyReformedAtYear"
>;
export interface Hu2011ElectoralProposal {
  _id: string;
  billId: ObjectId;
  revision: number;
  openedOnTurn: number;
  status: "open" | "authorized";
  reason: "legislator_proposal" | "npc_government_supermajority_mandate";
  authorizedOnTurn?: number;
  createdAt: Date;
}
export class Hu2011ElectoralConflict extends Error {}

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
    .findOne({ _id: "HU" }, { session, projection: { huElectoralSystem2011SinceTurn: 1 } });
  return hu2011DecisionAvailability({
    preset: current?.preset,
    calendarTurn: calendarTurn(turn, {
      preIterationActive: game.preIteration?.active,
      preIterationTurns: game.preIterationTurns,
    }),
    authorizedTurn: country?.huElectoralSystem2011SinceTurn,
    modernAssemblyYear: current?.huAssemblyReformedAtYear ?? game.huAssemblyReformedAtYear,
    hasParliament: !runtime || runtime.governmentType === "parliamentaryRepublic",
  });
}

export async function materializeHu2011ElectoralProposal(input: {
  db: Db;
  session: ClientSession;
  game: Calendar;
  turn: number;
  now: Date;
  sponsor: Pick<Character, "_id" | "name"> | null;
  sponsorParty?: string;
  reason?: Hu2011ElectoralProposal["reason"];
  newBillId?: ObjectId;
}): Promise<Hu2011ElectoralProposal> {
  const { db, session, game, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Hungarian electoral proposal needs a transaction, turn and time");
  const allowed = await availability(db, game, turn, session);
  if (!allowed.available) throw new Hu2011ElectoralConflict(allowed.reason);
  const proposals = db.collection<Hu2011ElectoralProposal>(HU_2011_PROPOSALS_COLLECTION);
  const prior = await proposals.findOne({ _id: ID }, { session });
  if (prior) {
    if (!Number.isSafeInteger(prior.revision) || prior.revision < 1)
      throw new Hu2011ElectoralConflict("Invalid electoral proposal revision");
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
      bill.hungarianElectoralMandate.kind !== "system2011"
    )
      throw new Hu2011ElectoralConflict("Electoral proposal no longer matches its bill");
    if (bill.status !== "failed") return prior;
  }
  const proposal: Hu2011ElectoralProposal = {
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
    title: "Hungarian 2011 Electoral System Decision",
    summary:
      "Authorize 106 single-round constituency seats and 93 national-list seats for later untouched campaigns, from January 2012. Single-party national-list eligibility is at least five percent, with winner-surplus compensation. Two-thirds of attending deputies must approve, with more than half the 386-seat Assembly attending. The existing Assembly keeps its mandates until a complete new election is seated. Existing general ballots and certified results retain their frozen rules.",
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
      kind: "system2011",
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
    throw new Hu2011ElectoralConflict("Electoral proposal changed");
  await db.collection<Bill>("bills").insertOne(bill, { session });
  return proposal;
}

export async function openHu2011ElectoralProposal(
  input: Omit<Parameters<typeof materializeHu2011ElectoralProposal>[0], "session">
) {
  const newBillId = input.newBillId ?? new ObjectId();
  return runRequiredTransaction(
    (session) => materializeHu2011ElectoralProposal({ ...input, newBillId, session }),
    { client: input.db.client }
  );
}

export async function authorizeHu2011ElectoralProposal(
  db: Db,
  game: Calendar,
  turn: number,
  now: Date,
  session: ClientSession
) {
  if (!session.inTransaction())
    throw new Error("Hungarian electoral authorization needs a transaction");
  const proposals = db.collection<Hu2011ElectoralProposal>(HU_2011_PROPOSALS_COLLECTION);
  const proposal = await proposals.findOne({ _id: ID, status: "open" }, { session });
  if (!proposal || !(await availability(db, game, turn, session)).available) return false;
  if (
    !Number.isSafeInteger(proposal.revision) ||
    proposal.revision < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Hu2011ElectoralConflict("Invalid electoral authorization revision or clock");
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
    bill.hungarianElectoralMandate.kind !== "system2011"
  )
    return false;
  if (!bill.voteSnapshot || !passesHuElectoralAmendment(bill.voteSnapshot.totals, 386))
    throw new Hu2011ElectoralConflict(
      "Enacted amendment lacks a quorate frozen parliamentary result"
    );
  await db
    .collection<CountryGameState>("countryGameStates")
    .updateOne(
      { _id: "HU", huElectoralSystem2011SinceTurn: { $exists: false } },
      { $set: { huElectoralSystem2011SinceTurn: turn } },
      { session, upsert: true }
    );
  const updated = await proposals.updateOne(
    { _id: ID, status: "open", revision: proposal.revision },
    { $set: { status: "authorized", authorizedOnTurn: turn } },
    { session }
  );
  if (updated.modifiedCount !== 1)
    throw new Hu2011ElectoralConflict("Electoral authorization changed");
  return true;
}

export async function loadHu2011ElectoralDecision(db: Db, game: Calendar, turn: number) {
  if (game.preset !== "1991-default") return null;
  const allowed = await availability(db, game, turn);
  const proposal = await db
    .collection<Hu2011ElectoralProposal>(HU_2011_PROPOSALS_COLLECTION)
    .findOne({ _id: ID });
  const bill = proposal
    ? await db
        .collection<Bill>("bills")
        .findOne({ _id: proposal.billId }, { projection: { status: 1 } })
    : null;
  return {
    kind: "system2011" as const,
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

export async function processHu2011ElectoralMandate(
  db: Db,
  game: Calendar,
  turn: number,
  now: Date
) {
  if (game.preset !== "1991-default") return false;
  const proposal = await db
    .collection<Hu2011ElectoralProposal>(HU_2011_PROPOSALS_COLLECTION)
    .findOne({ _id: ID, status: "open" }, { projection: { billId: 1 } });
  if (
    !proposal ||
    !(await db
      .collection<Bill>("bills")
      .findOne({ _id: proposal.billId, status: "signed" }, { projection: { _id: 1 } }))
  )
    return false;
  return runRequiredTransaction(
    (session) => authorizeHu2011ElectoralProposal(db, game, turn, now, session),
    { client: db.client }
  );
}
