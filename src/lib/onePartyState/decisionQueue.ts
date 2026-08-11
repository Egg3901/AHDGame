/**
 * Single-slot decision queue for the regime-escalation flow.
 *
 * Design: one active decision per country at a time. When a new decision
 * arrives while one is pending, it queues passively (visible as "next
 * up", inert until the active one resolves). The active decision
 * carries a 48-turn timeout — if the leader doesn't act before then,
 * the per-stage default-option fires through the registry (Phase 4).
 */
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { DecisionKind, LeaderDecision } from "@/lib/db/types/regimeEscalation";
import { getRegimeEscalationCollection } from "@/lib/db/collections/regimeEscalation";
import {
  applyDecisionOption,
  getDefaultOptionId,
} from "@/lib/onePartyState/decisionEvents/registry";

/** Wall-clock-equivalent timeout in turns. Per spec. */
export const DECISION_TIMEOUT_TURNS = 48;

export interface OfferDecisionInput {
  kind: DecisionKind;
  leaderCharacterId: ObjectId;
  offeredAtTurn: number;
  payload: Record<string, unknown>;
}

/**
 * Offer a decision to the country's ruling-party leader. When no
 * active decision exists, sets this as active. Otherwise pushes to the
 * passive queue.
 */
export async function offerDecision(
  db: Db,
  countryId: CountryId,
  input: OfferDecisionInput
): Promise<void> {
  const coll = getRegimeEscalationCollection(db);
  const state = await coll.findOne({ _id: countryId });
  if (!state) {
    throw new Error(`offerDecision: no escalation state for ${countryId}`);
  }

  const decision: LeaderDecision = {
    id: new ObjectId(),
    kind: input.kind,
    offeredAtTurn: input.offeredAtTurn,
    expiresAtTurn: input.offeredAtTurn + DECISION_TIMEOUT_TURNS,
    leaderCharacterId: input.leaderCharacterId,
    payload: input.payload,
  };

  if (!state.activeDecision) {
    await coll.findOneAndUpdate(
      { _id: countryId },
      { $set: { activeDecision: decision, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
  } else {
    await coll.findOneAndUpdate(
      { _id: countryId },
      { $push: { decisionQueue: decision }, $set: { updatedAt: new Date() } },
      { returnDocument: "after" }
    );
  }
}

/**
 * Resolve the active decision: apply the chosen option's effects via
 * the registry, then clear the active slot and promote the queue head.
 *
 * Effect application is intentionally inside the queue layer so the
 * "fire effects then promote queue" sequence is atomic per call — UI
 * routes and the per-turn timeout sweep both go through this single
 * entry point without needing to remember to dispatch separately.
 *
 * No-op when no active decision exists.
 */
export async function resolveActiveDecision(
  db: Db,
  countryId: CountryId,
  optionId: string,
  currentTurn: number
): Promise<void> {
  const coll = getRegimeEscalationCollection(db);
  const state = await coll.findOne({ _id: countryId });
  if (!state || !state.activeDecision) return;

  // Apply effects first, then promote the queue. If the handler throws
  // (programmer error: unknown option id) the queue stays as-is so the
  // problem surfaces instead of silently advancing.
  await applyDecisionOption(
    {
      db,
      countryId,
      currentTurn,
      decision: state.activeDecision,
      leaderCharacterId: state.activeDecision.leaderCharacterId,
    },
    optionId
  );

  const [nextActive, ...remainingQueue] = state.decisionQueue;

  await coll.findOneAndUpdate(
    { _id: countryId },
    {
      $set: {
        activeDecision: nextActive ?? null,
        decisionQueue: remainingQueue,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" }
  );
}

/**
 * Per-turn timeout sweep: if the active decision's expiresAtTurn has
 * been reached, fire the default-action (modelled as the worst option,
 * representing regime paralysis). Looks up the default option-id from
 * the registry; falls back to a hard-coded mapping when no handler is
 * registered (defensive — keeps the queue advancing during partial
 * Phase 4 rollouts and in tests that don't import the handlers).
 */
export async function expireDecisionsForTurn(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<void> {
  const coll = getRegimeEscalationCollection(db);
  const state = await coll.findOne({ _id: countryId });
  if (!state || !state.activeDecision) return;
  if (state.activeDecision.expiresAtTurn > currentTurn) return;

  const defaultOption =
    getDefaultOptionId(state.activeDecision.kind) ??
    fallbackDefaultOptionFor(state.activeDecision.kind);
  await resolveActiveDecision(db, countryId, defaultOption, currentTurn);
}

/**
 * Fallback default-option mapping used when the registry has no
 * handler for a decision kind (e.g. a test that imported only the
 * queue, not the handler barrel). Keeps the option-id strings stable
 * so the mapping is forward-compatible with the handler-side defaults.
 */
function fallbackDefaultOptionFor(kind: DecisionKind): string {
  switch (kind) {
    case "stage1.addressDiscontent":
      return "ignore";
    case "stage2.respondToUnrest":
      return "ignore";
    case "stage3.respondToFactionSplit":
      return "ignore";
    case "stage4.faceCollapse":
      return "acceptPeacefully";
    case "convention.draft":
      return "useDefaults";
  }
}
