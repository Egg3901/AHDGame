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
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";
import {
  passesBgConstitution1991,
  bg1991DecisionAvailability,
} from "./rules/constitutionalDecision1991";

import { BG_ORDINARY_ASSEMBLY_SEATS } from "./rules/assemblyTransition";
import type { CountryState } from "@/lib/db/types/countryState";
import { loadBg1991Initiative, signBg1991Initiative } from "./constitutionalInitiative1991";
import { BG_FOUNDING_COUNTS_COLLECTION, type BgFoundingAssemblyRecord } from "./foundingCount1990";
import { planBg1991AssemblyClock } from "./rules/assemblyClock1991";
import { turnToWallClock } from "@/lib/elections/canonicalCycle";
import { canRebindBg1991PrimaryCohort } from "./rules/primaryHandover1991";

export const BG_1991_PROPOSALS_COLLECTION = "bg1991ConstitutionalProposals";
const ID = "1991-default:bg-constitutional:constitution1991";
type Calendar = Pick<GameState, "preset" | "preIteration" | "preIterationTurns">;
export interface Bg1991ConstitutionalProposal {
  _id: string;
  billId: ObjectId;
  revision: number;
  openedOnTurn: number;
  status: "open" | "authorized";
  reason: "executive_proposal" | "npc_government_constituent_mandate" | "deputy_quarter_initiative";
  authorizedOnTurn?: number;
  capacity: number;
  createdAt: Date;
}
export class Bg1991ConstitutionalConflict extends Error {}

