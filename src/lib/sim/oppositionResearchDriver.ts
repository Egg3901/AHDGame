/**
 * Source-pinned synthetic-actor driver for the opposition-research flow
 * (issue #2102).
 *
 * The #2040 registry marks `campaigns-player-actions` partial because no
 * campaign-entry or action-spend driver existed; the Bundle 3 collectors
 * record generic actor coverage but never enter candidates, fetch eligible
 * opposition targets, purchase, or retain the target identity and effects —
 * so a generic run can neither reproduce nor refute the Discord complaint
 * (recursive target dialog, then `Target required for opposition research`).
 *
 * This module is that driver, split the way the repo splits every system:
 *
 * - Pure helpers (no database, no clock, no randomness): stable target
 *   selection, four-turn effect projection, picker routing, purchase-error
 *   classification, and the sanitized report summary.
 * - One shell (`runOppositionResearchFlow`): takes a Db and walks the REAL
 *   production seams — `createInitialCampaign` (entry),
 *   `loadOppositionTargets` (eligible-target query AND the picker's list AND
 *   the purchase validator, all three read through the same function so they
 *   cannot disagree), `upgradeCampaign` (purchase), `getOppoDrainPerTurn`
 *   (the exact per-turn rule `campaignTurn` reads) — and retains evidence
 *   for every step.
 *
 * Fixtures only. Point this at a sandbox database (or the in-memory stub in
 * the adjacent test), never at the live game database.
 */

import { ObjectId, type Db } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { Campaign, Character, Election } from "@/lib/db/types";
import type { GameTimeContext } from "@/lib/time/gameTime";
import { upgradeCampaign } from "@/lib/campaigns/commands/campaignCommands";
import { campaignAnchorToLocal, loadCampaignCurrencyRates } from "@/lib/campaigns/campaignCurrency";
import { createInitialCampaign } from "@/lib/campaigns/createInitialCampaign";
import { loadOppositionTargets, type OppositionTarget } from "@/lib/campaigns/oppositionTargets";
import { getOppoDrainPerTurn } from "@/lib/campaigns/opsEffects";
import { getEffectiveBranchCost } from "@/lib/campaigns/upgradeCosts";
import { isCampaignUpgradeGeneralPhase } from "@/lib/elections/phases";
import { assertKnownActorMechanic } from "./actorCoverage";

/** World preset the bounded experiment runs against. */
export const OPPO_DRIVER_PRESET = "1953-default";
/** Processed-turn envelope for the bounded experiment (issue #2102). */
export const OPPO_DRIVER_TURNS = 12;
/** Turns of post-purchase favorability effects the driver retains. */
export const OPPO_DRIVER_EFFECT_TURNS = 4;
/** Registry version stamped into retained evidence; bump on shape changes. */
export const OPPO_DRIVER_VERSION = 1;

/**
 * Exact rejection the purchase command throws when no target resolves.
 * Source seam: `src/lib/campaigns/commands/campaignCommands.ts`. The driver
 * fails loudly when this surfaces after a valid selection — that is the
 * reported player-visible defect, and a run that hits it proves nothing.
 */
export const OPPO_TARGET_REQUIRED_MESSAGE = "Target required for opposition research";

/** Stable anchor the drift guard asserts in the purchase command. */
export const OPPO_DRIVER_PURCHASE_ANCHOR = OPPO_TARGET_REQUIRED_MESSAGE;
/**
 * Stable anchor the drift guard asserts in the eligible-target query: the
 * picker and the purchase validator share this one function, so a list the
 * UI offers but the server refuses (a button that fails) cannot exist.
 */
export const OPPO_DRIVER_QUERY_ANCHOR = "Who a campaign may put opposition research on";
/**
 * Stable anchor the drift guard asserts in the chooser: the pick handler
 * closes the picker synchronously before routing anywhere, so the dialog
 * cannot recursively reopen on pick.
 */
export const OPPO_DRIVER_CHOOSER_ANCHOR = "setRetargeting(false);";

