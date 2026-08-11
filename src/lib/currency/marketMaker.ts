// src/lib/currency/marketMaker.ts
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ExchangeRate, TradeHistoryEntry, TradeSource } from "@/lib/db/types";
import {
  MARKET_MAKER_SPREAD,
  CURRENCY_ANCHOR_COUNTRY,
  COUNTRY_CURRENCY_MAP,
  clampForexSpreadStrength,
} from "@/lib/constants/currencies";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { calculateSpreadFee, distributeSpreadFee } from "@/lib/currency/spreadFees";

interface MarketMakerTradeParams {
  characterId: ObjectId;
  countryId: CountryId;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  amount: number; // amount of fromCurrency to spend
  turn: number;
  /** Collection to update — defaults to "characters" */
  collectionName?: "characters" | "imperialCharacters";
  /** Why this trade happened — stamped onto the tradeHistory row. Defaults to "manual". */
  source?: TradeSource;
  /** Optional reference to the originating entity (corp id, bond id, etc.). */
  sourceRef?: string;
}

interface MarketMakerTradeResult {
  success: boolean;
  error?: string;
  fromAmount: number;
  toAmount: number;
  effectiveRate: number;
  spreadCharged: number;
  tradeHistoryId?: ObjectId;
}

/**
 * Look up the anchor countryId whose exchangeRates doc backs a currency.
 * Uses the explicit {@link CURRENCY_ANCHOR_COUNTRY} map so EUR always resolves to
 * DE (the country that holds the live EUR rate), never to IE which has no doc.
 * Returns null for a currency no country actually uses (e.g. CAD, which only has
 * a USD-parity fallback in the anchor map) — preserving the "Invalid currency
 * code" trade guard.
 */
export function getCountryForCurrency(currencyCode: CurrencyCode): CountryId | null {
  const anchor = CURRENCY_ANCHOR_COUNTRY[currencyCode];
  if (!anchor || COUNTRY_CURRENCY_MAP[anchor] !== currencyCode) return null;
  return anchor;
}

/**
 * Get the cross rate between two currencies.
 * Cross rate = toRate / fromRate (units of toCurrency per 1 unit of fromCurrency).
 */
export function getCrossRate(fromRate: number, toRate: number): number {
  return toRate / fromRate;
}

/**
 * Route a spread fee that was already computed (or skimmed) by a NON-market-maker
 * cross-currency conversion — corp wallet FX on purchases, corp coupon/dividend
 * income, fund redemptions — into the central-bank system, using the same
 * destination-routing + split as {@link executeMarketMakerTrade}.
 *
 * `spreadFee` is denominated in `fromCurrency` (the outflow/spend currency). The
 * reserve slice accrues to the destination currency's CB as a foreign reserve;
 * forexRevenue stays with the source CB. No-op for a non-positive fee, a
 * same-currency conversion, or an unknown source currency.
 */
export async function distributeConversionSpread(
  db: Db,
  spreadFee: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode
): Promise<void> {
  if (!Number.isFinite(spreadFee) || spreadFee <= 0) return;
  if (fromCurrency === toCurrency) return;
  const fromCountryId = getCountryForCurrency(fromCurrency);
  if (!fromCountryId) return;
  const toCountryId = getCountryForCurrency(toCurrency);
  await distributeSpreadFee(db, spreadFee, fromCountryId, fromCurrency, toCountryId ?? undefined);
}

/**
 * Best-effort {@link distributeConversionSpread} for post-commit route side
 * effects (sector acquisition / takeover / relocation): the payer's spread is
 * already removed, so a transient CB-write failure must never reverse or fail
 * the committed transaction — swallow it rather than throw.
 */
export async function safeDistributeConversionSpread(
  db: Db,
  spreadFee: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode
): Promise<void> {
  try {
    await distributeConversionSpread(db, spreadFee, fromCurrency, toCurrency);
  } catch {
    /* post-commit side effect — never fail the originating transaction */
  }
}

/**
 * UI shows 2dp face amounts; stored balances can sit slightly below that rounding (float history).
 * Reject only when the request meaningfully exceeds available; otherwise clamp to available.
 */
function resolveMarketMakerSpend(
  requested: number,
  available: number,
  currency: CurrencyCode
): { spend: number } | { error: string } {
  const tolerance = currency === "JPY" ? 1 : 0.02;
  if (!Number.isFinite(requested) || requested <= 0) {
    return { error: "Invalid amount" };
  }
  if (!Number.isFinite(available) || available < 0) {
    return { error: `Insufficient ${currency} balance` };
  }
  if (requested > available + tolerance) {
    return { error: `Insufficient ${currency} balance` };
  }
  return { spend: Math.min(requested, available) };
}

/**
 * Execute an instant market maker trade at current rates + 0.275% spread.
 * - Deducts fromCurrency from character's personal balance
 * - Credits toCurrency to character's personal balance
 * - Records trade in tradeHistory
 * - Distributes spread fee (50% destroy, 50% central bank)
 *
 * The spread is deducted from the source amount before conversion:
 *   netAmount = amount - spreadFee
 *   toAmount = netAmount * crossRate
 */
