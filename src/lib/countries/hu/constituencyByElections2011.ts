/**
 * Modern Hungarian constituency vacancies open one plurality ballot per seat.
 * Frozen district identities, registration and the original Assembly term
 * prevent a vacancy from recalculating national-list awards or creating owners.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import {
  countHuModernByElection,
  type HuModernByElectionBallot,
  type HuModernByElectionCount,
} from "./rules/constituencyByElection2011";
import type {
  Character,
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
  unavailableWinnerIds?: string[];
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
  const claim = await db.collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION).updateOne(
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
      candidateNames: {},
      turnSnapshots: [],
      finalized: false,
      hungarianAssemblyBallot: true,
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

export async function materializeHuModernByElectionResolution(input: {
  db: Db;
  session: ClientSession;
  receiptId: string;
  turn: number;
  now: Date;
}): Promise<number> {
  const { db, session, receiptId, turn, now } = input;
  assertTransaction(session, turn, now);
  const journal = db.collection<HuModernByElectionRecord>(HU_2011_BY_ELECTIONS_COLLECTION);
  const job = await journal.findOne({ _id: receiptId }, { session });
  if (!job || job.completedAtTurn != null) return 0;
  const chamber = await db
    .collection<{ _id: string; hu1991MandateGeneration?: number }>("governmentFormations")
    .updateOne({ _id: "HU" }, { $inc: { hu1991MandateGeneration: 1 } }, { session });
  if (chamber.matchedCount !== 1) throw new Error("Modern Hungarian chamber authority is missing");
  const parent = await db
    .collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION)
    .findOne(
      { seatedAtTurn: { $exists: true } },
      { session, sort: { seatedAtTurn: -1 }, projection: { _id: 1 } }
    );
  const game = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      session,
      projection: { preset: 1, huAssemblyReformedAtYear: 1 },
    }
  );
  if (
    game?.preset !== "1991-default" ||
    game.huAssemblyReformedAtYear == null ||
    parent?._id !== job.parentReceiptId ||
    turn >= job.termEndTurn
  ) {
    await cancelJobs(db, session, [job], turn, now);
    return job.electionIds.length;
  }
  const ids = job.electionIds.map((id) => new ObjectId(id));
  const polls = await db
    .collection<Election>("elections")
    .find(
      { _id: { $in: ids } },
      {
        session,
        projection: { hungarianModernByElection: 1, state: 1, status: 1, endTurn: 1 },
      }
    )
    .toArray();
  if (
    polls.length !== ids.length ||
    polls.some((row) => row.status !== "completed" || row.endTurn == null || row.endTurn > turn)
  )
    return 0;
  if (
    polls.some(
      (row) =>
        row.hungarianModernByElection?.receiptId !== job._id ||
        row.hungarianModernByElection.parentReceiptId !== job.parentReceiptId ||
        !job.districtIds.includes(row.hungarianModernByElection.districtId)
    )
  )
    throw new Error("Modern Hungarian vacancy ballot lost its frozen authority");
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: { $in: ids } },
      {
        session,
        projection: {
          electionId: 1,
          characterId: 1,
          nppId: 1,
          isNPP: 1,
          party: 1,
          status: 1,
          characterName: 1,
        },
      }
    )
    .toArray();
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find(
      { electionId: { $in: ids } },
      {
        session,
        projection: { electionId: 1, totalVotes: 1, candidateParties: 1, finalized: 1 },
      }
    )
    .toArray();
  if (tallies.length !== ids.length || tallies.some((row) => row.finalized))
    throw new Error("Modern Hungarian vacancy lacks its unfinalized ballot");
  const ballots = polls.map((poll): HuModernByElectionBallot => ({
    districtId: poll.hungarianModernByElection!.districtId,
    registeredVoters: poll.hungarianModernByElection!.registeredVoters,
    candidates: Object.entries(
      tallies.find((row) => row.electionId.equals(poll._id))!.totalVotes ?? {}
    ).map(([personId, votes]) => ({ personId, votes })),
  }));
  const count = countHuModernByElection(
    job.constituencies.map((row) => row.id),
    job.districtIds,
    ballots
  );
  const held = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "HU", officeType: "assemblyDelegate" },
      {
        session,
        projection: {
          state: 1,
          party: 1,
          characterId: 1,
          nppId: 1,
          constituencyId: 1,
          hungarianAssemblyMandate: 1,
        },
      }
    )
    .toArray();
  const npcs = await db
    .collection<NPP>("npps")
    .find(
      { countryId: "HU", retiredAt: null, isTechnocrat: { $ne: true } },
      {
        session,
        projection: { party: 1, currentOffice: 1 },
      }
    )
    .toArray();
  const players = await db
    .collection<Character>("characters")
    .find(
      {
        countryId: "HU",
        federationPendingResidenceId: { $exists: false },
        $or: [
          { _id: { $in: candidates.filter((row) => !row.isNPP).map((row) => row.characterId) } },
          { "currentOffice.type": { $in: ["assemblyDelegate", "assemblyDeputy"] } },
        ],
      },
      { session, projection: { party: 1, currentOffice: 1, userId: 1 } }
    )
    .toArray();
  const owners = new Map([...npcs, ...players].map((row) => [row._id.toHexString(), row]));
  const playerWinners = new Set<string>();
  const officials: ElectedOfficial[] = [];
  for (const [districtId, winnerId] of Object.entries(count.winners)) {
    if (!winnerId) continue;
    const candidate = candidates.find((row) => row._id.toHexString() === winnerId);
    const ownerId = (
      candidate?.isNPP ? (candidate.nppId ?? candidate.characterId) : candidate?.characterId
    )?.toHexString();
    const owner = ownerId ? owners.get(ownerId) : undefined;
    const tally = candidate
      ? tallies.find((row) => row.electionId.equals(candidate.electionId))
      : undefined;
    if (
      !candidate ||
      candidate.status !== "active" ||
      !ownerId ||
      !owner ||
      owner.party !== candidate.party ||
      tally?.candidateParties[winnerId] !== candidate.party ||
      (owner.currentOffice &&
        !["assemblyDelegate", "assemblyDeputy", "primeMinister"].includes(owner.currentOffice.type))
    )
      continue;
    if (
      !candidate.isNPP &&
      (held.some((row) => row.characterId?.equals(candidate.characterId)) ||
        playerWinners.has(ownerId))
    )
      continue;
    if (
      held.some(
        (row) =>
          row.hungarianAssemblyMandate?.tier === "constituency" &&
          row.constituencyId === districtId &&
          (row.characterId || row.nppId)
      )
    )
      throw new Error("Modern Hungarian vacancy is already occupied");
    const district = job.constituencies.find((row) => row.id === districtId)!;
    const poll = polls.find((row) => row.hungarianModernByElection?.districtId === districtId)!;
    if (!candidate.electionId.equals(poll._id))
      throw new Error("Modern Hungarian winner crossed district ballots");
    if (!candidate.isNPP) playerWinners.add(ownerId);
    officials.push({
      _id: stableId(`${job.parentReceiptId}:by-election:${districtId}:${job.generation}`),
      countryId: "HU",
      officeType: "assemblyDelegate",
      state: district.regionId,
      characterId: candidate.isNPP ? null : candidate.characterId,
      nppId: candidate.isNPP ? new ObjectId(ownerId) : null,
      isNPP: !!candidate.isNPP,
      characterName: candidate.characterName,
      party: candidate.party,
      seatsHeld: 1,
      constituencyId: districtId,
      seatSource: "direct",
      electedAt: now,
      termEnds: job.termEnds,
      createdAt: now,
      updatedAt: now,
      hungarianAssemblyMandate: {
        receiptId: job.parentReceiptId,
        personId: winnerId,
        tier: "constituency",
        districtId,
        rootCandidateId: winnerId,
      },
    });
  }
  const tombstones = held.filter(
    (row) =>
      !row.characterId &&
      !row.nppId &&
      row.hungarianAssemblyMandate?.tier === "constituency" &&
      officials.some((winner) => winner.constituencyId === row.constituencyId)
  );
  if (tombstones.length) {
    const originals = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ _id: { $in: tombstones.map((row) => row._id) } }, { session })
      .toArray();
    await db
      .collection<{
        _id: string;
        receiptId: string;
        countryId: string;
        turn: number;
        official: ElectedOfficial;
      }>("hu2011AssemblyOfficeArchives")
      .insertMany(
        originals.map((official) => ({
          _id: `${job._id}:vacancy:${official._id}`,
          receiptId: job._id,
          countryId: "HU",
          turn,
          official,
        })),
        { session }
      );
    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany(
        { _id: { $in: tombstones.map((row) => row._id) }, characterId: null, nppId: null },
        { session }
      );
  }
  if (officials.length)
    await db.collection<ElectedOfficial>("electedOfficials").insertMany(officials, { session });
  const live = [
    ...held.filter((row) => !tombstones.some((old) => old._id.equals(row._id))),
    ...officials,
  ];
  for (const [isNpc, rows] of [
    [true, npcs],
    [false, players],
  ] as const) {
    const operations = rows
      .filter(
        (owner) =>
          officials.some((row) => (isNpc ? row.nppId : row.characterId)?.equals(owner._id)) ||
          ["assemblyDelegate", "assemblyDeputy"].includes(owner.currentOffice?.type ?? "")
      )
      .map((owner) => {
        const personal = live.filter((row) =>
          (isNpc ? row.nppId : row.characterId)?.equals(owner._id)
        );
        return {
          updateOne: {
            filter: { _id: owner._id, countryId: "HU" },
            update: {
              $set: {
                ...(owner.currentOffice?.type === "primeMinister"
                  ? {}
                  : {
                      currentOffice: personal.length
                        ? {
                            type: "assemblyDelegate",
                            state: personal[0].state,
                            seatsHeld: personal.length,
                          }
                        : null,
                    }),
                ...(isNpc ? { seatsHeld: personal.length } : {}),
                updatedAt: now,
              },
            },
          },
        };
      });
    if (operations.length)
      await db.collection(isNpc ? "npps" : "characters").bulkWrite(operations, { session });
  }
  const newlyElected = players.filter((row) => playerWinners.has(row._id.toHexString()));
  if (newlyElected.length) {
    await db.collection<Character>("characters").bulkWrite(
      newlyElected.map((player) => {
        const official = officials.find((row) => row.characterId?.equals(player._id))!;
        return {
          updateOne: {
            filter: { _id: player._id },
            update: {
              $push: {
                careerHistory: {
                  type: "elected" as const,
                  office: { type: "assemblyDelegate", state: official.state, seatsHeld: 1 },
                  officeLabel: "National Assembly Deputy",
                  party: official.party,
                  partyCountryId: "HU",
                  date: now,
                },
              },
            },
          },
        };
      }),
      { session }
    );
    const notices = newlyElected
      .filter((row) => row.userId)
      .map((row) => ({
        _id: stableId(`${job._id}:notice:${row._id}`),
        userId: row.userId,
        type: "general_win",
        title: "National Assembly By-election Won",
        message: "You won a vacant Hungarian constituency for the remainder of this Assembly term.",
        metadata: { countryId: "HU", receiptId: job._id, cycle: job.cycle },
        read: false,
        createdAt: now,
      }));
    if (notices.length) await db.collection("notifications").insertMany(notices, { session });
  }
  await db
    .collection<Election>("elections")
    .updateMany(
      { _id: { $in: ids } },
      { $set: { status: "resolved", resolving: false, updatedAt: now } },
      { session }
    );
  await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { electionId: { $in: ids }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } },
      { session }
    );
  await db.collection<ElectionVoteTally>("electionVoteTallies").bulkWrite(
    polls.map((poll) => {
      const local = candidates.filter((row) => row.electionId.equals(poll._id));
      const winners = officials.filter(
        (row) => row.constituencyId === poll.hungarianModernByElection!.districtId
      );
      return {
        updateOne: {
          filter: { electionId: poll._id },
          update: {
            $set: {
              finalized: true,
              resolvedAtTurn: turn,
              resolutionPath: "hu_statutory_mixed" as const,
              resolvedTotalSeats: winners.length,
              updatedAt: now,
              seatsEstimate: Object.fromEntries(
                local.map((row) => [
                  row._id.toHexString(),
                  winners.some(
                    (winner) =>
                      winner.hungarianAssemblyMandate?.rootCandidateId === row._id.toHexString()
                  )
                    ? 1
                    : 0,
                ])
              ),
              resolvedSeatHolders: winners.map((row) => ({
                identity: `${row.isNPP ? "npp" : "player"}:${row.isNPP ? row.nppId : row.characterId}`,
                party: row.party!,
                seats: 1,
                seatSource: "direct" as const,
              })),
            },
          },
        },
      };
    }),
    { session }
  );
  const committed = await journal.updateOne(
    { _id: job._id, completedAtTurn: { $exists: false } },
    {
      $set: {
        ballots,
        count,
        completedAtTurn: turn,
        officialIds: officials.map((row) => row._id),
        unavailableWinnerIds: Object.values(count.winners).filter(
          (id): id is string =>
            id !== null && !officials.some((row) => row.hungarianAssemblyMandate?.personId === id)
        ),
      },
    },
    { session }
  );
  if (committed.modifiedCount !== 1) throw new Error("Modern Hungarian vacancy receipt changed");
  return ids.length;
}
export async function resolveHuModernByElection(
  db: Db,
  receiptId: string,
  turn: number,
  now: Date
): Promise<number> {
  return runRequiredTransaction(
    (session) => materializeHuModernByElectionResolution({ db, session, receiptId, turn, now }),
    { client: db.client }
  );
}
