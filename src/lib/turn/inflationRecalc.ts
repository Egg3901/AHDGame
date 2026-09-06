/**
 * Inflation is recalculated every turn. recalculateInflationPerTurn reads each
 * country's prime rate, unemployment, GDP growth, deficit, tariffs, wage growth,
 * the commodity price trend over the last half game year, exchange rate moves and
 * money supply, then stores the new inflationRate and advances the household
 * price index.
 */
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
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { advanceHouseholdPriceIndex } from "@/lib/economy/householdPriceIndex";

/**
 * Lookback for the commodity cost-push signal: half a game year, annualized.
 *
 * Window choice is a lag-vs-noise trade and was picked off live prod data at
 * turn 221. A full game year still carried a price ramp that had already ended
 * (US would have read +20%/yr against an actual recent trend of roughly zero);
 * a 12-turn window has to be raised to the 4th power to annualize, which
 * amplifies ordinary market jitter. Half a year squares, and reproduced the
 * observed direction for every country.
 */
const COMMODITY_INFLATION_LOOKBACK_TURNS = TURNS_PER_YEAR / 2;
/** Shorter fallback for worlds younger than the main window. */
const COMMODITY_INFLATION_SHORT_LOOKBACK_TURNS = 12;

interface CommodityPressureSnapshot {
  commodity: string;
  nationalPrices?: Record<string, number>;
  /** The same commodity's national prices one lookback window ago. */
  priorNationalPrices?: Record<string, number>;
  /** Turns between the two snapshots, for annualizing the change. */
  lookbackTurns: number;
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
  commodityPriceHistoryDocs: CommodityPriceHistory[],
  priorHistoryDocs: CommodityPriceHistory[],
  lookbackTurns: number
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
  const priorByCommodity = new Map(priorHistoryDocs.map((doc) => [doc.commodity, doc] as const));

  return [...currentByCommodity.values()].map((doc) => ({
    commodity: doc.commodity,
    nationalPrices: historyByCommodity.get(doc.commodity)?.nationalPrices ?? doc.nationalPrices,
    priorNationalPrices: priorByCommodity.get(doc.commodity)?.nationalPrices,
    lookbackTurns,
  }));
}

