// src/lib/currency/autoConvert.ts
import type { Db, ObjectId } from "mongodb";
import type { ExchangeRate } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { PersonalWealthHolder } from "@/lib/currency/characterFunds";
import { FOREX_ACTIVE_CURRENCIES, MARKET_MAKER_SPREAD } from "@/lib/constants/currencies";
import { getPersonalBalance, getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  executeMarketMakerTrade,
  getCountryForCurrency,
  getCrossRate,
} from "@/lib/currency/marketMaker";

/**
 * Compute the source-currency spend that, after Math.round inside
 * executeMarketMakerTrade, will deliver at least `shortfall` target units —
 * capped to the available source balance. The naive idealSpend can land a
 * fraction below shortfall once spread + cross-rate are rounded to integers
 * (e.g. 0.19 EUR → 0 USD), which would leave a buyer "$0.13 short" with
 * plenty of EUR left to spend. The buffer scales with crossRate so it works
 * for both EUR↔USD (rate ~0.7) and JPY→USD (rate ~0.01).
 */
function spendAmountWithRoundingBuffer(
  shortfall: number,
  crossRate: number,
  sourceBal: number
): number {
  if (!Number.isFinite(crossRate) || crossRate <= 0) return Math.max(0, sourceBal);
  const idealSpend = shortfall / ((1 - MARKET_MAKER_SPREAD) * crossRate);
  // One source unit converts to ~crossRate target units. Step at least far
  // enough to absorb a full target-unit of round-down loss.
  const buffer = Math.max(1, Math.ceil(1 / crossRate));
  return Math.min(sourceBal, idealSpend + buffer);
}

interface AutoConvertParams {
  character: PersonalWealthHolder & { _id: ObjectId };
  requiredCurrency: CurrencyCode;
  requiredAmount: number;
  turn: number;
  forexEnabled: boolean;
  /** Collection to update — defaults to "characters" */
  collectionName?: "characters" | "imperialCharacters";
}

interface AutoConvertResult {
  /** Whether conversion was needed at all */
  needed: boolean;
  /** Whether the conversion succeeded (true if not needed) */
  success: boolean;
  /** Shortfall in the required currency */
  shortfall: number;
  /** Amount of home currency spent on conversion (including spread) */
  convertedAmount: number;
  /** Spread fee charged */
  spreadCharged: number;
  error?: string;
}

export interface TopUpPersonalBalanceParams {
  character: PersonalWealthHolder & { _id: ObjectId };
  targetCurrency: CurrencyCode;
  /** Stop once personal balance in `targetCurrency` is at least this much */
  minimumBalance: number;
  turn: number;
  forexEnabled: boolean;
  collectionName?: "characters" | "imperialCharacters";
}

export interface TopUpPersonalBalanceResult {
  success: boolean;
  /** True if at least one market-maker trade ran */
  needed: boolean;
  /** Sum of spread fees from executed trades */
  spreadChargedTotal: number;
  /** Sum of source-currency amounts spent */
  fromAmountTotal: number;
  error?: string;
}

/**
 * Drain other forex wallets into `targetCurrency` via the market maker (same spread as manual FX)
 * until `minimumBalance` is met or no further progress is possible.
 * Used so purchases denominated in one currency can spend liquid held in others.
 */
