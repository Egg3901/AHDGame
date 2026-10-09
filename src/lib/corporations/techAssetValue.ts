import type { Corporation } from "@/lib/db/types";
import { TECH_ASSET_VALUE_PER_RD_ANCHOR } from "@/lib/constants/corporations";
import { getUnlockedNodes } from "@/lib/constants/techTree/selectors";
import {
  TECH_DECADES,
  getDecadeForYear,
  getResearchableDecades,
} from "@/lib/constants/techTree/decades";

/**
 * Highest slot of the baseline tree. Slots above it are specializations and
 * capstones, which are choices and never handed out (see autoGrantedNodeIds).
 */
const BASELINE_MAX_SLOT = 9;

/**
 * Decade-weighted anchor value of a corporation's unlocked tech-tree nodes.
 *
 * Weight = 0.5^(currentDecadeIndex − nodeDecadeIndex), capped at 1.0 so
 * nodes from the current decade get full weight and each prior decade halves.
 * Returns 0 when currentYear is unknown or the corp has no unlocked nodes.
 *
 * Baseline nodes of decades the world clock has already passed carry no value.
 * Every corporation in the sector is granted them for free (autoGrantedNodeIds,
 * at founding and by backfill), so they are shared know-how rather than an
 * asset that sets one company apart. Valuing them gave every company the same
 * ~₳11M of book in the 1991 world, about 38% of all listed market cap, so a
 * dormant firm and a leader were priced almost alike. Only research a company
 * chose and paid for (current or future decades, and specializations) counts.
 */
export function computeTechAssetValueAnchor(
  corp: Pick<Corporation, "type" | "unlockedTechNodeIds" | "techDecadeLane" | "industryModel">,
  currentYear: number | undefined
): number {
  if (!currentYear || !corp.unlockedTechNodeIds?.length) return 0;
  const nodes = getUnlockedNodes(corp);
  if (nodes.length === 0) return 0;
  const currentDecadeIdx = TECH_DECADES.findIndex((d) => d.id === getDecadeForYear(currentYear).id);
  const researchable = new Set(getResearchableDecades(currentYear).map((d) => d.id));
  let total = 0;
  for (const node of nodes) {
    if (!researchable.has(node.decadeId) && node.slot <= BASELINE_MAX_SLOT) continue;
    const nodeDecadeIdx = TECH_DECADES.findIndex((d) => d.id === node.decadeId);
    const offset = Math.max(0, currentDecadeIdx - nodeDecadeIdx);
    total += node.cost * TECH_ASSET_VALUE_PER_RD_ANCHOR * Math.pow(0.5, offset);
  }
  return total;
}
