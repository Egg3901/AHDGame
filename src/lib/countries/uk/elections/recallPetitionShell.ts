/**
 * Persistence shell for UK Commons recall petitions (epic #856, #860).
 *
 * Pipeline: `watch` (sustained-low-approval streak) -> `open` (collecting
 * signatures) -> `check` (constituency support window) -> terminal
 * `retained` / `vacated` / `expired`. Every transition is guarded by the
 * current status plus `lastEvaluatedTurn`, so turn retries converge and two
 * triggers for the same MP collapse into one active petition.
 */

import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import { getUkRecallPetitionsCollection } from "@/lib/db/collections/ukByElection";
import type {
  RecallPetitionStatus,
  RecallTrigger,
  UkRecallPetition,
} from "@/lib/db/types/ukByElection";
import {
  RECALL_PETITION_OPEN_TURNS,
  RECALL_SIGNATURES_REQUIRED,
  evaluateRecallTrigger,
  meanSupportSample,
  nextPetitionStep,
  resolveSupportCheck,
  supportWindowEnd,
} from "@/lib/uk/elections/commonsRecallRules";
import { createCommonsVacancy } from "@/lib/uk/elections/commonsVacancyShell";

/** Non-terminal petition states: at most one may exist per official row. */
const LIVE_PETITION_STATUSES: RecallPetitionStatus[] = ["watch", "open", "check"];

export async function getActivePetitionForOfficial(
  db: Db,
  officialId: ObjectId
): Promise<UkRecallPetition | null> {
  return await getUkRecallPetitionsCollection(db).findOne({
    officialId,
    status: { $in: LIVE_PETITION_STATUSES },
  });
}

export interface EnsureRecallWatchInput {
  official: ElectedOfficial;
  target: Character;
  trigger?: RecallTrigger;
  currentTurn: number;
  now: Date;
}

/**
 * Ensure a `watch` tracker exists for a seated MP. Returns the live petition
 * (watch, open, or check) when one already tracks this seat.
 */
