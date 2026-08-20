import type { CrisisDecisionNode, CrisisDecisionOption, CrisisEffect } from "@/lib/db/types/crisis";

/**
 * Terse authoring helpers for living-conflict decision trees, so a definition
 * reads as content rather than boilerplate. A single-node "pick one" decision is
 * by far the common case for a role's turn on a conflict.
 */

export function opt(
  optionId: string,
  label: string,
  description: string,
  effects: CrisisEffect[] = []
): CrisisDecisionOption {
  return { optionId, label, description, effects, nextNodeId: null };
}

/** A one-shot choice node answered by a nation's head of state. */
export function choiceNode(
  nodeId: string,
  title: string,
  description: string,
  options: CrisisDecisionOption[]
): CrisisDecisionNode {
  return {
    nodeId,
    type: "choice",
    title,
    description,
    options,
    requiredRoles: ["headOfState"],
    timeLimitMinutes: null,
  };
}
