import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { evaluateTransitionWithDefaults } from "./evaluate";
import { DEFAULT_TRANSITION_PRESSURES, getTransitionRule } from "./rules";
import type { TransitionDiagnostics, TransitionEvaluation, TransitionPressures } from "./types";

/**
 * Read-model / admin diagnostics for an authored historical transition.
 * Surfaces dependency record, historical window, last evaluation, UN state, and rationale.
 */
export function getTransitionDiagnostics(
  ruleId: string,
  year: number,
  turn: number,
  pressures: Partial<TransitionPressures> = {},
  lastEvaluation: TransitionEvaluation | null = null
): TransitionDiagnostics {
  const rule = getTransitionRule(ruleId);
  const source = getWorldEntityOrThrow(rule.presetId, rule.sourceEntityId);
  const evaluation =
    lastEvaluation ??
    evaluateTransitionWithDefaults(ruleId, year, turn, {
      ...DEFAULT_TRANSITION_PRESSURES,
      ...pressures,
    });

  const parentParts = [source.parentEntityId, ...(source.coParentEntityIds ?? [])].filter(
    Boolean
  ) as string[];
  const parentLabel = parentParts.length > 0 ? parentParts.join("/") : "none";

  return {
    ruleId: rule.ruleId,
    sourceEntityId: rule.sourceEntityId,
    targetEntityId: rule.targetEntityId,
    sourceStatus: source.status,
    parentEntityId: source.parentEntityId,
    coParentEntityIds: source.coParentEntityIds,
    window: rule.window,
    lifecycle: source.lifecycle,
    lastEvaluation: evaluation,
    un: evaluation.un,
    rationale: [
      `${source.displayName} is ${source.status} under parent ${parentLabel}.`,
      `Default independence ${rule.window.expectedYear}; UN admission default ${rule.unAdmissionExpectedYear}.`,
      ...evaluation.rationale,
      ...evaluation.un.rationale,
    ],
  };
}

/** @deprecated Prefer getTransitionDiagnostics — Ghana tracer compatibility wrapper. */
export function getGoldCoastTransitionDiagnostics(
  year: number,
  turn: number,
  pressures: Partial<TransitionPressures> = {},
  lastEvaluation: TransitionEvaluation | null = null
): TransitionDiagnostics {
  return getTransitionDiagnostics("gold-coast-to-ghana", year, turn, pressures, lastEvaluation);
}
