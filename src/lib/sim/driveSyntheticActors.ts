/**
 * Per-turn synthetic-actor driver (issue #1993).
 *
 * Shell module: takes a Db, performs a bounded set of player-only actions
 * through the REAL production seams, and never throws. runWorld calls it once
 * per turn after `processTurn` in synthetic mode only; pure-NPP runs never
 * call it, so their passive-lifecycle behavior is byte-identical.
 *
 * Per-turn budget (hard caps, first success wins per step):
 * - Crisis: at most one `submitCrisisDecision` on the first open interaction
 *   the synthetic head of state is authorized for.
 * - Survey: at most 3 `launchGovernmentProspect` attempts for the synthetic DD
 *   finance minister; stops at the first acceptance.
 * - Chair: at most one `acceptCentralBankChairSelection` when the US bank
 *   holds a pending appointment for the synthetic nominee.
 *
 * Every step is individually guarded: a missing population, an ineligible
 * minister, a closed window, or any production error is a quiet no-op (one
 * log line), never a turn failure. The manifest's turn-derived evidence
 * counters (`crisisDecidedInteractions`, `wealthListRows`, `playerFoundedCorps`)
 * are what prove these steps ran — this driver never claims coverage itself.
 */

import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { getBankId } from "@/lib/centralBank/helpers";
import { acceptCentralBankChairSelection } from "@/lib/turn/centralBankChairSelection";
import {
  canCharacterInteract,
  resolveCharacterRoles,
  submitCrisisDecision,
} from "@/lib/crises/interactionEngine";
import { launchGovernmentProspect } from "@/lib/extraction/commands/launchGovernmentProspect";
import { buildSyntheticActorPlan } from "./syntheticActors";

export interface DriveSyntheticActorsOptions {
  seed: string;
  turn: number;
  now?: Date;
}

export interface DriveSyntheticActorsResult {
  crisisDecided: boolean;
  surveyOk: boolean;
  surveyStatus: number | null;
  chairAccepted: boolean;
}

const INITIAL_RESULT: DriveSyntheticActorsResult = {
  crisisDecided: false,
  surveyOk: false,
  surveyStatus: null,
  chairAccepted: false,
};

/** Crisis step: one authorized head-of-state decision through the real seam. */
async function driveCrisisDecision(
  db: Db,
  seed: string,
  out: DriveSyntheticActorsResult
): Promise<void> {
  const plan = buildSyntheticActorPlan(seed);
  // The seated president carries head-of-state roles through the persisted
  // electedOfficials row; the standalone decider only holds "any". Try the
  // president first so head-of-state-gated trees are exercised.
  const ordered = [
    plan.actors.find((a) => a.role === "us-president"),
    plan.actors.find((a) => a.role === "crisis-decider"),
  ].filter((a) => a !== undefined);
  const interactions = (await db.collection("crisisInteractions").find({}).toArray()).slice(0, 5);
  for (const decider of ordered) {
    const character = await db
      .collection("characters")
      .findOne({ _id: new ObjectId(decider.characterIdHex) });
    if (!character?.userId) continue;
    const roles = await resolveCharacterRoles(db, {
      _id: character._id as ObjectId,
      currentOffice: (character.currentOffice ?? null) as { type?: string } | null,
      countryId: character.countryId as string | undefined,
    });
    for (const interaction of interactions) {
      if (interaction.resolvedAt) continue;
      const tree = (interaction.decisionTree ?? []) as Array<{
        nodeId: string;
        options?: Array<{ optionId: string }>;
        requiredRoles?: string[];
      }>;
      const node = tree.find((n) => n.nodeId === interaction.currentNodeId);
      const option = node?.options?.[0];
      if (!node || !option) continue;
      if (
        !canCharacterInteract(
          node as never,
          roles,
          character.countryId as string,
          character.homeState as string
        )
      )
        continue;
      const crisis = interaction.crisisId
        ? await db.collection("crises").findOne({ _id: interaction.crisisId })
        : null;
      const countryId =
        (crisis?.countryId as string | undefined) ?? (character.countryId as string);
      await submitCrisisDecision(
        db,
        interaction._id as ObjectId,
        option.optionId,
        character._id as ObjectId,
        countryId,
        roles,
        character.homeState as string
      );
      out.crisisDecided = true;
      return;
    }
  }
}

