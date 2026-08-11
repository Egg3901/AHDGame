import { RESTRUCTURE_SECTOR_SALVAGE_FRACTION } from "@/lib/constants/corporations";

/**
 * One sector considered for restructuring liquidation. `npvAnchor` is the
 * sector's going-concern NPV in ₳; `salvageAnchor` is the cash actually
 * recoverable when it's liquidated to pay bondholders.
 */
export interface RestructureSectorCandidate {
  sectorId: string;
  npvAnchor: number;
  salvageAnchor: number;
}

export interface RestructurePreview {
  /** True when cash + salvage of ALL sectors covers the full defaulted principal. */
  feasible: boolean;
  /** Defaulted principal that must be paid in full to cure, in ₳. */
  defaultedPrincipal: number;
  /** Corp liquid capital in ₳ (may be negative — that's often why it defaulted). */
  liquidCapital: number;
  /** Shortfall that must be raised from sector sales (₳); 0 when cash alone covers. */
  needFromSectors: number;
  /** Salvage value of every liquidatable sector (₳) — the ceiling on what restructuring can raise. */
  totalSalvageAvailable: number;
  /** Minimum set of sectors (largest salvage first) whose sale covers `needFromSectors`. */
  sectorsToLiquidate: RestructureSectorCandidate[];
  /** Salvage cash raised by selling exactly `sectorsToLiquidate` (₳). */
  proceeds: number;
  /** liquidCapital after adding `proceeds` and paying the defaulted principal in full (₳). */
  residualLiquidCapital: number;
}

/**
 * Pure planner for a bond-default RESTRUCTURING: decide whether selling sectors
 * can raise enough cash to pay defaulted bondholders in full, and if so, which
 * (minimum, highest-value-first) sectors to liquidate.
 *
 * Restructuring keeps the corp alive: it sells just enough sectors — at the
 * orderly-sale {@link RESTRUCTURE_SECTOR_SALVAGE_FRACTION} recovery rate — to
 * top liquid capital up to the full defaulted principal. Bondholders are made
 * whole (100% of face), unlike dissolution's pro-rata waterfall.
 *
 * All amounts are in ₳; the caller normalizes corp-local values before calling.
 */
export function previewRestructure(params: {
  defaultedPrincipalAnchor: number;
  liquidCapitalAnchor: number;
  /** Per-sector going-concern NPV in ₳ (e.g. from computeSectorNpvSum on each sector). */
  sectorNpvByIdAnchor: { sectorId: string; npvAnchor: number }[];
}): RestructurePreview {
  const defaultedPrincipal = Math.max(0, params.defaultedPrincipalAnchor);
  const liquidCapital = params.liquidCapitalAnchor;

  // Only the positive cash balance offsets the debt; a negative balance is part
  // of the hole sectors must fill, so it correctly increases needFromSectors.
  const needFromSectors = Math.max(0, defaultedPrincipal - liquidCapital);

  const candidates: RestructureSectorCandidate[] = params.sectorNpvByIdAnchor
    .map((s) => ({
      sectorId: s.sectorId,
      npvAnchor: s.npvAnchor,
      salvageAnchor: Math.max(0, s.npvAnchor) * RESTRUCTURE_SECTOR_SALVAGE_FRACTION,
    }))
    .filter((s) => s.salvageAnchor > 0)
    .sort((a, b) => b.salvageAnchor - a.salvageAnchor);

  const totalSalvageAvailable = candidates.reduce((sum, s) => sum + s.salvageAnchor, 0);

  // Nothing owed, or cash already covers it: feasible with no sectors sold.
  if (defaultedPrincipal <= 0 || needFromSectors <= 0) {
    return {
      feasible: defaultedPrincipal > 0,
      defaultedPrincipal,
      liquidCapital,
      needFromSectors: 0,
      totalSalvageAvailable,
      sectorsToLiquidate: [],
      proceeds: 0,
      residualLiquidCapital: liquidCapital - defaultedPrincipal,
    };
  }

  // Infeasible: even selling every sector can't cover the shortfall.
  if (totalSalvageAvailable < needFromSectors) {
    return {
      feasible: false,
      defaultedPrincipal,
      liquidCapital,
      needFromSectors,
      totalSalvageAvailable,
      sectorsToLiquidate: [],
      proceeds: 0,
      residualLiquidCapital: liquidCapital + totalSalvageAvailable - defaultedPrincipal,
    };
  }

  // Greedily take the highest-salvage sectors until the shortfall is covered.
  const sectorsToLiquidate: RestructureSectorCandidate[] = [];
  let proceeds = 0;
  for (const c of candidates) {
    if (proceeds >= needFromSectors) break;
    sectorsToLiquidate.push(c);
    proceeds += c.salvageAnchor;
  }

  return {
    feasible: true,
    defaultedPrincipal,
    liquidCapital,
    needFromSectors,
    totalSalvageAvailable,
    sectorsToLiquidate,
    proceeds,
    residualLiquidCapital: liquidCapital + proceeds - defaultedPrincipal,
  };
}
