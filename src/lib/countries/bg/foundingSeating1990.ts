/**
 * Bulgaria installs constituency and list deputies together after certification.
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
import { BG_FOUNDING_COUNTS_COLLECTION, type BgFoundingAssemblyRecord } from "./foundingCount1990";
import { settleBgFoundingMandates } from "./rules/foundingMandates1990";
import { BG_1990_REGION_CAPACITY } from "./data/foundingDistricts1990";

export const BG_FOUNDING_OFFICE_ARCHIVES_COLLECTION = "bgFoundingAssemblyOfficeArchives";
interface BgFoundingAssemblyArchive {
  _id: string;
  countryId: "BG";
  receiptId: string;
  turn: number;
  official: ElectedOfficial;
}
function stableId(key: string): ObjectId {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}

export async function materializeBgFoundingAssemblySeating(input: {
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
    cycle < 0 ||
    !Number.isSafeInteger(turn) ||
    turn < 0 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Bulgarian handover needs an active transaction, cycle, turn and time");
  const journal = db.collection<BgFoundingAssemblyRecord>(BG_FOUNDING_COUNTS_COLLECTION);
  const receipt = await journal.findOne({ _id: `BG:founding1990:${cycle}` }, { session });
  if (!receipt || receipt.seatedAtTurn != null || receipt.count.kind !== "certified") return false;
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default") throw new Error("No native Bulgarian mandate in this world");
  const ids = [...receipt.electionIds, ...(receipt.runoffElectionIds ?? [])].map(
    (id) => new ObjectId(id)
  );
  const elections = await db
    .collection<Election>("elections")
    .find(
      {
        _id: { $in: ids },
        countryId: "BG",
        electionType: "nationalAssembly",
        cycle,
        status: { $in: ["completed", "resolved"] },
        "bulgarianFoundingRound.receiptId": receipt._id,
      },
      { session, projection: { state: 1, status: 1, bulgarianFoundingRound: 1 } }
    )
    .toArray();
  if (
    elections.length !== ids.length ||
    receipt.electionIds.length !== 5 ||
    new Set(
      elections.filter((row) => row.bulgarianFoundingRound?.round === 1).map((row) => row.state)
    ).size !== 5
  )
    throw new Error("Bulgarian certified cohort is incomplete or changed");
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
          bulgarianFoundingNomination: 1,
        },
      }
    )
    .toArray();
  const rootCandidates = new Map(
    candidates
      .filter(
        (row) =>
          receipt.electionIds.includes(row.electionId.toHexString()) ||
          row.bulgarianFoundingNomination?.rootCandidateId === row._id.toHexString()
      )
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
          { _id: { $in: npcIds }, countryId: "BG", retiredAt: null, isTechnocrat: { $ne: true } },
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
            countryId: "BG",
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
    const successor = candidates.find(
      (row) =>
        row.bulgarianFoundingNomination?.rootCandidateId === person.candidateId &&
        row.status === "active"
    );
    const transferredToRunoff = candidate?.status === "withdrawn" && successor?.status === "active";
    const acceptable =
      !!candidate &&
      !!owner &&
      owner.party === person.partyId &&
      candidate.party === person.partyId &&
      !!(person.isNpc ? candidate.nppId : candidate.characterId)?.equals(
        new ObjectId(person.ownerId)
      ) &&
      (candidate.status === "active" ||
        transferredToRunoff ||
        receipt.legacyResolvedElectionIds.includes(candidate.electionId.toHexString())) &&
      (!officeType || ["assemblyDeputy", "primeMinister"].includes(officeType));
    if (!acceptable) unavailable.add(person.id);
  }
  if (receipt.count.lists.kind !== "allocated") return false;
  const settled = settleBgFoundingMandates({
    nominations: receipt.nominations,
    constituencyWinners: receipt.count.constituencyWinners,
    districtListSeats: receipt.count.lists.districtSeats,
    availablePersonIds: new Set(
      receipt.nominations.people
        .filter((person) => !unavailable.has(person.id))
        .map((person) => person.id)
    ),
  });
  const names = new Map(receipt.nominees.map((row) => [row.id, row.name]));
  const officials: ElectedOfficial[] = settled.mandates.map((row) => ({
    _id: stableId(`${receipt._id}:person:${row.personId}`),
    countryId: "BG",
    officeType: "assemblyDeputy",
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
    bulgarianFoundingMandate: {
      receiptId: receipt._id,
      personId: row.personId,
      tier: row.tier,
      districtId: row.districtId,
      rootCandidateId: row.candidateId,
    },
  }));
  const incumbents = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId: "BG", officeType: { $in: ["assemblyDeputy"] } }, { session })
    .toArray();
  if (incumbents.length)
    await db
      .collection<BgFoundingAssemblyArchive>(BG_FOUNDING_OFFICE_ARCHIVES_COLLECTION)
      .insertMany(
        incumbents.map((official) => ({
          _id: `${receipt._id}:${official._id.toHexString()}`,
          countryId: "BG" as const,
          receiptId: receipt._id,
          turn,
          official,
        })),
        { session }
      );
  for (const isNpc of [false, true]) {
    const collection = isNpc ? db.collection<NPP>("npps") : db.collection<Character>("characters");
    await collection.updateMany(
      { countryId: "BG", "currentOffice.type": { $in: ["assemblyDeputy"] } },
      {
        $set: { currentOffice: null, updatedAt: now },
        ...(isNpc ? { $unset: { seatsHeld: "" as const } } : {}),
      },
      { session }
    );
  }
  await db
    .collection<ElectedOfficial>("electedOfficials")
    .deleteMany({ countryId: "BG", officeType: { $in: ["assemblyDeputy"] } }, { session });
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
            filter: { _id: new ObjectId(row.ownerId), countryId: "BG" as const },
            update: {
              $set: {
                currentOffice: isPrimeMinister
                  ? typeof originalOffice === "object" && originalOffice
                    ? originalOffice
                    : { type: "primeMinister" as const }
                  : { type: "assemblyDeputy", state: row.state, seatsHeld: row.seats },
                updatedAt: now,
                ...(isNpc ? { seatsHeld: row.seats } : {}),
              },
              ...(!isNpc
                ? {
                    $push: {
                      careerHistory: {
                        type: "elected" as const,
                        office: { type: "assemblyDeputy", state: row.state, seatsHeld: 1 },
                        officeLabel: "National Assembly Deputy",
                        party: row.party,
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
            bulgarianFoundingBallot: true as const,
            resolutionPath: "bg_founding_parallel" as const,
            resolvedAtTurn: turn,
            updatedAt: now,
            resolvedTotalSeats: BG_1990_REGION_CAPACITY[election.state],
            seatsEstimate: Object.fromEntries(
              receipt.nominees
                .filter((row) => row.regionId === election.state)
                .map((row) => [
                  candidates
                    .find(
                      (candidate) =>
                        candidate.electionId.equals(election._id) &&
                        (candidate._id.toHexString() === row.id ||
                          candidate.bulgarianFoundingNomination?.rootCandidateId === row.id)
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
    throw new Error("Bulgarian handover lost tally custody");
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
            totalSeats: BG_1990_REGION_CAPACITY[row.state],
            updatedAt: now,
          },
        },
      },
    })),
    { session }
  );
  if (finalizedElections.matchedCount !== ids.length)
    throw new Error("Bulgarian handover lost election custody");
  const resized = await db.collection<State>("states").bulkWrite(
    Object.entries(BG_1990_REGION_CAPACITY).map(([id, seats]) => ({
      updateOne: {
        filter: { _id: id, countryId: "BG" },
        update: { $set: { houseDistricts: seats } },
      },
    })),
    { session }
  );
  if (resized.matchedCount !== 5) throw new Error("Bulgarian handover requires all five regions");
  const formation = await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: "BG" },
    {
      $set: { totalSeats: 400, majorityThreshold: 201, updatedAt: now },
    },
    { session }
  );
  if (formation.matchedCount !== 1) throw new Error("Bulgarian government formation is missing");
  const notices = players.filter((player) => owners.has(`player:${player._id.toHexString()}`));
  if (notices.length)
    await db.collection("notifications").insertMany(
      notices.map((player) => ({
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
        settled,
      },
    },
    { session }
  );
  if (finalized.modifiedCount !== 1)
    throw new Error("Bulgarian seating receipt changed concurrently");
  return true;
}

export async function seatBgFoundingAssembly(
  db: Db,
  cycle: number,
  turn: number,
  now: Date
): Promise<boolean> {
  return runRequiredTransaction((session) =>
    materializeBgFoundingAssemblySeating({ db, session, cycle, turn, now })
  );
}