export async function executeMarketMakerTrade(
  db: Db,
  params: MarketMakerTradeParams
): Promise<MarketMakerTradeResult> {
  const { characterId, fromCurrency, toCurrency, amount, turn, source, sourceRef } = params;

  // Guard: same-currency trades are nonsensical
  if (fromCurrency === toCurrency) {
    return {
      success: false,
      error: "Cannot trade a currency for itself",
      fromAmount: amount,
      toAmount: 0,
      effectiveRate: 0,
      spreadCharged: 0,
    };
  }

  const fromCountryId = getCountryForCurrency(fromCurrency);
  const toCountryId = getCountryForCurrency(toCurrency);

  if (!fromCountryId || !toCountryId) {
    return {
      success: false,
      error: "Invalid currency code",
      fromAmount: amount,
      toAmount: 0,
      effectiveRate: 0,
      spreadCharged: 0,
    };
  }

  const collection = params.collectionName ?? "characters";
  const charDoc = await db
    .collection(collection)
    .findOne(
      { _id: characterId },
      { projection: { [`currencyBalances.personal.${fromCurrency}`]: 1 } }
    );
  const available =
    (charDoc as { currencyBalances?: { personal?: Partial<Record<CurrencyCode, number>> } } | null)
      ?.currencyBalances?.personal?.[fromCurrency] ?? 0;

  const spendResolution = resolveMarketMakerSpend(amount, available, fromCurrency);
  if ("error" in spendResolution) {
    return {
      success: false,
      error: spendResolution.error,
      fromAmount: amount,
      toAmount: 0,
      effectiveRate: 0,
      spreadCharged: 0,
    };
  }
  const spendAmount = spendResolution.spend;

  const [fromExRate, toExRate] = await Promise.all([
    db.collection<ExchangeRate>("exchangeRates").findOne({ _id: fromCountryId }),
    db.collection<ExchangeRate>("exchangeRates").findOne({ _id: toCountryId }),
  ]);

  if (!fromExRate || !toExRate) {
    return {
      success: false,
      error: "Exchange rate not found for one or both currencies",
      fromAmount: amount,
      toAmount: 0,
      effectiveRate: 0,
      spreadCharged: 0,
    };
  }

  // Guard against malformed rate documents. If either `.rate` is non-finite
  // or non-positive, getCrossRate() returns NaN/Infinity and Math.floor of
  // that propagates into the $inc update — the source balance still gets
  // debited while the credit side is silently dropped by the driver. The
  // turn-269 NaN cascade (gdpGrowth NaN → computeMacroTarget NaN →
  // exchangeRates.rate NaN) triggered exactly this on turns 270–277 and
  // drained ~$41M from a single bond-maturity payout. Reject up front so
  // the source balance is never touched on a broken rate.
  if (
    !Number.isFinite(fromExRate.rate) ||
    fromExRate.rate <= 0 ||
    !Number.isFinite(toExRate.rate) ||
    toExRate.rate <= 0
  ) {
    return {
      success: false,
      error: "Exchange rate is invalid for one or both currencies",
      fromAmount: amount,
      toAmount: 0,
      effectiveRate: 0,
      spreadCharged: 0,
    };
  }

  // Calculate spread and net conversion (use resolved spend — may clamp float/display mismatch).
  // The source currency chair's spread-strength (0.5–1.5×) scales the fee; read
  // from the already-loaded fromExRate doc so the hot path takes no extra query.
  const spreadStrength = clampForexSpreadStrength(fromExRate.forexSpreadStrength);
  const spreadFee = calculateSpreadFee(spendAmount, MARKET_MAKER_SPREAD * spreadStrength);
  const netAmount = spendAmount - spreadFee;
  const crossRate = getCrossRate(fromExRate.rate, toExRate.rate);
  const toAmount = Math.round(netAmount * crossRate);

  // Belt-and-braces: guard against non-finite derived values even when the
  // rate inputs passed the check above (extreme denormals, etc.). Fail before
  // writing so the fromCurrency isn't debited without a matching credit.
  if (!Number.isFinite(crossRate) || crossRate <= 0 || !Number.isFinite(toAmount)) {
    return {
      success: false,
      error: "Exchange rate is invalid for one or both currencies",
      fromAmount: amount,
      toAmount: 0,
      effectiveRate: 0,
      spreadCharged: 0,
    };
  }

  // Atomic balance update with race-condition guard:
  // The filter checks the character has sufficient fromCurrency before deducting.
  const deductInc = buildPersonalBalanceInc(-spendAmount, fromCurrency, true);
  const creditInc = buildPersonalBalanceInc(toAmount, toCurrency, true);

  const result = await db
    .collection(collection)
    .updateOne(
      { _id: characterId, [`currencyBalances.personal.${fromCurrency}`]: { $gte: spendAmount } },
      { $inc: { ...deductInc, ...creditInc } }
    );

  if (result.modifiedCount === 0) {
    return {
      success: false,
      error: `Insufficient ${fromCurrency} balance`,
      fromAmount: amount,
      toAmount: 0,
      effectiveRate: 0,
      spreadCharged: 0,
    };
  }

  // Record trade history
  const tradeEntry: Omit<TradeHistoryEntry, "_id"> = {
    buyerCharacterId: characterId,
    sellerCharacterId: null, // market maker
    fromCurrency,
    toCurrency,
    amount: spendAmount,
    rate: crossRate,
    spread: spreadFee,
    turn,
    createdAt: new Date(),
    source: source ?? "manual",
    ...(sourceRef ? { sourceRef } : {}),
  };
  const { insertedId: tradeHistoryId } = await db
    .collection<TradeHistoryEntry>("tradeHistory")
    .insertOne(tradeEntry as TradeHistoryEntry);

  // Distribute spread fee: destroy sink; forexRevenue to the source currency's
  // CB; the reserve slice (in fromCurrency) accrues to the destination currency's
  // CB as a foreign reserve — so converting foreign income (coupons/dividends) to
  // home currency builds the recipient country's foreign-currency reserves in the
  // outflow currency.
  await distributeSpreadFee(db, spreadFee, fromCountryId, fromCurrency, toCountryId);

  return {
    success: true,
    fromAmount: spendAmount,
    toAmount,
    effectiveRate: crossRate,
    spreadCharged: spreadFee,
    tradeHistoryId,
  };
}
