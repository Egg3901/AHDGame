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

/** Add aggregate scores and a real treasury cost to an authored option. */
export function responseOpt(
  optionId: string,
  label: string,
  description: string,
  responseScores: Record<string, number>,
  effects: CrisisEffect[] = [],
  treasuryCostPctGdp?: number
): CrisisDecisionOption {
  return {
    ...opt(optionId, label, description, effects),
    responseScores,
    ...(treasuryCostPctGdp !== undefined ? { treasuryCostPctGdp } : {}),
  };
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