export async function ensureRecallWatch(
  db: Db,
  input: EnsureRecallWatchInput
): Promise<UkRecallPetition> {
  const existing = await getActivePetitionForOfficial(db, input.official._id);
  if (existing) return existing;
  const state = typeof input.official.state === "string" ? input.official.state : "";
  const doc: UkRecallPetition = {
    _id: new ObjectId(),
    countryId: "UK",
    state,
    officialId: input.official._id,
    targetCharacterId: input.target._id,
    targetCharacterName: input.target.name,
    ...(typeof input.target.party === "string" ? { targetParty: input.target.party } : {}),
    status: "watch",
    trigger: input.trigger ?? "lowApproval",
    lowStreak: 0,
    lastEvaluatedTurn: input.currentTurn,
    signatures: [],
    declarations: [],
    supportSamples: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
  await getUkRecallPetitionsCollection(db).insertOne(doc);
  return doc;
}

export interface PetitionTriggerEvaluation {
  action: "none" | "counting" | "opened";
  petition: UkRecallPetition;
}

/**
 * Run one turn of automatic trigger evaluation for a watch petition:
 * infamy opens immediately, sustained low favorability opens after
 * RECALL_SUSTAINED_TURNS consecutive turns, anything else resets the streak.
 * Guarded by lastEvaluatedTurn so retries do not double count.
 */
export async function evaluatePetitionTriggers(
  db: Db,
  petition: UkRecallPetition,
  favorability: number,
  infamy: number,
  currentTurn: number,
  now: Date
): Promise<PetitionTriggerEvaluation> {
  if (petition.status !== "watch") return { action: "none", petition };
  if ((petition.lastEvaluatedTurn ?? -1) >= currentTurn) return { action: "none", petition };

  const { trigger, lowStreak } = evaluateRecallTrigger({
    infamy,
    favorability,
    lowStreak: petition.lowStreak,
  });

  if (!trigger) {
    const updated = await getUkRecallPetitionsCollection(db).findOneAndUpdate(
      { _id: petition._id, status: "watch" },
      { $set: { lowStreak, lastEvaluatedTurn: currentTurn, updatedAt: now } },
      { returnDocument: "after" }
    );
    return { action: "counting", petition: updated ?? { ...petition, lowStreak } };
  }

  const updated = await getUkRecallPetitionsCollection(db).findOneAndUpdate(
    { _id: petition._id, status: "watch" },
    {
      $set: {
        status: "open",
        trigger,
        lowStreak,
        openedTurn: currentTurn,
        openedAt: now,
        lastEvaluatedTurn: currentTurn,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  return { action: "opened", petition: updated ?? { ...petition, status: "open" } };
}

export interface SignatureResult {
  added: boolean;
  signatures: number;
  petition: UkRecallPetition | null;
}

/**
 * Record a player's signature on an open petition. One signature per
 * character; re-signing is a no-op. Returns the live count so callers can
 * report progress toward RECALL_SIGNATURES_REQUIRED.
 */
export async function addRecallSignature(
  db: Db,
  petitionId: ObjectId,
  signer: Pick<Character, "_id" | "name">,
  currentTurn: number,
  now: Date
): Promise<SignatureResult> {
  const petitions = getUkRecallPetitionsCollection(db);
  const petition = await petitions.findOne({ _id: petitionId });
  if (!petition || petition.status !== "open") return { added: false, signatures: 0, petition };
  if (petition.signatures.some((s) => s.characterId.equals(signer._id))) {
    return { added: false, signatures: petition.signatures.length, petition };
  }
  const updated = await petitions.findOneAndUpdate(
    { _id: petitionId, status: "open" },
    {
      $push: {
        signatures: {
          characterId: signer._id,
          characterName: signer.name,
          turn: currentTurn,
          createdAt: now,
        },
      },
      $set: { updatedAt: now },
    },
    { returnDocument: "after" }
  );
  const count = updated?.signatures.length ?? petition.signatures.length + 1;
  return { added: true, signatures: count, petition: updated };
}

export interface DeclarationResult {
  recorded: boolean;
  petition: UkRecallPetition | null;
}

/**
 * Record (or move) a player's declaration in the support-check window. One
 * declaration per character; re-declaring switches sides instead of stacking.
 */
export async function addRecallDeclaration(
  db: Db,
  petitionId: ObjectId,
  declarer: Pick<Character, "_id">,
  side: "retain" | "remove",
  currentTurn: number,
  now: Date
): Promise<DeclarationResult> {
  const petitions = getUkRecallPetitionsCollection(db);
  const petition = await petitions.findOne({ _id: petitionId });
  if (!petition || petition.status !== "check") return { recorded: false, petition };
  const existing = petition.declarations.find((d) => d.characterId.equals(declarer._id));
  if (existing && existing.side === side) return { recorded: false, petition };
  const declarations = existing
    ? petition.declarations.map((d) =>
        d.characterId.equals(declarer._id) ? { ...d, side, turn: currentTurn, createdAt: now } : d
      )
    : [
        ...petition.declarations,
        { characterId: declarer._id, side, turn: currentTurn, createdAt: now },
      ];
  const updated = await petitions.findOneAndUpdate(
    { _id: petitionId, status: "check" },
    { $set: { declarations, updatedAt: now } },
    { returnDocument: "after" }
  );
  return { recorded: true, petition: updated };
}

/** Record one favorability sample for the current support-check turn. */
export async function recordRecallSupportSample(
  db: Db,
  petitionId: ObjectId,
  currentTurn: number,
  favorability: number,
  now: Date
): Promise<void> {
  const petitions = getUkRecallPetitionsCollection(db);
  const petition = await petitions.findOne({ _id: petitionId });
  if (!petition || petition.status !== "check") return;
  if (petition.supportSamples.some((s) => s.turn === currentTurn)) return;
  await petitions.updateOne(
    { _id: petitionId, status: "check" },
    {
      $push: { supportSamples: { turn: currentTurn, favorability, createdAt: now } },
      $set: { updatedAt: now },
    }
  );
}

export type PetitionAdvanceAction =
  "wait" | "opened" | "check" | "retained" | "vacated" | "expired";

export interface AdvancePetitionResult {
  action: PetitionAdvanceAction;
  petition: UkRecallPetition | null;
}

/**
 * Run one turn of the petition pipeline. `check` transitions sample the
 * current favorability first (callers sampling separately stay idempotent:
 * one sample per turn). A `vacated` outcome creates the recall vacancy behind
 * the seat; the watcher spawns the by-election from that vacancy.
 */
export async function advanceRecallPetition(
  db: Db,
  petition: UkRecallPetition,
  currentTurn: number,
  favorability: number,
  now: Date
): Promise<AdvancePetitionResult> {
  const petitions = getUkRecallPetitionsCollection(db);
  if (petition.status === "check") {
    await recordRecallSupportSample(db, petition._id, currentTurn, favorability, now);
  }
  const fresh =
    petition.status === "check"
      ? ((await petitions.findOne({ _id: petition._id })) ?? petition)
      : petition;

  if (fresh.status !== "watch" && fresh.status !== "open" && fresh.status !== "check") {
    return { action: "wait", petition: fresh };
  }

  const step = nextPetitionStep({
    status: fresh.status,
    currentTurn,
    openedTurn: fresh.openedTurn,
    checkEndTurn: fresh.checkEndTurn,
    signatures: fresh.signatures.length,
  });

  if (step === "wait") {
    if (fresh.status === "open") {
      await petitions.updateOne(
        { _id: fresh._id },
        { $set: { lastEvaluatedTurn: currentTurn, updatedAt: now } }
      );
    }
    return { action: "wait", petition: fresh };
  }

  if (step === "check") {
    const checkStartTurn = currentTurn;
    const updated = await petitions.findOneAndUpdate(
      { _id: fresh._id, status: "open" },
      {
        $set: {
          status: "check",
          checkStartTurn,
          checkEndTurn: supportWindowEnd(checkStartTurn),
          lastEvaluatedTurn: currentTurn,
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) {
      return { action: "wait", petition: (await petitions.findOne({ _id: fresh._id })) ?? fresh };
    }
    await recordRecallSupportSample(db, updated._id, currentTurn, favorability, now);
    return { action: "check", petition: updated };
  }

  if (step === "resolve") {
    const latest = (await petitions.findOne({ _id: fresh._id })) ?? fresh;
    const removeDeclarations = latest.declarations.filter((d) => d.side === "remove").length;
    const retainDeclarations = latest.declarations.filter((d) => d.side === "retain").length;
    const outcome = resolveSupportCheck({
      removeDeclarations,
      retainDeclarations,
      meanFavorability: meanSupportSample(latest.supportSamples),
    });
    if (outcome === "vacated") {
      const vacancy = await createCommonsVacancy(db, {
        officialId: latest.officialId,
        state: latest.state,
        seats: 1,
        reason: "recall",
        priorCharacterId: latest.targetCharacterId,
        priorCharacterName: latest.targetCharacterName,
        priorParty: latest.targetParty,
        vacatedTurn: currentTurn,
        now,
      });
      const updated = await petitions.findOneAndUpdate(
        { _id: latest._id, status: "check" },
        {
          $set: {
            status: "vacated",
            outcome: "vacated",
            vacancyId: vacancy._id,
            resolvedTurn: currentTurn,
            resolvedAt: now,
            updatedAt: now,
          },
        },
        { returnDocument: "after" }
      );
      return { action: "vacated", petition: updated };
    }
    const updated = await petitions.findOneAndUpdate(
      { _id: latest._id, status: "check" },
      {
        $set: {
          status: "retained",
          outcome: "retained",
          resolvedTurn: currentTurn,
          resolvedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );
    return { action: "retained", petition: updated };
  }

  // step === "expire": open window lapsed without enough signatures.
  const updated = await petitions.findOneAndUpdate(
    { _id: fresh._id, status: "open" },
    {
      $set: {
        status: "expired",
        expireReason: `fewer than ${RECALL_SIGNATURES_REQUIRED} signatures within ${RECALL_PETITION_OPEN_TURNS} turns`,
        resolvedTurn: currentTurn,
        resolvedAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  return { action: "expired", petition: updated };
}
