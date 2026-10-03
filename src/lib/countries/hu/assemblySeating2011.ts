/**
 * Hungary installs constituency and list deputies together after certification.
 * Offices, financial-owner mirrors, all campaign results and the receipt commit
 * in one required transaction; withdrawals cannot reassign personal district wins.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Character,
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
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { HU_2011_COUNTS_COLLECTION, type Hu2011AssemblyRecord } from "./assemblyCount2011";
import { settleHuModernAssembly } from "./rules/modernAssembly2011";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";

export const HU_2011_OFFICE_ARCHIVES_COLLECTION = "hu2011AssemblyOfficeArchives";
interface Hu2011AssemblyArchive {
  _id: string;
  countryId: "HU";
  receiptId: string;
  turn: number;
  official: ElectedOfficial;
}
function stableId(key: string): ObjectId {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}

export async function materializeHu2011AssemblySeating(input: {
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
    throw new Error("Hungarian handover needs an active transaction, cycle, turn and time");
  const journal = db.collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION);
  const receipt = await journal.findOne({ _id: `HU:mixed2011:${cycle}` }, { session });
  if (!receipt || receipt.seatedAtTurn != null || receipt.count.kind !== "counted") return false;
  const game = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      session,
      projection: {
        preset: 1,
        preIteration: 1,
        preIterationTurns: 1,
        huAssemblyReformedAtYear: 1,
      },
    }
  );
  if (game?.preset !== "1991-default") throw new Error("No native Hungarian mandate in this world");
  const ids = receipt.electionIds.map((id) => new ObjectId(id));
  const elections = await db
    .collection<Election>("elections")
    .find(
      {
        _id: { $in: ids },
        countryId: "HU",
        electionType: "nationalAssembly",
        cycle,
        status: { $in: ["completed", "resolved"] },
        "hungarianModernAssembly.ruleVersion": "mixed-2011-v1",
      },
      { session, projection: { state: 1, status: 1, hungarianModernAssembly: 1 } }
    )
    .toArray();
  if (
    elections.length !== ids.length ||
    receipt.electionIds.length !== 6 ||
    new Set(elections.map((row) => row.state)).size !== 6
  )
    throw new Error("Hungarian certified cohort is incomplete or changed");
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
          hungarianAssemblyNomination: 1,
        },
      }
    )
    .toArray();
  const rootCandidates = new Map(
    candidates
      .filter((row) => receipt.electionIds.includes(row.electionId.toHexString()))
      .map((row) => [row._id.toHexString(), row])
  );
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
          { _id: { $in: npcIds }, countryId: "HU", retiredAt: null, isTechnocrat: { $ne: true } },
          {
            session,
            projection: { party: 1, currentOffice: 1 },
          }
        )
        .toArray()
    : [];
  const players = playerIds.length
    ? await db
        .collection<Character>("characters")
        .find(
          {
            _id: { $in: playerIds },
            countryId: "HU",
            federationPendingResidenceId: { $exists: false },
          },
          { session, projection: { party: 1, currentOffice: 1, userId: 1 } }
        )
        .toArray()
    : [];
  const npcMap = new Map(npcs.map((row) => [row._id.toHexString(), row])),
    playerMap = new Map(players.map((row) => [row._id.toHexString(), row]));
  const unavailable = new Set<string>();
  for (const person of receipt.nominations.people) {
    const candidate = rootCandidates.get(person.candidateId);
    const owner = (person.isNpc ? npcMap : playerMap).get(person.ownerId);
    const mirror = owner?.currentOffice;
    const officeType = typeof mirror === "string" ? mirror : mirror?.type;
    const acceptable =
      !!candidate &&
      !!owner &&
      owner.party === person.partyId &&
      candidate.party === person.partyId &&
      !!(person.isNpc ? candidate.nppId : candidate.characterId)?.equals(
        new ObjectId(person.ownerId)
      ) &&
      candidate.status === "active" &&
      (!officeType || ["assemblyDelegate", "assemblyDeputy", "primeMinister"].includes(officeType));
    if (!acceptable) unavailable.add(person.id);
  }
  const settled = settleHuModernAssembly(
    receipt.installed,
    receipt.nominations.people,
    unavailable
  );
  const names = new Map(receipt.nominees.map((row) => [row.id, row.name]));
  const officials: ElectedOfficial[] = settled.mandates.map((row) => ({
    _id: stableId(`${receipt._id}:person:${row.personId}`),
    countryId: "HU",
    officeType: "assemblyDelegate",
    state: row.regionId,
    characterId: row.isNpc ? null : new ObjectId(row.ownerId),
    nppId: row.isNpc ? new ObjectId(row.ownerId) : null,
    isNPP: row.isNpc,
    characterName: names.get(row.candidateId),
    party: row.partyId,
    seatsHeld: 1,
    constituencyId: row.districtId,
    seatSource: row.tier === "constituency" ? "direct" : "list",
    electedAt: now,
    termEnds: new Date(now.getTime() + 192 * MS_PER_TURN),
    createdAt: now,
    updatedAt: now,
    hungarianAssemblyMandate: {
      receiptId: receipt._id,
      personId: row.personId,
      tier: row.tier,
      districtId: row.districtId,
      rootCandidateId: row.candidateId,
    },
  }));
  const incumbents = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "HU", officeType: { $in: ["assemblyDelegate", "assemblyDeputy"] } },
      { session }
    )
    .toArray();
  if (incumbents.length)
    await db.collection<Hu2011AssemblyArchive>(HU_2011_OFFICE_ARCHIVES_COLLECTION).insertMany(
      incumbents.map((official) => ({
        _id: `${receipt._id}:${official._id.toHexString()}`,
        countryId: "HU" as const,
        receiptId: receipt._id,
        turn,
        official,
      })),
      { session }
    );
  for (const isNpc of [false, true]) {
    const collection = isNpc ? db.collection<NPP>("npps") : db.collection<Character>("characters");
    await collection.updateMany(
      { countryId: "HU", "currentOffice.type": { $in: ["assemblyDelegate", "assemblyDeputy"] } },
      {
        $set: { currentOffice: null, updatedAt: now },
        ...(isNpc ? { $unset: { seatsHeld: "" as const } } : {}),
      },
      { session }
    );
  }
  await db
    .collection<ElectedOfficial>("electedOfficials")
    .deleteMany(
      { countryId: "HU", officeType: { $in: ["assemblyDelegate", "assemblyDeputy"] } },
      { session }
    );
  if (officials.length)
    await db.collection<ElectedOfficial>("electedOfficials").insertMany(officials, { session });
  const owners = new Map<
    string,
    { ownerId: string; isNpc: boolean; state: string; party: string; seats: number }
  >();
  for (const row of settled.mandates) {
    const key = `${row.isNpc ? "npc" : "player"}:${row.ownerId}`;
    const old = owners.get(key);
    owners.set(key, {
      ownerId: row.ownerId,
      isNpc: row.isNpc,
      state: row.regionId,
      party: row.partyId,
      seats: (old?.seats ?? 0) + 1,
    });
  }
  for (const isNpc of [false, true]) {
    const selected = [...owners.values()].filter((row) => row.isNpc === isNpc);
    if (!selected.length) continue;
    const collection = isNpc ? db.collection<NPP>("npps") : db.collection<Character>("characters");
    await collection.bulkWrite(
      selected.map((row) => {
        const originalOffice = (isNpc ? npcMap : playerMap).get(row.ownerId)?.currentOffice;
        const legacyOffice: unknown = originalOffice;
        const isPrimeMinister =
          legacyOffice === "primeMinister" ||
          (originalOffice &&
            typeof originalOffice === "object" &&
            originalOffice.type === "primeMinister");
        return {
          updateOne: {
            filter: { _id: new ObjectId(row.ownerId), countryId: "HU" as const },
            update: {
              $set: {
                currentOffice: isPrimeMinister
                  ? typeof originalOffice === "object" && originalOffice
                    ? originalOffice
                    : { type: "primeMinister" as const }
                  : { type: "assemblyDelegate", state: row.state, seatsHeld: row.seats },
                updatedAt: now,
                ...(isNpc ? { seatsHeld: row.seats } : {}),
              },
              ...(!isNpc
                ? {
                    $push: {
                      careerHistory: {
                        type: "elected" as const,
                        office: { type: "assemblyDelegate", state: row.state, seatsHeld: 1 },
                        officeLabel: "National Assembly Deputy",
                        party: row.party,
                        partyCountryId: "HU",
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
  const finalizedTallies = await db.collection<ElectionVoteTally>("electionVoteTallies").bulkWrite(
    elections.map((election) => ({
      updateOne: {
        filter: {
          electionId: election._id,
          ...(receipt.legacyResolvedElectionIds.includes(election._id.toHexString())
            ? {}
            : { finalized: false }),
        },
        update: {
          $set: {
            finalized: true,
            hungarianAssemblyBallot: true as const,
            resolutionPath: "hu_statutory_mixed" as const,
            resolvedAtTurn: turn,
            updatedAt: now,
            resolvedTotalSeats: settled.regionCapacity[election.state],
            seatsEstimate: Object.fromEntries(
              receipt.nominees
                .filter((row) => row.regionId === election.state)
                .map((row) => [
                  candidates
                    .find(
                      (candidate) =>
                        candidate.electionId.equals(election._id) &&
                        (candidate._id.toHexString() === row.id ||
                          candidate.hungarianAssemblyNomination?.rootCandidateId === row.id)
                    )
                    ?._id.toHexString() ?? row.id,
                  settled.candidateSeats[row.id] ?? 0,
                ])
            ),
            resolvedSeatHolders: officials
              .filter((row) => row.state === election.state)
              .map((row) => ({
                identity: `${row.isNPP ? "npp" : "player"}:${row.isNPP ? row.nppId : row.characterId}`,
                party: row.party!,
                seats: 1,
                seatSource: row.seatSource!,
              })),
          },
        },
      },
    })),
    { session }
  );
  if (finalizedTallies.matchedCount !== ids.length)
    throw new Error("Hungarian handover lost tally custody");
  await db.collection<ElectionCandidate>("electionCandidates").updateMany(
    { electionId: { $in: ids }, status: "active" },
    {
      $set: { status: "withdrawn", withdrawnAt: now },
    },
    { session }
  );
  const finalizedElections = await db.collection<Election>("elections").bulkWrite(
    elections.map((row) => ({
      updateOne: {
        filter: { _id: row._id, status: { $in: ["completed", "resolved"] } },
        update: {
          $set: {
            status: "resolved" as const,
            resolving: false,
            totalSeats: settled.regionCapacity[row.state],
            updatedAt: now,
          },
        },
      },
    })),
    { session }
  );
  if (finalizedElections.matchedCount !== ids.length)
    throw new Error("Hungarian handover lost election custody");
  const resized = await db.collection<State>("states").bulkWrite(
    Object.entries(settled.regionCapacity).map(([id, seats]) => ({
      updateOne: {
        filter: { _id: id, countryId: "HU" },
        update: { $set: { houseDistricts: seats } },
      },
    })),
    { session }
  );
  if (resized.matchedCount !== 6) throw new Error("Hungarian handover requires all six regions");
  const formation = await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: "HU" },
    {
      $set: { totalSeats: 199, majorityThreshold: 100, updatedAt: now },
      $inc: { hu1991MandateGeneration: 1 },
    },
    { session }
  );
  if (formation.matchedCount !== 1) throw new Error("Hungarian government formation is missing");
  const currentYear = turnToGameMonth(
    calendarTurn(turn, {
      preIterationActive: game.preIteration?.active,
      preIterationTurns: game.preIterationTurns,
    }),
    1991
  ).year;
  await db.collection<GameState>("gameState").updateOne(
    { _id: "current" },
    {
      $set: {
        huAssemblyReformedAtYear: game.huAssemblyReformedAtYear ?? currentYear,
        updatedAt: now,
      },
    },
    { session }
  );
  const notices = players.filter((player) => owners.has(`player:${player._id.toHexString()}`));
  if (notices.length)
    await db.collection("notifications").insertMany(
      notices.map((player) => ({
        _id: stableId(`${receipt._id}:notice:${player._id.toHexString()}`),
        userId: player.userId,
        type: "general_win",
        title: "National Assembly Election Won",
        message: "You won one seat in Hungary's National Assembly.",
        metadata: { receiptId: receipt._id, cycle, countryId: "HU" },
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
        settled,
      },
    },
    { session }
  );
  if (finalized.modifiedCount !== 1)
    throw new Error("Hungarian seating receipt changed concurrently");
  return true;
}

export async function seatHu2011Assembly(
  db: Db,
  cycle: number,
  turn: number,
  now: Date
): Promise<boolean> {
  return runRequiredTransaction(
    (session) => materializeHu2011AssemblySeating({ db, session, cycle, turn, now }),
    { client: db.client }
  );
}
