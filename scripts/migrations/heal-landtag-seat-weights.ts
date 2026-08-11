import * as dotenv from "dotenv";
import { ObjectId, type Db } from "mongodb";

import { getDb, getMongoClient } from "@/lib/mongodb";
import type {
  Character,
  ElectedOfficial,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  NPP,
} from "@/lib/db/types";
import { allocateLandtagSeatsToCandidates } from "@/lib/turn/election/germanyLandtag";
import type { CareerEvent } from "@/lib/db/types/character";

dotenv.config({ path: ".env.local" });

interface RepairPlan {
  election: Election;
  assignments: ReturnType<typeof allocateLandtagSeatsToCandidates>["assignments"];
  totalSeats: number;
  currentFilledSeats: number;
  currentRows: number;
  staleCharacterIds: ObjectId[];
  staleNppIds: ObjectId[];
}

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const stateArg = process.argv.find((arg) => arg.startsWith("--state="));
const onlyState = stateArg?.split("=")[1]?.toUpperCase();

function objectIdKey(id: ObjectId | undefined | null): string | null {
  return id ? id.toString() : null;
}

function uniqueObjectIds(ids: Array<ObjectId | undefined | null>): ObjectId[] {
  const seen = new Set<string>();
  const out: ObjectId[] = [];
  for (const id of ids) {
    const key = objectIdKey(id);
    if (!id || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

async function getLatestResolvedLandtagElections(db: Db): Promise<Election[]> {
  const query: Record<string, unknown> = {
    countryId: "DE",
    electionType: "landtag",
    status: { $in: ["completed", "resolved"] },
  };
  if (onlyState) query.state = onlyState;

  const elections = await db
    .collection<Election>("elections")
    .find(query)
    .sort({ updatedAt: -1 })
    .toArray();

  const latestByState = new Map<string, Election>();
  for (const election of elections) {
    if (!latestByState.has(election.state)) latestByState.set(election.state, election);
  }
  return [...latestByState.values()].sort((a, b) => a.state.localeCompare(b.state));
}

async function buildPlan(db: Db, election: Election): Promise<RepairPlan | null> {
  const totalSeats = election.totalSeats ?? 0;
  if (totalSeats <= 0) return null;

  const tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId: election._id });
  if (!tally) {
    console.warn(`[skip] ${election.state}: no vote tally for ${election._id.toString()}`);
    return null;
  }

  const candidateIds = Object.keys(tally.totalVotes ?? {})
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ _id: { $in: candidateIds }, electionId: election._id })
    .toArray();

  const seatResolution = allocateLandtagSeatsToCandidates(candidates, tally, totalSeats);
  if (seatResolution.seatsAllocated !== totalSeats) {
    console.warn(
      `[skip] ${election.state}: allocation produced ${seatResolution.seatsAllocated}/${totalSeats} seats`
    );
    return null;
  }

  const currentOfficials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId: "DE", officeType: "landtag", state: election.state })
    .toArray();
  const currentFilledSeats = currentOfficials.reduce((sum, official) => {
    return sum + (official.seatsHeld ?? 1);
  }, 0);

  const expectedByHolder = new Map<string, number>();
  for (const assignment of seatResolution.assignments) {
    const holderId = assignment.candidate.isNPP
      ? objectIdKey(assignment.candidate.nppId)
      : objectIdKey(assignment.candidate.characterId);
    if (!holderId) continue;
    const holderKey = `${assignment.candidate.isNPP ? "npp" : "character"}:${holderId}`;
    expectedByHolder.set(holderKey, assignment.seats);
  }

  let alreadyCorrect =
    currentFilledSeats === totalSeats && currentOfficials.length === expectedByHolder.size;
  for (const official of currentOfficials) {
    const holderId = official.isNPP
      ? objectIdKey(official.nppId)
      : objectIdKey(official.characterId);
    if (!holderId) {
      alreadyCorrect = false;
      break;
    }
    const holderKey = `${official.isNPP ? "npp" : "character"}:${holderId}`;
    if (expectedByHolder.get(holderKey) !== (official.seatsHeld ?? 1)) {
      alreadyCorrect = false;
      break;
    }
  }

  if (alreadyCorrect) return null;

  const winnerCharacterIds = new Set(
    seatResolution.assignments
      .filter((assignment) => !assignment.candidate.isNPP)
      .map((assignment) => objectIdKey(assignment.candidate.characterId))
      .filter(Boolean)
  );
  const winnerNppIds = new Set(
    seatResolution.assignments
      .filter((assignment) => assignment.candidate.isNPP)
      .map((assignment) => objectIdKey(assignment.candidate.nppId))
      .filter(Boolean)
  );

  return {
    election,
    assignments: seatResolution.assignments,
    totalSeats,
    currentFilledSeats,
    currentRows: currentOfficials.length,
    staleCharacterIds: uniqueObjectIds(
      currentOfficials
        .filter(
          (official) =>
            !official.isNPP && !winnerCharacterIds.has(objectIdKey(official.characterId))
        )
        .map((official) => official.characterId)
    ),
    staleNppIds: uniqueObjectIds(
      currentOfficials
        .filter((official) => official.isNPP && !winnerNppIds.has(objectIdKey(official.nppId)))
        .map((official) => official.nppId)
    ),
  };
}

