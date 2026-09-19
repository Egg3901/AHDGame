/**
 * Forex Turn Phase — updates exchange rates for all active currencies.
 *
 * Runs in Group 12 after inflation recalc, gated behind GameState.forexEnabled.
 * Reads CentralBank (macro indicators), tradeHistory (volume), and exchangeRates
 * (current rates). Writes updated exchangeRates and processes triggered limit orders.
 *
 * See docs/design/currency-exchange.md "Rate Update Formula" and "Turn Processing Placement".
 */

import type { AnyBulkWriteOperation, Db, ObjectId } from "mongodb";
import type { CentralBank, TurnSnapshot } from "@/lib/db/types/centralBank";
import type {
  ExchangeRate,
  InterventionPolicy,
  InterventionRecord,
} from "@/lib/db/types/exchangeRate";
import { FOREX_AND_MACRO_CHART_HISTORY_TURNS, MS_PER_TURN } from "@/lib/constants/turnTime";
import type { CurrencyOrder } from "@/lib/db/types/currencyOrder";
import type { TradeHistoryEntry } from "@/lib/db/types/tradeHistory";
import type { Character } from "@/lib/db/types/character";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  FOREX_ACTIVE_COUNTRIES,
  INITIAL_RATES,
  getInitialRates,
  COUNTRY_CURRENCY_MAP,
  LIMIT_ORDER_SPREAD,
  SPREAD_FEE_CENTRAL_BANK_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
  CURRENCY_SYMBOLS,
  INTERVENTION_FAILURE_INFAMY,
  INTERVENTION_HISTORY_MAX,
  FOREX_ACTIVE_CURRENCIES,
  reserveCurrencyVolatilityMultiplier,
  CYCLE_PRESSURE_TURNS,
  CYCLE_PRESSURE_BY_REGIME,
  rollCyclePressureRegime,
} from "@/lib/constants/currencies";
import { computeRateUpdate, type MacroInputs } from "@/lib/currency/rateCalculation";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { isCommandEconomy, MARKETIZATION_SCHEDULE } from "@/lib/constants/commandEconomy";
import { rankReserveCurrencies } from "@/lib/centralBank/reserveCurrencyRanking";
import { computeCurrencyVolumes } from "@/lib/currency/volumeTracker";
import { computeInterventionPressure, isInBand } from "@/lib/currency/interventionCalculator";
import { interventionAdherenceMultiplier } from "@/lib/centralBank/marketEffects";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { sendSystemMail } from "@/lib/mail/systemMail";
import { getBankId } from "@/lib/centralBank/helpers";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export interface ForexTurnResult {
  countriesUpdated: number;
  limitOrdersFilled: number;
  limitOrdersExpired: number;
  totalSpreadRevenue: number;
}

/**
 * Finite-or-default: `typeof NaN === "number"` is true, so `?? 0` does not catch
 * NaN that slipped into a number field. Any NaN here would propagate through the
 * rate-update math and re-poison exchangeRates every turn forever, so every
 * input gets this guard.
 */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Extract macro indicators from a CentralBank document.
 * Falls back to 0 (and rejects NaN) for missing fields — safe default for rate math.
 */
function extractMacroInputs(bank: CentralBank): MacroInputs {
  return {
    primeRate: finiteOr(bank.primeRate, 0),
    inflationRate: finiteOr(bank.inflationHistory?.at(-1)?.rate, 0),
    gdpGrowth: finiteOr(bank.gdpGrowthHistory?.at(-1)?.rate, 0),
    tradeGrowth: finiteOr(bank.tradeGrowth, 0),
  };
}

/**
 * Process exchange rates for all forex-active currencies.
 *
 * Steps per country:
 * 1. Read current ExchangeRate (or seed from INITIAL_RATES if first run)
 * 2. Read CentralBank macro indicators
 * 3. Compute volume from tradeHistory
 * 4. Run rate update formula
 * 5. Write updated ExchangeRate with history snapshot
 *
 * After all rates are updated, process open limit orders that have been
 * triggered by the new rates.
 *
 * `preset` is the reset-preset id of the active world (`gameState.preset`,
 * e.g. `"1953-default"`). It selects the same era rate table the seed used so
 * the macro-target anchor (`baseRate`) stays era-correct at runtime — without
 * it, a 1953 world's Bretton Woods pegs would drift to the 2019 table within
 * ~12 turns (JPY 360→146, FRF 350→4.8, …). Omitted/unknown presets resolve to
 * the modern (2019) table, matching both the seeder's default and the legacy
 * behavior for 1991+/2019 worlds.
 *
 * DELIBERATELY preset-keyed (NOT current-year-keyed, unlike the monetary
 * anchors below): `baseRate` is the world's own seeded FX calibration. Every
 * live rate drifted from that anchor legitimately through play, and both the
 * macro-target multiplier and the ±50% guardrail (`clampRate`) are relative
 * to it — re-keying it to the current in-game year's era table would snap
 * every currency's anchor (and its guardrail band) the moment the world
 * crosses an era boundary, an instant FX discontinuity for player holdings.
 * A world keeps its seeded anchor for life; era graduation flows through the
 * monetary deviation terms instead.
 *
 * `currentYear` (`gameState.currentYear` — the CURRENT in-game year) selects
 * the era MONETARY baselines for the macro target's inflation/prime-rate
 * deviation terms (monetaryEra.ts), graduating as the world's clock advances.
 * Omitted or 1999+ = the global tables, byte-identical to prior behavior.
 */