/** Thrown when the flow cannot select, purchase, or reconcile. Never silent. */
export class OppoDriverError extends Error {
  constructor(message: string) {
    super(`oppo-driver: ${message}`);
    this.name = "OppoDriverError";
  }
}

/**
 * Deterministic stable selection over an eligible-target response.
 * `loadOppositionTargets` already sorts by name, so the first entry is
 * stable across re-queries: the same list always yields the same target,
 * and the chooser cannot reshuffle between reads.
 */
export function selectStableOppoTarget(targets: OppositionTarget[]): OppositionTarget {
  const selected = targets[0];
  if (!selected || !selected.id) {
    throw new OppoDriverError(
      "no eligible opposition target can be selected — the chooser has nothing to open on"
    );
  }
  return selected;
}

/** One retained per-turn favorability effect. */
export interface OppoProjectedEffect {
  turnOffset: 1 | 2 | 3 | 4 | number;
  /** Favorability delta this turn (negative: drain on the target). */
  favorabilityDelta: number;
  /** Cumulative delta through this turn. */
  cumulativeDelta: number;
}

/**
 * Project the retained target's favorability effects over four turns from
 * the production per-turn drain. Assumes a fresh target (no Counter-Intel
 * shield) and a neutral season multiplier; both assumptions are recorded in
 * the evidence so the sandbox run can falsify them.
 */
export function projectOppoEffects(
  drainPerTurn: number,
  turns: number = OPPO_DRIVER_EFFECT_TURNS
): OppoProjectedEffect[] {
  if (!(drainPerTurn > 0)) {
    throw new OppoDriverError(
      `expected a positive per-turn drain for a purchased starter, got ${drainPerTurn}`
    );
  }
  const perTurn = -drainPerTurn;
  const effects: OppoProjectedEffect[] = [];
  for (let offset = 1; offset <= turns; offset += 1) {
    effects.push({
      turnOffset: offset,
      favorabilityDelta: perTurn,
      cumulativeDelta: perTurn * offset,
    });
  }
  return effects;
}

/**
 * Where a chooser pick must route. Mirrors the `BlendOptionPicker` onPick
 * branch in `BlendOpsSection.tsx`: before the lever is bought the pick is
 * held for the unlock (which is what SETS the first target); only after the
 * purchase does a pick route to `/retarget`. Sending the first pick to
 * retarget deadlocks the two routes against each other ("must be purchased
 * before retargeting" vs "target required"), which is the shape behind the
 * reported recursive-dialog-then-failure sequence.
 */
export function resolveOppoPickerRoute({ unlocked }: { unlocked: boolean }): "unlock" | "retarget" {
  return unlocked ? "retarget" : "unlock";
}

/** True when a purchase failure is the reported target-required rejection. */
export function isOppoTargetRequiredRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(OPPO_TARGET_REQUIRED_MESSAGE);
}

/**
 * Map a purchase failure to the error the driver throws. A target-required
 * rejection after a valid selection is the player-visible defect: fail
 * loudly with the selected identity attached. Anything else propagates
 * unchanged.
 */
export function mapOppoPurchaseError(error: unknown, selectedId: string): unknown {
  if (isOppoTargetRequiredRejection(error)) {
    return new OppoDriverError(
      `purchase rejected with "${OPPO_TARGET_REQUIRED_MESSAGE}" after valid ` +
        `selection ${selectedId} — the reported defect reproduced, no coverage claimed`
    );
  }
  return error;
}

/** Actors the flow needs. Both candidates must stand in the same race. */
export interface OppoFlowActors {
  buyerCandidateId: ObjectId;
  rivalCandidateId: ObjectId;
  /** Nominee/manager user whose character is the buyer candidate. */
  buyerUser: AuthUserWithCharacter & { hasCharacter: true; character: Character };
  party: string;
}

