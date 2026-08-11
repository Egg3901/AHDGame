import type { Corporation } from "@/lib/db/types";
import { TECH_ASSET_VALUE_PER_RD_ANCHOR } from "@/lib/constants/corporations";
import { getUnlockedNodes } from "@/lib/constants/techTree/selectors";
import { TECH_DECADES, getDecadeForYear } from "@/lib/constants/techTree/decades";

/**
 * Decade-weighted anchor value of a corporation's unlocked tech-tree nodes.
 *
 * Weight = 0.5^(currentDecadeIndex − nodeDecadeIndex), capped at 1.0 so
 * nodes from the current decade get full weight and each prior decade halves.
 * Returns 0 when currentYear is unknown or the corp has no unlocked nodes.
 */
export function computeTechAssetValueAnchor(
  corp: Pick<Corporation, "type" | "unlockedTechNodeIds" | "techDecadeLane">,
  currentYear: number | undefined
): number {
  if (!currentYear || !corp.unlockedTechNodeIds?.length) return 0;
  const nodes = getUnlockedNodes(corp);
  if (nodes.length === 0) return 0;
  const currentDecadeIdx = TECH_DECADES.findIndex((d) => d.id === getDecadeForYear(currentYear).id);
  let total = 0;
  for (const node of nodes) {
    const nodeDecadeIdx = TECH_DECADES.findIndex((d) => d.id === node.decadeId);
    const offset = Math.max(0, currentDecadeIdx - nodeDecadeIdx);
    total += node.cost * TECH_ASSET_VALUE_PER_RD_ANCHOR * Math.pow(0.5, offset);
  }
  return total;
}