export async function processForexTurn(
  db: Db,
  currentTurn: number,
  preset?: string,
  currentYear?: number | null
): Promise<ForexTurnResult> {
  const now = new Date();
  let countriesUpdated = 0;
  let totalSpreadRevenue = 0;

  // Resolve the era-selected initial-rate table ONCE per turn (not per country)
  // — the same lookup `seedExchangeRates` used at world creation.
  const eraInitialRates = getInitialRates(preset ?? DEFAULT_SEED_PRESET);

  // Load all central bank data in one query
  const banks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  const bankMap = new Map(banks.map((b) => [b.countryId, b]));

  // Command-economy regime gate (default OFF). When on, command-era currencies
  // (USSR, command-China) are held at a fixed, non-convertible official rate.
  const gameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const commandEconomyEnabled = gameConfig?.commandEconomyEnabled === true;

  // Compute volumes for all currencies in one pass
  const volumes = await computeCurrencyVolumes(db, currentTurn);

  // Pre-fetch all existing exchange rates in one query
  const existingRateDocs = await db
    .collection<ExchangeRate>("exchangeRates")
    .find({ _id: { $in: FOREX_ACTIVE_COUNTRIES } })
    .toArray();
  const rateMap = new Map(existingRateDocs.map((r) => [r._id, r]));
  const ratesByCurrency: Partial<Record<CurrencyCode, number>> = Object.fromEntries(
    existingRateDocs.map((rate) => [rate.currencyCode, rate.rate])
  ) as Partial<Record<CurrencyCode, number>>;

  // The top reserve currencies (most-held across all CB reserves) get a
  // rank-based reduced-volatility buff this turn (#1 −50%, #2 −25%, #3 −12.5%).
  // Computed from pre-update rates — a 1-turn lag on the ranking is immaterial
  // and avoids ordering coupling.
  const reserveVolatilityByCurrency = new Map<CurrencyCode, number>();
  for (const entry of rankReserveCurrencies(banks, ratesByCurrency)) {
    reserveVolatilityByCurrency.set(
      entry.currencyCode,
      reserveCurrencyVolatilityMultiplier(entry.rank)
    );
  }

  // Update rates for each active country
  for (const countryId of FOREX_ACTIVE_COUNTRIES) {
    const bank = bankMap.get(countryId);
    if (!bank) continue;

    const currencyCode = COUNTRY_CURRENCY_MAP[countryId];
    // Era-aware anchor: pre-modern presets use their own rate table; modern
    // presets resolve to INITIAL_RATES (kept as a defensive fallback for any
    // country missing from an era table so its currency never loses its anchor).
    // Used ONLY to SEED a brand-new currency row — see below.
    const seedBaseRate = eraInitialRates[countryId] ?? INITIAL_RATES[countryId];
    if (seedBaseRate === undefined || !currencyCode) continue;

    // Read or seed the exchange rate document
    let existingRate = rateMap.get(countryId);

    // Anchor a LIVE currency to the baseRate it was persisted with — never
    // silently re-anchor a running world to a different rate table. NG exposed
    // this: its modern INITIAL_RATES (₦1550, ~2024) and its era table (~₦9,
    // 1991) differ ~100x (#3276), so when the era-aware anchor first resolved
    // the era value on a long-running 1991 world, NG's baseRate flipped
    // 1550→~9 and every naira-denominated asset/valuation snapped ~100x in a
    // single turn. The seeded row's persisted baseRate is the world's own
    // calibration and is authoritative; the era/initial tables only SEED a
    // new row.
    const baseRate = finiteOr(existingRate?.baseRate, seedBaseRate);

    if (!existingRate) {
      // First run — seed with initial rate
      existingRate = {
        _id: countryId,
        countryId,
        currencyCode,
        rate: baseRate,
        baseRate,
        macroTarget: baseRate,
        rateHistory: [],
        buyVolume24: 0,
        sellVolume24: 0,
        updatedAt: now,
      };
      await db.collection<ExchangeRate>("exchangeRates").insertOne(existingRate);
    }

    const macro = extractMacroInputs(bank);
    const currencyVolumes = volumes[currencyCode] ?? { buyVolume24: 0, sellVolume24: 0 };
    // Defend against NaN leaking in from either persisted rate or computed
    // volumes — reset to baseRate / 0 rather than propagate forever.
    const safeCurrentRate = finiteOr(existingRate.rate, baseRate);
    ratesByCurrency[currencyCode] = safeCurrentRate;
    const safeVolumes = {
      buyVolume24: finiteOr(currencyVolumes.buyVolume24, 0),
      sellVolume24: finiteOr(currencyVolumes.sellVolume24, 0),
    };

    // Fixed-rate short-circuit — hold at the pegged value, skip drift. Two
    // sources, both using != null (not truthy) so a theoretical peg of 0 isn't
    // silently bypassed:
    //  1. an admin hardPeg (explicit, wins if set), or
    //  2. the command-economy regime — a command-era currency (USSR / command
    //     China) is a FIXED, non-convertible official rate, pinned to its era
    //     anchor (baseRate) with no drift, volume/cycle pressure, or chair
    //     intervention. This is the currency half of the command-lite model and
    //     structurally prevents the drift/re-anchor class of FX incident for
    //     currencies that were never market currencies.
    const commandActive = isCommandEconomy(countryId, currentYear, commandEconomyEnabled);
    const peggedRate = existingRate.hardPeg ?? (commandActive ? baseRate : null);
    const hardPegActive = peggedRate != null;
    const volatilityMultiplier = reserveVolatilityByCurrency.get(currencyCode) ?? 1;

    // 12-hour (12-turn) directional pressure cycle: keep the active regime until
    // its window expires, then roll a fresh random one. Skipped under a hard peg.
    let cycleRegime = existingRate.cyclePressureRegime ?? null;
    let cycleUntil = existingRate.cyclePressureUntilTurn ?? null;
    if (cycleRegime == null || cycleUntil == null || currentTurn >= cycleUntil) {
      cycleRegime = rollCyclePressureRegime();
      cycleUntil = currentTurn + CYCLE_PRESSURE_TURNS;
    }
    const cyclePressure = hardPegActive ? 0 : CYCLE_PRESSURE_BY_REGIME[cycleRegime];

    const update = hardPegActive
      ? {
          rate: peggedRate as number,
          macroTarget: peggedRate as number,
          volumePressure: 0,
          cyclePressure: 0,
        }
      : computeRateUpdate(
          safeCurrentRate,
          baseRate,
          countryId,
          macro,
          safeVolumes,
          undefined,
          volatilityMultiplier,
          cyclePressure,
          currentYear
        );

    // Final sanity: if the pipeline still somehow produced NaN, fall back to the
    // current rate rather than write poison into history.
    if (!Number.isFinite(update.rate)) update.rate = safeCurrentRate;
    if (!Number.isFinite(update.macroTarget)) update.macroTarget = baseRate;

    // ── FX Intervention (chair standing policy) ────────────────────────────
    // Runs after macro/volume math, skipped under hardPeg. Synthetic volume is
    // blended into the shared volume-pressure channel so intervention obeys
    // the same ±5% cap as organic trades.
    const interventionOutcome = hardPegActive
      ? null
      : await applyIntervention({
          rate: update.rate,
          macroTarget: update.macroTarget,
          baseRate,
          countryId,
          currencyCode,
          policy: existingRate.interventionPolicy ?? null,
          bank,
          rates: ratesByCurrency,
          macro,
          organicVolumes: safeVolumes,
          currentTurn,
          now,
          volatilityMultiplier,
          cyclePressure,
          currentYear,
        });

    if (interventionOutcome) {
      update.rate = interventionOutcome.rate;
      update.macroTarget = interventionOutcome.macroTarget;
    }

    // Build history snapshot — prune to last FOREX_AND_MACRO_CHART_HISTORY_TURNS (5 in-game years)
    const newSnapshot: TurnSnapshot = { turn: currentTurn, rate: update.rate };
    const updatedHistory = [...existingRate.rateHistory, newSnapshot].slice(
      -FOREX_AND_MACRO_CHART_HISTORY_TURNS
    );

    const nextPolicy = computeNextPolicy({
      existing: existingRate.interventionPolicy ?? null,
      newRecord: interventionOutcome?.record ?? null,
      rateAfter: update.rate,
      currentTurn,
      infamyCharged: interventionOutcome?.infamyCharged ?? false,
    });

    // Persist hardPeg for command currencies so admin/forex UI badges them;
    // clear when the regime no longer applies. Flag-off → no hardPeg writes
    // (byte-identical). Non-schedule countries are never touched.
    const setFields: Record<string, unknown> = {
      rate: update.rate,
      macroTarget: update.macroTarget,
      rateHistory: updatedHistory,
      buyVolume24: currencyVolumes.buyVolume24,
      sellVolume24: currencyVolumes.sellVolume24,
      cyclePressureRegime: cycleRegime,
      cyclePressureUntilTurn: cycleUntil,
      ...(nextPolicy !== undefined ? { interventionPolicy: nextPolicy } : {}),
      updatedAt: now,
    };
    const unsetFields: Record<string, ""> = {};
    if (commandEconomyEnabled && MARKETIZATION_SCHEDULE[countryId]) {
      if (commandActive) {
        setFields.hardPeg = baseRate;
      } else if (existingRate.hardPeg != null) {
        unsetFields.hardPeg = "";
      }
    }

    await db.collection<ExchangeRate>("exchangeRates").updateOne(
      { _id: countryId },
      {
        $set: setFields,
        ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
      }
    );

    // Persist reserve draw, infamy, and trade audit row. All post-rate-write so
    // that a partial failure here leaves exchange rates intact rather than
    // half-updated.
    if (interventionOutcome) {
      await persistInterventionSideEffects(db, countryId, bank, interventionOutcome);
    }

    countriesUpdated++;
  }

  // Process triggered limit orders
  const limitResult = await processTriggeredLimitOrders(db, currentTurn, now);
  totalSpreadRevenue = limitResult.totalSpreadRevenue;
  await sendFillNotifications(db, limitResult.notifications);

  // Expire orders past their expiry turn
  const expiredCount = await expireStaleOrders(db, currentTurn, now);

  return {
    countriesUpdated,
    limitOrdersFilled: limitResult.ordersFilled,
    limitOrdersExpired: expiredCount,
    totalSpreadRevenue,
  };
}