async function applyPlan(db: Db, plan: RepairPlan, now: Date): Promise<void> {
  const electedAt = plan.election.updatedAt ?? now;
  const officials: ElectedOfficial[] = plan.assignments.map(({ candidate, partyId, seats }) => ({
    _id: new ObjectId(),
    countryId: "DE",
    officeType: "landtag",
    state: plan.election.state,
    isAppointment: false,
    seatsHeld: seats,
    characterId: candidate.isNPP ? null : (candidate.characterId ?? null),
    characterName: candidate.characterName,
    party: partyId,
    isNPP: candidate.isNPP ?? false,
    nppId: candidate.nppId,
    electedAt,
    createdAt: now,
    updatedAt: now,
  }));

  await db
    .collection<ElectedOfficial>("electedOfficials")
    .deleteMany({ countryId: "DE", officeType: "landtag", state: plan.election.state });

  if (officials.length > 0) {
    await db.collection<ElectedOfficial>("electedOfficials").insertMany(officials);
  }

  for (const assignment of plan.assignments) {
    const { candidate, partyId, seats } = assignment;
    const office = { type: "landtag" as const, state: plan.election.state, seatsHeld: seats };
    if (candidate.isNPP && candidate.nppId) {
      await db
        .collection<NPP>("npps")
        .updateOne(
          { _id: candidate.nppId },
          { $set: { currentOffice: office, party: partyId, updatedAt: now } }
        );
    } else if (!candidate.isNPP && candidate.characterId) {
      const character = await db
        .collection<Character>("characters")
        .findOne({ _id: candidate.characterId }, { projection: { careerHistory: 1 } });
      const hasElectionEvent = (character?.careerHistory ?? []).some(
        (event) =>
          event.type === "elected" &&
          event.electionId === plan.election._id.toString() &&
          event.office?.type === "landtag" &&
          event.office?.state === plan.election.state
      );

      const update: Record<string, unknown> = {
        $set: { currentOffice: office, updatedAt: now },
      };
      if (!hasElectionEvent) {
        const careerEvent: CareerEvent = {
          type: "elected",
          office,
          officeLabel: `Member of Landtag (${plan.election.state})`,
          party: partyId,
          partyCountryId: "DE",
          electionId: plan.election._id.toString(),
          date: electedAt,
        };
        update.$push = { careerHistory: careerEvent };
      }

      await db
        .collection<Character>("characters")
        .updateOne({ _id: candidate.characterId }, update);
    }
  }

  if (plan.staleCharacterIds.length > 0) {
    await db.collection<Character>("characters").updateMany(
      {
        _id: { $in: plan.staleCharacterIds },
        "currentOffice.type": "landtag",
        "currentOffice.state": plan.election.state,
      },
      { $set: { currentOffice: null, updatedAt: now } }
    );
  }

  if (plan.staleNppIds.length > 0) {
    await db.collection<NPP>("npps").updateMany(
      {
        _id: { $in: plan.staleNppIds },
        "currentOffice.type": "landtag",
        "currentOffice.state": plan.election.state,
      },
      { $set: { currentOffice: null, updatedAt: now } }
    );
  }
}

async function main() {
  const db = await getDb();
  const elections = await getLatestResolvedLandtagElections(db);
  const plans: RepairPlan[] = [];

  for (const election of elections) {
    const plan = await buildPlan(db, election);
    if (plan) plans.push(plan);
  }

  if (plans.length === 0) {
    console.log("No Landtag seat-weight repairs needed.");
    return;
  }

  for (const plan of plans) {
    const assignmentSummary = plan.assignments
      .map((assignment) => `${assignment.candidate.characterName}:${assignment.seats}`)
      .join(", ");
    console.log(
      `${apply ? "[apply]" : "[dry-run]"} ${plan.election.state} cycle ${plan.election.cycle}: ` +
        `${plan.currentFilledSeats}/${plan.totalSeats} filled across ${plan.currentRows} row(s) -> ` +
        `${plan.totalSeats}/${plan.totalSeats} via ${plan.assignments.length} row(s): ${assignmentSummary}`
    );
  }

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write repairs.");
    return;
  }

  const now = new Date();
  for (const plan of plans) {
    await applyPlan(db, plan, now);
  }
  console.log(`Applied ${plans.length} Landtag repair(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const client = await getMongoClient().catch(() => null);
    await client?.close();
  });
