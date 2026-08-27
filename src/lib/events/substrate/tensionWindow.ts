import type { EventDefinition } from "@/lib/db/types/events";

/**
 * Tension gating: a definition with `minTension`/`maxTension` bounds only
 * fires while the global cold-war tension reading sits inside its inclusive
 * window. When the reading is unknown (legacy callers, unit tests that don't
 * thread it), bounds are not enforced, matching the contract in `yearWindow.ts`.
 * Admin manual triggers bypass this on purpose (QA escape hatch).
 */
export function isWithinTensionWindow(
  definition: Pick<EventDefinition, "minTension" | "maxTension">,
  currentTension?: number
): boolean {
  if (currentTension == null) {
    return true;
  }
  if (definition.minTension != null && currentTension < definition.minTension) {
    return false;
  }
  if (definition.maxTension != null && currentTension > definition.maxTension) {
    return false;
  }
  return true;
}
