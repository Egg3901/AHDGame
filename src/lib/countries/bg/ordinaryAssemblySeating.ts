/**
 * Bulgarian ordinary mandates enter office together. The national count, all
 * five resolved ballots, office mirrors, chamber capacity and receipt share one
 * required transaction; external notification services are not called inside it.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Character,
  CountryGameState,
  ElectedOfficial,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  GameState,
  NPP,
  State,
} from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  BG_ORDINARY_PLANS_COLLECTION,
  type BgOrdinaryPlanRecord,
} from "@/lib/turn/election/bgOrdinaryEligibility";
import { calendarTurn } from "@/lib/utils/gameDate";
import { settleBgOrdinaryListHolders } from "./rules/ordinaryElectionPlan";
import { BG_ORDINARY_ASSEMBLY_START_TURN } from "./rules/assemblyTransition";

export const BG_ASSEMBLY_ARCHIVES_COLLECTION = "bgAssemblyOfficeArchives";
function stableId(key: string): ObjectId {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}

export async function materializeBgOrdinaryAssembly(input: {
  db: Db;
  session: ClientSession;
  cycle: number;
  turn: number;
  now: Date;
}): Promise<boolean> {
  const { db, session, cycle, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(cycle) ||
    cycle < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Bulgarian seating requires a transaction, ordinary cycle, turn and time");
  const journal = db.collection<BgOrdinaryPlanRecord>(BG_ORDINARY_PLANS_COLLECTION);
  const receipt = await journal.findOne({ _id: `BG:ordinary:${cycle}` }, { session });
  if (!receipt || receipt.seatedAtTurn != null) return false;
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  if (game?.preset !== "1991-default")
    throw new Error("No Bulgarian ordinary mandate in this world");
  const calendar = calendarTurn(turn, {
    preIterationActive: game.preIteration?.active,
    preIterationTurns: game.preIterationTurns,
  });
  if (calendar < BG_ORDINARY_ASSEMBLY_START_TURN) return false;
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "BG" }, { session, projection: { bgOrdinaryAssemblySinceTurn: 1 } });
  if (!country) throw new Error("Bulgarian country authority is missing");
  const ids = receipt.electionIds.map((id) => new ObjectId(id));
  const elections = await db
    .collection<Election>("elections")
    .find(
      {
        _id: { $in: ids },
        countryId: "BG",
        electionType: "nationalAssembly",
        cycle,
        status: { $in: ["completed", "resolved"] },
      },
      { session, projection: { state: 1 } }
    )
    .toArray();
  const regions = Object.keys(receipt.plan.regionCapacity);
  if (
    elections.length !== 5 ||
    new Set(elections.map((row) => row.state)).size !== 5 ||
    elections.some((row) => !regions.includes(row.state))
  )
    throw new Error("Bulgarian frozen ballot cohort is incomplete or changed");
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
          enteredAt: 1,
        },
      }
    )
    .toArray();
  const candidateMap = new Map(candidates.map((row) => [row._id.toHexString(), row]));
  const npcIds = receipt.nominees
    .filter((row) => row.isNpc)
    .map((row) => new ObjectId(row.ownerId));
  const playerIds = receipt.nominees
    .filter((row) => !row.isNpc)
    .map((row) => new ObjectId(row.ownerId));
  const npcs = npcIds.length
    ? await db
        .collection<NPP>("npps")
        .find(
          { _id: { $in: npcIds }, countryId: "BG", retiredAt: null, isTechnocrat: { $ne: true } },
          { session, projection: { party: 1, currentOffice: 1 } }
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
            federationPendingResidenceId: { $exists: false },
          },
          { session, projection: { party: 1, currentOffice: 1, userId: 1 } }
        )
        .toArray()
    : [];
  const npcMap = new Map(npcs.map((row) => [row._id.toHexString(), row]));
  const playerMap = new Map(players.map((row) => [row._id.toHexString(), row]));
  const electionMap = new Map(elections.map((row) => [row._id.toHexString(), row]));
  const settled = settleBgOrdinaryListHolders(
    receipt.plan,
    elections.map((election) => ({
      electionId: election._id.toHexString(),
      regionId: election.state,
      candidates: receipt.nominees
        .filter((row) => row.electionId === election._id.toHexString())
        .map((row) => {
          const candidate = candidateMap.get(row.id);
          const owner = (row.isNpc ? npcMap : playerMap).get(row.ownerId);
          const office = owner?.currentOffice;
          const officeType = typeof office === "string" ? office : office?.type;
          return {
            ...row,
            votes: 0,
            eligible:
              !!owner &&
              owner.party === row.party &&
              (candidate?.status === "active" ||
                !!receipt.legacyResolvedElectionIds?.includes(election._id.toHexString())) &&
              candidate.party === row.party &&
              !!(row.isNpc ? candidate.nppId : candidate.characterId)?.equals(
                new ObjectId(row.ownerId)
              ) &&
              (!officeType || officeType === "assemblyDeputy"),
          };
        }),
    }))
  );
  if (settled.kind === "deferred") return false;
  const wanted = Object.entries(settled.candidateSeatsByElection).flatMap(
    ([electionId, allocation]) =>
      Object.entries(allocation)
        .filter(([, seats]) => seats > 0)
        .map(([id, seats]) => ({ id, seats, electionId }))
  );
  if (wanted.reduce((sum, row) => sum + row.seats, 0) !== 240)
    throw new Error("Bulgarian ordinary count does not conserve 240 mandates");
  const seenOwners = new Set<string>();
  const officials: ElectedOfficial[] = [];
  for (const row of wanted) {
    const candidate = candidateMap.get(row.id);
    const election = electionMap.get(row.electionId);
    const ownerId = candidate?.isNPP ? candidate.nppId : candidate?.characterId;
    const owner = ownerId
      ? (candidate?.isNPP ? npcMap : playerMap).get(ownerId.toHexString())
      : undefined;
    const office = owner?.currentOffice;
    const officeType = typeof office === "string" ? office : office?.type;
    const ownerKey = `${candidate?.isNPP ? "npc" : "player"}:${ownerId}`;
    if (
      !candidate ||
      !owner ||
      !election ||
      (candidate.status !== "active" &&
        !receipt.legacyResolvedElectionIds?.includes(row.electionId)) ||
      !candidate.electionId.equals(election._id) ||
      owner.party !== candidate.party ||
      seenOwners.has(ownerKey) ||
      (!candidate.isNPP && row.seats !== 1) ||
      (officeType && officeType !== "assemblyDeputy")
    )
      throw new Error("Bulgarian frozen winner is unavailable or has an incompatible office");
    seenOwners.add(ownerKey);
    officials.push({
      _id: stableId(`${receipt._id}:official:${row.id}`),
      countryId: "BG",
      officeType: "assemblyDeputy",
      state: election.state,
      characterId: candidate.isNPP ? null : candidate.characterId,
      nppId: candidate.isNPP ? candidate.nppId : null,
      characterName: candidate.characterName,
      party: candidate.party,
      isNPP: !!candidate.isNPP,
      seatsHeld: row.seats,
      seatSource: candidate.party === "independent" ? "direct" : "list",
      electedAt: now,
    });
  }
  const incumbents = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId: "BG", officeType: "assemblyDeputy" }, { session })
    .toArray();
  if (incumbents.length)
    await db.collection(BG_ASSEMBLY_ARCHIVES_COLLECTION).insertMany(
      incumbents.map((official) => ({
        _id: `${receipt._id}:${official._id.toHexString()}`,
        countryId: "BG",
        receiptId: receipt._id,
        turn,
        official,
      })),
      { session }
    );
  const previousPlayers = incumbents.flatMap((row) => (row.characterId ? [row.characterId] : []));
  const previousNpcs = incumbents.flatMap((row) => (row.nppId ? [row.nppId] : []));
  if (previousPlayers.length)
    await db
      .collection<Character>("characters")
      .updateMany(
        { _id: { $in: previousPlayers }, "currentOffice.type": "assemblyDeputy" },
        { $set: { currentOffice: null, updatedAt: now } },
        { session }
      );
  if (previousNpcs.length)
    await db
      .collection<NPP>("npps")
      .updateMany(
        { _id: { $in: previousNpcs }, "currentOffice.type": "assemblyDeputy" },
        { $set: { currentOffice: null, updatedAt: now } },
        { session }
      );
  await db
    .collection<ElectedOfficial>("electedOfficials")
    .deleteMany({ countryId: "BG", officeType: "assemblyDeputy" }, { session });
  await db.collection<ElectedOfficial>("electedOfficials").insertMany(officials, { session });
  if (officials.some((row) => row.isNPP))
    await db.collection<NPP>("npps").bulkWrite(
      officials
        .filter((row) => row.isNPP)
        .map((row) => ({
          updateOne: {
            filter: { _id: row.nppId!, retiredAt: null },
            update: {
              $set: {
                currentOffice: {
                  type: "assemblyDeputy",
                  state: row.state!,
                  seatsHeld: row.seatsHeld!,
                },
                updatedAt: now,
              },
            },
          },
        })),
      { session }
    );
  if (officials.some((row) => !row.isNPP))
    await db.collection<Character>("characters").bulkWrite(
      officials
        .filter((row) => !row.isNPP)
        .map((row) => ({
          updateOne: {
            filter: { _id: row.characterId! },
            update: {
              $set: {
                currentOffice: { type: "assemblyDeputy", state: row.state!, seatsHeld: 1 },
                updatedAt: now,
              },
              $push: {
                careerHistory: {
                  type: "elected",
                  office: { type: "assemblyDeputy", state: row.state!, seatsHeld: 1 },
                  officeLabel: "National Assembly Deputy",
                  party: row.party!,
                  partyCountryId: "BG",
                  date: now,
                },
              },
            },
          },
        })),
      { session }
    );
  const finalizedTallies = await db.collection<ElectionVoteTally>("electionVoteTallies").bulkWrite(
    elections.map((election) => ({
      updateOne: {
        filter: {
          electionId: election._id,
          ...(receipt.legacyResolvedElectionIds?.includes(election._id.toHexString())
            ? {}
            : { finalized: false }),
        },
        update: {
          $set: {
            finalized: true,
            bgOrdinaryBallot: true as const,
            seatsEstimate: settled.candidateSeatsByElection[election._id.toHexString()],
            resolutionPath: "bg_ordinary_national" as const,
            resolvedAtTurn: turn,
            updatedAt: now,
            resolvedTotalSeats: receipt.plan.regionCapacity[election.state],
            resolvedSeatHolders: officials
              .filter((row) => row.state === election.state)
              .map((row) => ({
                identity: `${row.isNPP ? "npp" : "player"}:${row.isNPP ? row.nppId : row.characterId}`,
                party: row.party!,
                seats: row.seatsHeld!,
                seatSource: row.seatSource!,
              })),
          },
        },
      },
    })),
    { session }
  );
  if (finalizedTallies.matchedCount !== 5)
    throw new Error("Bulgarian handover tally custody changed");
  await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { electionId: { $in: ids }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } },
      { session }
    );
  await db.collection<Election>("elections").bulkWrite(
    elections.map((row) => ({
      updateOne: {
        filter: { _id: row._id, status: { $in: ["completed", "resolved"] } },
        update: {
          $set: {
            status: "resolved" as const,
            resolving: false,
            totalSeats: receipt.plan.regionCapacity[row.state],
            updatedAt: now,
          },
        },
      },
    })),
    { session }
  );
  const resized = await db.collection<State>("states").bulkWrite(
    regions.map((id) => ({
      updateOne: {
        filter: { _id: id, countryId: "BG" },
        update: { $set: { houseDistricts: receipt.plan.regionCapacity[id] } },
      },
    })),
    { session }
  );
  if (resized.matchedCount !== 5) throw new Error("Bulgarian handover requires all five regions");
  const formation = await db
    .collection<GovernmentFormation>("governmentFormations")
    .updateOne(
      { _id: "BG" },
      { $set: { totalSeats: 240, majorityThreshold: 121, updatedAt: now } },
      { session }
    );
  if (formation.matchedCount !== 1) throw new Error("Bulgarian government formation is missing");
  await db.collection<CountryGameState>("countryGameStates").updateOne(
    { _id: "BG" },
    {
      $set: {
        bgOrdinaryAssemblySinceTurn: country.bgOrdinaryAssemblySinceTurn ?? turn,
        updatedAt: now,
      },
    },
    { session }
  );
  if (officials.some((row) => !row.isNPP))
    await db.collection("notifications").insertMany(
      players
        .filter((player) => officials.some((row) => row.characterId?.equals(player._id)))
        .map((player) => ({
          _id: stableId(`${receipt._id}:notice:${player._id.toHexString()}`),
          userId: player.userId,
          type: "general_win",
          title: "National Assembly Election Won",
          message: "You won one seat in Bulgaria's National Assembly.",
          metadata: { receiptId: receipt._id, cycle, countryId: "BG" },
          read: false,
          createdAt: now,
        })),
      { session }
    );
  const finalized = await journal.updateOne(
    { _id: receipt._id, seatedAtTurn: { $exists: false } },
    {
      $set: {
        seatedAtTurn: turn,
        seatedAt: now,
        officialIds: officials.map((row) => row._id),
        settledCandidateSeats: settled.candidateSeatsByElection,
      },
    },
    { session }
  );
  if (finalized.modifiedCount !== 1)
    throw new Error("Bulgarian seating receipt changed concurrently");
  return true;
}

export async function seatBgOrdinaryAssembly(
  db: Db,
  cycle: number,
  turn: number,
  now: Date
): Promise<boolean> {
  return runRequiredTransaction((session) =>
    materializeBgOrdinaryAssembly({ db, session, cycle, turn, now })
  );
}
