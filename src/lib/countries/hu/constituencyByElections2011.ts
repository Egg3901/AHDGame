/**
 * Modern Hungarian constituency vacancies open one plurality ballot per seat.
 * Frozen district identities, registration and the original Assembly term
 * prevent a vacancy from recalculating national-list awards or creating owners.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectedOfficial,
  ElectionVoteTally,
  GameState,
  NPP,
  State,
  StateRegistrationPool,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { scalePoolToRegistered } from "@/lib/electionEngine/rules/registration";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { HU_2011_COUNTS_COLLECTION, type Hu2011AssemblyRecord } from "./assemblyCount2011";
import type {
  HuModernByElectionBallot,
  HuModernByElectionCount,
} from "./rules/constituencyByElection2011";

export const HU_2011_BY_ELECTIONS_COLLECTION = "hu2011ConstituencyByElections";
export interface HuModernByElectionRecord {
  _id: string;
  parentReceiptId: string;
  cycle: number;
  generation: number;
  constituencies: readonly { id: string; regionId: string }[];
  districtIds: string[];
  electionIds: string[];
  openedAtTurn: number;
  termEndTurn: number;
  termEnds: Date;
  completedAtTurn?: number;
  ballots?: HuModernByElectionBallot[];
  count?: HuModernByElectionCount;
  officialIds?: ObjectId[];
}
function stableId(key: string): ObjectId {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}
function assertTransaction(session: ClientSession, turn: number, now: Date): void {
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Modern Hungarian vacancy needs a transaction, turn and time");
}
async function cancelJobs(
  db: Db,
  session: ClientSession,
  jobs: readonly HuModernByElectionRecord[],
  turn: number,
  now: Date
) {
  if (!jobs.length) return;
  const ids = jobs.flatMap((job) => job.electionIds.map((id) => new ObjectId(id)));
  await db
    .collection<HuModernByElectionRecord>(HU_2011_BY_ELECTIONS_COLLECTION)
    .updateMany(
      { _id: { $in: jobs.map((job) => job._id) }, completedAtTurn: { $exists: false } },
      { $set: { completedAtTurn: turn } },
      { session }
    );
  await db
    .collection<Election>("elections")
    .updateMany(
      { _id: { $in: ids } },
      { $set: { status: "cancelled", resolving: false, updatedAt: now } },
      { session }
    );
  await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { electionId: { $in: ids }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } },
      { session }
    );
}
export async function materializeHuModernByElectionOpening(input: {
  db: Db;
  session: ClientSession;
  turn: number;
  now: Date;
}): Promise<string[]> {
  const { db, session, turn, now } = input;
  assertTransaction(session, turn, now);
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, huAssemblyReformedAtYear: 1 } }
    );
  if (game?.preset !== "1991-default" || game.huAssemblyReformedAtYear == null) return [];
  const parent = await db.collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION).findOne(
    { seatedAtTurn: { $exists: true } },
    {
      session,
      sort: { seatedAtTurn: -1 },
      projection: {
        cycle: 1,
        seatedAt: 1,
        seatedAtTurn: 1,
        constituencies: 1,
        installed: 1,
        nominees: 1,
        constituencyByElectionGeneration: 1,
      },
    }
  );
  if (!parent || parent.seatedAtTurn == null || !parent.seatedAt) return [];
  const journal = db.collection<HuModernByElectionRecord>(HU_2011_BY_ELECTIONS_COLLECTION);
  const pending = await journal
    .find({ completedAtTurn: { $exists: false } }, { session })
    .toArray();
  const obsolete = pending.filter(
    (job) => job.parentReceiptId !== parent._id || turn >= job.termEndTurn
  );
  await cancelJobs(db, session, obsolete, turn, now);
  const live = pending.find((job) => job.parentReceiptId === parent._id && turn < job.termEndTurn);
  if (live) return live.electionIds;
  if (turn + 4 >= parent.seatedAtTurn + 192) return [];
  const districts =
    parent.constituencies ??
    parent.installed.mandates
      .filter((row) => row.tier === "constituency")
      .map((row) => ({ id: row.districtId, regionId: row.regionId }));
  if (districts.length !== 106 || new Set(districts.map((row) => row.id)).size !== 106) return [];
  const held = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      {
        countryId: "HU",
        officeType: "assemblyDelegate",
        "hungarianAssemblyMandate.receiptId": parent._id,
      },
      {
        session,
        projection: {
          constituencyId: 1,
          hungarianAssemblyMandate: 1,
          characterId: 1,
          nppId: 1,
          termEnds: 1,
        },
      }
    )
    .toArray();
  const occupied = new Set(
    held
      .filter(
        (row) =>
          (row.characterId || row.nppId) && row.hungarianAssemblyMandate?.tier === "constituency"
      )
      .map((row) => row.constituencyId)
  );
  const vacant = districts.filter((row) => !occupied.has(row.id));
  if (!vacant.length) return [];
  const upcoming = await db.collection<Election>("elections").findOne(
    {
      countryId: "HU",
      electionType: "nationalAssembly",
      cycle: { $ne: parent.cycle },
      status: { $in: ["active", "upcoming", "completed"] },
      hungarianModernByElection: { $exists: false },
      endTurn: { $lte: turn + 4 },
    },
    { session, projection: { _id: 1 } }
  );
  if (upcoming) return [];
  const states = await db
    .collection<State>("states")
    .find(
      { countryId: "HU" },
      {
        session,
        projection: { population: 1, votingEligiblePopulation: 1 },
      }
    )
    .toArray();
  const pools = await db
    .collection<StateRegistrationPool>("stateRegistrationPool")
    .find(
      { countryId: "HU" },
      {
        session,
        projection: { stateId: 1, unregistered: 1 },
      }
    )
    .toArray();
  const register: Record<string, number> = {};
  for (const regionId of new Set(vacant.map((row) => row.regionId))) {
    const state = states.find((row) => String(row._id) === regionId);
    if (!state) throw new Error("Modern Hungarian vacancy lacks its authoritative region");
    const regional = Math.floor(
      scalePoolToRegistered(
        state.votingEligiblePopulation ?? state.population,
        pools.find((row) => row.stateId === regionId)?.unregistered
      )
    );
    const local = districts.filter((row) => row.regionId === regionId);
    const shares = apportionSeats(regional, Object.fromEntries(local.map((row) => [row.id, 1])));
    Object.assign(register, shares);
  }
  if (vacant.some((row) => !Number.isSafeInteger(register[row.id]) || register[row.id] < 1))
    throw new Error("Modern Hungarian vacancy has an invalid district electorate");
  const owners = await db
    .collection<NPP>("npps")
    .find(
      {
        _id: {
          $in: parent.nominees.filter((row) => row.isNpc).map((row) => new ObjectId(row.ownerId)),
        },
        countryId: "HU",
        retiredAt: null,
        isTechnocrat: { $ne: true },
      },
      { session, projection: { party: 1, name: 1, currentOffice: 1 } }
    )
    .toArray();
  const generation = (parent.constituencyByElectionGeneration ?? 0) + 1;
  const id = `${parent._id}:by-election:${generation}`;
  const termEnds =
    held.find((row) => row.termEnds)?.termEnds ??
    new Date(parent.seatedAt.getTime() + 192 * MS_PER_TURN);
  const polls: Election[] = vacant.map((district) => ({
    _id: stableId(`${id}:district:${district.id}`),
    countryId: "HU",
    electionType: "nationalAssembly",
    state: district.regionId,
    seatId: district.id,
    cycle: parent.cycle,
    totalSeats: 1,
    status: "active",
    startTurn: turn,
    primaryEndTurn: turn + 2,
    endTurn: turn + 4,
    startTime: now,
    primaryEndTime: new Date(now.getTime() + 2 * MS_PER_TURN),
    endTime: new Date(now.getTime() + 4 * MS_PER_TURN),
    durationHours: 4,
    primaryDurationHours: 2,
    createdAt: now,
    updatedAt: now,
    hungarianModernByElection: {
      receiptId: id,
      parentReceiptId: parent._id,
      districtId: district.id,
      registeredVoters: register[district.id],
    },
  }));
  const candidates: ElectionCandidate[] = [];
  for (const poll of polls) {
    const parties = new Set<string>();
    for (const nominee of parent.nominees.filter(
      (row) => row.isNpc && row.regionId === poll.state
    )) {
      const owner = owners.find((row) => row._id.toHexString() === nominee.ownerId);
      if (
        !owner ||
        owner.party !== nominee.party ||
        parties.has(owner.party) ||
        (owner.currentOffice &&
          !["assemblyDelegate", "assemblyDeputy", "primeMinister"].includes(
            owner.currentOffice.type
          ))
      )
        continue;
      parties.add(owner.party);
      candidates.push({
        _id: stableId(`${id}:candidate:${poll.seatId}:${owner._id}`),
        electionId: poll._id,
        countryId: "HU",
        characterId: owner._id,
        nppId: owner._id,
        isNPP: true,
        party: owner.party,
        characterName: owner.name ?? nominee.name,
        status: "active",
        enteredAt: now,
      });
    }
  }
  const chamberLock = await db
    .collection<{ _id: string; hu1991MandateGeneration?: number }>("governmentFormations")
    .updateOne({ _id: "HU" }, { $inc: { hu1991MandateGeneration: 1 } }, { session });
  if (chamberLock.matchedCount !== 1)
    throw new Error("Modern Hungarian chamber authority is missing");
  const claim = await db
    .collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION)
    .updateOne(
      {
        _id: parent._id,
        constituencyByElectionGeneration: parent.constituencyByElectionGeneration ?? {
          $exists: false,
        },
      },
      { $set: { constituencyByElectionGeneration: generation } },
      { session }
    );
  if (claim.modifiedCount !== 1)
    throw new Error("Modern Hungarian vacancy opening changed concurrently");
  const electionIds = polls.map((row) => row._id.toHexString());
  await journal.insertOne(
    {
      _id: id,
      parentReceiptId: parent._id,
      cycle: parent.cycle,
      generation,
      constituencies: districts,
      districtIds: vacant.map((row) => row.id),
      electionIds,
      openedAtTurn: turn,
      termEndTurn: parent.seatedAtTurn + 192,
      termEnds,
    },
    { session }
  );
  await db.collection<Election>("elections").insertMany(polls, { session });
  if (candidates.length)
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .insertMany(candidates, { session });
  await db.collection<ElectionVoteTally>("electionVoteTallies").insertMany(
    polls.map((poll) => ({
      _id: stableId(`${id}:tally:${poll.seatId}`),
      electionId: poll._id,
      state: poll.state,
      totalVotes: {},
      candidateParties: {},
      finalized: false,
      lastUpdatedTurn: turn,
      createdAt: now,
      updatedAt: now,
    })),
    { session }
  );
  return electionIds;
}
export async function openHuModernByElections(db: Db, turn: number, now: Date): Promise<string[]> {
  const parent = await db
    .collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION)
    .findOne({ seatedAtTurn: { $exists: true } }, { projection: { _id: 1 } });
  if (!parent) return [];
  return runRequiredTransaction(
    (session) => materializeHuModernByElectionOpening({ db, session, turn, now }),
    { client: db.client }
  );
}