// ── FX Intervention ─────────────────────────────────────────────────────────

interface InterventionOutcome {
  /** Post-intervention rate (may equal input rate if no spend happened). */
  rate: number;
  macroTarget: number;
  /** Audit record to append to recentInterventions — null when no spend happened. */
  record: InterventionRecord | null;
  /** Reserve draw deltas (negative numbers). */
  forexRevenueDelta: number;
  reserveBalanceDelta: number;
  spreadFeeReserveDeltas: Partial<Record<CurrencyCode, number>>;
  /** True when a failure-infamy charge should be applied to the seated chair. */
  infamyCharged: boolean;
}

interface ReserveFundingPlan {
  availableInternal: number;
  spreadFeeReserveDeltas: Partial<Record<CurrencyCode, number>>;
  forexRevenueDelta: number;
  reserveBalanceDelta: number;
  homeCurrencyDelta: number;
  reservesSpentHome: number;
}

function finitePositiveRate(rates: Partial<Record<CurrencyCode, number>>, currency: CurrencyCode) {
  const rate = rates[currency];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

function chooseCounterReserveCurrency(homeCurrency: CurrencyCode): CurrencyCode {
  return (
    FOREX_ACTIVE_CURRENCIES.find((currency) => currency !== homeCurrency && currency === "USD") ??
    FOREX_ACTIVE_CURRENCIES.find((currency) => currency !== homeCurrency) ??
    "USD"
  );
}

function buildInterventionFundingPlan(params: {
  direction: "buy" | "sell";
  homeCurrency: CurrencyCode;
  currentRate: number;
  rates: Partial<Record<CurrencyCode, number>>;
  bank: CentralBank;
  requestedInternal: number;
}): ReserveFundingPlan {
  const spreadBalances = params.bank.spreadFeeReserveBalances ?? {};
  const spreadFeeReserveDeltas: Partial<Record<CurrencyCode, number>> = {};
  const homeRate = params.currentRate;
  let remainingInternal = params.requestedInternal;
  let actualInternal = 0;
  let forexRevenueDelta = 0;
  let reserveBalanceDelta = 0;
  let homeCurrencyDelta = 0;

  const drawCurrency = (currency: CurrencyCode, maxInternal?: number) => {
    const rate = finitePositiveRate(params.rates, currency);
    const balance = spreadBalances[currency] ?? 0;
    if (!rate || balance <= 0 || remainingInternal <= 0) return 0;
    const availableInternal = balance / rate;
    const internalDraw = Math.min(availableInternal, remainingInternal, maxInternal ?? Infinity);
    if (internalDraw <= 0) return 0;
    const currencyDraw = internalDraw * rate;
    spreadFeeReserveDeltas[currency] = (spreadFeeReserveDeltas[currency] ?? 0) - currencyDraw;
    remainingInternal -= internalDraw;
    actualInternal += internalDraw;
    return internalDraw;
  };

  if (params.direction === "buy") {
    const foreignBalances = (Object.entries(spreadBalances) as Array<[CurrencyCode, number]>)
      .filter(([currency, balance]) => currency !== params.homeCurrency && balance > 0)
      .map(([currency, balance]) => {
        const rate = finitePositiveRate(params.rates, currency);
        return { currency, internalValue: rate ? balance / rate : 0 };
      })
      .filter((entry) => entry.internalValue > 0)
      .sort((a, b) => b.internalValue - a.internalValue);

    for (const entry of foreignBalances) {
      drawCurrency(entry.currency);
    }

    homeCurrencyDelta = actualInternal * homeRate;
    if (homeCurrencyDelta > 0) {
      spreadFeeReserveDeltas[params.homeCurrency] =
        (spreadFeeReserveDeltas[params.homeCurrency] ?? 0) + homeCurrencyDelta;
    }
  } else {
    drawCurrency(params.homeCurrency);
    if (remainingInternal > 0) {
      const forexRevenue = finiteOr(params.bank.forexRevenue, 0);
      const forexInternal = forexRevenue / homeRate;
      const drawInternal = Math.min(forexInternal, remainingInternal);
      if (drawInternal > 0) {
        forexRevenueDelta = -(drawInternal * homeRate);
        remainingInternal -= drawInternal;
        actualInternal += drawInternal;
      }
    }
    if (remainingInternal > 0) {
      const reserveBalance = finiteOr(params.bank.reserveBalance, 0);
      const reserveInternal = reserveBalance / homeRate;
      const drawInternal = Math.min(reserveInternal, remainingInternal);
      if (drawInternal > 0) {
        reserveBalanceDelta = -(drawInternal * homeRate);
        remainingInternal -= drawInternal;
        actualInternal += drawInternal;
      }
    }

    const counterCurrency = chooseCounterReserveCurrency(params.homeCurrency);
    const counterRate = finitePositiveRate(params.rates, counterCurrency);
    if (counterRate && actualInternal > 0) {
      spreadFeeReserveDeltas[counterCurrency] =
        (spreadFeeReserveDeltas[counterCurrency] ?? 0) + actualInternal * counterRate;
    }
  }

  return {
    availableInternal: actualInternal,
    spreadFeeReserveDeltas,
    forexRevenueDelta,
    reserveBalanceDelta,
    homeCurrencyDelta,
    reservesSpentHome: actualInternal * homeRate,
  };
}

/**
 * Compute intervention spend for a single currency this turn. Pure-ish: reads
 * bank reserves off the pre-loaded bank document, returns deltas + audit data
 * for the caller to persist. No DB writes.
 */
async function applyIntervention(args: {
  rate: number;
  macroTarget: number;
  baseRate: number;
  countryId: string;
  currencyCode: CurrencyCode;
  policy: InterventionPolicy | null;
  bank: CentralBank;
  rates: Partial<Record<CurrencyCode, number>>;
  macro: MacroInputs;
  organicVolumes: { buyVolume24: number; sellVolume24: number };
  currentTurn: number;
  now: Date;
  /** Reduced jitter for the leading reserve currency (1 = no buff). */
  volatilityMultiplier?: number;
  /** Active 12-hour cycle pressure, folded into the blended re-computation. */
  cyclePressure?: number;
  /** CURRENT in-game year — era monetary baselines for the blended re-computation. */
  currentYear?: number | null;
}): Promise<InterventionOutcome | null> {
  const { policy } = args;
  if (!policy) return null;
  if (isInBand(args.rate, policy)) return null;

  const desiredIntervention = computeInterventionPressure(
    args.rate,
    policy,
    Number.MAX_SAFE_INTEGER
  );
  const fundingPlan = buildInterventionFundingPlan({
    direction: desiredIntervention.direction === "sell" ? "sell" : "buy",
    homeCurrency: args.currencyCode,
    currentRate: args.rate,
    rates: args.rates,
    bank: args.bank,
    requestedInternal: desiredIntervention.reserveCost,
  });

  const intervention = computeInterventionPressure(
    args.rate,
    policy,
    fundingPlan.availableInternal
  );

  if (intervention.reserveCost <= 0) {
    // No reserves to spend — still assess failure infamy since the rate is out
    // of band and the CB can't defend it.
    const alreadyCharged = typeof policy.lastInfamyChargedAtTurn === "number";
    const hasSeatedChair = !!args.bank.chairCharacterId;
    return {
      rate: args.rate,
      macroTarget: args.macroTarget,
      record: null,
      forexRevenueDelta: 0,
      reserveBalanceDelta: 0,
      spreadFeeReserveDeltas: {},
      infamyCharged: !alreadyCharged && hasSeatedChair,
    };
  }
  const spreadReserveDrawn = Object.values(fundingPlan.spreadFeeReserveDeltas).some(
    (delta) => (delta ?? 0) < 0
  );
  const forexDrawn = fundingPlan.forexRevenueDelta < 0;
  const reserveDrawn = fundingPlan.reserveBalanceDelta < 0;
  const fundingKinds = [spreadReserveDrawn, forexDrawn, reserveDrawn].filter(Boolean).length;
  const fundingSource: InterventionRecord["fundingSource"] =
    fundingKinds > 1
      ? "mixed"
      : spreadReserveDrawn
        ? "spreadFeeReserves"
        : reserveDrawn
          ? "reserveBalance"
          : "forexRevenue";

  // B4 market effect: a discredited bank's intervention holds the target less
  // well. The reserve outlay is UNCHANGED; what shrinks is what the outlay
  // buys, which is the right shape for a market that doubts the bank will hold
  // the line. Floored, so even a maximally discredited bank still moves the
  // rate.
  const adherence = interventionAdherenceMultiplier(args.bank.chairInfamy ?? 0);
  const effectiveSynthetic = intervention.syntheticVolume * adherence;

  // Re-run the rate pipeline with synthetic volume folded into the shared
  // volume-pressure term. This is what makes intervention affect the SAME
  // turn's published rate; the shared VOLUME_PRESSURE_CAP constrains it.
  const runBlend = (syntheticVolume: number) => {
    const syntheticBuy = syntheticVolume > 0 ? syntheticVolume : 0;
    const syntheticSell = syntheticVolume < 0 ? -syntheticVolume : 0;
    return computeRateUpdate(
      args.rate,
      args.baseRate,
      args.countryId as Parameters<typeof computeRateUpdate>[2],
      args.macro,
      {
        buyVolume24: args.organicVolumes.buyVolume24 + syntheticBuy,
        sellVolume24: args.organicVolumes.sellVolume24 + syntheticSell,
      },
      undefined,
      args.volatilityMultiplier ?? 1,
      args.cyclePressure ?? 0,
      args.currentYear
    );
  };
  const blended = runBlend(effectiveSynthetic);
  const nextRate = Number.isFinite(blended.rate) ? blended.rate : args.rate;
  const nextMacroTarget = Number.isFinite(blended.macroTarget)
    ? blended.macroTarget
    : args.macroTarget;

  const record: InterventionRecord = {
    turn: args.currentTurn,
    direction: intervention.direction === "buy" ? "buy" : "sell",
    reservesSpent: fundingPlan.reservesSpentHome,
    fundingSource,
    resultingRate: nextRate,
  };

  // Failure when reserves were fully drained AND the rate is still outside band
  // after the blended re-computation.
  //
  // Judged at FULL adherence on purpose. Charging infamy for a breach that the
  // credibility dampener itself caused would close a scrutiny-feeds-scrutiny
  // loop, which is the same spiral B4 separated the market effects to avoid.
  // The dampened rate is what the world sees; the undampened rate is what the
  // chair is blamed for.
  const rateForBlame =
    adherence >= 1 ? nextRate : (runBlend(intervention.syntheticVolume).rate ?? nextRate);
  const stillBreached = !isInBand(Number.isFinite(rateForBlame) ? rateForBlame : nextRate, policy);
  const reservesDrained =
    desiredIntervention.reserveCost > 0 &&
    fundingPlan.availableInternal < desiredIntervention.reserveCost - 1e-9;
  const alreadyCharged = typeof policy.lastInfamyChargedAtTurn === "number";
  const hasSeatedChair = !!args.bank.chairCharacterId;
  const infamyCharged = stillBreached && reservesDrained && !alreadyCharged && hasSeatedChair;

  return {
    rate: nextRate,
    macroTarget: nextMacroTarget,
    record,
    forexRevenueDelta: fundingPlan.forexRevenueDelta,
    reserveBalanceDelta: fundingPlan.reserveBalanceDelta,
    spreadFeeReserveDeltas: fundingPlan.spreadFeeReserveDeltas,
    infamyCharged,
  };
}

/**
 * Apply the reserve deltas, infamy tick, audit trade row, and chair
 * notification after the exchange rate has been persisted.
 */
async function persistInterventionSideEffects(
  db: Db,
  countryId: string,
  bank: CentralBank,
  outcome: InterventionOutcome
): Promise<void> {
  const inc: Record<string, number> = {};
  if (outcome.forexRevenueDelta !== 0) inc.forexRevenue = outcome.forexRevenueDelta;
  if (outcome.reserveBalanceDelta !== 0) inc.reserveBalance = outcome.reserveBalanceDelta;
  for (const [currency, delta] of Object.entries(outcome.spreadFeeReserveDeltas) as Array<
    [CurrencyCode, number]
  >) {
    if (delta !== 0) inc[`spreadFeeReserveBalances.${currency}`] = delta;
  }
  const set: Partial<Pick<CentralBank, "chairInfamy">> = {};
  if (outcome.infamyCharged) {
    set.chairInfamy = Math.min(100, finiteOr(bank.chairInfamy, 0) + INTERVENTION_FAILURE_INFAMY);
  }

  if (Object.keys(inc).length > 0 || Object.keys(set).length > 0) {
    // Use getBankId so shared-bank countries (e.g. eurozone members) update the
    // correct central bank document rather than a per-country phantom document.
    const bankId = getBankId(countryId as Parameters<typeof getBankId>[0]);
    await db.collection<CentralBank>("centralBanks").updateOne(
      { _id: bankId },
      {
        ...(Object.keys(inc).length > 0 ? { $inc: inc } : {}),
        ...(Object.keys(set).length > 0 ? { $set: set } : {}),
      },
      { upsert: true }
    );
  }

  if (outcome.infamyCharged && bank.chairCharacterId) {
    const chair = await db
      .collection<Character>("characters")
      .findOne(
        { _id: bank.chairCharacterId },
        { projection: { _id: 1, userId: 1, name: 1, sequentialId: 1 } }
      );
    if (chair) {
      await sendSystemMail(db, {
        toCharacterId: chair._id,
        toCharacterName: chair.name,
        toCharacterSequentialId: chair.sequentialId ?? 0,
        toUserId: chair.userId,
        subject: "FX Intervention Failure",
        body: "The FX band could not be defended this turn — reserves are depleted. Your infamy has risen. The band remains posted; restore reserves or widen the band to recover.",
      });
    }
  }
}

/**
 * Build the next interventionPolicy value for the exchangeRates writeback.
 * Returns `undefined` when no change is needed; returns `null` only if the
 * existing policy is already null. Appends a new audit record when one was
 * produced this turn, and manages the lastInfamyChargedAtTurn dedup flag.
 */
function computeNextPolicy(args: {
  existing: InterventionPolicy | null;
  newRecord: InterventionRecord | null;
  rateAfter: number;
  currentTurn: number;
  infamyCharged: boolean;
}): InterventionPolicy | null | undefined {
  const { existing } = args;
  if (!existing) return undefined;

  const recentInterventions = args.newRecord
    ? [...existing.recentInterventions, args.newRecord].slice(-INTERVENTION_HISTORY_MAX)
    : existing.recentInterventions;

  // Manage lastInfamyChargedAtTurn: set to currentTurn when a failure just fired;
  // clear when rate is back inside the band so the next breach cycle starts fresh.
  let lastInfamyChargedAtTurn = existing.lastInfamyChargedAtTurn;
  if (args.infamyCharged) {
    lastInfamyChargedAtTurn = args.currentTurn;
  } else if (isInBand(args.rateAfter, existing)) {
    lastInfamyChargedAtTurn = undefined;
  }

  const next: InterventionPolicy = {
    ...existing,
    recentInterventions,
    ...(lastInfamyChargedAtTurn !== undefined ? { lastInfamyChargedAtTurn } : {}),
  };
  // If the field was cleared, strip it explicitly so the $set write drops it.
  if (lastInfamyChargedAtTurn === undefined) {
    delete next.lastInfamyChargedAtTurn;
  }

  return next;
}

// ── Limit order processing ──────────────────────────────────────────────────

interface FilledOrderNotification {
  characterId: ObjectId;
  characterName: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  spentAmount: number;
  receivedAmount: number;
  filledRate: number;
}

interface LimitOrderResult {
  ordersFilled: number;
  totalSpreadRevenue: number;
  notifications: FilledOrderNotification[];
}

/**
 * Scan open limit orders and fill any whose limit price is met by the
 * current exchange rate. Executes against the market maker at the
 * prevailing rate. Priority: FIFO (oldest order first).
 *
 * Spread revenue is split: 50% destroyed, 50% to central bank.
 *
 * Crash-safety: each order is atomically claimed (open/partial → processing)
 * before any credits are applied. If the process dies after claiming but
 * before completing, the order is left in "processing" (not "open"), so it
 * will not be replayed on the next turn. Orders stuck in "processing" for
 * more than 2 turns are recovered at the start of this function.
 */
async function processTriggeredLimitOrders(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<LimitOrderResult> {
  // ── Stuck-order recovery ──────────────────────────────────────────────────
  // Orders left in "processing" from a prior crash are safe to re-attempt:
  // they were claimed but never completed. Reset them to "open" so they are
  // picked up in this turn's scan below. 2-turn window = 2 real-time hours.
  await db.collection<CurrencyOrder>("currencyOrders").updateMany(
    {
      status: "processing",
      updatedAt: { $lt: new Date(now.getTime() - 2 * MS_PER_TURN) },
    },
    { $set: { status: "open" as const, updatedAt: now } }
  );

  // Load current rates into a map for quick lookup
  const rates = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
  const rateMap = new Map(rates.map((r) => [r.currencyCode, r.rate]));

  // Find open/partial limit orders, sorted by creation date (FIFO)
  const openOrders = await db
    .collection<CurrencyOrder>("currencyOrders")
    .find({
      type: "limit",
      status: { $in: ["open", "partial"] },
    })
    .sort({ createdAt: 1 })
    .toArray();

  let ordersFilled = 0;
  let totalSpreadRevenue = 0;
  const notifications: FilledOrderNotification[] = [];

  for (const order of openOrders) {
    if (order.limitRate === undefined) continue;

    const fromRate = rateMap.get(order.fromCurrency) ?? 1;
    const toRate = rateMap.get(order.toCurrency) ?? 1;

    // Cross rate: how many toCurrency units per 1 fromCurrency unit
    // Both rates are "local currency per 1 internal unit"
    // crossRate = toRate / fromRate
    const crossRate = toRate / fromRate;

    // If the rate document was malformed this turn (e.g. a NaN cascade like
    // the turn-269 incident upstream), skip the order rather than filling
    // it at Infinity/NaN and poisoning the destination balance via $inc.
    // The order re-evaluates next turn once rates recover.
    if (!Number.isFinite(crossRate) || crossRate <= 0) continue;

    // Buy: fill when cross rate >= limit (player gets at least as much toCurrency as expected)
    // Sell: fill when cross rate <= limit (player gets at least as much fromCurrency as expected)
    const isBuy = order.direction !== "sell";
    const isFillable = isBuy ? crossRate >= order.limitRate : crossRate <= order.limitRate;

    if (!isFillable) continue;

    const remainingAmount = order.amount - order.filledAmount;
    if (remainingAmount <= 0) continue;

    // ── Atomic claim: open/partial → processing ───────────────────────────
    // This is the idempotency guard. If the process crashes after this point
    // the order stays in "processing", not "open", and will not be replayed.
    const claimResult = await db
      .collection<CurrencyOrder>("currencyOrders")
      .updateOne(
        { _id: order._id, status: { $in: ["open", "partial"] } },
        { $set: { status: "processing" as const, updatedAt: now } }
      );
    if (claimResult.modifiedCount === 0) {
      // Another process already claimed it (or it was cancelled/expired concurrently).
      continue;
    }

    // Calculate spread on the remaining fill
    const spreadAmount = remainingAmount * LIMIT_ORDER_SPREAD;
    const netAmount = remainingAmount - spreadAmount;
    const centralBankShare = spreadAmount * SPREAD_FEE_CENTRAL_BANK_RATIO;

    // Convert net fromCurrency to toCurrency at current cross rate
    const toAmount = netAmount * crossRate;

    totalSpreadRevenue += centralBankShare;

    // Split the central bank share per the SPREAD_FEE_*_RATIO constants.
    // forexRevenue (home revenue) stays with the fromCurrency country's CB. The
    // reserve slice stays denominated in the collected fromCurrency but accrues
    // to the *destination* (toCurrency) country's CB as a foreign reserve in the
    // outflow currency — mirroring distributeSpreadFee's cross-currency routing.
    // Use getBankId so shared-bank countries route to the correct bank document.
    const fromCountryEntry = rates.find((r) => r.currencyCode === order.fromCurrency);
    if (fromCountryEntry) {
      const toReserveBalance = Math.floor(spreadAmount * SPREAD_FEE_RESERVE_RATIO);
      const toForexRevenue = centralBankShare - toReserveBalance;
      const fromBankId = getBankId(fromCountryEntry.countryId as Parameters<typeof getBankId>[0]);
      const toCountryEntry = rates.find((r) => r.currencyCode === order.toCurrency);
      const reserveBankId = toCountryEntry
        ? getBankId(toCountryEntry.countryId as Parameters<typeof getBankId>[0])
        : fromBankId;
      const banks = db.collection<CentralBank>("centralBanks");
      if (reserveBankId === fromBankId) {
        await banks.updateOne(
          { _id: fromBankId },
          {
            $inc: {
              forexRevenue: toForexRevenue,
              [`spreadFeeReserveBalances.${order.fromCurrency}`]: toReserveBalance,
            } as Record<string, number>,
          },
          { upsert: true }
        );
      } else {
        await Promise.all([
          banks.updateOne(
            { _id: fromBankId },
            { $inc: { forexRevenue: toForexRevenue } as Record<string, number> },
            { upsert: true }
          ),
          toReserveBalance > 0
            ? banks.updateOne(
                { _id: reserveBankId },
                {
                  $inc: {
                    [`spreadFeeReserveBalances.${order.fromCurrency}`]: toReserveBalance,
                  } as Record<string, number>,
                },
                { upsert: true }
              )
            : Promise.resolve(),
        ]);
      }
    }

    // Credit the purchased toCurrency to the character's personal balance.
    // The fromCurrency was escrowed at order creation time — no deduction needed here.
    const creditInc = buildPersonalBalanceInc(toAmount, order.toCurrency, true);
    const creditResult = await db
      .collection("characters")
      .updateOne({ _id: order.characterId }, { $inc: creditInc });

    // Character was deleted between order creation and fill — cancel the order
    // so it doesn't retry every turn. Escrowed funds are unrecoverable.
    // Record the trade for audit trail since spread was already collected.
    if (creditResult.modifiedCount === 0) {
      await db.collection<TradeHistoryEntry>("tradeHistory").insertOne({
        buyerCharacterId: order.characterId,
        sellerCharacterId: null,
        fromCurrency: order.fromCurrency,
        toCurrency: order.toCurrency,
        amount: netAmount,
        rate: crossRate,
        spread: spreadAmount,
        turn: currentTurn,
        createdAt: now,
        source: "limit_order",
      } as TradeHistoryEntry);

      await db
        .collection<CurrencyOrder>("currencyOrders")
        .updateOne({ _id: order._id }, { $set: { status: "expired" as const, updatedAt: now } });
      continue;
    }

    // forexEnabled is always true here — this phase only runs inside the gameState.forexEnabled gate
    // Record trade history entry
    await db.collection<TradeHistoryEntry>("tradeHistory").insertOne({
      buyerCharacterId: order.characterId,
      sellerCharacterId: null, // market maker
      fromCurrency: order.fromCurrency,
      toCurrency: order.toCurrency,
      amount: netAmount,
      rate: crossRate,
      spread: spreadAmount,
      turn: currentTurn,
      createdAt: now,
      source: "limit_order",
    } as TradeHistoryEntry);

    // Update order to its terminal status (filled or partial)
    const newFilledAmount = order.filledAmount + remainingAmount;
    const newStatus = newFilledAmount >= order.amount ? "filled" : "partial";

    await db.collection<CurrencyOrder>("currencyOrders").updateOne(
      { _id: order._id },
      {
        $set: {
          status: newStatus,
          filledAmount: newFilledAmount,
          filledRate: crossRate,
          updatedAt: now,
        },
        $inc: { spreadCharged: spreadAmount },
      }
    );

    notifications.push({
      characterId: order.characterId,
      characterName: order.characterName,
      fromCurrency: order.fromCurrency,
      toCurrency: order.toCurrency,
      spentAmount: remainingAmount,
      receivedAmount: toAmount,
      filledRate: crossRate,
    });
    ordersFilled++;
  }

  return { ordersFilled, totalSpreadRevenue, notifications };
}

/**
 * Expire open limit/direct orders that have passed their expiresAtTurn.
 * Refunds remaining escrowed fromCurrency back to each character.
 *
 * Crash-safety: status is transitioned (open/partial → expired) atomically
 * BEFORE any refund is issued. The filter on open/partial makes this
 * idempotent — already-expired orders are untouched. If the process crashes
 * after the updateMany but before all refunds complete, the next turn's query
 * (which filters on "open"/"partial") will NOT pick up these orders again,
 * eliminating the double-refund risk.
 */
async function expireStaleOrders(db: Db, currentTurn: number, now: Date): Promise<number> {
  // Step 1: Atomically transition all eligible orders from open/partial → expired.
  // The status filter makes this idempotent — already-expired orders are untouched.
  const transitionResult = await db.collection<CurrencyOrder>("currencyOrders").updateMany(
    {
      status: { $in: ["open", "partial"] },
      expiresAtTurn: { $lte: currentTurn },
    },
    { $set: { status: "expired" as const, updatedAt: now } }
  );

  if (transitionResult.modifiedCount === 0) return 0;

  // Step 2: Fetch the orders that were JUST transitioned (same `updatedAt` timestamp).
  // Re-querying by status + updatedAt is safe because `now` is a fixed value for this turn
  // and the transition above wrote it atomically.
  const justExpired = await db
    .collection<CurrencyOrder>("currencyOrders")
    .find({
      status: "expired",
      updatedAt: now,
    })
    .toArray();

  // Step 3: Issue refunds only for the just-transitioned orders.
  const refundOps: AnyBulkWriteOperation<Character>[] = [];
  for (const order of justExpired) {
    const refundAmount = order.amount - order.filledAmount;
    if (refundAmount > 0) {
      const refundInc = buildPersonalBalanceInc(refundAmount, order.fromCurrency, true);
      refundOps.push({
        updateOne: {
          filter: { _id: order.characterId },
          update: { $inc: refundInc },
        },
      });
    }
  }
  if (refundOps.length > 0) {
    await db.collection<Character>("characters").bulkWrite(refundOps);
  }

  return transitionResult.modifiedCount;
}

/**
 * Send in-game mail to each character whose limit order filled this turn.
 * Batches the character lookup — one query for all unique characterIds.
 */
async function sendFillNotifications(
  db: Db,
  notifications: FilledOrderNotification[]
): Promise<void> {
  if (notifications.length === 0) return;

  const uniqueOids = notifications
    .filter(
      (n, i, arr) =>
        arr.findIndex((x) => x.characterId.toString() === n.characterId.toString()) === i
    )
    .map((n) => n.characterId);

  const chars = await db
    .collection<Character>("characters")
    .find(
      { _id: { $in: uniqueOids } },
      { projection: { _id: 1, userId: 1, name: 1, sequentialId: 1 } }
    )
    .toArray();

  const charMap = new Map(chars.map((c) => [c._id.toString(), c]));

  for (const note of notifications) {
    const char = charMap.get(note.characterId.toString());
    if (!char) continue;

    const fromSym = CURRENCY_SYMBOLS[note.fromCurrency] ?? note.fromCurrency;
    const toSym = CURRENCY_SYMBOLS[note.toCurrency] ?? note.toCurrency;
    const rate = note.filledRate.toFixed(4);
    const spent = note.spentAmount.toLocaleString("en-US", { maximumFractionDigits: 2 });
    const received = note.receivedAmount.toLocaleString("en-US", { maximumFractionDigits: 2 });

    await sendSystemMail(db, {
      toCharacterId: char._id,
      toCharacterName: char.name,
      toCharacterSequentialId: char.sequentialId ?? 0,
      toUserId: char.userId,
      subject: "Limit Order Filled",
      body: `Your limit order to exchange ${fromSym}${spent} ${note.fromCurrency} → ${note.toCurrency} has filled at a rate of ${rate}. You received ${toSym}${received} ${note.toCurrency}.`,
    });
  }
}