export async function topUpPersonalBalanceInCurrency(
  db: Db,
  params: TopUpPersonalBalanceParams
): Promise<TopUpPersonalBalanceResult> {
  const {
    character,
    targetCurrency,
    minimumBalance,
    turn,
    forexEnabled,
    collectionName = "characters",
  } = params;

  if (!forexEnabled || !Number.isFinite(minimumBalance) || minimumBalance <= 0) {
    return { success: true, needed: false, spreadChargedTotal: 0, fromAmountTotal: 0 };
  }

  if (getPersonalBalance(character, targetCurrency, true) >= minimumBalance) {
    return { success: true, needed: false, spreadChargedTotal: 0, fromAmountTotal: 0 };
  }

  const personalSnap = character.currencyBalances?.personal ?? {};
  let otherLiquid = 0;
  for (const code of FOREX_ACTIVE_CURRENCIES) {
    if (code === targetCurrency) continue;
    otherLiquid += personalSnap[code] ?? 0;
  }
  if (otherLiquid <= 0) {
    return { success: true, needed: false, spreadChargedTotal: 0, fromAmountTotal: 0 };
  }

  const initialDoc = (await db.collection(collectionName).findOne({ _id: character._id })) as
    (PersonalWealthHolder & { _id: ObjectId }) | null;

  // No DB row (e.g. unit tests without collection mocks) — skip consolidation safely.
  if (!initialDoc) {
    return { success: true, needed: false, spreadChargedTotal: 0, fromAmountTotal: 0 };
  }

  if (getPersonalBalance(initialDoc, targetCurrency, true) >= minimumBalance) {
    return { success: true, needed: false, spreadChargedTotal: 0, fromAmountTotal: 0 };
  }

  let spreadChargedTotal = 0;
  let fromAmountTotal = 0;
  let needed = false;

  for (let iter = 0; iter < 48; iter++) {
    const doc = (await db.collection(collectionName).findOne({ _id: character._id })) as
      (PersonalWealthHolder & { _id: ObjectId }) | null;
    if (!doc) {
      return { success: true, needed, spreadChargedTotal, fromAmountTotal };
    }

    const targetBal = getPersonalBalance(doc, targetCurrency, true);
    if (targetBal >= minimumBalance) {
      return { success: true, needed, spreadChargedTotal, fromAmountTotal };
    }

    const shortfall = minimumBalance - targetBal;
    let progressed = false;

    for (const code of FOREX_ACTIVE_CURRENCIES) {
      if (code === targetCurrency) continue;

      const fresh = (await db.collection(collectionName).findOne({ _id: character._id })) as
        (PersonalWealthHolder & { _id: ObjectId }) | null;
      if (!fresh) break;

      const sourceBal = getPersonalBalance(fresh, code, true);
      if (sourceBal <= 0) continue;

      const fromCountryId = getCountryForCurrency(code);
      const toCountryId = getCountryForCurrency(targetCurrency);
      if (!fromCountryId || !toCountryId) continue;

      const [fromExRate, toExRate] = await Promise.all([
        db.collection<ExchangeRate>("exchangeRates").findOne({ _id: fromCountryId }),
        db.collection<ExchangeRate>("exchangeRates").findOne({ _id: toCountryId }),
      ]);
      if (!fromExRate || !toExRate) {
        return {
          success: false,
          needed,
          spreadChargedTotal,
          fromAmountTotal,
          error: "Exchange rates not available",
        };
      }

      const crossRate = getCrossRate(fromExRate.rate, toExRate.rate);
      const spendAmount = spendAmountWithRoundingBuffer(shortfall, crossRate, sourceBal);
      if (spendAmount <= 0) continue;

      const tradeResult = await executeMarketMakerTrade(db, {
        characterId: character._id,
        countryId: character.countryId as CountryId,
        fromCurrency: code,
        toCurrency: targetCurrency,
        amount: spendAmount,
        turn,
        collectionName,
        source: "auto_purchase",
      });

      if (tradeResult.success) {
        needed = true;
        progressed = true;
        spreadChargedTotal += tradeResult.spreadCharged;
        fromAmountTotal += tradeResult.fromAmount;
        break;
      }
    }

    if (!progressed) {
      return { success: true, needed, spreadChargedTotal, fromAmountTotal };
    }
  }

  return { success: true, needed, spreadChargedTotal, fromAmountTotal };
}

/**
 * Auto-convert helper for purchases requiring foreign currency.
 *
 * When a player lacks sufficient foreign currency for a purchase (stock, bond),
 * this helper converts the shortfall from their home currency at market maker rate (0.275%).
 *
 * Flow:
 * 1. Check if player has enough of requiredCurrency -> no-op if sufficient
 * 2. If autoConvertEnabled is false -> return error directing player to exchange
 * 3. Calculate shortfall in requiredCurrency
 * 4. Reverse-calculate how much homeCurrency is needed (including spread)
 * 5. Check homeCurrency balance is sufficient
 * 6. Execute market maker trade for the shortfall amount
 */
