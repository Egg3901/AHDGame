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

/**
 * Strip everything about the decision from an entry the character cannot act on,
 * before it is sent to the client.
 *
 * All three pieces describe a prompt that is not theirs to take:
 *
 *  - `currentNode` is the prompt itself.
 *  - `interaction` is the live decision state. It also carries
 *    `leaderResponses`, which is where covert campaign choices live, so shipping
 *    it to a bystander would hand them a ledger the crisis page deliberately
 *    redacts. The card reads it only under `canInteract`, for the collective
 *    fund bar.
 *  - `crisis.interactionDefinition` is the authored decision tree. Not secret
 *    (the crisis page shows it to everyone) but it is the bulk of an ambient
 *    card's payload, and this feed is polled by every player once a minute.
 *
 * An ambient card needs the name, the description and the effects, and that is
 * what is left.
 */
export function sanitizeCrisisForActionsPage<T extends ActionsPageCrisisEntry>(entry: T): T {
  if (entry.canInteract) return entry;

  const { interactionDefinition: _omitted, ...crisis } = entry.crisis;
  return { ...entry, crisis, currentNode: null, interaction: null };
}

/**
 * Ordering for the Actions page feed.
 *
 * A decision the character can actually take comes first. Ambient cards are
 * shown so players know what is hitting them, but there can be several of them
 * at once (six on the live world for a US player during the war scare), and
 * without this a real prompt could render below a stack of crises the character
 * can do nothing about. Ties break newest-first, then on id, so the order is
 * total and stable — this response is ETagged, and a feed that reshuffles
 * between polls would defeat the 304.
 */
export function compareActionsPageCrises(
  a: ActionsPageCrisisEntry,
  b: ActionsPageCrisisEntry
): number {
  const actionable = Number(b.canInteract) - Number(a.canInteract);
  if (actionable !== 0) return actionable;
  const recency = b.crisis.startTurn - a.crisis.startTurn;
  if (recency !== 0) return recency;
  return a.crisis._id.toString().localeCompare(b.crisis._id.toString());
}