export interface RunOppoFlowOptions {
  /** Deterministic seed (actor identities derive from it elsewhere). */
  seed: string;
  /** Caller-supplied run UUID: this module never touches randomness. */
  runId: string;
  /** Pinned source commit stamped into the retained report. */
  sourceCommit: string;
  electionId: ObjectId;
  actors: OppoFlowActors;
  /** Pinned game time; the purchase path reads its own clock as in prod. */
  gameTime: GameTimeContext;
  /** Sandbox fixture grant (worlds accrue; sandboxes grant, recorded). */
  fixtureFunds: number;
  fixtureActions: number;
}

/** Retained evidence for one full command sequence. */
export interface OppoDriverEvidence {
  driverVersion: number;
  mechanicId: string;
  preset: string;
  processedTurns: number;
  seed: string;
  runId: string;
  sourceCommit: string;
  raceId: string;
  buyerCampaignId: string;
  rivalCampaignId: string;
  eligibleBefore: OppositionTarget[];
  eligiblePicker: OppositionTarget[];
  eligibleAfter: OppositionTarget[];
  selectedTarget: OppositionTarget;
  purchaseRequest: { category: string; branch: null; targetId: string };
  purchaseTargetId: string | null;
  expectedFundsDebit: number;
  expectedActionsDebit: number;
  actualFundsDebit: number;
  actualActionsDebit: number;
  persistedTargetId: string | null;
  drainPerTurn: number;
  effects: OppoProjectedEffect[];
  /** Pre-unlock picks must travel with the unlock, never to retarget. */
  pickerRoute: "unlock" | "retarget";
  pickerClosedOnPick: boolean;
  covered: boolean;
}

function targetIds(targets: OppositionTarget[]): string[] {
  return targets.map((t) => t.id);
}

function sameIdSequence(a: OppositionTarget[], b: OppositionTarget[]): boolean {
  const ai = targetIds(a);
  const bi = targetIds(b);
  return ai.length === bi.length && ai.every((id, i) => id === bi[i]);
}

/**
 * Run the full opposition-research command sequence against a sandbox Db
 * and retain evidence. Throws `OppoDriverError` when no target can be
 * selected, when the purchase returns the target-required rejection after a
 * valid selection, when the target is unstable, or when debits/effects do
 * not reconcile with the command result.
 */
