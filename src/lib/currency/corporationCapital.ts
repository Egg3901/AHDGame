/**
 * Corporation liquidCapital currency helpers.
 *
 * Invariant after the forex migration:
 *   - `corporation.liquidCapital` is denominated in `liquidCurrencyCode` (the
 *     corp's home currency, e.g. JPY for JP corps, GBP for UK corps, USD for
 *     US corps). Pre-forex corps have no `liquidCurrencyCode` and their
 *     balance is still in ₳ (internal / anchor units).
 *   - Internal turn-processor math runs in ₳ (anchor), and the client's
 *     `formatAmount()` likewise assumes ₳ input and multiplies by the display
 *     FX rate. BUT since v0.2.6 several STORED per-corp economic fields —
 *     `CorporateSector.revenue` / `currentGrowthCost`, `sharePrice`,
 *     `marketingBudget` / `logisticsBudget`, `ceoSalary` — are persisted in
 *     the corp's `liquidCurrencyCode`, NOT ₳ (see `corpEconomyFields.ts`).
 *     Normalize those via `readCorpEconomicAnchor` before any ₳ math; never
 *     treat a stored `sector.revenue` as ₳ directly (doing so silently scaled
 *     a sector-revenue-derived cost by the FX rate and broke affordability
 *     gates for non-USD corps).
 *   - ALL forex-active currencies — including USD — float against ₳ and must
 *     use the live exchange rate when converting. ₳ is its own anchor unit;
 *     there is no currency that is 1:1 with ₳ by definition. (Early forex
 *     code treated USD as identical to ₳; that assumption is no longer true
 *     once USD is in `FOREX_ACTIVE_CURRENCIES` and the rate floats.)
 *
 * Any code path that wants to `$inc` or compare against `liquidCapital` in
 * home-currency units MUST first convert through one of these helpers.
 * Otherwise we leak value: a 1 ₳ payment gets added literally to a JPY
 * balance (~0.01 ¥ instead of ~87 ¥), so non-anchor corps accrue ~100× less
 * cash than the UI claims they are earning.
 */

import type { Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP, eraRateForCurrency } from "@/lib/constants/currencies";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import type { ExchangeRate } from "@/lib/db/types";
// Re-exported so server-side callers keep importing them from here. The
// definitions live in the client-safe module because two client components need
// them, and this file reaches `mongodb` — see corpWalletSpend.ts.
export {
  estimateCorpWalletSpend,
  estimateCorpMaxSpendableTargetAmount,
} from "@/lib/currency/corpWalletSpend";

const FX_RATE_CACHE_TTL_MS = 15_000;

type FxRateCacheEntry = {
  expiresAt: number;
  rates: Map<CurrencyCode, number>;
};

let fxRateCache: FxRateCacheEntry | null = null;
let fxRateCachePromise: Promise<Map<CurrencyCode, number>> | null = null;

export interface CorpCapitalCurrencyInfo {
  countryId?: string | null;
  liquidCurrencyCode?: CurrencyCode | string | null;
}

function buildFxRateMap(docs: ExchangeRate[]): Map<CurrencyCode, number> {
  const map = new Map<CurrencyCode, number>();
  for (const doc of docs) {
    if (doc.rate && doc.rate > 0) map.set(doc.currencyCode as CurrencyCode, doc.rate);
  }
  if (!map.has("USD")) map.set("USD", 1.0);
  return map;
}

/**
 * Home currency used for `liquidCapital` ↔ ₳ conversion.
 * Prefer explicit `liquidCurrencyCode`; if missing, infer from `countryId`
 * (same as sector turn FX lookup) so bond credits and API routes stay aligned
 * when migration backfilled country but not the currency field.
 */
export function resolveCorpLiquidCurrencyCode(
  corp: CorpCapitalCurrencyInfo | null | undefined
): CurrencyCode | undefined {
  if (!corp) return undefined;
  const raw = corp.liquidCurrencyCode;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    return raw as CurrencyCode;
  }
  if (corp.countryId && corp.countryId in COUNTRY_CURRENCY_MAP) {
    return COUNTRY_CURRENCY_MAP[corp.countryId as keyof typeof COUNTRY_CURRENCY_MAP];
  }
  return undefined;
}

