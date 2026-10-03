/**
 * Grand Assembly constituency vacancies open fresh partial-election campaigns.
 * The certified party lists and original term remain intact; existing financial
 * actors supply the new nominees without creating NPC financial actors.
 */
import { createHash } from "node:crypto";
import {
  ObjectId,
  type Db,
  type ClientSession,
  type AnyBulkWriteOperation,
  type Document,
} from "mongodb";
import type {
  Character,
  ElectedOfficial,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  GameState,
  NPP,
  PoliticalParty,
  State,
  StateRegistrationPool,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { scalePoolToRegistered } from "@/lib/electionEngine/rules/registration";
import { TALLY_WITH_LATEST_SNAPSHOT_ONLY } from "@/lib/electionEngine/tallyProjections";
import { BG_FOUNDING_COUNTS_COLLECTION, type BgFoundingAssemblyRecord } from "./foundingCount1990";
import { BG_1990_CONSTITUENCIES } from "./data/foundingDistricts1990";
import {
  bgGrandAssemblyAllowsPartialElection,
  bgGrandPartialOwnerEligible,
  planBgGrandPartialNpcNominees,
  bgGrandConstituencyRegister,
  bgGrandPartialElectionSchedule,
  countBgGrandPartialElection,
} from "./rules/constituencyByElection1991";
import type { BgFoundingMajorityBallot } from "./rules/foundingMajority1990";

export const BG_GRAND_BY_ELECTIONS_COLLECTION = "bgGrandConstituencyByElections";
export interface BgGrandByElectionRecord {
  _id: string;
  parentReceiptId: string;
  countryId: "BG";
  cycle: number;
  generation: number;
  districtId: string;
  regionId: string;
  slotId: string;
  termEndTurn: number;
  termEnds: Date;
  registeredVoters: number;
  openedAtTurn: number;
  activeElectionId: ObjectId;
  electionIds: ObjectId[];
  round: 1 | 2;
  runoffGeneration: number;
  first?: BgFoundingMajorityBallot;
  status: "open" | "seated" | "cancelled" | "vacant";
  completedAtTurn?: number;
  winnerPersonId?: string;
  winnerOwnerId?: string;
  winnerIsNpc?: boolean;
  previousOwnerId?: string;
  previousIsNpc?: boolean;
  officialId?: ObjectId;
}
type Country = {
  _id: string;
  dissolvedTurn?: number;
  bgOrdinaryAssemblySinceTurn?: number;
  bgGrandAssemblyDissolutionSinceTurn?: number;
  bgConstitution1991SinceTurn?: number;
  bgGrandAssemblyContinuationSinceTurn?: number;
  bgGrandByElectionGeneration?: number;
};
type Parent = BgFoundingAssemblyRecord & { byElectionGeneration?: number };
function stableId(key: string) {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}
async function context(db: Db, turn: number, session?: ClientSession, full = false) {
  const country = await db.collection<Country>("countryGameStates").findOne(
    { _id: "BG" },
    {
      session,
      projection: {
        dissolvedTurn: 1,
        bgOrdinaryAssemblySinceTurn: 1,
        bgGrandAssemblyDissolutionSinceTurn: 1,
        bgConstitution1991SinceTurn: 1,
        bgGrandAssemblyContinuationSinceTurn: 1,
      },
    }
  );
  const parent = await db.collection<Parent>(BG_FOUNDING_COUNTS_COLLECTION).findOne(
    { countryId: "BG", seatedAtTurn: { $exists: true }, settled: { $exists: true } },
    {
      session,
      sort: { cycle: -1 },
      projection: {
        cycle: 1,
        seatedAtTurn: 1,
        grandTermEndTurn: 1,
        byElectionGeneration: 1,
        ...(full ? { "settled.mandates": 1, "settled.vacancies": 1 } : {}),
      },
    }
  );
  const endTurn =
    parent?.grandTermEndTurn ??
    (parent && parent.cycle > 0 && parent.seatedAtTurn != null ? parent.seatedAtTurn + 192 : null);
  return {
    country,
    parent,
    endTurn,
    available:
      bgGrandAssemblyAllowsPartialElection(country) &&
      !!parent &&
      endTurn != null &&
      turn < endTurn,
  };
}
async function lockChamber(db: Db, session: ClientSession, parent: Parent) {
  const country = await db
    .collection<Country>("countryGameStates")
    .updateOne({ _id: "BG" }, { $inc: { bgGrandByElectionGeneration: 1 } }, { session });
  const chamber = await db
    .collection<{ _id: string; bg1991MandateGeneration?: number }>("governmentFormations")
    .updateOne({ _id: "BG" }, { $inc: { bg1991MandateGeneration: 1 } }, { session });
  const receipt = await db
    .collection<Parent>(BG_FOUNDING_COUNTS_COLLECTION)
    .updateOne(
      { _id: parent._id, seatedAtTurn: parent.seatedAtTurn },
      { $inc: { byElectionGeneration: 1 } },
      { session }
    );
  if (country.matchedCount !== 1 || chamber.matchedCount !== 1 || receipt.matchedCount !== 1)
    throw new Error("Bulgarian partial election lost its chamber authority");
}
async function cancelJobs(
  db: Db,
  session: ClientSession,
  jobs: BgGrandByElectionRecord[],
  turn: number,
  now: Date
) {
  if (!jobs.length) return;
  const ids = jobs.flatMap((row) => row.electionIds);
  await db
    .collection<BgGrandByElectionRecord>(BG_GRAND_BY_ELECTIONS_COLLECTION)
    .updateMany(
      { _id: { $in: jobs.map((row) => row._id) }, status: "open" },
      { $set: { status: "cancelled", completedAtTurn: turn } },
      { session }
    );
  await db
    .collection<Election>("elections")
    .updateMany(
      { _id: { $in: ids }, status: { $nin: ["resolved", "cancelled"] } },
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

export async function openBgGrandConstituencyByElections(
  db: Db,
  game: Pick<GameState, "preset" | "preIteration">,
  turn: number,
  now: Date
): Promise<number> {
  if (game.preset !== "1991-default" || game.preIteration?.active) return 0;
  if (!Number.isSafeInteger(turn) || turn < 1 || !Number.isFinite(now.getTime()))
    throw new Error("Invalid Bulgarian partial-election time");
  const ready = await context(db, turn);
  const active = await db
    .collection<BgGrandByElectionRecord>(BG_GRAND_BY_ELECTIONS_COLLECTION)
    .find({ status: "open" }, { projection: { parentReceiptId: 1, electionIds: 1 } })
    .toArray();
  const needsCancellation = active.some(
    (row) => !ready.available || row.parentReceiptId !== ready.parent?._id
  );
  if (!needsCancellation && (!ready.available || turn >= ready.endTurn! - 24)) return 0;
  if (!needsCancellation) {
    const held = await db.collection<ElectedOfficial>("electedOfficials").countDocuments({
      countryId: "BG",
      officeType: "assemblyDeputy",
      "bulgarianFoundingMandate.receiptId": ready.parent!._id,
      "bulgarianFoundingMandate.tier": "constituency",
      seatsHeld: 1,
      $or: [{ nppId: { $type: "objectId" } }, { characterId: { $type: "objectId" } }],
    });
    if (held === 200) return 0;
    if (held > 200) throw new Error("Bulgarian constituency mandates exceed 200");
  }
  return runRequiredTransaction(
    async (session) => {
      const current = await context(db, turn, session, true);
      const journal = db.collection<BgGrandByElectionRecord>(BG_GRAND_BY_ELECTIONS_COLLECTION);
      const jobs = await journal.find({ status: "open" }, { session }).toArray();
      const stale = jobs.filter(
        (row) => !current.available || row.parentReceiptId !== current.parent?._id
      );
      await cancelJobs(db, session, stale, turn, now);
      if (!current.available || turn >= current.endTurn! - 24) return 0;
      const parent = current.parent!;
      const officials = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find(
          { countryId: "BG", officeType: "assemblyDeputy" },
          {
            session,
            projection: {
              characterId: 1,
              nppId: 1,
              seatsHeld: 1,
              constituencyId: 1,
              bulgarianFoundingMandate: 1,
            },
          }
        )
        .toArray();
      const held = officials.filter((row) => row.seatsHeld === 1 && (row.characterId || row.nppId));
      if (held.some((row) => row.bulgarianFoundingMandate?.receiptId !== parent._id)) return 0;
      const occupied = new Set(
        held
          .filter((row) => row.bulgarianFoundingMandate?.tier === "constituency")
          .map((row) => row.bulgarianFoundingMandate!.districtId)
      );
      const pending = new Set(
        jobs.filter((row) => row.parentReceiptId === parent._id).map((row) => row.districtId)
      );
      const vacancies = BG_1990_CONSTITUENCIES.filter(
        (row) => !occupied.has(row.id) && !pending.has(row.id)
      );
      if (!vacancies.length) return 0;
      const schedule = bgGrandPartialElectionSchedule({
        turn,
        vacancyObservedTurn: turn,
        termEndTurn: current.endTurn!,
      })!;
      const states = await db
        .collection<State>("states")
        .find(
          { countryId: "BG" },
          { session, projection: { population: 1, votingEligiblePopulation: 1 } }
        )
        .toArray();
      const pools = await db
        .collection<StateRegistrationPool>("stateRegistrationPool")
        .find({ countryId: "BG" }, { session, projection: { stateId: 1, unregistered: 1 } })
        .toArray();
      const npcs = await db
        .collection<NPP>("npps")
        .find(
          { countryId: "BG", retiredAt: null, isTechnocrat: { $ne: true } },
          { session, projection: { party: 1, name: 1, homeState: 1, currentOffice: 1 } }
        )
        .sort({ _id: 1 })
        .toArray();
      const parties = await db
        .collection<PoliticalParty>("politicalParties")
        .find(
          { countryId: "BG", regimeStatus: { $ne: "banned" } },
          { session, projection: { sequentialId: 1 } }
        )
        .toArray();
      const npcNominations = planBgGrandPartialNpcNominees({
        districtIds: vacancies.map((row) => row.id),
        registeredPartyIds: new Set(parties.map((row) => String(row.sequentialId))),
        owners: npcs.map((row) => ({
          ownerId: row._id.toHexString(),
          partyId: row.party,
          regionId: row.homeState,
          officeType: row.currentOffice?.type,
        })),
      });
      await lockChamber(db, session, parent);
      const previousWinners = await journal
        .aggregate<{ _id: string; ownerId: string; isNpc: boolean }>(
          [
            {
              $match: {
                parentReceiptId: parent._id,
                status: "seated",
                districtId: { $in: vacancies.map((row) => row.id) },
              },
            },
            { $sort: { completedAtTurn: -1, generation: -1 } },
            {
              $group: {
                _id: "$districtId",
                ownerId: { $first: "$winnerOwnerId" },
                isNpc: { $first: "$winnerIsNpc" },
              },
            },
          ],
          { session }
        )
        .toArray();
      const generation = (parent.byElectionGeneration ?? 0) + 1;
      const records: BgGrandByElectionRecord[] = [],
        polls: Election[] = [],
        candidates: ElectionCandidate[] = [],
        tallies: ElectionVoteTally[] = [];
      for (const district of vacancies) {
        const state = states.find((row) => String(row._id) === district.regionId);
        if (!state) throw new Error("Bulgarian partial election lacks its authoritative region");
        const regionalRegister = Math.floor(
          scalePoolToRegistered(
            state.votingEligiblePopulation ?? state.population,
            pools.find((row) => row.stateId === district.regionId)?.unregistered
          )
        );
        const registeredVoters = bgGrandConstituencyRegister(district.id, regionalRegister);
        const certified = parent.settled!.mandates.find(
          (row) => row.tier === "constituency" && row.districtId === district.id
        );
        const initial = parent.settled!.vacancies.findIndex(
          (row) => row.tier === "constituency" && row.districtId === district.id
        );
        if (!certified && initial < 0)
          throw new Error("Bulgarian vacant constituency lacks an original physical slot");
        const id = `${parent._id}:partial:${generation}:${district.id}`,
          pollId = stableId(`${id}:poll:1`);
        const termEnds = new Date(now.getTime() + (current.endTurn! - turn) * MS_PER_TURN);
        const previous = previousWinners.find((row) => row._id === district.id);
        const stub = officials.find(
          (row) =>
            row.bulgarianFoundingMandate?.tier === "constituency" &&
            row.bulgarianFoundingMandate.districtId === district.id
        );
        const previousOwnerId =
          stub?.nppId?.toHexString() ??
          stub?.characterId?.toHexString() ??
          previous?.ownerId ??
          certified?.ownerId;
        const previousIsNpc = stub?.nppId
          ? true
          : stub?.characterId
            ? false
            : (previous?.isNpc ?? certified?.isNpc);
        records.push({
          _id: id,
          parentReceiptId: parent._id,
          countryId: "BG",
          cycle: parent.cycle,
          generation,
          districtId: district.id,
          regionId: district.regionId,
          slotId: certified?.personId ?? `initial-vacancy:${initial}`,
          ...(previousOwnerId ? { previousOwnerId, previousIsNpc } : {}),
          termEndTurn: current.endTurn!,
          termEnds,
          registeredVoters,
          openedAtTurn: turn,
          activeElectionId: pollId,
          electionIds: [pollId],
          round: 1,
          runoffGeneration: 0,
          status: "open",
        });
        polls.push({
          _id: pollId,
          countryId: "BG",
          electionType: "nationalAssembly",
          state: district.regionId,
          cycle: parent.cycle,
          status: "active",
          totalSeats: 1,
          startTurn: turn,
          primaryEndTurn: schedule.primaryEndTurn,
          endTurn: schedule.endTurn,
          startTime: now,
          primaryEndTime: new Date(now.getTime() + (schedule.primaryEndTurn - turn) * MS_PER_TURN),
          endTime: new Date(now.getTime() + (schedule.endTurn - turn) * MS_PER_TURN),
          durationHours: schedule.endTurn - turn,
          primaryDurationHours: schedule.primaryEndTurn - turn,
          createdAt: now,
          updatedAt: now,
          bulgarianFoundingRound: {
            ruleVersion: "parallel-1990-v1",
            receiptId: id,
            rootElectionId: pollId.toHexString(),
            round: 1,
            registeredVoters,
            newNominationDistrictIds: [district.id],
            byElection: { parentReceiptId: parent._id, districtId: district.id, generation },
          },
        });
        for (const nomination of npcNominations.filter((row) => row.districtId === district.id)) {
          const npc = npcs.find((row) => row._id.toHexString() === nomination.ownerId)!;
          candidates.push({
            _id: stableId(`${id}:candidate:${npc.party}:${npc._id}`),
            countryId: "BG",
            electionId: pollId,
            nppId: npc._id,
            characterId: npc._id,
            isNPP: true,
            party: npc.party,
            characterName: npc.name,
            status: "active",
            enteredAt: now,
            bulgarianFoundingNomination: { constituencyId: district.id },
          });
        }
        tallies.push({
          _id: stableId(`${id}:tally:1`),
          electionId: pollId,
          state: district.regionId,
          totalVotes: {},
          candidateNames: {},
          candidateParties: {},
          turnSnapshots: [],
          finalized: false,
          bulgarianFoundingBallot: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      await journal.insertMany(records, { session });
      await db.collection<Election>("elections").insertMany(polls, { session });
      if (candidates.length)
        await db
          .collection<ElectionCandidate>("electionCandidates")
          .insertMany(candidates, { session });
      await db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .insertMany(tallies, { session });
      return records.length;
    },
    { client: db.client }
  );
}

/** Count only completed partial ballots, including their immutable first round. */
export async function resolveBgGrandConstituencyByElections(
  db: Db,
  game: Pick<GameState, "preset" | "preIteration">,
  turn: number,
  now: Date,
  onlyElectionIds?: readonly ObjectId[]
): Promise<number> {
  if (game.preset !== "1991-default" || game.preIteration?.active) return 0;
  if (!Number.isSafeInteger(turn) || turn < 1 || !Number.isFinite(now.getTime()))
    throw new Error("Invalid Bulgarian partial count time");
  return runRequiredTransaction(
    async (session) => {
      const journal = db.collection<BgGrandByElectionRecord>(BG_GRAND_BY_ELECTIONS_COLLECTION);
      const jobs = await journal
        .find(
          {
            status: "open",
            ...(onlyElectionIds ? { electionIds: { $in: [...onlyElectionIds] } } : {}),
          },
          { session }
        )
        .toArray();
      if (!jobs.length) return 0;
      const current = await context(db, turn, session, true);
      const stale = jobs.filter(
        (row) =>
          !current.available ||
          row.parentReceiptId !== current.parent?._id ||
          turn >= row.termEndTurn
      );
      await cancelJobs(db, session, stale, turn, now);
      const usable = jobs.filter((row) => !stale.includes(row));
      if (!usable.length) return 0;
      const polls = await db
        .collection<Election>("elections")
        .find(
          {
            _id: { $in: usable.map((row) => row.activeElectionId) },
            status: "completed",
            endTurn: { $lte: turn },
          },
          { session }
        )
        .toArray();
      if (!polls.length) return 0;
      const ready = usable.filter((row) =>
        polls.some((poll) => poll._id.equals(row.activeElectionId))
      );
      const candidates = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: { $in: ready.flatMap((row) => row.electionIds) } }, { session })
        .toArray();
      const tallies = await db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .find(
          { electionId: { $in: polls.map((row) => row._id) } },
          { session, projection: TALLY_WITH_LATEST_SNAPSHOT_ONLY }
        )
        .toArray();
      const officials = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ countryId: "BG", officeType: "assemblyDeputy" }, { session })
        .toArray();
      const held = officials.filter((row) => row.seatsHeld === 1 && (row.characterId || row.nppId));
      if (held.some((row) => row.bulgarianFoundingMandate?.receiptId !== current.parent!._id)) {
        await cancelJobs(db, session, ready, turn, now);
        return 0;
      }
      const npcIds = [
        ...new Set([
          ...candidates
            .filter((row) => row.isNPP && row.nppId)
            .map((row) => row.nppId!.toHexString()),
          ...ready.flatMap((row) =>
            row.previousOwnerId && row.previousIsNpc ? [row.previousOwnerId] : []
          ),
        ]),
      ].map((id) => new ObjectId(id));
      const playerIds = [
        ...new Set([
          ...candidates.filter((row) => !row.isNPP).map((row) => row.characterId.toHexString()),
          ...ready.flatMap((row) =>
            row.previousOwnerId && row.previousIsNpc === false ? [row.previousOwnerId] : []
          ),
        ]),
      ].map((id) => new ObjectId(id));
      const npcs = npcIds.length
        ? await db
            .collection<NPP>("npps")
            .find(
              {
                _id: { $in: npcIds },
                countryId: "BG",
              },
              { session, projection: { party: 1, currentOffice: 1, retiredAt: 1, isTechnocrat: 1 } }
            )
            .toArray()
        : [];
      const players = playerIds.length
        ? await db
            .collection<Character>("characters")
            .find(
              {
                _id: { $in: playerIds },
                countryId: "BG",
              },
              {
                session,
                projection: {
                  party: 1,
                  currentOffice: 1,
                  userId: 1,
                  federationPendingResidenceId: 1,
                },
              }
            )
            .toArray()
        : [];
      const owners = new Map<
        string,
        Pick<Character | NPP, "_id" | "party" | "currentOffice"> & {
          userId?: ObjectId;
          retiredAt?: Date | null;
          isTechnocrat?: boolean;
          federationPendingResidenceId?: string;
        }
      >([...npcs, ...players].map((row) => [row._id.toHexString(), row]));
      await lockChamber(db, session, current.parent!);
      const newPolls: Election[] = [],
        newCandidates: ElectionCandidate[] = [],
        newTallies: ElectionVoteTally[] = [],
        additions: ElectedOfficial[] = [];
      const jobUpdates: AnyBulkWriteOperation<BgGrandByElectionRecord>[] = [],
        tallyUpdates: AnyBulkWriteOperation<ElectionVoteTally>[] = [],
        campaignUpdates: AnyBulkWriteOperation<Document>[] = [];
      const completedIds: ObjectId[] = [],
        renewedIds: ObjectId[] = [];
      const cancelledJobs: BgGrandByElectionRecord[] = [];
      const seatedJobs: BgGrandByElectionRecord[] = [];
      let resolved = 0;
      for (const job of ready) {
        const poll = polls.find((row) => row._id.equals(job.activeElectionId))!,
          binding = poll.bulgarianFoundingRound;
        if (
          binding?.ruleVersion !== "parallel-1990-v1" ||
          binding.receiptId !== job._id ||
          binding.rootElectionId !== job.electionIds[0].toHexString() ||
          binding.byElection?.generation !== job.generation ||
          binding.round !== job.round ||
          binding.registeredVoters !== job.registeredVoters ||
          binding.byElection?.parentReceiptId !== job.parentReceiptId ||
          binding.byElection.districtId !== job.districtId ||
          poll.state !== job.regionId ||
          poll.totalSeats !== 1
        )
          throw new Error("Bulgarian partial-election binding changed");
        const tally = tallies.find((row) => row.electionId.equals(poll._id));
        if (!tally || tally.finalized) continue;
        if (
          held.some(
            (row) =>
              row.bulgarianFoundingMandate?.tier === "constituency" &&
              row.bulgarianFoundingMandate.districtId === job.districtId
          )
        ) {
          cancelledJobs.push(job);
          continue;
        }
        const local = candidates.filter((row) => row.electionId.equals(poll._id));
        const allRoots = candidates
          .filter(
            (row) =>
              job.electionIds.some((id) => id.equals(row.electionId)) &&
              !row.bulgarianFoundingNomination?.rootCandidateId
          )
          .sort(
            (a, b) =>
              a.enteredAt.getTime() - b.enteredAt.getTime() ||
              a._id.toHexString().localeCompare(b._id.toHexString())
          );
        const votes = Object.keys(tally.totalVotes ?? {}).length
          ? tally.totalVotes
          : (tally.turnSnapshots?.at(-1)?.cumulativeVotes ?? {});
        if (Object.keys(votes).some((id) => !local.some((row) => row._id.toHexString() === id)))
          throw new Error("Bulgarian partial tally names an unfiled candidate");
        let ballotsCast = 0,
          invalidBallots = 0;
        const options: BgFoundingMajorityBallot["options"][number][] = [];
        const firstOrder = new Map(
          job.first?.options.map((row) => [row.personId, row.tieOrder]) ?? []
        );
        const extraRoots = allRoots.filter((row) => !firstOrder.has(row._id.toHexString()));
        const extraStart = Math.max(0, ...firstOrder.values()) + 1;
        for (const candidate of local) {
          const count = votes[candidate._id.toHexString()] ?? 0;
          const rootId =
            candidate.bulgarianFoundingNomination?.rootCandidateId ?? candidate._id.toHexString();
          const root = allRoots.find((row) => row._id.toHexString() === rootId);
          if (
            !root ||
            !Number.isSafeInteger(count) ||
            count < 0 ||
            candidate.party !== root.party ||
            candidate.isNPP !== root.isNPP ||
            candidate.bulgarianFoundingNomination?.constituencyId !== job.districtId ||
            !(candidate.isNPP ? candidate.nppId : candidate.characterId)?.equals(
              (root.isNPP ? root.nppId : root.characterId)!
            ) ||
            (count > 0 && tally.candidateParties[candidate._id.toHexString()] !== candidate.party)
          )
            throw new Error("Bulgarian partial nominee custody changed");
          ballotsCast += count;
          if (candidate.status !== "active") {
            invalidBallots += count;
            continue;
          }
          options.push({
            personId: rootId,
            votes: count,
            tieOrder:
              job.round === 1
                ? allRoots.indexOf(root) + 1
                : (firstOrder.get(rootId) ?? extraStart + extraRoots.indexOf(root)),
          });
        }
        const ballot: BgFoundingMajorityBallot = {
          registeredVoters: job.registeredVoters,
          ballotsCast,
          invalidBallots,
          options,
        };
        const result = countBgGrandPartialElection({
          districtId: job.districtId,
          first: job.first ?? ballot,
          ...(job.round === 2 ? { second: ballot } : {}),
        });
        if (result.kind !== "elected") {
          if (turn + 1 >= job.termEndTurn) {
            cancelledJobs.push(job);
            continue;
          }
          const first = job.first ?? ballot;
          const firstResult = countBgGrandPartialElection({ districtId: job.districtId, first });
          if (firstResult.kind !== "runoff")
            throw new Error("Bulgarian partial runoff has no pending first round");
          const generation = job.runoffGeneration + 1;
          const pollId = stableId(`${job._id}:poll:runoff:${generation}`);
          const qualified = firstResult.allowNewNominations
            ? new Set(
                local.map(
                  (row) => row.bulgarianFoundingNomination?.rootCandidateId ?? row._id.toHexString()
                )
              )
            : new Set(firstResult.personIds);
          const renewed = local
            .filter(
              (row) =>
                row.status === "active" &&
                qualified.has(
                  row.bulgarianFoundingNomination?.rootCandidateId ?? row._id.toHexString()
                )
            )
            .map((row): ElectionCandidate => ({
              ...row,
              _id: stableId(
                `${job._id}:runoff:${generation}:candidate:${row.bulgarianFoundingNomination?.rootCandidateId ?? row._id}`
              ),
              electionId: pollId,
              enteredAt: now,
              bulgarianFoundingNomination: {
                ...row.bulgarianFoundingNomination,
                rootCandidateId:
                  row.bulgarianFoundingNomination?.rootCandidateId ?? row._id.toHexString(),
              },
            }));
          newPolls.push({
            ...poll,
            _id: pollId,
            status: "active",
            resolving: false,
            startTurn: turn,
            primaryEndTurn: firstResult.allowNewNominations ? turn + 1 : turn,
            endTurn: turn + 1,
            startTime: now,
            primaryEndTime: new Date(
              now.getTime() + (firstResult.allowNewNominations ? MS_PER_TURN : 0)
            ),
            endTime: new Date(now.getTime() + MS_PER_TURN),
            durationHours: 1,
            primaryDurationHours: firstResult.allowNewNominations ? 1 : 0,
            createdAt: now,
            updatedAt: now,
            bulgarianFoundingRound: {
              ...binding,
              round: 2,
              newNominationDistrictIds: firstResult.allowNewNominations
                ? [job.districtId]
                : undefined,
            },
          });
          newCandidates.push(...renewed);
          renewedIds.push(...local.filter((row) => row.status === "active").map((row) => row._id));
          for (const row of renewed)
            campaignUpdates.push({
              updateMany: {
                filter: {
                  electionId: poll._id,
                  candidateId: row.isNPP ? row.nppId : row.characterId,
                  status: { $ne: "archived" },
                },
                update: { $set: { electionId: pollId, updatedAt: now } },
              },
            });
          newTallies.push({
            _id: stableId(`${job._id}:tally:runoff:${generation}`),
            electionId: pollId,
            state: job.regionId,
            totalVotes: {},
            candidateNames: {},
            candidateParties: {},
            turnSnapshots: [],
            finalized: false,
            bulgarianFoundingBallot: true,
            createdAt: now,
            updatedAt: now,
          });
          jobUpdates.push({
            updateOne: {
              filter: { _id: job._id, status: "open", activeElectionId: poll._id },
              update: {
                $set: {
                  first,
                  round: 2 as const,
                  activeElectionId: pollId,
                  runoffGeneration: generation,
                },
                $push: { electionIds: pollId },
              },
            },
          });
          continue;
        }
        const root = allRoots.find((row) => row._id.toHexString() === result.personId)!;
        const ownerId = (root.isNPP ? root.nppId! : root.characterId).toHexString(),
          owner = owners.get(ownerId);
        const ownerHeld = [...held, ...additions].filter(
          (row) => (root.isNPP ? row.nppId : row.characterId)?.toHexString() === ownerId
        );
        const compatible = bgGrandPartialOwnerEligible({
          ownerExists: !!owner,
          ownerParty: owner?.party,
          candidateParty: root.party,
          officeType: owner?.currentOffice?.type,
          isNpc: !!root.isNPP,
          heldPlayerMandates: ownerHeld.length,
          retired: owner?.retiredAt != null,
          technocrat: owner?.isTechnocrat === true,
          pendingRelocation: owner?.federationPendingResidenceId !== undefined,
        });
        const officialId = stableId(`${job.parentReceiptId}:person:${job.slotId}`);
        if (compatible) {
          seatedJobs.push(job);
          additions.push({
            _id: officialId,
            countryId: "BG",
            officeType: "assemblyDeputy",
            state: job.regionId,
            nppId: root.isNPP ? new ObjectId(ownerId) : null,
            characterId: root.isNPP ? null : new ObjectId(ownerId),
            isNPP: !!root.isNPP,
            characterName: root.characterName,
            party: root.party,
            seatsHeld: 1,
            constituencyId: job.districtId,
            seatSource: "direct",
            termEnds: job.termEnds,
            electedAt: now,
            createdAt: now,
            updatedAt: now,
            bulgarianFoundingMandate: {
              receiptId: job.parentReceiptId,
              personId: result.personId,
              tier: "constituency",
              districtId: job.districtId,
              rootCandidateId: result.personId,
            },
          });
        }
        jobUpdates.push({
          updateOne: {
            filter: { _id: job._id, status: "open", activeElectionId: poll._id },
            update: {
              $set: {
                status: compatible ? ("seated" as const) : ("vacant" as const),
                completedAtTurn: turn,
                winnerPersonId: result.personId,
                ...(compatible ? { winnerOwnerId: ownerId, winnerIsNpc: !!root.isNPP } : {}),
                ...(compatible ? { officialId } : {}),
              },
            },
          },
        });
        for (const electionId of job.electionIds)
          tallyUpdates.push({
            updateOne: {
              filter: { electionId },
              update: {
                $set: {
                  finalized: true,
                  bulgarianFoundingBallot: true as const,
                  resolutionPath: "bg_founding_parallel" as const,
                  resolvedAtTurn: turn,
                  resolvedTotalSeats: 1,
                  seatsEstimate: Object.fromEntries(
                    candidates
                      .filter((row) => row.electionId.equals(electionId))
                      .map((row) => [
                        row._id.toHexString(),
                        compatible &&
                        (row.bulgarianFoundingNomination?.rootCandidateId ??
                          row._id.toHexString()) === result.personId
                          ? 1
                          : 0,
                      ])
                  ),
                  resolvedSeatHolders: compatible
                    ? [
                        {
                          identity: `${root.isNPP ? "npp" : "player"}:${ownerId}`,
                          party: root.party,
                          seats: 1,
                          seatSource: "direct" as const,
                        },
                      ]
                    : [],
                  updatedAt: now,
                },
              },
            },
          });
        completedIds.push(...job.electionIds);
        resolved += job.electionIds.length;
      }
      await cancelJobs(db, session, cancelledJobs, turn, now);
      const stubs = officials.filter((row) => additions.some((added) => added._id.equals(row._id)));
      if (stubs.length) {
        await db
          .collection<{ _id: string; official: ElectedOfficial; turn: number }>(
            "bgFoundingAssemblyOfficeArchives"
          )
          .insertMany(
            stubs.map((official) => ({
              _id: `${current.parent!._id}:partial:${turn}:${official._id}:departed`,
              official,
              turn,
            })),
            { session }
          );
        await db
          .collection<ElectedOfficial>("electedOfficials")
          .deleteMany({ _id: { $in: stubs.map((row) => row._id) } }, { session });
      }
      if (additions.length) {
        await db.collection<ElectedOfficial>("electedOfficials").insertMany(additions, { session });
        const finalHeld = [...held, ...additions];
        for (const isNpc of [true, false]) {
          const ids = [
            ...new Set([
              ...additions
                .filter((row) => !!row.isNPP === isNpc)
                .map((row) => (isNpc ? row.nppId! : row.characterId!).toHexString()),
              ...seatedJobs.flatMap((row) =>
                row.previousOwnerId && row.previousIsNpc === isNpc ? [row.previousOwnerId] : []
              ),
            ]),
          ].filter((id) => owners.has(id));
          if (!ids.length) continue;
          const collection = isNpc
            ? db.collection<NPP>("npps")
            : db.collection<Character>("characters");
          await collection.bulkWrite(
            ids.map((id) => {
              const owner = owners.get(id)!,
                owned = finalHeld.filter(
                  (row) => (isNpc ? row.nppId : row.characterId)?.toHexString() === id
                ),
                first = owned[0];
              const newlySeated = additions.find(
                (row) => (isNpc ? row.nppId : row.characterId)?.toHexString() === id
              );
              return {
                updateOne: {
                  filter: { _id: new ObjectId(id), countryId: "BG" },
                  update: {
                    $set: {
                      ...(owner.currentOffice?.type === "primeMinister"
                        ? {}
                        : newlySeated || owner.currentOffice?.type === "assemblyDeputy"
                          ? {
                              currentOffice: first
                                ? {
                                    type: "assemblyDeputy" as const,
                                    state: first.state,
                                    seatsHeld: owned.length,
                                  }
                                : null,
                            }
                          : {}),
                      ...(isNpc ? { seatsHeld: owned.length } : {}),
                      updatedAt: now,
                    },
                    ...(!isNpc && newlySeated
                      ? {
                          $push: {
                            careerHistory: {
                              type: "elected" as const,
                              office: {
                                type: "assemblyDeputy" as const,
                                state: newlySeated.state,
                                seatsHeld: 1,
                              },
                              officeLabel: "Grand National Assembly Deputy",
                              party: newlySeated.party,
                              partyCountryId: "BG",
                              date: now,
                            },
                          },
                        }
                      : {}),
                  },
                },
              };
            }),
            { session }
          );
        }
        const notices = additions
          .filter((row) => row.characterId && owners.get(row.characterId.toHexString())?.userId)
          .map((row) => ({
            _id: stableId(`${row.bulgarianFoundingMandate!.personId}:partial-notice`),
            userId: owners.get(row.characterId!.toHexString())!.userId,
            type: "general_win",
            title: "Grand Assembly Partial Election Won",
            message:
              "You won the vacant Bulgarian constituency mandate for the remainder of this Assembly term.",
            metadata: { countryId: "BG", receiptId: current.parent!._id },
            read: false,
            createdAt: now,
          }));
        if (notices.length) await db.collection("notifications").insertMany(notices, { session });
      }
      if (newPolls.length)
        await db.collection<Election>("elections").insertMany(newPolls, { session });
      if (newCandidates.length)
        await db
          .collection<ElectionCandidate>("electionCandidates")
          .insertMany(newCandidates, { session });
      if (newTallies.length)
        await db
          .collection<ElectionVoteTally>("electionVoteTallies")
          .insertMany(newTallies, { session });
      if (renewedIds.length)
        await db
          .collection<ElectionCandidate>("electionCandidates")
          .updateMany(
            { _id: { $in: renewedIds } },
            { $set: { status: "withdrawn", withdrawnAt: now } },
            { session }
          );
      if (campaignUpdates.length)
        await db.collection("campaigns").bulkWrite(campaignUpdates, { session });
      if (completedIds.length) {
        await db
          .collection<Election>("elections")
          .updateMany(
            { _id: { $in: completedIds } },
            { $set: { status: "resolved", resolving: false, updatedAt: now } },
            { session }
          );
        await db
          .collection<ElectionCandidate>("electionCandidates")
          .updateMany(
            { electionId: { $in: completedIds }, status: "active" },
            { $set: { status: "withdrawn", withdrawnAt: now } },
            { session }
          );
      }
      if (tallyUpdates.length)
        await db
          .collection<ElectionVoteTally>("electionVoteTallies")
          .bulkWrite(tallyUpdates, { session });
      if (jobUpdates.length) await journal.bulkWrite(jobUpdates, { session });
      return resolved;
    },
    { client: db.client }
  );
}
