/**
 * Hungarian vacant constituencies open bounded by-election campaigns within
 * the existing Assembly term. Existing NPC owners supply distinct nominees;
 * territorial and compensation receipts are never recalculated.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  ElectedOfficial,
  ElectionVoteTally,
  NPP,
  GameState,
  State,
  StateRegistrationPool,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { scalePoolToRegistered } from "@/lib/electionEngine/rules/registration";
import { HU_1991_COUNTS_COLLECTION, type Hu1991AssemblyRecord } from "./assemblyCount1991";
import { HU_1991_CONSTITUENCIES } from "./data/electoralDistricts1991";
import {
  countHu1991ByElection,
  type Hu1991ByElectionBallot,
  type Hu1991ByElectionCount,
} from "./rules/constituencyByElection1991";
import type { Hu1991Nominations } from "./rules/mandates1991";
import { buildHu1991Slates } from "./rules/slates1991";
import {
  projectHu1991CampaignBallots,
  projectHu1991Runoff,
  type Hu1991RegionalCampaign,
} from "./rules/campaignBallots1991";
import { TALLY_WITH_LATEST_SNAPSHOT_ONLY } from "@/lib/electionEngine/tallyProjections";
export const HU_1991_BY_ELECTIONS_COLLECTION = "hu1991ConstituencyByElections";
export interface Hu1991ByElectionRecord {
  _id: string;
  parentReceiptId: string;
  cycle: number;
  generation: number;
  districtIds: string[];
  termEndTurn: number;
  termEnds: Date;
  electionIds: string[];
  activeElectionIds: string[];
  round: 1 | 2;
  regionalRegister: Record<string, number>;
  openedAtTurn: number;
  nominations?: Hu1991Nominations;
  ballots?: Hu1991ByElectionBallot[];
  count?: Hu1991ByElectionCount;
  completedAtTurn?: number;
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
    throw new Error("Hungarian by-election requires a transaction, turn and time");
}
async function cancelByElection(
  db: Db,
  session: ClientSession,
  job: Hu1991ByElectionRecord,
  turn: number,
  now: Date
): Promise<void> {
  const ids = job.electionIds.map((id) => new ObjectId(id));
  await db
    .collection<Hu1991ByElectionRecord>(HU_1991_BY_ELECTIONS_COLLECTION)
    .updateOne(
      { _id: job._id, completedAtTurn: { $exists: false } },
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
export async function materializeHu1991ByElectionOpening(input: {
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
  if (game?.preset !== "1991-default") return [];
  const parent = await db
    .collection<Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
    .findOne({ seatedAtTurn: { $exists: true } }, { session, sort: { seatedAtTurn: -1 } });
  if (!parent?.settled || parent.seatedAtTurn == null) return [];
  const journal = db.collection<Hu1991ByElectionRecord>(HU_1991_BY_ELECTIONS_COLLECTION);
  const modernChamber = game.huAssemblyReformedAtYear != null;
  const superseded = await journal
    .find(
      {
        ...(modernChamber ? {} : { parentReceiptId: { $ne: parent._id } }),
        completedAtTurn: { $exists: false },
      },
      { session, projection: { electionIds: 1 } }
    )
    .toArray();
  if (superseded.length) {
    const ids = superseded.flatMap((row) => row.electionIds.map((id) => new ObjectId(id)));
    await journal.updateMany(
      { _id: { $in: superseded.map((row) => row._id) }, completedAtTurn: { $exists: false } },
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
  if (modernChamber) return [];
  const prior = await journal.findOne(
    { parentReceiptId: parent._id },
    { session, sort: { generation: -1 } }
  );
  if (prior && prior.completedAtTurn == null) {
    if (turn < prior.termEndTurn) return prior.activeElectionIds;
    await cancelByElection(db, session, prior, turn, now);
    return [];
  }
  if (turn + 4 >= parent.seatedAtTurn + 192) return [];
  const ordinary = await db.collection<Election>("elections").findOne(
    {
      countryId: "HU",
      electionType: "nationalAssembly",
      cycle: { $ne: parent.cycle },
      // Perpetual campaigns stay open all term. Only a nearby general
      // election prevents a replacement from completing within this term.
      endTurn: { $lte: turn + 6 },
      status: { $in: ["active", "upcoming"] },
      "hungarianAssemblyRound.byElection": { $exists: false },
    },
    { session, projection: { _id: 1 } }
  );
  if (ordinary) return [];
  if (prior?.completedAtTurn != null && turn < prior.completedAtTurn + 2) return [];
  const officials = await db
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
          characterId: 1,
          nppId: 1,
          termEnds: 1,
          hungarianAssemblyMandate: 1,
        },
      }
    )
    .toArray();
  const held = new Set(
    officials
      .filter((row) => row.characterId || row.nppId)
      .filter((row) => row.hungarianAssemblyMandate?.tier === "constituency")
      .map((row) => row.constituencyId)
  );
  const districtIds = HU_1991_CONSTITUENCIES.map((row) => row.id)
    .filter((id) => !held.has(id))
    .sort();
  if (!districtIds.length) return [];
  const generation = (prior?.generation ?? 0) + 1;
  const receiptId = `${parent._id}:by-election:${generation}`;
  const regions = [
    ...new Set(
      districtIds.map((id) => HU_1991_CONSTITUENCIES.find((row) => row.id === id)!.regionId)
    ),
  ];
  const states = await db
    .collection<State>("states")
    .find(
      { countryId: "HU" },
      { session, projection: { population: 1, votingEligiblePopulation: 1 } }
    )
    .toArray();
  const pools = await db
    .collection<StateRegistrationPool>("stateRegistrationPool")
    .find({ countryId: "HU" }, { session, projection: { stateId: 1, unregistered: 1 } })
    .toArray();
  const regionalRegister = Object.fromEntries(
    parent.firstCampaigns.map((campaign) => {
      const state = states.find((row) => String(row._id) === campaign.regionId);
      if (!state) throw new Error("Hungarian by-election lacks an authoritative region");
      const eligible = state.votingEligiblePopulation ?? state.population;
      const register = Math.floor(
        scalePoolToRegistered(
          eligible,
          pools.find((row) => row.stateId === campaign.regionId)?.unregistered
        )
      );
      if (!Number.isSafeInteger(register) || register < 1)
        throw new Error("Invalid Hungarian by-election electorate");
      return [campaign.regionId, register];
    })
  );
  const npcOwners = [
    ...new Set(
      parent.nominees
        .filter((row) => row.isNpc && regions.includes(row.regionId))
        .map((row) => row.ownerId)
    ),
  ];
  const npcs = await db
    .collection<NPP>("npps")
    .find(
      {
        _id: { $in: npcOwners.map((id) => new ObjectId(id)) },
        countryId: "HU",
        retiredAt: null,
        isTechnocrat: { $ne: true },
      },
      { session, projection: { name: 1, party: 1, currentOffice: 1, homeState: 1 } }
    )
    .toArray();
  const termEnds =
    officials.find((row) => row.termEnds)?.termEnds ??
    new Date(parent.seatedAt!.getTime() + 192 * MS_PER_TURN);
  const polls: Election[] = regions.map((regionId) => ({
    _id: stableId(`${receiptId}:first:${regionId}`),
    countryId: "HU",
    electionType: "nationalAssembly",
    cycle: parent.cycle,
    state: regionId,
    status: "active",
    totalSeats: districtIds.filter(
      (id) => HU_1991_CONSTITUENCIES.find((row) => row.id === id)!.regionId === regionId
    ).length,
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
    hungarianAssemblyRound: {
      ruleVersion: "mixed-1989-v1",
      receiptId,
      round: 1,
      registeredVoters: regionalRegister[regionId],
      byElection: { parentReceiptId: parent._id, districtIds, generation },
    },
  }));
  const candidates: ElectionCandidate[] = [];
  for (const poll of polls) {
    const owners = parent.nominees.filter((row) => row.isNpc && row.regionId === poll.state);
    const partyIds = new Set<string>();
    for (const nominee of owners) {
      const owner = npcs.find((row) => row._id.toHexString() === nominee.ownerId);
      if (
        !owner ||
        owner.party !== nominee.party ||
        partyIds.has(owner.party) ||
        (owner.currentOffice &&
          !["assemblyDelegate", "assemblyDeputy", "primeMinister"].includes(
            owner.currentOffice.type
          ))
      )
        continue;
      partyIds.add(owner.party);
      candidates.push({
        _id: stableId(`${receiptId}:candidate:${poll.state}:${owner.party}`),
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
  const ids = polls.map((row) => row._id.toHexString());
  const claim = await db
    .collection<Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
    .updateOne(
      { _id: parent._id, byElectionGeneration: parent.byElectionGeneration ?? { $exists: false } },
      { $set: { byElectionGeneration: generation } },
      { session }
    );
  if (claim.modifiedCount !== 1)
    throw new Error("Hungarian by-election opening changed concurrently");
  await journal.insertOne(
    {
      _id: receiptId,
      parentReceiptId: parent._id,
      cycle: parent.cycle,
      generation,
      districtIds,
      termEndTurn: parent.seatedAtTurn + 192,
      termEnds,
      electionIds: ids,
      activeElectionIds: ids,
      regionalRegister,
      round: 1,
      openedAtTurn: turn,
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
      _id: stableId(`${receiptId}:tally:${poll.state}`),
      electionId: poll._id,
      state: poll.state,
      totalVotes: {},
      candidateNames: {},
      candidateParties: {},
      turnSnapshots: [],
      finalized: false,
      hungarianAssemblyBallot: true,
      createdAt: now,
      updatedAt: now,
    })),
    { session }
  );
  return ids;
}
export async function openHu1991ByElections(db: Db, turn: number, now: Date): Promise<string[]> {
  // Worlds without a certified native Assembly need no transaction or by-election.
  const parent = await db
    .collection<Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
    .findOne(
      { seatedAtTurn: { $exists: true } },
      { projection: { _id: 1 }, sort: { seatedAtTurn: -1 } }
    );
  if (!parent) return [];
  return runRequiredTransaction((session) =>
    materializeHu1991ByElectionOpening({ db, session, turn, now })
  );
}

export async function materializeHu1991ByElectionResolution(input: {
  db: Db;
  session: ClientSession;
  receiptId: string;
  turn: number;
  now: Date;
}): Promise<number> {
  const { db, session, receiptId, turn, now } = input;
  assertTransaction(session, turn, now);
  const journal = db.collection<Hu1991ByElectionRecord>(HU_1991_BY_ELECTIONS_COLLECTION);
  const job = await journal.findOne({ _id: receiptId }, { session });
  if (!job || job.completedAtTurn != null) return 0;
  const chamberLock = await db
    .collection<{ _id: string; hu1991MandateGeneration?: number }>("governmentFormations")
    .updateOne({ _id: "HU" }, { $inc: { hu1991MandateGeneration: 1 } }, { session });
  if (chamberLock.matchedCount !== 1) throw new Error("Hungarian chamber authority is missing");
  const parent = await db
    .collection<Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
    .findOne({ _id: job.parentReceiptId }, { session });
  if (!parent?.settled || parent.seatedAtTurn == null)
    throw new Error("Hungarian by-election lost its certified parent");
  const latestParent = await db
    .collection<Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
    .findOne(
      { seatedAtTurn: { $exists: true } },
      { session, sort: { seatedAtTurn: -1 }, projection: { _id: 1 } }
    );
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { huAssemblyReformedAtYear: 1 } });
  const currentChamber =
    game?.huAssemblyReformedAtYear == null && latestParent?._id === job.parentReceiptId;
  if (!currentChamber || turn >= job.termEndTurn) {
    await cancelByElection(db, session, job, turn, now);
    return job.electionIds.length;
  }

  const polls = await db
    .collection<Election>("elections")
    .find({ _id: { $in: job.activeElectionIds.map((id) => new ObjectId(id)) } }, { session })
    .toArray();
  if (
    polls.length !== job.activeElectionIds.length ||
    polls.some((row) => row.status !== "completed" || row.endTurn == null || row.endTurn > turn)
  )
    return 0;
  if (
    polls.some(
      (row) =>
        row.hungarianAssemblyRound?.receiptId !== job._id ||
        row.hungarianAssemblyRound.round !== job.round ||
        row.hungarianAssemblyRound.registeredVoters !== job.regionalRegister[row.state] ||
        row.hungarianAssemblyRound.byElection?.parentReceiptId !== job.parentReceiptId ||
        JSON.stringify(row.hungarianAssemblyRound.byElection.districtIds) !==
          JSON.stringify(job.districtIds)
    )
  )
    throw new Error("Hungarian by-election binding changed");
  const allCandidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ electionId: { $in: job.electionIds.map((id) => new ObjectId(id)) } }, { session })
    .toArray();
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find(
      { electionId: { $in: polls.map((row) => row._id) } },
      { session, projection: TALLY_WITH_LATEST_SNAPSHOT_ONLY }
    )
    .toArray();
  if (tallies.length !== polls.length || tallies.some((row) => row.finalized)) return 0;
  const firstCandidates = allCandidates.filter(
    (row) => !row.hungarianAssemblyNomination?.rootCandidateId
  );
  const originalRegion = (row: ElectionCandidate) =>
    polls.find((poll) => poll._id.equals(row.electionId))?.state ??
    parent.nominees.find(
      (nominee) =>
        nominee.isNpc === !!row.isNPP &&
        nominee.ownerId === (row.isNPP ? row.nppId : row.characterId)?.toHexString()
    )?.regionId;
  const nominations =
    job.nominations ??
    buildHu1991Slates(
      firstCandidates.map((row) => ({
        id: row._id.toHexString(),
        ownerId: (row.isNPP ? row.nppId! : row.characterId).toHexString(),
        regionId: originalRegion(row)!,
        partyId: row.party,
        isNpc: !!row.isNPP,
        filingOrder: row.enteredAt.getTime(),
        constituencyId: row.hungarianAssemblyNomination?.constituencyId,
      }))
    ).nominations;
  const campaigns: Hu1991RegionalCampaign[] = Object.entries(job.regionalRegister).map(
    ([regionId, registeredVoters]) => {
      const poll = polls.find((row) => row.state === regionId);
      if (!poll) return { regionId, registeredVoters, candidates: [] };
      const tally = tallies.find((row) => row.electionId.equals(poll._id))!;
      const local = allCandidates.filter((row) => row.electionId.equals(poll._id));
      const votes = Object.keys(tally.totalVotes ?? {}).length
        ? tally.totalVotes
        : (tally.turnSnapshots?.at(-1)?.cumulativeVotes ?? {});
      if (Object.keys(votes).some((id) => !local.some((row) => row._id.toHexString() === id)))
        throw new Error("Hungarian by-election tally names an unfiled person");
      return {
        regionId,
        registeredVoters,
        candidates: local.map((row) => {
          const rootId = row.hungarianAssemblyNomination?.rootCandidateId ?? row._id.toHexString();
          const original = firstCandidates.find(
            (candidate) => candidate._id.toHexString() === rootId
          );
          const qualified =
            job.count?.kind === "pending"
              ? new Set(
                  Object.values(job.count.runoffs)
                    .flat()
                    .map((id) => nominations.people.find((person) => person.id === id)!.candidateId)
                )
              : null;
          if (
            (job.round === 2 &&
              (!qualified?.has(rootId) ||
                !row._id.equals(stableId(`${job._id}:runoff-candidate:${rootId}`)))) ||
            !original ||
            original.party !== row.party ||
            original.isNPP !== row.isNPP ||
            !(row.isNPP ? row.nppId : row.characterId)?.equals(
              (original.isNPP ? original.nppId : original.characterId)!
            ) ||
            ((votes[row._id.toHexString()] ?? 0) > 0 &&
              tally.candidateParties[row._id.toHexString()] !== row.party)
          )
            throw new Error("Hungarian by-election nominee or counted party changed");
          return { candidateId: rootId, votes: votes[row._id.toHexString()] ?? 0 };
        }),
      };
    }
  );
  const projected =
    job.round === 1
      ? projectHu1991CampaignBallots(campaigns, nominations)
      : projectHu1991Runoff(
          { constituencies: job.ballots!, territorial: [], nationalLists: [] },
          {
            kind: "pending",
            reason: "runoff-required",
            constituencyRunoffs: job.count?.kind === "pending" ? job.count.runoffs : {},
            territorialRunoffs: [],
          },
          campaigns,
          nominations
        );
  const ballots = projected.constituencies.filter((row) => job.districtIds.includes(row.id));
  const count = countHu1991ByElection(job.districtIds, ballots);
  if (count.kind === "pending") {
    if (job.round !== 1 || turn + 2 >= job.termEndTurn) return 0;
    const people = new Map(nominations.people.map((row) => [row.id, row]));
    const qualified = new Set(
      Object.values(count.runoffs)
        .flat()
        .map((id) => people.get(id)!.candidateId)
    );
    const regions = new Set(
      Object.keys(count.runoffs).map(
        (id) => HU_1991_CONSTITUENCIES.find((row) => row.id === id)!.regionId
      )
    );
    const renewed = polls
      .filter((poll) => regions.has(poll.state))
      .map((poll): Election => ({
        ...poll,
        _id: stableId(`${job._id}:runoff:${poll.state}`),
        status: "active",
        startTurn: turn,
        primaryEndTurn: turn,
        endTurn: turn + 2,
        startTime: now,
        primaryEndTime: now,
        endTime: new Date(now.getTime() + 2 * MS_PER_TURN),
        durationHours: 2,
        primaryDurationHours: 0,
        createdAt: now,
        updatedAt: now,
        hungarianAssemblyRound: { ...poll.hungarianAssemblyRound!, round: 2 },
      }));
    const renewedCandidates = firstCandidates
      .filter((row) => qualified.has(row._id.toHexString()))
      .map((row): ElectionCandidate => ({
        ...row,
        _id: stableId(`${job._id}:runoff-candidate:${row._id.toHexString()}`),
        electionId: renewed.find((poll) => poll.state === originalRegion(row))!._id,
        status: "active",
        enteredAt: now,
        hungarianAssemblyNomination: {
          ...row.hungarianAssemblyNomination,
          rootCandidateId: row._id.toHexString(),
        },
      }));
    await journal.updateOne(
      { _id: job._id, round: 1, completedAtTurn: { $exists: false } },
      {
        $set: {
          nominations,
          ballots,
          count,
          round: 2,
          activeElectionIds: renewed.map((row) => row._id.toHexString()),
          electionIds: [...job.electionIds, ...renewed.map((row) => row._id.toHexString())],
        },
      },
      { session }
    );
    await db.collection<Election>("elections").insertMany(renewed, { session });
    if (renewedCandidates.length) {
      await db
        .collection<ElectionCandidate>("electionCandidates")
        .insertMany(renewedCandidates, { session });
      await db.collection<ElectionCandidate>("electionCandidates").updateMany(
        {
          _id: {
            $in: firstCandidates
              .filter((row) => qualified.has(row._id.toHexString()))
              .map((row) => row._id),
          },
        },
        { $set: { status: "withdrawn", withdrawnAt: now } },
        { session }
      );
      await db.collection("campaigns").bulkWrite(
        renewedCandidates.map((row) => ({
          updateMany: {
            filter: {
              electionId: firstCandidates.find(
                (original) =>
                  original._id.toHexString() === row.hungarianAssemblyNomination!.rootCandidateId
              )!.electionId,
              candidateId: row.isNPP ? row.nppId : row.characterId,
              status: { $ne: "archived" },
            },
            update: { $set: { electionId: row.electionId, updatedAt: now } },
          },
        })),
        { session }
      );
    }
    await db.collection<ElectionVoteTally>("electionVoteTallies").insertMany(
      renewed.map((poll) => ({
        _id: stableId(`${job._id}:runoff-tally:${poll.state}`),
        electionId: poll._id,
        state: poll.state,
        totalVotes: {},
        candidateNames: {},
        candidateParties: {},
        turnSnapshots: [],
        finalized: false,
        hungarianAssemblyBallot: true,
        createdAt: now,
        updatedAt: now,
      })),
      { session }
    );
    return 0;
  }
  // Candidate custody and every seat are checked together before inserting a
  // replacement. No list compensation or occupied mandate is reallocated.
  const held = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "HU", officeType: "assemblyDelegate" },
      {
        session,
        projection: { characterId: 1, nppId: 1, constituencyId: 1, hungarianAssemblyMandate: 1 },
      }
    )
    .toArray();
  const heldDistricts = new Set(
    held
      .filter((row) => row.characterId || row.nppId)
      .filter((row) => row.hungarianAssemblyMandate?.tier === "constituency")
      .map((row) => row.constituencyId)
  );
  const winnerPeople = Object.entries(count.winners).flatMap(([districtId, id]) =>
    id ? [{ districtId, person: nominations.people.find((row) => row.id === id)! }] : []
  );
  const npcs = await db
    .collection<NPP>("npps")
    .find(
      {
        _id: {
          $in: winnerPeople
            .filter((row) => row.person.isNpc)
            .map((row) => new ObjectId(row.person.ownerId)),
        },
        countryId: "HU",
        retiredAt: null,
      },
      { session, projection: { party: 1, currentOffice: 1 } }
    )
    .toArray();
  const players = await db
    .collection<Character>("characters")
    .find(
      {
        _id: {
          $in: winnerPeople
            .filter((row) => !row.person.isNpc)
            .map((row) => new ObjectId(row.person.ownerId)),
        },
        countryId: "HU",
        federationPendingResidenceId: { $exists: false },
      },
      { session, projection: { party: 1, currentOffice: 1, userId: 1 } }
    )
    .toArray();
  const owners = new Map([...npcs, ...players].map((row) => [row._id.toHexString(), row]));
  const officials: ElectedOfficial[] = [];
  if (currentChamber && turn < job.termEndTurn)
    for (const { districtId, person } of winnerPeople) {
      const owner = owners.get(person.ownerId);
      const candidate = firstCandidates.find((row) => row._id.toHexString() === person.candidateId);
      const available =
        candidate?.status === "active" ||
        allCandidates.some(
          (row) =>
            row.hungarianAssemblyNomination?.rootCandidateId === person.candidateId &&
            row.status === "active"
        );
      if (
        heldDistricts.has(districtId) ||
        !owner ||
        owner.party !== person.partyId ||
        !available ||
        (owner.currentOffice &&
          !["assemblyDelegate", "assemblyDeputy", "primeMinister"].includes(
            owner.currentOffice.type
          )) ||
        (!person.isNpc && held.some((row) => row.characterId?.toHexString() === person.ownerId))
      )
        continue;
      officials.push({
        _id: stableId(`${job._id}:person:${person.id}`),
        countryId: "HU",
        officeType: "assemblyDelegate",
        state: person.regionId,
        constituencyId: districtId,
        seatSource: "direct",
        seatsHeld: 1,
        characterId: person.isNpc ? null : new ObjectId(person.ownerId),
        nppId: person.isNpc ? new ObjectId(person.ownerId) : null,
        isNPP: person.isNpc,
        characterName: candidate!.characterName,
        party: person.partyId,
        electedAt: now,
        termEnds: job.termEnds,
        createdAt: now,
        updatedAt: now,
        hungarianAssemblyMandate: {
          receiptId: job.parentReceiptId,
          personId: person.id,
          tier: "constituency",
          districtId,
          rootCandidateId: person.candidateId,
        },
      });
    }
  const tombstones = held.filter(
    (row) =>
      !row.characterId &&
      !row.nppId &&
      row.hungarianAssemblyMandate?.tier === "constituency" &&
      officials.some((official) => official.constituencyId === row.constituencyId)
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
        countryId: "HU";
        turn: number;
        official: ElectedOfficial;
      }>("hu1991AssemblyOfficeArchives")
      .insertMany(
        originals.map((official) => ({
          _id: `${job._id}:vacancy:${official._id.toHexString()}`,
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
  const ownerSeats = new Map<string, { isNpc: boolean; regionId: string; seats: number }>();
  for (const official of officials) {
    const ownerId = (official.isNPP ? official.nppId! : official.characterId!).toHexString();
    const prior = ownerSeats.get(ownerId);
    ownerSeats.set(ownerId, {
      isNpc: !!official.isNPP,
      regionId: official.state!,
      seats:
        (prior?.seats ??
          held.filter(
            (row) => (official.isNPP ? row.nppId : row.characterId)?.toHexString() === ownerId
          ).length) + 1,
    });
  }
  for (const isNpc of [false, true]) {
    const operations = [...ownerSeats]
      .filter(([, row]) => row.isNpc === isNpc)
      .map(([ownerId, row]) => ({
        updateOne: {
          filter: { _id: new ObjectId(ownerId), countryId: "HU" },
          update: {
            $set: {
              ...(owners.get(ownerId)?.currentOffice?.type === "primeMinister"
                ? {}
                : {
                    currentOffice: {
                      type: "assemblyDelegate",
                      state: row.regionId,
                      seatsHeld: row.seats,
                    },
                  }),
              ...(isNpc ? { seatsHeld: row.seats } : {}),
              updatedAt: now,
            },
          },
        },
      }));
    if (operations.length)
      await db.collection(isNpc ? "npps" : "characters").bulkWrite(operations, { session });
  }
  const notices = players.filter((player) => ownerSeats.has(player._id.toHexString()));
  if (notices.length)
    await db.collection<Character>("characters").bulkWrite(
      notices.map((player) => {
        const official = officials.find((row) => row.characterId?.equals(player._id))!;
        return {
          updateOne: {
            filter: { _id: player._id, countryId: "HU" as const },
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
  if (notices.length)
    await db.collection("notifications").insertMany(
      notices.map((player) => ({
        _id: stableId(`${job._id}:notice:${player._id.toHexString()}`),
        userId: player.userId,
        type: "general_win",
        title: "National Assembly By-election Won",
        message:
          "You won a vacant constituency seat in Hungary's National Assembly for the remainder of its term.",
        metadata: { receiptId: job._id, countryId: "HU", cycle: job.cycle },
        read: false,
        createdAt: now,
      })),
      { session }
    );
  await db
    .collection<Election>("elections")
    .updateMany(
      { _id: { $in: job.electionIds.map((id) => new ObjectId(id)) } },
      { $set: { status: "resolved", resolving: false, updatedAt: now } },
      { session }
    );
  await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { electionId: { $in: job.electionIds.map((id) => new ObjectId(id)) }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } },
      { session }
    );
  await db.collection<ElectionVoteTally>("electionVoteTallies").bulkWrite(
    job.electionIds.map((id) => {
      const local = allCandidates.filter((row) => row.electionId.toHexString() === id);
      const localSeats = officials.filter((row) =>
        local.some(
          (candidate) =>
            (candidate.hungarianAssemblyNomination?.rootCandidateId ??
              candidate._id.toHexString()) === row.hungarianAssemblyMandate!.rootCandidateId
        )
      );
      return {
        updateOne: {
          filter: { electionId: new ObjectId(id) },
          update: {
            $set: {
              finalized: true,
              resolvedAtTurn: turn,
              resolutionPath: "hu_statutory_mixed" as const,
              updatedAt: now,
              resolvedTotalSeats: localSeats.length,
              seatsEstimate: Object.fromEntries(
                local.map((candidate) => [
                  candidate._id.toHexString(),
                  localSeats.filter(
                    (official) =>
                      official.hungarianAssemblyMandate!.rootCandidateId ===
                      (candidate.hungarianAssemblyNomination?.rootCandidateId ??
                        candidate._id.toHexString())
                  ).length,
                ])
              ),
              resolvedSeatHolders: localSeats.map((row) => ({
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
    { _id: job._id, completedAtTurn: { $exists: false }, round: job.round },
    {
      $set: {
        nominations,
        ballots,
        count,
        completedAtTurn: turn,
        officialIds: officials.map((row) => row._id),
        unavailableWinnerIds: winnerPeople
          .filter(
            ({ person }) =>
              !officials.some((row) => row.hungarianAssemblyMandate!.personId === person.id)
          )
          .map(({ person }) => person.id),
      },
    },
    { session }
  );
  if (committed.modifiedCount !== 1) throw new Error("Hungarian by-election changed concurrently");
  return job.electionIds.length;
}
export async function resolveHu1991ByElection(
  db: Db,
  receiptId: string,
  turn: number,
  now: Date
): Promise<number> {
  return runRequiredTransaction((session) =>
    materializeHu1991ByElectionResolution({ db, session, receiptId, turn, now })
  );
}
