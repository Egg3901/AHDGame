/**
 * ONE exit basis for a sector, shared by every preview/executor pair (D11).
 *
 * The rule: below the plants tier a sector exits at its going-concern NPV;
 * at/above plants it exits at replacement-cost BOOK (built capacity priced at
 * the same ₳/unit the build path charges, plus construction in flight). Book is
 * what closes the build-then-exit mint — salvage can never exceed build cost.
 *
 * The reason this is a module and not an inline `plantsEnabled ? … : …` at each
 * call site is the P3a audit finding: the bond-default PANEL quoted a
 * salvage/restructure figure derived from NPV while the EXECUTOR it launches
 * settled at book. A CEO chose "dissolve" against one number and was paid
 * another. Preview and executor now call the SAME function with the SAME mode,
 * so the two cannot drift again without the test below going red.
 *
 * Every value returned is in ₳.
 */
import type { CentralBank, Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorpCapitalCurrencyInfo } from "@/lib/currency/corporationCapital";
import { computeSectorNpvSum } from "@/lib/bonds/corporateBondDefault";
import {
  sectorBookValueAnchor,
  sumSectorBookValueAnchor,
} from "@/lib/corporations/sectorProfitBasis";

export interface SectorExitBasisOptions {
  /** True when marketSystemMode >= "plants". */
  plantsEnabled: boolean;
  /** Game year — era-prices the book basis. Only read under plants. */
  currentYear?: number | null;
  /** The world's era unit-basis scale (`getEraUnitScale(preset)`). Only read under plants. */
  eraUnitScale: number;
  /**
   * Steady-state basis: value the sector on revenue − maintenance, ignoring the
   * owner's discretionary growth spend. Nationalization uses this; the
   * going-concern exit paths (dissolution / restructuring) do not. Ignored
   * under plants, where the growth deduction is 0 either way.
   */
  excludeGrowthCost?: boolean;
}

/**
 * Whole-corp exit value in ₳: Σ book under plants, Σ NPV below.
 *
 * `primeMap` / `corp` / `fxByCurrency` are only consulted on the NPV branch;
 * callers still pass them because the mode is a runtime value.
 */
export function sectorExitValueAnchor(
  sectors: CorporateSector[],
  primeRateByCountry: Map<string, number>,
  corp: CorpCapitalCurrencyInfo | Corporation | null | undefined,
  fxByCurrency: ReadonlyMap<CurrencyCode, number> | undefined,
  options: SectorExitBasisOptions
): number {
  if (options.plantsEnabled) {
    return sumSectorBookValueAnchor(sectors, options.currentYear, options.eraUnitScale);
  }
  return computeSectorNpvSum(sectors, primeRateByCountry, corp, fxByCurrency, {
    excludeGrowthCost: options.excludeGrowthCost,
  });
}

/**
 * Per-sector exit value in ₳, keyed by sector id.
 *
 * The restructure planner ({@link import("./restructure").previewRestructure})
 * ranks and selects sectors by this figure, so the preview route and the
 * executor MUST build the list the same way — that is the whole point of this
 * helper. The field stays named `npvAnchor` because the planner's public shape
 * is unchanged; under plants the number it carries is a book value.
 */
export function sectorExitValueByIdAnchor(
  sectors: CorporateSector[],
  primeRateByCountry: Map<string, number>,
  corp: CorpCapitalCurrencyInfo | Corporation | null | undefined,
  fxByCurrency: ReadonlyMap<CurrencyCode, number> | undefined,
  options: SectorExitBasisOptions
): { sectorId: string; npvAnchor: number }[] {
  return sectors.map((s) => ({
    sectorId: s._id.toString(),
    npvAnchor: options.plantsEnabled
      ? sectorBookValueAnchor(s, options.currentYear, options.eraUnitScale)
      : computeSectorNpvSum([s], primeRateByCountry, corp, fxByCurrency, {
          excludeGrowthCost: options.excludeGrowthCost,
        }),
  }));
}

/** Re-exported so callers need one import for the whole exit-basis contract. */
export type { CentralBank };