async function availability(db: Db, game: Calendar, turn: number, session?: ClientSession) {
  const current = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  const runtime = await db
    .collection<CountryState>("countryState")
    .findOne({ _id: "BG" }, { session, projection: { governmentType: 1 } });
  const country = await db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "BG" },
    {
      session,
      projection: {
        bgConstitution1991SinceTurn: 1,
        bgOrdinaryAssemblySinceTurn: 1,
        dissolvedTurn: 1,
      },
    }
  );
  return bg1991DecisionAvailability({
    preset: current?.preset,
    calendarTurn: calendarTurn(turn, {
      preIterationActive: current?.preIteration?.active,
      preIterationTurns: current?.preIterationTurns,
    }),
    authorizedTurn: country?.bgConstitution1991SinceTurn,
    completedTurn: country?.bgOrdinaryAssemblySinceTurn,
    hasParliament:
      country?.dissolvedTurn == null &&
      (!runtime || runtime.governmentType === "parliamentaryRepublic"),
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
    const bill = await db.collection<Bill>("bills").findOne(
      { _id: prior.billId },
      {
        session,
        projection: {
          countryId: 1,
          status: 1,
          bulgarianConstitutionalMandate: 1,
          "voteSnapshot.resolvedAtTurn": 1,
        },
      }
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
    if (turn < prior.openedOnTurn || (bill.voteSnapshot && turn < bill.voteSnapshot.resolvedAtTurn))
      throw new Bg1991ConstitutionalConflict(
        "A revised draft cannot precede the previous decision"
      );
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
  let sponsorParty = input.sponsorParty;
  if (input.reason === "deputy_quarter_initiative") {
    if (
      !input.sponsor ||
      !(await loadBg1991Initiative(db, (prior?.revision ?? 0) + 1, session)).canIntroduce
    )
      throw new Bg1991ConstitutionalConflict(
        "One hundred constituent deputies must endorse this draft"
      );
    const deputy = await db.collection("electedOfficials").findOne(
      {
        countryId: "BG",
        characterId: input.sponsor._id,
        officeType: "assemblyDeputy",
        seatsHeld: { $ne: 0 },
      },
      { session, projection: { _id: 1, party: 1 } }
    );
    if (!deputy)
      throw new Bg1991ConstitutionalConflict(
        "A seated constituent deputy must introduce the collective draft"
      );
    sponsorParty = typeof deputy.party === "string" ? deputy.party : undefined;
  } else if (input.sponsor) {
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
      "Authorize the ordinary 240-seat National Assembly with a two-thirds vote of all 400 constituent deputies. The government, President or a quarter of constituent deputies introduces the draft. Existing cast ballots retain their frozen rules.",
    originChamber: "nationalAssembly",
    currentChamber: "nationalAssembly",
    sponsorId: input.sponsor?._id ?? null,
    sponsorName: input.sponsor?.name ?? "Bulgarian Government",
    ...(sponsorParty ? { sponsorParty } : {}),
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

export async function endorseBg1991ConstitutionalInitiative(
  input: Omit<Parameters<typeof materializeBg1991ConstitutionalProposal>[0], "session">
) {
  if (!Number.isFinite(input.now.getTime()))
    throw new Error("Constituent initiative needs a valid time");
  if (!input.sponsor)
    throw new Bg1991ConstitutionalConflict(
      "A seated constituent deputy must endorse this initiative"
    );
  const sponsor = input.sponsor;
  return runRequiredTransaction(
    async (session) => {
      const allowed = await availability(input.db, input.game, input.turn, session);
      if (!allowed.available) throw new Bg1991ConstitutionalConflict(allowed.reason);
      const prior = await input.db
        .collection<Bg1991ConstitutionalProposal>(BG_1991_PROPOSALS_COLLECTION)
        .findOne(
          { _id: ID },
          { session, projection: { revision: 1, billId: 1, status: 1, openedOnTurn: 1 } }
        );
      if (prior) {
        const bill = await input.db
          .collection<Bill>("bills")
          .findOne(
            { _id: prior.billId },
            { session, projection: { status: 1, "voteSnapshot.resolvedAtTurn": 1 } }
          );
        if (!bill || !["failed", "vetoed", "override_failed"].includes(bill.status))
          throw new Bg1991ConstitutionalConflict(
            "The current draft must resolve before another initiative"
          );
        if (
          input.turn < prior.openedOnTurn ||
          (bill.voteSnapshot && input.turn < bill.voteSnapshot.resolvedAtTurn)
        )
          throw new Bg1991ConstitutionalConflict(
            "A revised draft cannot precede the previous decision"
          );
      }
      const revision = (prior?.revision ?? 0) + 1;
      const initiative = await signBg1991Initiative({
        db: input.db,
        session,
        revision,
        turn: input.turn,
        characterId: sponsor._id,
      });
      const proposal = initiative.canIntroduce
        ? await materializeBg1991ConstitutionalProposal({
            ...input,
            sponsor,
            session,
            reason: "deputy_quarter_initiative",
          })
        : null;
      return { initiative, proposal };
    },
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
  await rebindBg1991PrimaryCohort(db, game, turn, now, session);
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
    initiative: await loadBg1991Initiative(
      db,
      proposal && bill && !["failed", "vetoed", "override_failed"].includes(bill.status)
        ? proposal.revision
        : (proposal?.revision ?? 0) + 1
    ),
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
async function rebindBg1991PrimaryCohort(
  db: Db,
  game: Calendar,
  turn: number,
  now: Date,
  session: ClientSession
) {
  const clock = planBg1991AssemblyClock({
    currentTurn: turn,
    authorized: true,
    previousOrdinary: false,
  });
  if (clock.kind !== "ordinary-first") throw new Error("Invalid Bulgarian transition clock");
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
        projection: {
          cycle: 1,
          state: 1,
          electionType: 1,
          primaryEndTurn: 1,
          primaryEndTime: 1,
          bulgarianFoundingRound: 1,
        },
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
  const receipts = polls.length
    ? await db
        .collection<BgFoundingAssemblyRecord>(BG_FOUNDING_COUNTS_COLLECTION)
        .find(
          { _id: { $in: [...new Set(polls.map((row) => `BG:founding1990:${row.cycle}`))] } },
          { session, projection: { _id: 1 } }
        )
        .toArray()
    : [];
  const certifiedReceiptIds = new Set(receipts.map((row) => row._id));
  const reboundIds: ObjectId[] = [];
  const updates: AnyBulkWriteOperation<Election>[] = [
    ...new Set(polls.map((row) => row.cycle)),
  ].flatMap((cycle) => {
    const cohort = polls.filter((row) => row.cycle === cycle);
    if (
      !canRebindBg1991PrimaryCohort({
        polls: cohort.map((row) => ({
          id: row._id.toHexString(),
          state: row.state,
          cycle: row.cycle,
          primaryEndTurn: row.primaryEndTurn,
          primaryEndTimeMs: row.primaryEndTime?.getTime(),
          foundingRound: row.bulgarianFoundingRound?.round,
          receiptId: row.bulgarianFoundingRound?.receiptId,
          ruleVersion: row.bulgarianFoundingRound?.ruleVersion,
        })),
        tallies: cohort.flatMap((row) => {
          const tally = byPoll.get(row._id.toHexString());
          return tally
            ? [
                {
                  electionId: row._id.toHexString(),
                  finalized: tally.finalized,
                  votes: [
                    ...Object.values(tally.totalVotes ?? {}),
                    ...Object.values(tally.turnSnapshots?.[0]?.cumulativeVotes ?? {}),
                  ],
                },
              ]
            : [];
        }),
        hasCertifiedReceipt: certifiedReceiptIds.has(`BG:founding1990:${cycle}`),
        turn,
        nowMs: now.getTime(),
      })
    )
      return [];
    reboundIds.push(...cohort.map((row) => row._id));
    return cohort.map((row) => ({
      updateOne: {
        filter: { _id: row._id, status: { $in: ["active", "upcoming"] } },
        update: {
          $set: {
            totalSeats: BG_ORDINARY_ASSEMBLY_SEATS[row.state],
            status: "active",
            startTurn: clock.startTurn,
            primaryEndTurn: clock.primaryEndTurn,
            endTurn: clock.endTurn,
            shiftedScheduleEndTurn: clock.endTurn,
            startTime: now,
            primaryEndTime: turnToWallClock(clock.primaryEndTurn, now, turn),
            endTime: turnToWallClock(clock.endTurn, now, turn),
            electionYear: turnToGameMonth(
              calendarTurn(clock.endTurn, {
                preIterationActive: game.preIteration?.active,
                preIterationTurns: game.preIterationTurns,
              }),
              1991
            ).year,
            durationHours: clock.endTurn - clock.startTurn,
            primaryDurationHours: clock.primaryEndTurn - clock.startTurn,
            updatedAt: now,
          },
          $unset: { bulgarianFoundingRound: "" },
        },
      },
    }));
  });
  if (updates.length) {
    await db.collection<Election>("elections").bulkWrite(updates, { session });
    await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .updateMany(
        { electionId: { $in: reboundIds } },
        { $unset: { bulgarianFoundingBallot: "" } },
        { session }
      );
  }
}
