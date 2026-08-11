/**
 * Central registry for decision-event handlers.
 *
 * Each stage handler module calls `registerDecisionHandler` at import
 * time; the decision-queue layer calls `applyDecisionOption` /
 * `getDefaultOptionId` to dispatch.
 *
 * Pure mutable Map — initialised by the `decisionEvents/index.ts`
 * barrel which imports every stage handler exactly once at app
 * startup.
 */
import type { DecisionKind } from "@/lib/db/types/regimeEscalation";
import type { DecisionContext, DecisionHandler } from "./types";

const handlers = new Map<DecisionKind, DecisionHandler>();

export function registerDecisionHandler(handler: DecisionHandler): void {
  handlers.set(handler.kind, handler);
}

export function getDecisionHandler(kind: DecisionKind): DecisionHandler | undefined {
  return handlers.get(kind);
}

/**
 * Dispatch a decision-option's effects. Behaviour split:
 *
 * - **No handler registered for the kind** → no-op (allows queue
 *   mechanics tests + the per-turn timeout sweep to advance the queue
 *   when handlers aren't loaded, e.g. in isolated tests). Logs once
 *   per process per kind so a missing import doesn't go silent in
 *   production.
 * - **Handler registered but option-id is unknown** → throws. This
 *   is always a bug (stale UI sending an option that the handler
 *   doesn't declare).
 */
const warnedMissingHandlers = new Set<DecisionKind>();
export async function applyDecisionOption(ctx: DecisionContext, optionId: string): Promise<void> {
  const handler = handlers.get(ctx.decision.kind);
  if (!handler) {
    if (!warnedMissingHandlers.has(ctx.decision.kind)) {
      warnedMissingHandlers.add(ctx.decision.kind);
      console.warn(
        `applyDecisionOption: no handler registered for ${ctx.decision.kind} — queue advancing without firing effects`
      );
    }
    return;
  }
  const option = handler.options.find((o) => o.id === optionId);
  if (!option) {
    throw new Error(
      `applyDecisionOption: no option "${optionId}" on handler for ${ctx.decision.kind}`
    );
  }
  await option.apply(ctx);
}

/** Test-only: clear the missing-handler warning memo. */
export function _resetMissingHandlerWarningsForTests(): void {
  warnedMissingHandlers.clear();
}

/**
 * Look up the timeout default option-id for a decision kind. Returns
 * undefined if no handler is registered — callers should treat this as
 * "queue advances without firing effects" (Phase 3 fallback behaviour).
 */
export function getDefaultOptionId(kind: DecisionKind): string | undefined {
  return handlers.get(kind)?.defaultOptionId;
}

/** Test-only: clear all registered handlers (for isolated test cases). */
export function _resetHandlerRegistryForTests(): void {
  handlers.clear();
}