export async function autoConvertForPurchase(
  db: Db,
  params: AutoConvertParams
): Promise<AutoConvertResult> {
  let { character } = params;
  const { requiredCurrency, requiredAmount, turn, forexEnabled } = params;
  const homeCurrency = getHomeCurrency(character);
  let topUpFromTotal = 0;
  let topUpSpreadTotal = 0;

  // Consolidate other forex wallets into the payment currency (market-maker spread applies).
  if (forexEnabled && character.autoConvertEnabled !== false) {
    const topUp = await topUpPersonalBalanceInCurrency(db, {
      character,
      targetCurrency: requiredCurrency,
      minimumBalance: requiredAmount,
      turn,
      forexEnabled,
      collectionName: params.collectionName,
    });
    if (!topUp.success) {
      return {
        needed: true,
        success: false,
        shortfall: Math.max(
          0,
          requiredAmount - getPersonalBalance(character, requiredCurrency, forexEnabled)
        ),
        convertedAmount: 0,
        spreadCharged: 0,
        error: topUp.error ?? "Could not consolidate currencies",
      };
    }
    topUpFromTotal = topUp.fromAmountTotal;
    topUpSpreadTotal = topUp.spreadChargedTotal;
    const fresh = (await db
      .collection(params.collectionName ?? "characters")
      .findOne({ _id: character._id })) as (PersonalWealthHolder & { _id: ObjectId }) | null;
    if (fresh) character = fresh;
  }

  // If buying in home currency, consolidation is all we can do (no further FX leg).
  if (requiredCurrency === homeCurrency) {
    const bal = getPersonalBalance(character, requiredCurrency, forexEnabled);
    if (bal >= requiredAmount) {
      const anyTopUp = topUpFromTotal > 0 || topUpSpreadTotal > 0;
      return {
        needed: anyTopUp,
        success: true,
        shortfall: 0,
        convertedAmount: topUpFromTotal,
        spreadCharged: topUpSpreadTotal,
      };
    }
    return {
      needed: true,
      success: false,
      shortfall: requiredAmount - bal,
      convertedAmount: 0,
      spreadCharged: 0,
      error: `Insufficient funds. Need ${requiredAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${requiredCurrency}, have ${bal.toLocaleString(undefined, { minimumFractionDigits: 2 })}.`,
    };
  }

  const currentBalance = getPersonalBalance(character, requiredCurrency, forexEnabled);

  // Sufficient balance — no conversion needed (possibly after consolidation only)
  if (currentBalance >= requiredAmount) {
    const anyTopUp = topUpFromTotal > 0 || topUpSpreadTotal > 0;
    return {
      needed: anyTopUp,
      success: true,
      shortfall: 0,
      convertedAmount: topUpFromTotal,
      spreadCharged: topUpSpreadTotal,
    };
  }

  const shortfall = requiredAmount - currentBalance;

  // Auto-convert disabled — reject the transaction (undefined treated as enabled by default)
  if (character.autoConvertEnabled === false) {
    return {
      needed: true,
      success: false,
      shortfall,
      convertedAmount: 0,
      spreadCharged: 0,
      error: "Auto-convert is disabled. Visit the currency exchange to convert funds manually.",
    };
  }

  // Calculate how much home currency is needed to produce the shortfall in foreign currency.
  // Reverse the market maker formula:
  //   toAmount = fromAmount * (1 - MARKET_MAKER_SPREAD) * crossRate
  //   fromAmount = toAmount / ((1 - MARKET_MAKER_SPREAD) * crossRate)
  const fromCountryId = getCountryForCurrency(homeCurrency);
  const toCountryId = getCountryForCurrency(requiredCurrency);

  if (!fromCountryId || !toCountryId) {
    return {
      needed: true,
      success: false,
      shortfall,
      convertedAmount: 0,
      spreadCharged: 0,
      error: "Invalid currency configuration",
    };
  }

  const [fromExRate, toExRate] = await Promise.all([
    db.collection<ExchangeRate>("exchangeRates").findOne({ _id: fromCountryId }),
    db.collection<ExchangeRate>("exchangeRates").findOne({ _id: toCountryId }),
  ]);

  if (!fromExRate || !toExRate) {
    return {
      needed: true,
      success: false,
      shortfall,
      convertedAmount: 0,
      spreadCharged: 0,
      error: "Exchange rates not available",
    };
  }

  const crossRate = getCrossRate(fromExRate.rate, toExRate.rate);

  // Check if player has enough home currency
  const homeBalance = getPersonalBalance(character, homeCurrency, forexEnabled);
  // Use the rounding-aware buffer so a sub-unit shortfall (e.g. $0.13)
  // doesn't bottom out at 0 delivered when the natural idealSpend rounds to
  // 0 source units. Cap to homeBalance so we never overspend the wallet.
  const requiredHomeAmount = spendAmountWithRoundingBuffer(shortfall, crossRate, homeBalance);
  const homeNeededRaw = shortfall / ((1 - MARKET_MAKER_SPREAD) * crossRate);
  if (homeBalance < homeNeededRaw) {
    return {
      needed: true,
      success: false,
      shortfall,
      convertedAmount: 0,
      spreadCharged: 0,
      error: `Insufficient ${homeCurrency} to auto-convert. Need ~${Math.ceil(homeNeededRaw).toLocaleString()} ${homeCurrency}, have ${Math.floor(homeBalance).toLocaleString()}.`,
    };
  }

  // Execute the market maker trade for the calculated home amount
  const tradeResult = await executeMarketMakerTrade(db, {
    characterId: character._id,
    countryId: character.countryId as CountryId,
    fromCurrency: homeCurrency,
    toCurrency: requiredCurrency,
    amount: requiredHomeAmount,
    turn,
    collectionName: params.collectionName,
    source: "auto_purchase",
  });

  if (!tradeResult.success) {
    return {
      needed: true,
      success: false,
      shortfall,
      convertedAmount: 0,
      spreadCharged: 0,
      error: tradeResult.error,
    };
  }

  return {
    needed: true,
    success: true,
    shortfall,
    convertedAmount: topUpFromTotal + tradeResult.fromAmount,
    spreadCharged: topUpSpreadTotal + tradeResult.spreadCharged,
  };
}