/**
 * FX rate (local per 1 ₳) for a corp's home currency using a preloaded map.
 * Missing currency in the map falls back to `1.0` — same operational risk as
 * a missing `exchangeRates` row (corps then receive anchor amounts literally
 * and look under-credited vs intended local denomination).
 *
 * Note: USD is a forex-active currency and floats against ₳ — it must use the
 * live rate, not a hardcoded 1.0. Only truly-missing codes return 1.0.
 */
export function fxRateForCorpFromMap(
  corp: CorpCapitalCurrencyInfo | null | undefined,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  const code = resolveCorpLiquidCurrencyCode(corp);
  if (!code) return 1.0;
  return fxByCurrency.get(code) ?? 1.0;
}

/**
 * Functional currency for a {@link CorporateSector}'s stored economic fields
 * (`revenue`, `realizedRevenue`, `currentGrowthCost`, `laborCost`).
 *
 * A sector is denominated in the currency of the STATE/COUNTRY where it
 * operates (its host market), NOT the parent corp's home currency: a
 * foreign-owned sector earns and spends in its host economy, so its real
 * (₳) value must track the host currency, not the owner's. This keeps a
 * home-currency move on the parent from spuriously revaluing earnings that
 * never touched that currency. Host currency is invariant to ownership
 * changes (a sector's `countryId` doesn't move when the corp changes), which
 * is what makes nationalization / sale re-denomination collapse to a no-op.
 *
 * Falls back to the corp's `countryId` when the sector lacks an explicit one.
 */
export function resolveSectorHostCurrencyCode(
  sector: { countryId?: string | null } | null | undefined,
  corp: CorpCapitalCurrencyInfo | null | undefined
): CurrencyCode | undefined {
  const country = sector?.countryId ?? corp?.countryId;
  if (country && country in COUNTRY_CURRENCY_MAP) {
    return COUNTRY_CURRENCY_MAP[country as keyof typeof COUNTRY_CURRENCY_MAP];
  }
  return undefined;
}

/**
 * FX rate (local per 1 ₳) for a sector's host currency using a preloaded map.
 * Missing currency falls back to `1.0` — same operational risk profile as
 * {@link fxRateForCorpFromMap}.
 */
export function fxRateForSectorHostFromMap(
  sector: { countryId?: string | null } | null | undefined,
  corp: CorpCapitalCurrencyInfo | null | undefined,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  const code = resolveSectorHostCurrencyCode(sector, corp);
  if (!code) return 1.0;
  return fxByCurrency.get(code) ?? 1.0;
}

/**
 * ₳ → `liquidCapital` using {@link resolveCorpLiquidCurrencyCode}. Use with
 * {@link getCorpFxRate} so issuance/spend paths match bond turn when
 * `liquidCurrencyCode` was never set but `countryId` is present.
 */
export function anchorToCorpLiquidCapital(
  amountAnchor: number,
  corp: CorpCapitalCurrencyInfo | null | undefined,
  fxRate: number
): number {
  return anchorToCorpCapital(amountAnchor, resolveCorpLiquidCurrencyCode(corp), fxRate);
}

/** `liquidCapital` → ₳ using resolved home currency (pair with {@link getCorpFxRate}). */
export function corpLiquidCapitalToAnchor(
  amountLocal: number,
  corp: CorpCapitalCurrencyInfo | null | undefined,
  fxRate: number
): number {
  return corpCapitalToAnchor(amountLocal, resolveCorpLiquidCurrencyCode(corp), fxRate);
}

/**
 * Convert an amount expressed in ₳ (anchor / internal units) into the corp's
 * `liquidCapital` denomination. Pre-forex corps (no `liquidCurrencyCode`) keep
 * the ₳ value unchanged.
 *
 * @param amountAnchor Amount in ₳.
 * @param liquidCurrencyCode The corp's `liquidCurrencyCode` field (undefined
 *   = pre-forex).
 * @param fxRate Current FX rate for the corp's home currency (local per 1 ₳).
 *   Must be > 0; caller should default to `1.0` if unknown.
 */
export function anchorToCorpCapital(
  amountAnchor: number,
  liquidCurrencyCode: CurrencyCode | string | null | undefined,
  fxRate: number
): number {
  // Pre-forex corps (no liquidCurrencyCode) hold their balance directly in ₳.
  // All named currencies — including USD — float against ₳ and must use the live rate.
  if (!liquidCurrencyCode) return amountAnchor;
  if (!Number.isFinite(fxRate) || fxRate <= 0) return amountAnchor;
  return amountAnchor * fxRate;
}

