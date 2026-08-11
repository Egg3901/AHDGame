import type { Crisis, CrisisDecisionNode, CrisisInteraction } from "@/lib/db/types/crisis";

export interface ActionsPageCrisisEntry {
  crisis: Crisis;
  interaction: CrisisInteraction | null;
  currentNode: CrisisDecisionNode | null;
  canInteract: boolean;
}

/**
 * Whether an enriched crisis should appear on the Actions page.
 *
 * - Actionable decision prompts (for roles the character holds) are shown.
 * - Ambient effect-only crises are shown so players know they are affected;
 *   they can dismiss these locally. Full detail lives on /world/crises.
 * - Resolved interactions and decision prompts the character cannot take are hidden.
 */
export function shouldShowCrisisOnActionsPage(
  entry: ActionsPageCrisisEntry,
  isLocalCrisis: boolean
): boolean {
  if (!isLocalCrisis) {
    return entry.currentNode?.type === "collective" && entry.canInteract;
  }

  if (entry.interaction?.resolvedAt) {
    return false;
  }

  if (entry.currentNode && !entry.canInteract) {
    return false;
  }

  if (entry.currentNode && entry.canInteract) {
    return true;
  }

  return entry.crisis.effects.length > 0;
}

/** Strip decision prompts the character cannot act on before sending to the client. */
export function sanitizeCrisisForActionsPage<T extends ActionsPageCrisisEntry>(entry: T): T {
  if (!entry.canInteract) {
    return { ...entry, currentNode: null };
  }
  return entry;
}