interface ExplicitPayParams {
  character: PersonalWealthHolder & { _id: ObjectId };
  payCurrency: CurrencyCode;
  requiredCurrency: CurrencyCode;
  requiredAmount: number;
  turn: number;
  forexEnabled: boolean;
  /** Collection to update — defaults to "characters" */
  collectionName?: "characters" | "imperialCharacters";
}

/**
 * Convert the full purchase amount from an explicitly chosen `payCurrency`
 * to `requiredCurrency` using the market maker.
 *
 * Unlike autoConvertForPurchase (which converts the shortfall from home currency),
 * this converts the FULL required amount from the selected pay currency.
 * Used when the player explicitly picks a non-native currency in the UI.
 *
 * No-op when payCurrency == requiredCurrency (direct payment, no conversion needed).
 */
export async function convertForExplicitPay(
  db: Db,
  params: ExplicitPayParams
): Promise<AutoConvertResult> {
  const { character, payCurrency, requiredCurrency, requiredAmount, turn } = params;

  // Direct payment — no conversion needed
  if (payCurrency === requiredCurrency) {
    return { needed: false, success: true, shortfall: 0, convertedAmount: 0, spreadCharged: 0 };
  }

  const fromCountryId = getCountryForCurrency(payCurrency);
  const toCountryId = getCountryForCurrency(requiredCurrency);

  if (!fromCountryId || !toCountryId) {
    return {
      needed: true,
      success: false,
      shortfall: requiredAmount,
      convertedAmount: 0,
      spreadCharged: 0,
      error: `Cannot convert ${payCurrency} → ${requiredCurrency}: currency not supported`,
    };
  }

  const [fromExRate, toExRate] = await Promise.all([
    db.collection<ExchangeRate>("exchangeRates").findOne({ _id: fromCountryId }),
    db.collection<ExchangeRate>("exchangeRates").findOne({ _id: toCountryId }),
  ]);

  if (!fromExRate || !toExRate) {
    return {
      needed: true,
      success: false,
      shortfall: requiredAmount,
      convertedAmount: 0,
      spreadCharged: 0,
      error: "Exchange rates not available",
    };
  }

  // How much payCurrency is needed to produce requiredAmount in requiredCurrency?
  // toAmount = fromAmount * (1 - spread) * crossRate
  // => fromAmount = toAmount / ((1 - spread) * crossRate)
  const crossRate = getCrossRate(fromExRate.rate, toExRate.rate);
  const requiredPayAmount = requiredAmount / ((1 - MARKET_MAKER_SPREAD) * crossRate);

  const payBalance = getPersonalBalance(character, payCurrency, true);
  if (payBalance < requiredPayAmount) {
    return {
      needed: true,
      success: false,
      shortfall: requiredAmount,
      convertedAmount: 0,
      spreadCharged: 0,
      error: `Insufficient ${payCurrency}. Need ~${Math.ceil(requiredPayAmount).toLocaleString()} ${payCurrency}, have ${Math.floor(payBalance).toLocaleString()}.`,
    };
  }

  const tradeResult = await executeMarketMakerTrade(db, {
    characterId: character._id,
    countryId: character.countryId as CountryId,
    fromCurrency: payCurrency,
    toCurrency: requiredCurrency,
    amount: requiredPayAmount,
    turn,
    collectionName: params.collectionName,
    source: "auto_purchase",
  });

  if (!tradeResult.success) {
    return {
      needed: true,
      success: false,
      shortfall: requiredAmount,
      convertedAmount: 0,
      spreadCharged: 0,
      error: tradeResult.error,
    };
  }

  return {
    needed: true,
    success: true,
    shortfall: 0,
    convertedAmount: tradeResult.fromAmount,
    spreadCharged: tradeResult.spreadCharged,
  };
}