/**
 * Inverse of {@link anchorToCorpCapital}: convert a home-currency amount back
 * into ₳. Useful when summing `liquidCapital` into balance-sheet / credit
 * computations that live in ₳.
 */
export function corpCapitalToAnchor(
  amountLocal: number,
  liquidCurrencyCode: CurrencyCode | string | null | undefined,
  fxRate: number
): number {
  // Pre-forex corps (no liquidCurrencyCode) hold their balance directly in ₳.
  // All named currencies — including USD — float against ₳ and must use the live rate.
  if (!liquidCurrencyCode) return amountLocal;
  if (!Number.isFinite(fxRate) || fxRate <= 0) return amountLocal;
  return amountLocal / fxRate;
}

/**
 * Look up the current FX rate for a corp's home currency.
 * Returns `1.0` (no conversion) when the corp is pre-forex (no
 * `liquidCurrencyCode`) or when no rate document exists.
 *
 * Prefer the batch helper {@link loadFxRatesByCurrency} inside turn-level
 * loops; this per-corp lookup is convenient for one-off API routes.
 */
export async function getCorpFxRate(db: Db, corp: CorpCapitalCurrencyInfo): Promise<number> {
  const code = resolveCorpLiquidCurrencyCode(corp);
  // Only pre-forex corps (no resolvable code) skip conversion. USD is forex-active.
  if (!code) return 1.0;
  const doc = await db.collection<ExchangeRate>("exchangeRates").findOne({ currencyCode: code });
  if (doc?.rate && doc.rate > 0) return doc.rate;
  return (await eraFallbackRate(db, code)) ?? 1.0;
}

/**
 * FX rate (local per 1 ₳) for a sector's HOST-state functional currency — the
 * currency its economic fields (revenue, growthCost, …) are stored in. Sibling
 * to {@link getCorpFxRate} for one-off routes; prefer the batch
 * {@link fxRateForSectorHostFromMap} inside loops. Falls back to the corp's
 * country when the sector lacks an explicit one.
 */
export async function getSectorHostFxRate(
  db: Db,
  sector: { countryId?: string | null } | null | undefined,
  corp: CorpCapitalCurrencyInfo | null | undefined
): Promise<number> {
  const code = resolveSectorHostCurrencyCode(sector, corp);
  if (!code) return 1.0;
  const doc = await db.collection<ExchangeRate>("exchangeRates").findOne({ currencyCode: code });
  if (doc?.rate && doc.rate > 0) return doc.rate;
  return (await eraFallbackRate(db, code)) ?? 1.0;
}

/**
 * Convert a `shares × corp.sharePrice` amount from the target corp's home
 * currency into ₳. Post-v0.2.6 `corporation.sharePrice` is stored in each
 * corp's `liquidCurrencyCode`; any cross-currency math (share trades between
 * corps in different currencies, portfolio aggregation across the market,
 * wealth rankings) MUST normalize via ₳ first. Using raw `shares ×
 * sharePrice` as if it were ₳ produces order-of-magnitude wrong values for
 * JPY-denominated corps (~100× off) and small-but-systematic errors for GBP
 * corps (~25% off).
 *
 * Pre-forex corps (no `liquidCurrencyCode`) still hold sharePrice in ₳; the
 * helper returns `shares × sharePrice` unchanged in that case.
 */
export function shareTradeAnchorValue(
  shares: number,
  corp: (CorpCapitalCurrencyInfo & { sharePrice?: number }) | null | undefined,
  fxRate: number
): number {
  const sharePriceLocal = corp?.sharePrice ?? 0;
  const costLocal = shares * sharePriceLocal;
  return corpLiquidCapitalToAnchor(costLocal, corp ?? {}, fxRate);
}

/**
 * Estimate how much of a corporation's single-currency wallet must be spent
 * to fund a purchase denominated in another currency through the market maker.
 * When either currency is missing (legacy / pre-forex corp) or both match,
 * this collapses to a direct same-currency affordability check with no spread.
 */
/**
 * Load every FX rate keyed by currency code. Useful when processing many
 * corps inside a single turn.
 */
/**
 * Rate for a currency with no `exchangeRates` document, from the preset's
 * authored table. See {@link eraRateForCurrency} — the set of currencies is
 * deliberately larger than the set of forex-active ones.
 */
