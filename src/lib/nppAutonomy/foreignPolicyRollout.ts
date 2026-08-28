import type { NppForeignPolicyStage } from "@/lib/db/types/gameState";
import type { ForeignPolicyActionType } from "./foreignPolicy";

export const DEFAULT_FOREIGN_POLICY_STAGE: NppForeignPolicyStage = "votes";

export const FOREIGN_POLICY_STAGES: readonly NppForeignPolicyStage[] = [
  "votes",
  "proposals",
  "trade",
  "support",
  "war",
];

const STAGE_RANK: Record<NppForeignPolicyStage, number> = {
  votes: 0,
  proposals: 1,
  trade: 2,
  support: 3,
  war: 4,
};

export function foreignPolicyStageFrom(value: unknown): NppForeignPolicyStage {
  return typeof value === "string" && FOREIGN_POLICY_STAGES.includes(value as NppForeignPolicyStage)
    ? (value as NppForeignPolicyStage)
    : DEFAULT_FOREIGN_POLICY_STAGE;
}

export function foreignPolicyActionStage(type: ForeignPolicyActionType): NppForeignPolicyStage {
  if (type === "vote_org_yes" || type === "vote_org_no") return "votes";
  if (
    type === "propose_fta" ||
    type === "propose_sanctions" ||
    type === "propose_aid" ||
    type === "endorse_country" ||
    type === "condemn_country"
  ) {
    return "proposals";
  }
  if (
    type === "raise_tariff" ||
    type === "lower_tariff" ||
    type === "impose_embargo" ||
    type === "lift_embargo"
  ) {
    return "trade";
  }
  if (type === "support_war") return "support";
  return "war";
}

export function foreignPolicyActionAllowed(
  type: ForeignPolicyActionType,
  stage: NppForeignPolicyStage
): boolean {
  return STAGE_RANK[foreignPolicyActionStage(type)] <= STAGE_RANK[stage];
}
