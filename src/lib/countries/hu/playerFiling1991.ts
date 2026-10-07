/**
 * Hungarian player filing reserves one party district and one character slot
 * in the frozen Assembly cohort. The candidacy and reservation commit together;
 * withdrawal and re-entry reuse the original person and their recorded ballots.
 */
import { MongoServerError, ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  GameState,
  PoliticalParty,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { chooseHu1991PlayerDistrict } from "./rules/playerFiling1991";
import { isHu1991AssemblyCampaign } from "./rules/assemblyCampaign1991";
export const HU_1991_FILING_LOCKS_COLLECTION = "hu1991AssemblyFilingLocks";
export type Hu1991FilingFailure =
  | "invalid-ballot"
  | "filing-closed"
  | "invalid-residence"
  | "outside-region"
  | "party-slot-full"
  | "already-filed"
  | "unregistered-party"
  | "party-changed"
  | "incompatible-office";
export const hu1991FilingMessages: Record<Hu1991FilingFailure, string> = {
  "invalid-ballot": "This race no longer belongs to a valid Hungarian Assembly cohort.",
  "filing-closed":
    "Hungarian Assembly filing has closed. Second rounds retain their qualified nominees.",
  "invalid-residence":
    "Choose a playable Hungarian residence in this campaign region before filing.",
  "outside-region": "Choose a constituency inside your home campaign region.",
  "party-slot-full":
    "Your party already has a player filed in this constituency. Choose another constituency.",
  "already-filed": "You have already filed in this Hungarian Assembly cycle.",
  "unregistered-party": "Join an existing unbanned Hungarian party or file as an independent.",
  "party-changed":
    "This person's party and constituency are fixed for the current Assembly election.",
  "incompatible-office": "Your current office is incompatible with a Hungarian Assembly mandate.",
};
interface FilingLock {
  _id: string;
  ownerId: string;
  electionId: ObjectId;
  candidateId: ObjectId;
  party: string;
  constituencyId: string;
  createdAt: Date;
}
export async function materializeHu1991PlayerFiling(input: {
  db: Db;
  session: ClientSession;
  electionId: ObjectId;
  candidateId: ObjectId;
  candidate: Omit<ElectionCandidate, "_id">;
  requestedDistrictId?: string;
  turn: number;
  now: Date;
}): Promise<
  { allowed: true; insertedId: ObjectId } | { allowed: false; reason: Hu1991FilingFailure }
> {
  const { db, session, electionId, candidateId, candidate, requestedDistrictId, turn, now } = input;
  const reject = (reason: Hu1991FilingFailure) => ({ allowed: false as const, reason });
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 0 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Hungarian filing needs an active transaction and time");
  const election = await db
    .collection<Election>("elections")
    .findOne({ _id: electionId }, { session });
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, currentTurn: 1, huAssemblyReformedAtYear: 1 } }
    );
  const modern = election?.hungarianModernByElection;
  if (
    !election ||
    game?.preset !== "1991-default" ||
    (!isHu1991AssemblyCampaign(election) &&
      (!modern || election.countryId !== "HU" || election.electionType !== "nationalAssembly")) ||
    !candidate.electionId.equals(electionId) ||
    candidate.isNPP
  )
    return reject("invalid-ballot");
  if (
    (!modern && election.hungarianAssemblyRound!.round !== 1) ||
    !["active", "upcoming"].includes(election.status) ||
    (election.primaryEndTurn != null
      ? Math.max(turn, game.currentTurn) >= election.primaryEndTurn
      : !election.primaryEndTime || now >= election.primaryEndTime)
  )
    return reject("filing-closed");
  const character = await db.collection<Character>("characters").findOne(
    { _id: candidate.characterId },
    {
      session,
      projection: {
        countryId: 1,
        homeState: 1,
        party: 1,
        currentOffice: 1,
        federationPendingResidenceId: 1,
      },
    }
  );
  if (
    !character ||
    character.countryId !== "HU" ||
    character.homeState !== election.state ||
    character.federationPendingResidenceId !== undefined
  )
    return reject("invalid-residence");
  if (character.party !== candidate.party) return reject("party-changed");
  if (
    character.currentOffice &&
    !["assemblyDelegate", "assemblyDeputy", "primeMinister"].includes(character.currentOffice.type)
  )
    return reject("incompatible-office");
  if (
    (modern || election.hungarianAssemblyRound!.byElection) &&
    (await db.collection("electedOfficials").findOne(
      {
        countryId: "HU",
        officeType: { $in: ["assemblyDelegate", "assemblyDeputy"] },
        characterId: candidate.characterId,
      },
      { session, projection: { _id: 1 } }
    ))
  )
    return reject("incompatible-office");
  if (candidate.party !== "independent") {
    const sequence = Number(candidate.party);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || String(sequence) !== candidate.party)
      return reject("unregistered-party");
    const party = await db.collection<PoliticalParty>("politicalParties").findOne(
      {
        countryId: "HU",
        sequentialId: sequence,
      },
      {
        session,
        projection: { regimeStatus: 1 },
      }
    );
    if (!party || party.regimeStatus === "banned") return reject("unregistered-party");
  }
  let districts: readonly { id: string; regionId: string }[] | undefined;
  const receiptId = modern?.receiptId ?? election.hungarianAssemblyRound!.receiptId;
  let byElection = election.hungarianAssemblyRound?.byElection;
  if (modern) {
    const job = await db
      .collection<import("./constituencyByElections2011").HuModernByElectionRecord>(
        "hu2011ConstituencyByElections"
      )
      .findOne({ _id: receiptId }, { session });
    const parent = await db
      .collection<import("./assemblyCount2011").Hu2011AssemblyRecord>("hu2011AssemblyCounts")
      .findOne(
        { seatedAtTurn: { $exists: true } },
        { session, sort: { seatedAtTurn: -1 }, projection: { _id: 1 } }
      );
    if (
      !job ||
      game.huAssemblyReformedAtYear == null ||
      job.completedAtTurn != null ||
      job.parentReceiptId !== parent?._id ||
      job.parentReceiptId !== modern.parentReceiptId ||
      job.parentReceiptId !== `HU:mixed2011:${election.cycle}` ||
      receiptId !== `${job.parentReceiptId}:by-election:${job.generation}` ||
      !job.electionIds.includes(electionId.toHexString()) ||
      !job.districtIds.includes(modern.districtId) ||
      Math.max(turn, game.currentTurn) >= job.termEndTurn
    )
      return reject("invalid-ballot");
    const chamberLock = await db
      .collection<{ _id: string; hu1991MandateGeneration?: number }>("governmentFormations")
      .updateOne({ _id: "HU" }, { $inc: { hu1991MandateGeneration: 1 } }, { session });
    if (chamberLock.matchedCount !== 1)
      throw new Error("Hungarian filing lost its chamber authority");
    districts = job.constituencies;
    byElection = {
      parentReceiptId: job.parentReceiptId,
      generation: job.generation,
      districtIds: [modern.districtId],
    };
  } else {
    const expectedReceipt = byElection
      ? `${byElection.parentReceiptId}:by-election:${byElection.generation}`
      : `HU:mixed1989:${election.cycle}`;
    if (
      receiptId !== expectedReceipt ||
      (byElection && byElection.parentReceiptId !== `HU:mixed1989:${election.cycle}`)
    )
      return reject("invalid-ballot");
    if (byElection) {
      const job = await db
        .collection<import("./constituencyByElections1991").Hu1991ByElectionRecord>(
          "hu1991ConstituencyByElections"
        )
        .findOne({ _id: receiptId }, { session });
      const parent = await db
        .collection<import("./assemblyCount1991").Hu1991AssemblyRecord>("hu1991AssemblyCounts")
        .findOne(
          { seatedAtTurn: { $exists: true } },
          { session, sort: { seatedAtTurn: -1 }, projection: { _id: 1 } }
        );
      if (
        !job ||
        job.round !== 1 ||
        job.completedAtTurn != null ||
        !job.activeElectionIds.includes(electionId.toHexString()) ||
        job.parentReceiptId !== parent?._id ||
        Math.max(turn, game.currentTurn) >= job.termEndTurn ||
        JSON.stringify(job.districtIds) !== JSON.stringify(byElection.districtIds)
      )
        return reject("invalid-ballot");
    }
  }
  const locks = db.collection<FilingLock>(HU_1991_FILING_LOCKS_COLLECTION);
  const ownerId = candidate.characterId.toHexString();
  const ownerKey = `${receiptId}:player:${ownerId}`;
  const saved = await locks.findOne({ _id: ownerKey }, { session });
  if (saved) {
    if (!saved.electionId.equals(electionId)) return reject("already-filed");
    if (
      saved.party !== candidate.party ||
      (requestedDistrictId && requestedDistrictId !== saved.constituencyId)
    )
      return reject("party-changed");
    const prior = await db
      .collection<ElectionCandidate>("electionCandidates")
      .findOne(
        { _id: saved.candidateId, characterId: candidate.characterId, electionId },
        { session }
      );
    if (!prior) throw new Error("Hungarian filing reservation has lost its original candidate");
    if (prior.status === "active") return reject("already-filed");
    await db.collection<ElectionCandidate>("electionCandidates").updateOne(
      { _id: prior._id, status: "withdrawn" },
      {
        $set: { status: "active" },
        $unset: { withdrawnAt: "", withdrawnBy: "" },
      },
      { session }
    );
    return { allowed: true, insertedId: prior._id };
  }
  const legacy = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId, characterId: candidate.characterId, isNPP: { $ne: true } },
      {
        session,
        projection: { party: 1, status: 1, hungarianAssemblyNomination: 1 },
      }
    )
    .toArray();
  if (legacy.length > 1) return reject("already-filed");
  const prior = legacy[0];
  if (prior?.party !== undefined && prior.party !== candidate.party) return reject("party-changed");
  if (prior?.status === "active") return reject("already-filed");
  if (
    prior?.hungarianAssemblyNomination?.constituencyId &&
    requestedDistrictId &&
    prior.hungarianAssemblyNomination.constituencyId !== requestedDistrictId
  )
    return reject("party-changed");
  const peers = await locks.find({ electionId, party: candidate.party }, { session }).toArray();
  const district = chooseHu1991PlayerDistrict({
    districts,
    personId: ownerId,
    regionId: election.state,
    partyId: candidate.party,
    requestedId:
      prior?.hungarianAssemblyNomination?.constituencyId ??
      requestedDistrictId ??
      modern?.districtId,
    allowedDistrictIds: byElection?.districtIds,
    otherFilings: peers.map((row) => ({
      personId: row.ownerId,
      partyId: row.party,
      constituencyId: row.constituencyId,
    })),
  });
  if (!district.allowed) return reject(district.reason);
  const partyKey = `${receiptId}:party:${candidate.party}:constituency:${district.constituencyId}`;
  if (candidate.party !== "independent") {
    const occupied = await locks.findOne({ _id: partyKey }, { session });
    if (occupied && occupied.ownerId !== ownerId) return reject("party-slot-full");
  }
  const reservation: FilingLock = {
    _id: ownerKey,
    ownerId,
    electionId,
    candidateId: prior?._id ?? candidateId,
    party: candidate.party,
    constituencyId: district.constituencyId,
    createdAt: now,
  };
  await locks.insertOne(reservation, { session });
  if (candidate.party !== "independent")
    await locks.insertOne({ ...reservation, _id: partyKey }, { session });
  if (prior) {
    await db.collection<ElectionCandidate>("electionCandidates").updateOne(
      { _id: prior._id, status: "withdrawn" },
      {
        $set: {
          status: "active",
          hungarianAssemblyNomination: { constituencyId: district.constituencyId },
        },
        $unset: { withdrawnAt: "", withdrawnBy: "" },
      },
      { session }
    );
    return { allowed: true, insertedId: prior._id };
  }
  await db.collection<ElectionCandidate>("electionCandidates").insertOne(
    {
      ...candidate,
      _id: candidateId,
      hungarianAssemblyNomination: { constituencyId: district.constituencyId },
    },
    { session }
  );
  return { allowed: true, insertedId: candidateId };
}
export async function registerHu1991PlayerFiling(
  input: Omit<Parameters<typeof materializeHu1991PlayerFiling>[0], "session" | "candidateId">
) {
  const candidateId = new ObjectId();
  try {
    return await runRequiredTransaction((session) =>
      materializeHu1991PlayerFiling({ ...input, session, candidateId })
    );
  } catch (error) {
    if (
      error instanceof MongoServerError &&
      error.code === 11000 &&
      error.message.includes(HU_1991_FILING_LOCKS_COLLECTION) &&
      typeof error.keyValue?._id === "string" &&
      (error.keyValue._id.startsWith("HU:mixed1989:") ||
        error.keyValue._id.startsWith("HU:mixed2011:"))
    ) {
      return {
        allowed: false as const,
        reason: error.keyValue._id.includes(":player:")
          ? ("already-filed" as const)
          : ("party-slot-full" as const),
      };
    }
    throw error;
  }
}