/**
 * The world's preset, read through the CALLER'S `db` handle.
 *
 * ⚠️ Deliberately not `getGameStatePresetOrDefault`. That helper lives in
 * `@/lib/db/collections/gameState`, whose import pulls `@/lib/mongodb` — and
 * therefore the whole driver — into any client component that transitively
 * reaches this file. Several do, via `nationalization/concentration` and the
 * bond/share modals, and `next build` failed with a module-not-found on
 * mongodb's node-only deps. Every function here already receives `db`, so
 * querying through it needs no module import at all. Same read, same fallback.
 */
async function presetFromDb(db: Db): Promise<string | undefined> {
  try {
    const gs = await db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } });
    return gs?.preset ?? DEFAULT_SEED_PRESET;
  } catch {
    return undefined;
  }
}

async function eraFallbackRate(db: Db, code: CurrencyCode): Promise<number | undefined> {
  return eraRateForCurrency(code, await presetFromDb(db));
}

export async function loadFxRatesByCurrency(db: Db): Promise<Map<CurrencyCode, number>> {
  const now = Date.now();
  if (fxRateCache && fxRateCache.expiresAt > now) {
    return new Map(fxRateCache.rates);
  }

  if (!fxRateCachePromise) {
    fxRateCachePromise = db
      .collection<ExchangeRate>("exchangeRates")
      .find({})
      .toArray()
      .then((docs) => {
        // ⚠️ Deliberately NOT back-filled with authored era rates, though the
        // valuation helpers below do exactly that. This map is shared with
        // TRANSACTION paths — `cancelShareListingAndRefund` and friends — which
        // treat a missing entry as "no live rate" and fail closed rather than
        // move money at a substituted one. The authored rate is a turn-0 anchor;
        // the live rate drifts every turn, so silently standing in for it would
        // refund at a stale price. Absence has to stay detectable here.
        const rates = buildFxRateMap(docs);
        fxRateCache = {
          expiresAt: Date.now() + FX_RATE_CACHE_TTL_MS,
          rates,
        };
        return rates;
      })
      .finally(() => {
        fxRateCachePromise = null;
      });
  }

  return new Map(await fxRateCachePromise);
}

/**
 * FX rates for VALUATION — the live map, plus the authored era rate for any
 * currency that legitimately has no `exchangeRates` row.
 *
 * ⚠️ Use this for anything that DISPLAYS or RANKS a value. Use
 * {@link loadFxRatesByCurrency} for anything that SETTLES one: that map leaves
 * a missing currency missing on purpose, so transaction paths can fail closed
 * rather than move money at a turn-0 anchor.
 *
 * The distinction is not academic. `COUNTRY_CURRENCY_MAP` assigns a currency to
 * 28 countries and `FOREX_ACTIVE_COUNTRIES` lists 18; the six Warsaw-Pact
 * members in the gap are deliberately budget-only, so `seedExchangeRates` never
 * writes them a row — but their corporations still carry a real
 * `liquidCurrencyCode` and so take the convert path. MEASURED on a seeded 1953
 * world before this existed: 62 of the exchange's 136 listings were bloc-currency
 * and every one had `totalRevenueAnchor === totalRevenue`, i.e. converted at
 * 1.0, while the controls came out right (GBP 0.357, DDM 4.2, SUR 9.0). A
 * Czechoslovak corp's 25,714,260 Kčs read as ₳25,714,260 instead of ₳952,380.
 */
export async function loadValuationFxRates(db: Db): Promise<Map<CurrencyCode, number>> {
  const rates = await loadFxRatesByCurrency(db);
  const preset = await presetFromDb(db);
  for (const code of Object.values(COUNTRY_CURRENCY_MAP) as CurrencyCode[]) {
    if (rates.has(code)) continue;
    const era = eraRateForCurrency(code, preset);
    if (era !== undefined) rates.set(code, era);
  }
  return rates;
}

export function fxRateMapToRecord(
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): Partial<Record<CurrencyCode, number>> {
  return Object.fromEntries(fxByCurrency) as Partial<Record<CurrencyCode, number>>;
}

export async function loadFxRatesRecord(db: Db): Promise<Partial<Record<CurrencyCode, number>>> {
  return fxRateMapToRecord(await loadFxRatesByCurrency(db));
}

export function resetCorpFxRateCacheForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  fxRateCache = null;
  fxRateCachePromise = null;
}
