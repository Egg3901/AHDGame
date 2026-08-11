/**
 * Per-Turn Inflation Recalculation
 *
 * Recalculates inflation each turn so the economic trends chart reflects
 * real-time changes in monetary policy, unemployment, GDP growth, fiscal
 * stance, tariffs, and wage growth — rather than showing a flat line
 * between annual fiscal-year recalculations.
 *
 * Runs after nationalMetrics (so GDP growth / unemployment are current)
 * and before the interest-rate snapshot captures the value for history.
 */

import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { CommodityPriceHistory } from "@/lib/db/types/commodityPriceHistory";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { GameState } from "@/lib/db/types/gameState";
import { calculateCountryInflation } from "@/lib/budget/inflation";
import { savingsFlowPressureRatio } from "@/lib/budget/savingsFlowPressure";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import type { MoneySupplySnapshot } from "@/lib/db/types/moneySupply";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Dynamic wage growth target driven by labor-market signals.
 *
 * Baseline: 2.5% wage growth.
 * Tight labor market (unemployment below NAIRU=5%) pushes wages up.
 * Slack labor market (unemployment above NAIRU) pulls wages down.
 * Strong GDP growth contributes a smaller pro-cyclical bump.
 *
 * Without this, `budget.economicFactors.wageGrowth` stays frozen at its
 * seeded value forever, producing a permanent inflation cost-push floor
 * (bug #0575: JP/US runaway inflation).
 */
const WAGE_BASELINE = 2.5;
const WAGE_NAIRU = 5.0;
const WAGE_COEFF_LABOR_TIGHT = 0.4; // pp wage growth per pp unemployment below NAIRU
const WAGE_COEFF_LABOR_SLACK = 0.2; // pp wage growth per pp unemployment above NAIRU
const WAGE_COEFF_GDP = 0.15; // pp wage growth per pp GDP growth above 2% trend
const WAGE_INERTIA = 0.6; // smooth toward target so wages don't whipsaw

function computeWageGrowthTarget(unemployment: number, gdpGrowth: number): number {
  const uGap = WAGE_NAIRU - unemployment; // positive = tight labor
  const laborTerm = uGap >= 0 ? uGap * WAGE_COEFF_LABOR_TIGHT : uGap * WAGE_COEFF_LABOR_SLACK;
  const gdpTerm = Math.max(0, gdpGrowth - 2.0) * WAGE_COEFF_GDP;
  // Realistic wage-growth range: -2% (deep recession) to +8% (overheating)
  return Math.max(-2.0, Math.min(8.0, WAGE_BASELINE + laborTerm + gdpTerm));
}

interface CommodityPressureSnapshot {
  commodity: string;
  basePrice: number;
  nationalPrices?: Record<string, number>;
}

function pickPreferredCommodityDoc(
  current: CommodityPrice | undefined,
  candidate: CommodityPrice
): CommodityPrice {
  if (!current) return candidate;
  const currentTurn = typeof current.turn === "number" ? current.turn : -1;
  const candidateTurn = typeof candidate.turn === "number" ? candidate.turn : -1;
  if (candidateTurn !== currentTurn) {
    return candidateTurn > currentTurn ? candidate : current;
  }
  const currentUpdated = current.updatedAt instanceof Date ? current.updatedAt.getTime() : 0;
  const candidateUpdated = candidate.updatedAt instanceof Date ? candidate.updatedAt.getTime() : 0;
  return candidateUpdated > currentUpdated ? candidate : current;
}

function buildCommodityPressureSnapshots(
  commodityPriceDocs: CommodityPrice[],
  commodityPriceHistoryDocs: CommodityPriceHistory[]
): CommodityPressureSnapshot[] {
  const currentByCommodity = new Map<string, CommodityPrice>();
  for (const doc of commodityPriceDocs) {
    currentByCommodity.set(
      doc.commodity,
      pickPreferredCommodityDoc(currentByCommodity.get(doc.commodity), doc)
    );
  }

  const historyByCommodity = new Map(
    commodityPriceHistoryDocs.map((doc) => [doc.commodity, doc] as const)
  );

  return [...currentByCommodity.values()].map((doc) => ({
    commodity: doc.commodity,
    basePrice: doc.basePrice,
    nationalPrices: historyByCommodity.get(doc.commodity)?.nationalPrices ?? doc.nationalPrices,
  }));
}

/**
 * Recalculate inflation for every country that has a central bank and
 * a federal budget, then persist the updated rate to the budget document.
 *
 * Returns the number of countries updated.
 */
export async function recalculateInflationPerTurn(db: Db, turn: number): Promise<number> {
  const banks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  if (banks.length === 0) return 0;

  const gameStateDoc = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const preset = gameStateDoc?.preset ?? DEFAULT_SEED_PRESET;

  // Pre-fetch commodity prices, exchange rates, and 12-turn savings flows once.
  // Commodity national prices (written this turn by commodityPriceTurn) give cost-push.
  // Exchange rates used are previous turn's settled values (inflationRecalc runs before forexTurn).
  const [
    commodityPriceDocs,
    commodityPriceHistoryDocs,
    exchangeRateDocs,
    moneyRows,
    savingsFlowAgg,
  ] = await Promise.all([
    db
      .collection<CommodityPrice>("commodityPrices")
      .find(
        {},
        { projection: { commodity: 1, basePrice: 1, nationalPrices: 1, turn: 1, updatedAt: 1 } }
      )
      .toArray(),
    db
      .collection<CommodityPriceHistory>("commodityPriceHistory")
      .find({ turn }, { projection: { commodity: 1, nationalPrices: 1 } })
      .toArray(),
    db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
    db
      .collection<MoneySupplySnapshot>("moneySupplySnapshots")
      .find({ turn: { $lt: turn } })
      .sort({ turn: -1 })
      .toArray(),
    // 12-turn rolling savings flows. countryId on ledger entries reflects currency jurisdiction,
    // matching nationalSavingsBalance on centralBanks (both keyed by currency, not character nationality).
    db
      .collection("savingsLedger")
      .aggregate<{ _id: { countryId: string; type: string }; total: number }>([
        {
          $match: {
            type: { $in: ["deposit", "withdraw"] },
            turn: { $gte: turn - 12 },
          },
        },
        {
          $group: {
            _id: { countryId: "$countryId", type: "$type" },
            total: { $sum: "$amount" },
          },
        },
      ])
      .toArray(),
  ]);
  // `annualizedM2GrowthPct` is null until the lookback window reaches a
  // game-quarter (see MIN_MONEY_GROWTH_BASE_TURNS) — annualizing a stock jump
  // over one or two turns raises the ratio to the 24th power. The consumer
  // below reads this through `finiteOr(..., gdpGrowth)`, which already treats a
  // non-number as "no signal" and falls back, so a null degrades to a zero
  // monetary impulse rather than asserting the money supply is frozen.
  const moneyGrowthByCurrency = new Map<string, number | null>();
  for (const row of moneyRows) {
    if (!moneyGrowthByCurrency.has(row.currencyCode))
      moneyGrowthByCurrency.set(row.currencyCode, row.annualizedM2GrowthPct);
  }
  const commodityPressureSnapshots = buildCommodityPressureSnapshots(
    commodityPriceDocs,
    commodityPriceHistoryDocs
  );
  const exchangeRateByCountry = new Map(exchangeRateDocs.map((r) => [r.countryId, r]));

  // Build per-country savings flow map: { deposits, withdrawals } in local currency
  const savingsFlowByCountry = new Map<string, { deposits: number; withdrawals: number }>();
  for (const row of savingsFlowAgg) {
    const { countryId, type } = row._id;
    if (!savingsFlowByCountry.has(countryId)) {
      savingsFlowByCountry.set(countryId, { deposits: 0, withdrawals: 0 });
    }
    const entry = savingsFlowByCountry.get(countryId)!;
    if (type === "deposit") entry.deposits += row.total;
    else if (type === "withdraw") entry.withdrawals += row.total;
  }

  let updated = 0;
  // `?? fallback` / `!= null` checks do NOT reject NaN (typeof NaN === "number");
  // any NaN in a persisted price or rate would poison inflation and recurse every
  // turn. Guard all derived pressure signals with a finite-only filter.
  const finiteOr = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

  // Per-commodity pressure clamp. Normal markets produce ratios in roughly
  // [-0.5, 3] (base±50% on the low side, 4× base on the high side). Corrupt
  // data has been observed to produce ratios in the hundreds or thousands
  // (e.g. one `nationalPrice` from a different commodity divided by this
  // row's `basePrice`). Clamping each row's contribution to [-0.9, 10]
  // prevents a single bad row from detonating the average without
  // meaningfully constraining legitimate signals — a real +10 ratio already
  // saturates the downstream `COMMODITY_PRESSURE_COEFF_UP=3.0` into a +30pp
  // contribution, and `MAX_INFLATION=15.0` caps the final output anyway.
  const COMMODITY_PRESSURE_ROW_FLOOR = -0.9;
  const COMMODITY_PRESSURE_ROW_CEILING = 10.0;

  // Countries covered by a central bank, collected as we go so the unbanked
  // pass below knows who it still has to recompute.
  const bankedCountries = new Set<string>();
  for (const bank of banks) {
    const bankCountryId = bank.countryId as CountryId;
    if (!COUNTRY_CONFIGS[bankCountryId]) continue;

    // A shared bank (e.g. the ECB — one doc for all eurozone members, with
    // `countryId` set to the anchor member) must recalculate EVERY member
    // country's inflation, not just the one recorded on the doc. Otherwise the
    // other members' inflation and wage growth freeze forever and crisis $inc
    // shocks never decay (IE froze at 15.34% while DE tracked normally).
    const { memberCountries } = await getCentralBankScope(db, bankCountryId);

    // Savings flow pressure is a property of the bank's currency jurisdiction:
    // ledger entries carry the currency's anchor countryId (= bank.countryId for
    // every real bank) and the balance lives on the bank doc, so all members of
    // a shared bank see the same pressure.
    const flow = savingsFlowByCountry.get(bankCountryId);
    const totalBalance = bank.nationalSavingsBalance ?? 0;
    const deposits = flow?.deposits ?? 0;
    const withdrawals = flow?.withdrawals ?? 0;
    const savingsPressureRaw = savingsFlowPressureRatio(
      withdrawals - deposits,
      deposits + withdrawals,
      totalBalance
    );
    const savingsPressure = finiteOr(savingsPressureRaw, 0);

    let membersUpdated = 0;

    for (const member of memberCountries) bankedCountries.add(String(member));
    for (const countryId of memberCountries) {
      const config = COUNTRY_CONFIGS[countryId];
      if (!config) continue;

      // Commodity cost-push: avg(P_national / P_base - 1) across all commodities that
      // have a national price for this country. 0.0 if none available yet (first turns).
      const pressures: number[] = [];
      for (const doc of commodityPressureSnapshots) {
        const nationalPrice = doc.nationalPrices?.[countryId];
        if (
          typeof nationalPrice === "number" &&
          Number.isFinite(nationalPrice) &&
          typeof doc.basePrice === "number" &&
          doc.basePrice > 0
        ) {
          const raw = nationalPrice / doc.basePrice - 1.0;
          const clamped = Math.max(
            COMMODITY_PRESSURE_ROW_FLOOR,
            Math.min(COMMODITY_PRESSURE_ROW_CEILING, raw)
          );
          if (clamped !== raw) {
            console.warn(
              `[inflationRecalc] ${countryId} ${doc.commodity}: pressure clamped ${raw.toFixed(2)} -> ${clamped.toFixed(2)} (nationalPrice=${nationalPrice}, basePrice=${doc.basePrice})`
            );
          }
          pressures.push(clamped);
        }
      }
      const commodityPressureRaw =
        pressures.length > 0 ? pressures.reduce((s, v) => s + v, 0) / pressures.length : 0.0;
      const commodityPressure = finiteOr(commodityPressureRaw, 0);

      // Forex depreciation cost-push: rate / baseRate - 1.
      // Positive = local currency weaker than calibration (imported goods more expensive).
      // Uses previous turn's settled rate; forexTurn runs after inflationRecalc.
      // Members without their own doc (eurozone: only the EUR anchor DE carries
      // one) inherit the currency anchor's rate so they feel the same FX signal.
      const currencyCode = COUNTRY_CURRENCY_MAP[countryId];
      const currencyAnchorId = currencyCode ? getCountryIdForCurrency(currencyCode) : countryId;
      const fxDoc =
        exchangeRateByCountry.get(countryId) ?? exchangeRateByCountry.get(currencyAnchorId);
      const fxRate = finiteOr(fxDoc?.rateHistory?.at(-1)?.rate, finiteOr(fxDoc?.rate, NaN));
      const fxBase = finiteOr(fxDoc?.baseRate, 0);
      const forexPressure = Number.isFinite(fxRate) && fxBase > 0 ? fxRate / fxBase - 1.0 : 0.0;

      const budget = await ensureFederalBudget(db, countryId, preset);
      if (!budget) continue;

      // Update wageGrowth dynamically before computing inflation, so the wage
      // cost-push reflects current labor-market conditions instead of a static
      // seed value. Without this, JP's seeded 5% wage growth (or any other
      // country's) produces a permanent +0.4pp inflation floor forever.
      const nationalDocId = getNationalDocId(countryId);
      const nationalMetrics = nationalDocId
        ? // SP5: national economic rollup lives on macroMetrics.
          await db.collection<StateMetrics>("macroMetrics").findOne({ _id: nationalDocId })
        : null;
      const unemployment = finiteOr(nationalMetrics?.economic?.unemploymentRate?.value, 5.0);
      const gdpGrowth = finiteOr(nationalMetrics?.economic?.gdpGrowth?.value, 2.0);
      const currentWageGrowth = finiteOr(budget.economicFactors?.wageGrowth, WAGE_BASELINE);
      const wageTarget = computeWageGrowthTarget(unemployment, gdpGrowth);
      const newWageGrowth =
        Math.round((WAGE_INERTIA * currentWageGrowth + (1 - WAGE_INERTIA) * wageTarget) * 100) /
        100;

      // Pass the updated wageGrowth into the inflation calculation by mutating
      // the budget snapshot — the persisted update happens below in the same
      // operation, so this preserves write-once semantics.
      const budgetForCalc: FederalBudget = {
        ...budget,
        economicFactors: { ...budget.economicFactors, wageGrowth: newWageGrowth },
      };

      const policyStancePressure = finiteOr(bank.policyInflationPressure, 0);
      const moneySupplyGrowthPct = finiteOr(moneyGrowthByCurrency.get(currencyCode), gdpGrowth);

      const newInflation = await calculateCountryInflation(
        db,
        countryId,
        budgetForCalc,
        commodityPressure,
        forexPressure,
        savingsPressure,
        policyStancePressure,
        moneySupplyGrowthPct
      );

      await db.collection<FederalBudget>("federalBudget").updateOne(
        { _id: budget._id },
        {
          $set: {
            "economicFactors.inflationRate": newInflation,
            "economicFactors.wageGrowth": newWageGrowth,
            "economicFactors.lastUpdated": new Date(),
          },
        }
      );

      membersUpdated++;
      updated++;
    }

    if (membersUpdated > 0) {
      // Persist current pressure so interestRateSnapshot can chart it without
      // re-aggregating. Stored as a percentage (×100) to match the chart's %
      // y-axis convention. Keyed by the bank doc's _id — the previous
      // `{ _id: countryId }` write was a silent no-op for shared banks whose
      // _id ("ECB") differs from their countryId.
      await db
        .collection<CentralBank>("centralBanks")
        .updateOne({ _id: bank._id }, { $set: { currentSavingsPressure: savingsPressure * 100 } });
    }
  }

  // Countries with NO central bank still need their inflation recomputed every
  // turn. This loop used to iterate central banks alone, which left the six
  // Eastern-bloc satellites (PL, HU, CS, RO, BG, YU) with no per-turn recalc at
  // all — and crisisTurn writes inflation with a raw `$inc`, on the documented
  // assumption that "the per-turn inflation recalc then blends it through
  // inertia, so a crisis shock decays over subsequent turns". For a quarter of
  // the world that assumption was false: the shocks only ever accumulated, with
  // nothing to pull them back, so administered command-economy CPI ratcheted
  // from 1.5-3% to 8-19% over 75 turns. fiscalYear's annual pass reset it once a
  // year, producing a sawtooth rather than a fix.
  //
  // These countries have no monetary policy to model, so they take the plain
  // recompute — which for a planned economy returns the administered target and
  // for anyone else runs the ordinary market model.
  const unbanked = await db
    .collection<FederalBudget>("federalBudget")
    .find({ countryId: { $nin: [...bankedCountries] } })
    .toArray();
  for (const budget of unbanked) {
    const countryId = budget.countryId as CountryId | undefined;
    if (!countryId || !COUNTRY_CONFIGS[countryId]) continue;
    const newInflation = await calculateCountryInflation(db, countryId, budget);
    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: budget._id },
      {
        $set: {
          "economicFactors.inflationRate": newInflation,
          "economicFactors.lastUpdated": new Date(),
        },
      }
    );
    updated++;
  }

  return updated;
}
