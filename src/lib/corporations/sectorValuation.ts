import {
  NPV_ANNUAL_DISCOUNT_RATE,
  SECTOR_FOR_SALE_PRICE_FRACTION,
  TURNS_PER_DAY,
} from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { resolveSectorHostCurrencyCode } from "@/lib/currency/corporationCapital";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import {
  sectorBookValueAnchor,
  sectorDailyProfitAnchor,
  type SectorBookValueInput,
} from "@/lib/corporations/sectorProfitBasis";

const GAME_DAYS_PER_YEAR = TURNS_PER_YEAR / TURNS_PER_DAY;

export interface SectorListingValuation {
  dailyProfitAnchor: number;
  yearlyProfitAnchor: number;
  npvAnchor: number;
  priceAnchor: number;
}

/**
 * Asking-price valuation for a sector that a CEO wants to list on the
 * secondary market.
 *
 * The base profitMargin (CEO-set) is intentional: it gives a stable, predictable
 * quote that doesn't drift hour-to-hour with commodity prices or tariff churn.
 * Effective margin (state/commodity/tariff modifiers) is the buyer's diligence
 * — exposed on the sector detail page.
 *
 * Loss-making sectors (negative base profit) get a 0 price and cannot be
 * listed; the listing route enforces that explicitly.
 */
export function computeSectorListingValuation(
  sector: Pick<
    CorporateSector,
    "revenue" | "realizedRevenue" | "profitMargin" | "currentGrowthCost" | "countryId"
  >,
  corporation: Pick<Corporation, "liquidCurrencyCode" | "countryId">,
  hostFxRate: number,
  /**
   * True when marketSystemMode >= "plants" — the growth-cost deduction below is
   * a phantom charge there (growth spend no longer buys capacity), so the quote
   * would understate every sector. Defaults to false = legacy behaviour for the
   * pure/sync callers that cannot read game config.
   */
  plantsEnabled = false,
  /**
   * Book-value floor inputs (D11). Supplied only under plants.
   *
   * WHY A FLOOR EXISTS AT ALL. The quote above is an NPV of PROFIT, and under
   * plants profit is derived from `revenue`, which is itself derived from
   * `capitalStock`. A MOTHBALLED sector therefore prices at exactly 0 — and
   * because the listing route rejects a 0 price, its owner could not sell it at
   * any price, to anybody, while it sat on real capacity and real construction
   * in progress. The only exits left were abandon (a partial refund) and
   * dissolution (salvage), both of which pay LESS than the plant is worth. That
   * is a trap, not a market.
   *
   * The floor is `sectorBookValueAnchor` — the identical basis dissolution
   * salvage and nationalization compensation settle at, so a mothballed plant
   * is worth the same number on every exit and there is no arbitrage between
   * them. It is a `max`, never a replacement: a profitable sector still quotes
   * on its earnings, which are normally far above book, and nothing about the
   * ordinary listing changes.
   *
   * Omit below plants — the legacy quote is then byte-identical.
   */
  bookFloor?: {
    sector: SectorBookValueInput;
    currentYear: number | null | undefined;
    /** The world's era unit-basis scale (`getEraUnitScale(preset)`). */
    eraUnitScale: number;
  }
): SectorListingValuation {
  // Sector economic fields are stored in the sector's host-state currency (the
  // market it operates in), not the owning corp's — resolve/convert accordingly.
  const hostCode = resolveSectorHostCurrencyCode(sector, corporation);
  // Value the listing off realized revenue (what actually clears), not nameplate
  // capacity — keeps the asking quote in line with the corp Financials page and
  // avoids listing a sector on output it never sells. Base profitMargin below
  // stays intentional (a stable quote that doesn't drift with commodity/tariff).
  const { dailyProfitAnchor } = sectorDailyProfitAnchor(sector, {
    plantsEnabled,
    // Persisted `currentGrowthCost` (not a recompute) so the quote matches what
    // the sector page shows.
    growthCost: { kind: "stored" },
    currencyCode: hostCode,
    fxRate: hostFxRate,
  });
  const yearlyProfitAnchor = dailyProfitAnchor * GAME_DAYS_PER_YEAR;
  const npvAnchor = yearlyProfitAnchor > 0 ? yearlyProfitAnchor / NPV_ANNUAL_DISCOUNT_RATE : 0;
  const earningsPriceAnchor = Math.round(npvAnchor * SECTOR_FOR_SALE_PRICE_FRACTION);
  // Book floor: only under plants, and only ever upward. `SECTOR_FOR_SALE_PRICE_
  // FRACTION` is deliberately NOT applied to it — that fraction is a haircut on
  // a speculative earnings stream, whereas book is the plant's replacement cost,
  // which is the thing being handed over.
  const bookAnchor =
    plantsEnabled && bookFloor
      ? Math.round(
          sectorBookValueAnchor(bookFloor.sector, bookFloor.currentYear, bookFloor.eraUnitScale)
        )
      : 0;
  const priceAnchor = Math.max(earningsPriceAnchor, bookAnchor);
  return {
    dailyProfitAnchor,
    yearlyProfitAnchor,
    npvAnchor: Math.round(npvAnchor),
    priceAnchor,
  };
}
