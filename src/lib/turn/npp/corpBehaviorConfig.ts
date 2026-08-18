import type { Corporation } from "@/lib/db/types";
import {
  canUnlock,
  getTreeForType,
  techNodeCashCost,
  type TechTreeNode,
} from "@/lib/constants/techTree";

/**
 * Pick one deterministic, affordable node per turn. Sector-lane nodes win ties
 * because they fit the corporation's industry; deeper nodes win within a lane.
 */
export function pickBestNppTechNode(
  corp: Corporation,
  currentYear: number,
  dailyGrossRevenue: number
): { node: TechTreeNode; cashCost: number } | null {
  const rdScore = corp.rdScore ?? 0;
  const cashAvailable = corp.liquidCapital ?? 0;
  const candidates = getTreeForType(corp.type)
    .map((node) => ({ node, cashCost: techNodeCashCost(node, dailyGrossRevenue) }))
    .filter(
      ({ node, cashCost }) =>
        canUnlock(corp, node.id, currentYear, { rdScore, cashAvailable, cashCost }).ok
    )
    .sort((a, b) => {
      if (a.node.lane !== b.node.lane) return a.node.lane === "sector" ? -1 : 1;
      return b.node.cost - a.node.cost;
    });
  return candidates[0] ?? null;
}