/** Survey step: up to 3 eligible national-survey attempts for the DD minister. */
async function driveDdSurvey(
  db: Db,
  seed: string,
  turn: number,
  now: Date,
  out: DriveSyntheticActorsResult
): Promise<void> {
  const plan = buildSyntheticActorPlan(seed);
  const minister = plan.actors.find((a) => a.role === "dd-finance-minister");
  if (!minister) return;
  const character = await db
    .collection("characters")
    .findOne({ _id: new ObjectId(minister.characterIdHex) });
  if (!character?.userId) return;
  if (!COUNTRY_CONFIGS.DD?.financeMinisterCabinetId) return;
  const caps = (await db
    .collection("stateResourceCapacity")
    .find({ countryId: "DD" })
    .toArray()) as unknown as Array<{
    stateId: string;
    resources?: Record<string, number>;
  }>;
  const attempts: Array<{ stateId: string; resource: string }> = [];
  for (const cap of caps) {
    for (const [resource, amount] of Object.entries(cap.resources ?? {})) {
      if ((amount ?? 0) > 0) attempts.push({ stateId: cap.stateId, resource });
      if (attempts.length >= 3) break;
    }
    if (attempts.length >= 3) break;
  }
  for (const attempt of attempts) {
    const result = await launchGovernmentProspect(
      db,
      {
        countryId: "DD",
        stateId: attempt.stateId,
        resource: attempt.resource as never,
        level: "national",
      },
      {
        characterId: character._id as ObjectId,
        userId: (character.userId as ObjectId).toString(),
        isAdmin: false,
      },
      turn,
      now
    );
    out.surveyStatus = result.status;
    if (result.ok) {
      out.surveyOk = true;
      return;
    }
  }
}

/** Chair step: accept the pending US appointment when it names our nominee. */
async function driveChairAccept(
  db: Db,
  seed: string,
  turn: number,
  now: Date,
  out: DriveSyntheticActorsResult
): Promise<void> {
  const plan = buildSyntheticActorPlan(seed);
  const nominee = plan.actors.find((a) => a.role === "us-fed-nominee");
  if (!nominee) return;
  const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId("US") });
  const pending = bank?.chairSelectionPending as { characterId?: ObjectId } | undefined;
  if (!pending?.characterId?.equals(new ObjectId(nominee.characterIdHex))) return;
  const result = await acceptCentralBankChairSelection(
    db,
    "US",
    new ObjectId(nominee.characterIdHex),
    now,
    turn
  );
  out.chairAccepted = result.ok;
}

/**
 * Run one bounded synthetic-actor pass. Never throws: every step is guarded
 * individually and the whole pass is guarded once more, so a production error
 * surfaces as a log line, never as a failed turn.
 */
export async function driveSyntheticActors(
  db: Db,
  options: DriveSyntheticActorsOptions
): Promise<DriveSyntheticActorsResult> {
  const out: DriveSyntheticActorsResult = { ...INITIAL_RESULT };
  const now = options.now ?? new Date();
  const steps: Array<[string, () => Promise<void>]> = [
    ["crisis", () => driveCrisisDecision(db, options.seed, out)],
    ["survey", () => driveDdSurvey(db, options.seed, options.turn, now, out)],
    ["chair", () => driveChairAccept(db, options.seed, options.turn, now, out)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      console.log(
        `[SyntheticActors] per-turn ${name} driver skipped: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (out.crisisDecided || out.surveyOk || out.chairAccepted) {
    console.log(
      `[SyntheticActors] turn ${options.turn}: crisisDecided=${out.crisisDecided} ` +
        `surveyOk=${out.surveyOk} chairAccepted=${out.chairAccepted}`
    );
  }
  return out;
}