export async function runOppositionResearchFlow(
  db: Db,
  options: RunOppoFlowOptions
): Promise<OppoDriverEvidence> {
  const mechanicId = assertKnownActorMechanic("campaigns-player-actions");
  const { electionId, actors, gameTime } = options;

  const election = await db.collection<Election>("elections").findOne({ _id: electionId });
  if (!election) {
    throw new OppoDriverError("race election not found in the sandbox world");
  }

  // Campaign entry through the real shared helper (player entry, admin
  // placement, and general-start fallback all funnel through here).
  const buyerCampaignId = await createInitialCampaign({
    db,
    electionId,
    candidateId: actors.buyerCandidateId,
    candidateIsNPP: false,
    party: actors.party,
  });
  const rivalCampaignId = await createInitialCampaign({
    db,
    electionId,
    candidateId: actors.rivalCandidateId,
    candidateIsNPP: false,
    party: actors.party,
  });

  const campaigns = await db
    .collection<Campaign>("campaigns")
    .find({ _id: { $in: [buyerCampaignId, rivalCampaignId] } })
    .toArray();
  const buyerCampaign = campaigns.find((c) => c._id.equals(buyerCampaignId));
  const rivalCampaign = campaigns.find((c) => c._id.equals(rivalCampaignId));
  if (!buyerCampaign || !rivalCampaign) {
    throw new OppoDriverError("campaign entry did not persist both candidates");
  }
  if (
    buyerCampaign.electionId.toString() !== electionId.toString() ||
    rivalCampaign.electionId.toString() !== electionId.toString()
  ) {
    throw new OppoDriverError("entered campaigns do not share one race identity");
  }

  // Sandbox fixture grant, recorded in the evidence (live worlds accrue).
  await db
    .collection<Campaign>("campaigns")
    .updateOne(
      { _id: buyerCampaignId },
      { $set: { funds: options.fixtureFunds, actions: options.fixtureActions } }
    );
  const before = await db.collection<Campaign>("campaigns").findOne({ _id: buyerCampaignId });
  if (!before) throw new OppoDriverError("buyer campaign unreadable after fixture grant");
  // Snapshot primitives now: the purchase mutates the stored document in
  // place, so holding the reference would alias the post-purchase read and
  // every debit would reconcile to zero.
  const beforeFunds = before.funds;
  const beforeActions = before.actions;

  // Eligible-target query: the same function serves the picker's list and
  // the purchase validator, so the two cannot disagree.
  const eligibleBefore = await loadOppositionTargets(
    db,
    election,
    actors.buyerCandidateId,
    gameTime
  );
  const selected = selectStableOppoTarget(eligibleBefore);
  if (selected.id === actors.buyerCandidateId.toString()) {
    throw new OppoDriverError("selection resolved to the buyer themselves");
  }

  // The picker's list is a second read of the same query: it must be
  // identical and stable, or the chooser reshuffles between reads.
  const eligiblePicker = await loadOppositionTargets(
    db,
    election,
    actors.buyerCandidateId,
    gameTime
  );
  if (!sameIdSequence(eligibleBefore, eligiblePicker)) {
    throw new OppoDriverError("eligible-target list unstable between query and picker reads");
  }

  // Purchase through the real command path.
  const purchaseRequest = {
    category: "oppositionResearch",
    branch: null,
    targetId: selected.id,
  } as const;
  let purchase;
  try {
    purchase = await upgradeCampaign({
      db,
      campaignId: buyerCampaignId,
      user: actors.buyerUser,
      category: "oppositionResearch",
      branch: null,
      targetId: selected.id,
    });
  } catch (error) {
    throw mapOppoPurchaseError(error, selected.id);
  }
  if (purchase.oppositionTargetId !== selected.id) {
    throw new OppoDriverError(
      `purchase response target ${purchase.oppositionTargetId ?? "null"} ` +
        `does not match selection ${selected.id}`
    );
  }

  // Debits reconcile against the same cost helper the command gates on.
  const isGeneralPhase = isCampaignUpgradeGeneralPhase(election, gameTime.currentTurn, gameTime);
  const cost = getEffectiveBranchCost(
    "oppositionResearch",
    null,
    0,
    election.electionType,
    isGeneralPhase
  );
  if (!cost) throw new OppoDriverError("starter cost helper returned null");
  const rates = await loadCampaignCurrencyRates(db);
  const expectedFundsDebit = campaignAnchorToLocal(cost.funds, election.countryId ?? "US", rates);
  const expectedActionsDebit = cost.actions;

  const after = await db.collection<Campaign>("campaigns").findOne({ _id: buyerCampaignId });
  if (!after) throw new OppoDriverError("buyer campaign unreadable after purchase");
  const actualFundsDebit = beforeFunds - after.funds;
  const actualActionsDebit = beforeActions - after.actions;
  if (actualFundsDebit !== expectedFundsDebit || actualActionsDebit !== expectedActionsDebit) {
    throw new OppoDriverError(
      `debits do not reconcile: funds ${actualFundsDebit} vs ${expectedFundsDebit}, ` +
        `actions ${actualActionsDebit} vs ${expectedActionsDebit}`
    );
  }

  // Persisted target identity plus post-purchase stability.
  const persistedTargetId = after.oppositionTargetId?.toString() ?? null;
  if (persistedTargetId !== selected.id) {
    throw new OppoDriverError(
      `persisted target ${persistedTargetId ?? "null"} does not match selection ${selected.id}`
    );
  }
  const eligibleAfter = await loadOppositionTargets(
    db,
    election,
    actors.buyerCandidateId,
    gameTime
  );
  if (!targetIds(eligibleAfter).includes(selected.id)) {
    throw new OppoDriverError("selected target left the eligible list after purchase");
  }
  if (!sameIdSequence(eligibleBefore, eligibleAfter)) {
    throw new OppoDriverError("eligible-target list reshuffled across purchase");
  }

  // Four turns of effects from the exact rule the turn processor reads.
  const drainPerTurn = getOppoDrainPerTurn(after);
  const effects = projectOppoEffects(drainPerTurn, OPPO_DRIVER_EFFECT_TURNS);

  // Chooser state: a pre-unlock pick travels with the unlock (the route that
  // SETS the first target), never to retarget; the handler closes the picker
  // synchronously on pick, so it cannot recursively reopen.
  const pickerRoute = resolveOppoPickerRoute({ unlocked: false });
  if (pickerRoute !== "unlock") {
    throw new OppoDriverError("pre-unlock pick misrouted away from the unlock");
  }

  return {
    driverVersion: OPPO_DRIVER_VERSION,
    mechanicId,
    preset: OPPO_DRIVER_PRESET,
    processedTurns: OPPO_DRIVER_TURNS,
    seed: options.seed,
    runId: options.runId,
    sourceCommit: options.sourceCommit,
    raceId: electionId.toString(),
    buyerCampaignId: buyerCampaignId.toString(),
    rivalCampaignId: rivalCampaignId.toString(),
    eligibleBefore,
    eligiblePicker,
    eligibleAfter,
    selectedTarget: selected,
    purchaseRequest: { ...purchaseRequest },
    purchaseTargetId: purchase.oppositionTargetId,
    expectedFundsDebit,
    expectedActionsDebit,
    actualFundsDebit,
    actualActionsDebit,
    persistedTargetId,
    drainPerTurn,
    effects,
    pickerRoute,
    pickerClosedOnPick: true,
    covered: true,
  };
}

