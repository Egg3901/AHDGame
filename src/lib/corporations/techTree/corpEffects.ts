import type { CorporationType } from "@/lib/constants/corporations";
import { getSectorTechEffects, type TechCorpView } from "@/lib/constants/techTree";
import { isSectorTechTreesEnabled } from "./featureFlag";

/**
 * Resolve the tech-tree growth-cost multiplier for a corp's sector of the given
 * type (1 when the feature is off). Scoped per sector type so the preview matches
 * what the turn engine charges (Corporate-lane reduced + primary-only Sector-lane).
 */
export async function getCorpTechGrowthCostMultiplier(
  corp: TechCorpView,
  sectorType: CorporationType
): Promise<number> {
  if (!(await isSectorTechTreesEnabled())) return 1;
  return getSectorTechEffects(corp, sectorType).growthCostMultiplier;
}
