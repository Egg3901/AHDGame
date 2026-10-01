/**
 * Crisis decision windows open on phase entry or their recurring cadence.
 * Campaign-stage and intensity restrictions still apply to both timing paths.
 */
import type { ConflictEvent, LivingConflictState } from "../types";

export function triggerMatches(event: ConflictEvent, state: LivingConflictState): boolean {
  const trigger = event.trigger;
  if (!trigger) return event.kind === "authored";
  if (
    trigger.campaignStages &&
    !trigger.campaignStages.includes(state.campaign?.stage ?? "posture")
  ) {
    return false;
  }
  if (
    trigger.trackConditions?.some((condition) => {
      const value = state.tracks?.[condition.track] ?? 0;
      return (
        (condition.min !== undefined && value < condition.min) ||
        (condition.max !== undefined && value > condition.max)
      );
    })
  )
    return false;
  if (trigger.minIntensity !== undefined && state.intensity < trigger.minIntensity) return false;
  if (trigger.maxIntensity !== undefined && state.intensity > trigger.maxIntensity) return false;
  if (trigger.onPhaseEnter || trigger.everyTurns !== undefined) {
    const entered = trigger.onPhaseEnter && state.phaseTurns === 0;
    const recurring =
      trigger.everyTurns !== undefined &&
      trigger.everyTurns > 0 &&
      state.totalTurns > 0 &&
      state.totalTurns % trigger.everyTurns === 0;
    return Boolean(entered || recurring);
  }
  return true;
}