/** Median of a non-empty numeric list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
  // The same national prices one game year back. The commodity cost-push signal
  // is the CHANGE between the two, not today's level — see the pressure block
  // below. Kept out of the Promise.all above on purpose: adding elements to that
  // tuple pushes tsc's inference over a cliff and the typecheck OOMs.
  const priorHistoryFor = (lookbackTurns: number): Promise<CommodityPriceHistory[]> =>
    db
      .collection<CommodityPriceHistory>("commodityPriceHistory")
      .find({ turn: turn - lookbackTurns }, { projection: { commodity: 1, nationalPrices: 1 } })
      .toArray();
  const [commodityPriorYearDocs, commodityPriorQuarterDocs] = await Promise.all([
    priorHistoryFor(COMMODITY_INFLATION_LOOKBACK_TURNS),
    priorHistoryFor(COMMODITY_INFLATION_SHORT_LOOKBACK_TURNS),
  ]);
  // Prefer the full game-year window; fall back to the quarter window (scaled up
  // to an annual rate) only while the world is too young to have the former.
  const usableLookback =
    commodityPriorYearDocs.length > 0
      ? { docs: commodityPriorYearDocs, turns: COMMODITY_INFLATION_LOOKBACK_TURNS }
      : { docs: commodityPriorQuarterDocs, turns: COMMODITY_INFLATION_SHORT_LOOKBACK_TURNS };
  const commodityPressureSnapshots = buildCommodityPressureSnapshots(
    commodityPriceDocs,
    commodityPriceHistoryDocs,
    usableLookback.docs,
    usableLookback.turns
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

  // Per-commodity clamp on the ANNUALIZED price change. A row moving more than
  // +200%/yr or less than -50%/yr is a market pathology (or corrupt data), not a
  // consumer-price signal. The median below is already robust to a handful of
  // outliers, so this only guards against garbage.
  const COMMODITY_PRESSURE_ROW_FLOOR = -0.5;
  const COMMODITY_PRESSURE_ROW_CEILING = 2.0;

  // Countries covered by a central bank, collected as we go so the unbanked
  // pass below knows who it still has to recompute.
  const bankedCountries = new Set<string>();
  // Banks are independent (disjoint member sets, per-country budget writes),
  // and so are the members within a bank — fan both levels out instead of the
  // old strictly serial walk.
  await Promise.all(
    banks.map(async (bank) => {
      const bankCountryId = bank.countryId as CountryId;
      if (!COUNTRY_CONFIGS[bankCountryId]) return;

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
      await Promise.all(
        memberCountries.map(async (countryId) => {
          const config = COUNTRY_CONFIGS[countryId];
          if (!config) return;

          // Commodity cost-push: the MEDIAN annualized CHANGE in this country's
          // national prices. 0.0 until a lookback window exists.
          //
          // This used to be `avg(P_national / P_base - 1)` — a price LEVEL
          // against a frozen seed `basePrice`, fed straight into an inflation
          // RATE. `basePrice` never moves, so once national prices had drifted a
          // few multiples above it the term became a large and permanently
          // growing constant that no policy could answer. On prod at turn 221 it
          // was injecting +4.1pp (US) to +8.4pp (FR) every turn while those same
          // countries' prices were FLAT over the preceding game year (US median
          // -7%/yr annualized). Central banks then held rates 3-5pp above their
          // era neutral fighting a number that was not inflation.
          //
          // Same dimensional error the cost-of-living/housing term was retired
          // for — see HOUSING_PRESSURE_COEFF in budget/inflation.ts: "a high
          // price level is not inflation". A rate of change is, and it decays to
          // zero when prices settle, so CPI can reach target again.
          //
          // Median, not mean: a few commodities in acute scarcity (prod FR: mean
          // +70%/yr vs median +36%/yr) would otherwise drag the whole basket and
          // rebuild a spurious permanent term.
          const pressures: number[] = [];
          for (const doc of commodityPressureSnapshots) {
            const nationalPrice = doc.nationalPrices?.[countryId];
            const priorPrice = doc.priorNationalPrices?.[countryId];
            if (
              typeof nationalPrice === "number" &&
              Number.isFinite(nationalPrice) &&
              nationalPrice > 0 &&
              typeof priorPrice === "number" &&
              Number.isFinite(priorPrice) &&
              priorPrice > 0 &&
              doc.lookbackTurns > 0
            ) {
              // Scale a partial-year window up to an annual rate.
              const annualized =
                Math.pow(nationalPrice / priorPrice, TURNS_PER_YEAR / doc.lookbackTurns) - 1.0;
              const clamped = Math.max(
                COMMODITY_PRESSURE_ROW_FLOOR,
                Math.min(COMMODITY_PRESSURE_ROW_CEILING, annualized)
              );
              if (Number.isFinite(clamped)) pressures.push(clamped);
            }
          }
          const commodityPressureRaw = pressures.length > 0 ? median(pressures) : 0.0;
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
          if (!budget) return;

          const nationalDocId = getNationalDocId(countryId);
          const nationalMetrics = nationalDocId
            ? await db.collection<StateMetrics>("macroMetrics").findOne({ _id: nationalDocId })
            : null;
          const gdpGrowth = finiteOr(nationalMetrics?.economic?.gdpGrowth?.value, 2.0);
          const policyStancePressure = finiteOr(bank.policyInflationPressure, 0);
          const moneySupplyGrowthPct = finiteOr(moneyGrowthByCurrency.get(currencyCode), gdpGrowth);

          const newInflation = await calculateCountryInflation(
            db,
            countryId,
            budget,
            commodityPressure,
            forexPressure,
            savingsPressure,
            policyStancePressure,
            moneySupplyGrowthPct
          );
          // Household prices trail the newly settled CPI, but never feed back
          // into its calculation. This gives inflation a visible purchasing-
          // power consequence without turning it into a nominal unit rescaler.
          const householdPriceIndex = advanceHouseholdPriceIndex(
            budget.economicFactors?.householdPriceIndex,
            newInflation
          );

          await db.collection<FederalBudget>("federalBudget").updateOne(
            { _id: budget._id },
            {
              $set: {
                "economicFactors.inflationRate": newInflation,
                "economicFactors.householdPriceIndex": householdPriceIndex,
                "economicFactors.lastUpdated": new Date(),
              },
            }
          );

          membersUpdated++;
          updated++;
        })
      );

      if (membersUpdated > 0) {
        // Persist current pressure so interestRateSnapshot can chart it without
        // re-aggregating. Stored as a percentage (×100) to match the chart's %
        // y-axis convention. Keyed by the bank doc's _id — the previous
        // `{ _id: countryId }` write was a silent no-op for shared banks whose
        // _id ("ECB") differs from their countryId.
        await db
          .collection<CentralBank>("centralBanks")
          .updateOne(
            { _id: bank._id },
            { $set: { currentSavingsPressure: savingsPressure * 100 } }
          );
      }
    })
  );

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
  await Promise.all(
    unbanked.map(async (budget) => {
      const countryId = budget.countryId as CountryId | undefined;
      if (!countryId || !COUNTRY_CONFIGS[countryId]) return;
      const newInflation = await calculateCountryInflation(db, countryId, budget);
      const householdPriceIndex = advanceHouseholdPriceIndex(
        budget.economicFactors?.householdPriceIndex,
        newInflation
      );
      await db.collection<FederalBudget>("federalBudget").updateOne(
        { _id: budget._id },
        {
          $set: {
            "economicFactors.inflationRate": newInflation,
            "economicFactors.householdPriceIndex": householdPriceIndex,
            "economicFactors.lastUpdated": new Date(),
          },
        }
      );
      updated++;
    })
  );

  return updated;
}
