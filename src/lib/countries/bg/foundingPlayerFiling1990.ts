/**
 * Bulgarian player filing reserves one party district and one character slot
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
import { chooseBgFoundingPlayerDistrict } from "./rules/foundingPlayerFiling1990";
import { isBgFoundingCampaign } from "./rules/foundingCampaign1990";
import { BG_FOUNDING_COUNTS_COLLECTION, type BgFoundingAssemblyRecord } from "./foundingCount1990";
import {
  addBgFoundingRenewedNominee,
  bgFoundingOpenNominationDistricts,
} from "./rules/foundingRenewal1990";
export const BG_FOUNDING_FILING_LOCKS_COLLECTION = "bgFoundingAssemblyFilingLocks";
export type BgFoundingFilingFailure =
  | "invalid-ballot"
  | "filing-closed"
  | "invalid-residence"
  | "outside-region"
  | "party-slot-full"
  | "already-filed"
  | "unregistered-party"
  | "party-changed"
  | "incompatible-office";
export const bgFoundingFilingMessages: Record<BgFoundingFilingFailure, string> = {
  "invalid-ballot": "This race no longer belongs to a valid Bulgarian Assembly cohort.",
  "filing-closed":
    "Bulgarian Assembly filing has closed. New second-round nominations require an eligible constituency.",
  "invalid-residence":
    "Choose a playable Bulgarian residence in this campaign region before filing.",
  "outside-region": "Choose a constituency inside your home campaign region.",
  "party-slot-full":
    "Your party already has a player filed in this constituency. Choose another constituency.",
  "already-filed": "You have already filed in this Bulgarian Assembly cycle.",
  "unregistered-party": "Join an existing unbanned Bulgarian party or file as an independent.",
  "party-changed":
    "This person's party and constituency are fixed for the current Assembly election.",
  "incompatible-office": "Your current office is incompatible with a Bulgarian Assembly mandate.",
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
export async function materializeBgFoundingPlayerFiling(input: {
  db: Db;
  session: ClientSession;
  electionId: ObjectId;
  candidateId: ObjectId;
  candidate: Omit<ElectionCandidate, "_id">;
  requestedDistrictId?: string;
  turn: number;
  now: Date;
}): Promise<
  { allowed: true; insertedId: ObjectId } | { allowed: false; reason: BgFoundingFilingFailure }
> {
  const { db, session, electionId, candidateId, candidate, requestedDistrictId, turn, now } = input;
  const reject = (reason: BgFoundingFilingFailure) => ({ allowed: false as const, reason });
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 0 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Bulgarian filing needs an active transaction and time");
  const election = await db
    .collection<Election>("elections")
    .findOne({ _id: electionId }, { session });
  if (election?.bulgarianFoundingRound?.byElection) {
    const { materializeBgGrandPartialPlayerFiling } =
      await import("./constituencyByElectionPlayerFiling1991");
    return materializeBgGrandPartialPlayerFiling(input);
  }
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1, currentTurn: 1 } });
  if (
    !election ||
    game?.preset !== "1991-default" ||
    !isBgFoundingCampaign(election) ||
    !candidate.electionId.equals(electionId) ||
    ![1, 2].includes(election.bulgarianFoundingRound!.round) ||
    candidate.isNPP
  )
    return reject("invalid-ballot");
  if (
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
    character.countryId !== "BG" ||
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
        countryId: "BG",
        sequentialId: sequence,
      },
      {
        session,
        projection: { regimeStatus: 1 },
      }
    );
    if (!party || party.regimeStatus === "banned") return reject("unregistered-party");
  }
  const receiptId = election.bulgarianFoundingRound!.receiptId;
  const receipt =
    election.bulgarianFoundingRound!.round === 2
      ? await db
          .collection<BgFoundingAssemblyRecord>(BG_FOUNDING_COUNTS_COLLECTION)
          .findOne({ _id: receiptId }, { session })
      : null;
  const allowedDistrictIds = receipt
    ? bgFoundingOpenNominationDistricts(receipt.count, receipt.first, election.state)
    : undefined;
  if (
    election.bulgarianFoundingRound!.round === 2 &&
    (!receipt ||
      receipt.ruleVersion !== "parallel-1990-v1" ||
      receipt.count.kind !== "pending" ||
      !receipt.electionIds.includes(election.bulgarianFoundingRound!.rootElectionId) ||
      receipt.seatedAtTurn != null ||
      !receipt.activeRunoffElectionIds?.includes(electionId.toHexString()) ||
      !allowedDistrictIds?.length)
  )
    return reject("filing-closed");
  const locks = db.collection<FilingLock>(BG_FOUNDING_FILING_LOCKS_COLLECTION);
  const ownerId = candidate.characterId.toHexString();
  const ownerKey = `${receiptId}:player:${ownerId}`;
  const saved = await locks.findOne({ _id: ownerKey }, { session });
  if (saved) {
    if (!saved.electionId.equals(electionId)) return reject("already-filed");
    if (
      receipt &&
      (!allowedDistrictIds?.includes(saved.constituencyId) ||
        !receipt.nominations.people.some(
          (person) =>
            !person.isNpc &&
            person.candidateId === saved.candidateId.toHexString() &&
            person.ownerId === ownerId &&
            person.partyId === saved.party
        ))
    )
      return reject("invalid-ballot");
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
    if (!prior) throw new Error("Bulgarian filing reservation has lost its original candidate");
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
  if (receipt?.nominations.people.some((person) => !person.isNpc && person.ownerId === ownerId))
    return reject("already-filed");
  const legacy = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId, characterId: candidate.characterId, isNPP: { $ne: true } },
      {
        session,
        projection: { party: 1, status: 1, bulgarianFoundingNomination: 1 },
      }
    )
    .toArray();
  if (legacy.length > 1) return reject("already-filed");
  if (receipt && legacy.length) return reject("invalid-ballot");
  const prior = legacy[0];
  if (prior?.party !== undefined && prior.party !== candidate.party) return reject("party-changed");
  if (prior?.status === "active") return reject("already-filed");
  if (
    prior?.bulgarianFoundingNomination?.constituencyId &&
    requestedDistrictId &&
    prior.bulgarianFoundingNomination.constituencyId !== requestedDistrictId
  )
    return reject("party-changed");
  const peers = await locks.find({ electionId, party: candidate.party }, { session }).toArray();
  const existingPeople = new Map(receipt?.nominations.people.map((person) => [person.id, person]));
  const district = chooseBgFoundingPlayerDistrict({
    personId: ownerId,
    regionId: election.state,
    partyId: candidate.party,
    requestedId: prior?.bulgarianFoundingNomination?.constituencyId ?? requestedDistrictId,
    allowedDistrictIds,
    otherFilings: [
      ...peers.map((row) => ({
        personId: row.ownerId,
        partyId: row.party,
        constituencyId: row.constituencyId,
      })),
      ...(receipt?.nominations.constituencies.flatMap((row) =>
        row.candidateIds.map((id) => ({
          personId: existingPeople.get(id)!.ownerId,
          partyId: existingPeople.get(id)!.partyId,
          constituencyId: row.id,
        }))
      ) ?? []),
    ],
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
          bulgarianFoundingNomination: { constituencyId: district.constituencyId },
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
      bulgarianFoundingNomination: {
        constituencyId: district.constituencyId,
        ...(receipt ? { rootCandidateId: candidateId.toHexString() } : {}),
      },
    },
    { session }
  );
  if (receipt) {
    const nominations = addBgFoundingRenewedNominee({
      count: receipt.count,
      first: receipt.first,
      nominations: receipt.nominations,
      constituencyId: district.constituencyId,
      person: {
        id: candidateId.toHexString(),
        candidateId: candidateId.toHexString(),
        ownerId,
        isNpc: false,
        partyId: candidate.party,
        regionId: election.state,
      },
    });
    const updated = await db
      .collection<BgFoundingAssemblyRecord>(BG_FOUNDING_COUNTS_COLLECTION)
      .updateOne(
        {
          _id: receiptId,
          seatedAtTurn: { $exists: false },
          activeRunoffElectionIds: electionId.toHexString(),
        },
        {
          $set: { nominations },
          $push: {
            nominees: {
              id: candidateId.toHexString(),
              ownerId,
              electionId: electionId.toHexString(),
              isNpc: false,
              party: candidate.party,
              name: candidate.characterName,
              regionId: election.state,
            },
          },
        },
        { session }
      );
    if (updated.modifiedCount !== 1)
      throw new Error("Bulgarian renewed nomination changed concurrently");
  }
  return { allowed: true, insertedId: candidateId };
}
export async function registerBgFoundingPlayerFiling(
  input: Omit<Parameters<typeof materializeBgFoundingPlayerFiling>[0], "session" | "candidateId">
) {
  const candidateId = new ObjectId();
  try {
    return await runRequiredTransaction((session) =>
      materializeBgFoundingPlayerFiling({ ...input, session, candidateId })
    );
  } catch (error) {
    if (
      error instanceof MongoServerError &&
      error.code === 11000 &&
      error.message.includes(BG_FOUNDING_FILING_LOCKS_COLLECTION) &&
      typeof error.keyValue?._id === "string" &&
      error.keyValue._id.startsWith("BG:founding1990:")
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