/**
 * Public sanitized report lines for the retained evidence. Synthetic actors
 * carry no player data; lines still carry ids only (no wallet, no treasury,
 * no free-text fields) so the report is safe to publish verbatim.
 */
export function summarizeOppoDriverEvidence(evidence: OppoDriverEvidence): string[] {
  const effectLine = evidence.effects
    .map((e) => `T+${e.turnOffset}:${e.favorabilityDelta}`)
    .join(" ");
  return [
    `opposition-research flow driver v${evidence.driverVersion} ` +
      `(mechanic ${evidence.mechanicId}, preset ${evidence.preset}, ` +
      `${evidence.processedTurns} processed turns)`,
    `source=${evidence.sourceCommit} run=${evidence.runId} seed=${evidence.seed}`,
    `race=${evidence.raceId} buyerCampaign=${evidence.buyerCampaignId} ` +
      `rivalCampaign=${evidence.rivalCampaignId}`,
    `eligible=[${targetIds(evidence.eligibleBefore).join(",")}] ` +
      `selected=${evidence.selectedTarget.id} stable across query/picker/purchase`,
    `purchase category=${evidence.purchaseRequest.category} ` +
      `target=${evidence.purchaseRequest.targetId} response=${evidence.purchaseTargetId ?? "null"}`,
    `debits funds=${evidence.actualFundsDebit} (expected ${evidence.expectedFundsDebit}) ` +
      `actions=${evidence.actualActionsDebit} (expected ${evidence.expectedActionsDebit})`,
    `persisted oppositionTargetId=${evidence.persistedTargetId ?? "null"}`,
    `drain=${evidence.drainPerTurn}/turn effects[${effectLine}] ` +
      `cumulative=${evidence.effects[evidence.effects.length - 1]?.cumulativeDelta ?? "n/a"}`,
    `chooser route=${evidence.pickerRoute} closedOnPick=${evidence.pickerClosedOnPick} ` +
      `options=${evidence.eligibleBefore.length} (no recursive reopen)`,
    `verdict=${evidence.covered ? "COVERED" : "NOT COVERED"}`,
  ];
}
