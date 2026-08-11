/**
 * First-plant founding: one facility quantum + era-scaled entry fee.
 *
 * Under plants, entering a market is a FIRST BUILD. The starter used to be
 * sized from DEFAULT_SECTOR_STARTING_REVENUE ($1M/day modern nameplate), which
 * in a 1953 world became ~thousands of facilities and priced new corps out of
 * every market. One facility (`plantSizeUnits`) is the honest "first plant".
 *
 * The entry fee (SECTOR_EXPANSION_BASE_COST) is a modern-calibrated ₳ constant;
 * corp treasuries deflate with the era, so the fee must too or even the permit
 * alone exceeds a baseline 1953 treasury.
 *
 * expandSector, expand-suggestions, and NPP founding MUST call these helpers so
 * the quote and the charge cannot drift.
 */

import type { CorporationType } from "@/lib/constants/corporations";
import { SECTOR_EXPANSION_BASE_COST } from "@/lib/constants/corporations";
import { plantSizeUnits } from "@/lib/constants/facilityQuantum";
import { getEraNominalAmount } from "@/lib/constants/sectorSeedEra";

/** Capacity units ordered for a greenfield first plant (one facility). */
export function foundingStarterUnits(sectorType: CorporationType): number {
  return plantSizeUnits(sectorType);
}

/**
 * Land/permits/licences fee for entering a (state, type) market, in ₳, scaled
 * to the world's era money. `expansionDiscount` is the tech-tree fraction in
 * [0, 1] (already capped upstream).
 */
export function sectorEntryFeeAnchor(preset: string | undefined, expansionDiscount = 0): number {
  const disc =
    Number.isFinite(expansionDiscount) && expansionDiscount > 0
      ? Math.min(1, expansionDiscount)
      : 0;
  return Math.round(getEraNominalAmount(SECTOR_EXPANSION_BASE_COST, preset) * (1 - disc));
}
