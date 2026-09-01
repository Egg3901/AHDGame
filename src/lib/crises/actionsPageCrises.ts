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
 * - Every other crisis that reaches this character is shown as an AMBIENT card
 *   whenever it still carries effects, so players know they are affected; they
 *   can dismiss these locally. Full detail lives on /world/crises.
 * - Only crises with nothing to decide AND nothing to feel are hidden.
 *
 * "Ambient" is a property of the character, not of the crisis. A crisis is
 * ambient to anyone who cannot act on it — because the prompt belongs to a role
 * they do not hold, or because it has already been answered — and it goes on
 * hitting their metrics either way. This used to return false in both of those
 * cases, which is why an active Recession was invisible to every player in the
 * country except the head of state, and invisible to them too the moment they
 * answered it, while it kept draining GDP, employment, confidence and approval
 * for the rest of its (up to 24-turn) run.
 *
 * Hiding the PROMPT from a character who cannot take it is a separate job, and
 * `sanitizeCrisisForActionsPage` already does it by nulling `currentNode`;
 * `CrisisActionCard` renders the decision block only under `canInteract`. So an
 * entry kept here renders as a name/description/effects card and nothing more.
 */
export function shouldShowCrisisOnActionsPage(
  entry: ActionsPageCrisisEntry,
  isLocalCrisis: boolean
): boolean {
  if (!isLocalCrisis) {
    return entry.currentNode?.type === "collective" && entry.canInteract;
  }

  if (entry.currentNode && entry.canInteract && !entry.interaction?.resolvedAt) {
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
