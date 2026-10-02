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
    .findOne({ _id: "current" }, { session, projection: { preset: 1, currentTurn: 1 } });
  if (
    !election ||
    game?.preset !== "1991-default" ||
    !isHu1991AssemblyCampaign(election) ||
    !candidate.electionId.equals(electionId) ||
    candidate.isNPP
  )
    return reject("invalid-ballot");
  if (
    election.hungarianAssemblyRound!.round !== 1 ||
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
  const receiptId = election.hungarianAssemblyRound!.receiptId;
  if (receiptId !== `HU:mixed1989:${election.cycle}`) return reject("invalid-ballot");
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
        $unset: { withdrawnAt: "" },
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
    personId: ownerId,
    regionId: election.state,
    partyId: candidate.party,
    requestedId: prior?.hungarianAssemblyNomination?.constituencyId ?? requestedDistrictId,
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
        $unset: { withdrawnAt: "" },
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
      error.keyValue._id.startsWith("HU:mixed1989:")
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
