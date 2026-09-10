/**
 * Re-runs the fundamental share-price formula AFTER processBondTurn has updated
 * bond marketPrices, settled matured bonds, and credited/debited corp
 * liquidCapital for coupon flows. Overwrites the placeholder share price
 * written by processCorporationTurn so the persisted price reflects
 * post-bond-turn state — eliminates the one-turn lag for bond cash flows.
 *
 * Called from the turn phase registry as a sequential phase between bondTurn
 * and the later end-of-turn wealth/portfolio snapshots. Splitting the bond
 * batch into bondTurn + recompute ensures every downstream snapshot consumer
 * sees the post-recompute price.
 */
import { ObjectId, type Db, type AnyBulkWriteOperation } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Corporation, CorporationHistory } from "@/lib/db/types";
import {
  STOCK_SPLIT_PRICE_SMOOTHING_TURNS,
  SECTOR_RISK_PREMIUM,
} from "@/lib/constants/corporations";
import { getCountryConfig } from "@/lib/constants/countries";
import { buildCorporationLookups } from "./buildLookups";
import { computeSharePrices, type SharePriceInput } from "./sharePriceFormula";
import { indexFundOwnershipFraction } from "@/lib/corporations/indexOwnership";
import { normalizedEarningsFromHistory } from "./earningsRollingAverage";
import { applyEquityMethodEarnings } from "./equityMethodEarnings";
import {
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getGameState } from "@/lib/gameState";
import { computeTechAssetValueAnchor } from "@/lib/corporations/techAssetValue";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { sumConstructionInProgressAnchor } from "@/lib/corporations/sectorProfitBasis";
import { ceoOwnershipFraction } from "@/lib/corporations/ceoOwnership";

export interface RecomputeSharePricesResult {
  corpsRepriced: number;
  corpsSkipped: number;
}

// Last-resort cost-of-capital input when a corp's countryId has no
// CountryConfig entry. Not a designed economic parameter — just prevents a
// bad countryId from crashing repricing for every corporation.
const FALLBACK_PRIME_RATE_PERCENT = 5;

/**
 * Bulk re-price every corporation using fresh post-bondTurn state.
 *
 * Skips a corporation when its same-turn `corporationHistory` snapshot is missing
 * (e.g., the corp turn errored for that corp, or the snapshot writer hasn't run).
 * In that case the placeholder price written by processCorporationTurn stays in
 * place — better to ship slightly-stale data than crash an entire turn.
 */
export async function recomputeSharePricesAfterBondTurn(
  turn: number,
  db?: Db
): Promise<RecomputeSharePricesResult> {
  const database = db ?? (await getDb());
  const [lookups, gameState, marketMode] = await Promise.all([
    buildCorporationLookups(database, { omitBuildQueue: true }),
    getGameState(database),
    getMarketSystemModeForDb(database),
  ]);
  const currentYear = gameState?.currentYear;
  const plantsEnabled = marketAtLeast(marketMode, "plants");

  if (lookups.corporations.length === 0) {
    return { corpsRepriced: 0, corpsSkipped: 0 };
  }

  // Pull this turn's snapshots in one query — we need sectorNPV, incomePreDividends,
  // perTurnBondCouponIncome, perTurnBondDragOnNetIncome (none of which change in
  // bondTurn — sectors and revenue are corp-turn outputs).
  // Also pull PREVIOUS turn's snapshot for the smoothing-term anchor: by the
  // time we run, both corp.sharePrice and this turn's hist.sharePrice already
  // hold the corp-turn placeholder. Using that as previousSharePrice in the
  // formula would double-apply the 0.15 smoothing weight, biasing the result
  // toward the placeholder. Pulling turn-1 gives the true prior.
  const [histRows, prevHistRows] = await Promise.all([
    database.collection<CorporationHistory>("corporationHistory").find({ turn }).toArray(),
    database
      .collection<CorporationHistory>("corporationHistory")
      .find({ turn: turn - 1 })
      .project<{ corporationId: ObjectId; sharePrice: number }>({
        corporationId: 1,
        sharePrice: 1,
      })
      .toArray(),
  ]);
  const histByCorpId = new Map(histRows.map((h) => [h.corporationId.toString(), h]));
  const prevPriceByCorpId = new Map(
    prevHistRows.map((h) => [h.corporationId.toString(), h.sharePrice])
  );

  // Equity-adjusted earnings: corp.earningsHistory was already updated this turn
  // by processCorporationTurn. buildCorporationLookups was just called so corp
  // documents reflect the post-corp-turn state.
  const baseEarningsMap = new Map<string, number>();
  const totalSharesById = new Map<string, number>();
  for (const corp of lookups.corporations) {
    const id = corp._id.toString();
    baseEarningsMap.set(id, normalizedEarningsFromHistory(corp.earningsHistory ?? []));
    totalSharesById.set(id, corp.totalShares ?? 10_000_000);
  }
  const adjustedEarningsMap = applyEquityMethodEarnings(
    baseEarningsMap,
    lookups.crossCorpStockHoldingsByHolderCorpId,
    totalSharesById
  );

  const inputs: SharePriceInput[] = [];
  let skipped = 0;
  for (const corp of lookups.corporations) {
    const id = corp._id.toString();
    const hist = histByCorpId.get(id);
    if (!hist) {
      // Snapshot not present — leave the placeholder price untouched.
      skipped++;
      continue;
    }

    // Re-read corp.liquidCapital fresh — bondTurn has applied coupons since the
    // corp turn snapshot was taken. corp.liquidCapital is in local currency
    // post-migration; normalize to ₳ for the formula.
    const homeCurrency = resolveCorpLiquidCurrencyCode(corp);
    const fxRate = fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency);
    const liquidCapitalAnchor = corpCapitalToAnchor(corp.liquidCapital, homeCurrency, fxRate);

    // Mirror the issuance-proceeds exclusion from sectorCalculations so the
    // post-bond recompute doesn't inflate tangible book for corps that have
    // realized proceeds from selling their own shares out of the public float.
    const issuanceProceedsAnchor = corpCapitalToAnchor(
      corp.shareIssuanceProceeds ?? 0,
      homeCurrency,
      fxRate
    );

    // Revenue-weighted sector growth rate from current sector state (already
    // updated this turn). Ratio is currency-neutral since all sector revenues
    // for a given corp are in the same home currency.
    //
    // PLANTS (marketSystemMode >= "plants"): `currentGrowthRate` is the CEO's
    // growth SLIDER, and under plants that slider no longer buys any capacity —
    // build orders do. It keeps whatever value it was last left at, forever.
    // Feeding it to the Gordon-growth terminal-value premium below would pay
    // every corp a permanent unearned premium for a setting that does nothing.
    //
    // The honest replacement would be a trailing capacity delta, but nothing
    // persists a per-sector capacity history to difference against (corporation
    // History carries sectorNPV, not capitalStock), so computing one here would
    // mean a second per-sector time series purely for this term. Until that
    // exists, the growth premium is switched OFF under plants — g = 0 is the
    // premium's neutral value (component 3 evaluates to exactly 0), which
    // prices a corp on assets + earnings only. That understates a genuinely
    // expanding corp rather than overstating a stagnant one, which is the
    // right way round for a valuation floor.
    const sectors = lookups.sectorsByCorp.get(id) ?? [];
    let growthNumer = 0;
    let growthDenom = 0;
    for (const sector of sectors) {
      const rev = typeof sector.revenue === "number" ? sector.revenue : 0;
      const gr = sector.currentGrowthRate ?? sector.growthRate ?? 0;
      growthNumer += (gr / 100) * rev;
      growthDenom += rev;
    }
    const sectorGrowthRate = plantsEnabled ? 0 : growthDenom > 0 ? growthNumer / growthDenom : 0;

    // Capitalized build spend in flight (P3a). Already ₳ on disk — see the
    // capex contract in sectorProfitBasis.ts — so no FX normalization.
    const constructionInProgressAnchor = sumConstructionInProgressAnchor(sectors);

    // Fallback for an unrecognized countryId (e.g. stale pre-rename data):
    // getCountryConfig returns undefined rather than a CountryConfig, and
    // this runs inside the per-corp repricing loop — throwing here would
    // abort repricing for every corporation, not just this one.
    let countryPrimeRate = getCountryConfig(corp.countryId)?.centralBank.defaultPrimeRate;
    if (countryPrimeRate === undefined) {
      console.warn(
        `[recomputeSharePrices] unrecognized countryId "${corp.countryId}" on corp ${id} — falling back to ${FALLBACK_PRIME_RATE_PERCENT}% prime rate`
      );
      countryPrimeRate = FALLBACK_PRIME_RATE_PERCENT;
    }
    // Discount by the SMOOTHED prime rate (EMA, fomcMeetingTurn): with hourly
    // turns an active FOMC moves spot +-0.75pp every few turns, and instant
    // full transmission whipsawed every corp's earnings component with it.
    // Spot remains the basis everywhere money actually reprices immediately
    // (loans, coupons, growth costs).
    const corpPrimeRate =
      (lookups.primeRateSmoothedByCountry.get(corp.countryId) ??
        lookups.primeRateByCountry.get(corp.countryId) ??
        countryPrimeRate) / 100;
    const riskPremium = SECTOR_RISK_PREMIUM[corp.type as string] ?? SECTOR_RISK_PREMIUM.default;

    // hist.sectorNPV is stored in local currency (converted by marketCapSnapshot);
    // normalize to ₳ to match the formula's anchor space.
    const sectorNPVAnchor = corpCapitalToAnchor(hist.sectorNPV ?? 0, homeCurrency, fxRate);

    inputs.push({
      corpId: id,
      liquidCapitalAnchor: Math.max(0, liquidCapitalAnchor - issuanceProceedsAnchor),
      sectorNPVAnchor,
      issuedBondDebt: lookups.issuedBondDebtByCorpId.get(id) ?? 0,
      bondHoldingsAnchor: lookups.bondAndImfPortfolioAnchorByCorpId.get(id) ?? 0,
      normalizedEarningsAnchor: adjustedEarningsMap.get(id) ?? 0,
      // Annualised bond-coupon income. hist value is per-turn local currency;
      // anchor-normalize (formula space is ₳) then annualize.
      bondCouponEarningsAnchor:
        Math.max(0, corpCapitalToAnchor(hist.perTurnBondCouponIncome ?? 0, homeCurrency, fxRate)) *
        TURNS_PER_YEAR,
      // Issuer-side interest, same units and normalization: nets against
      // coupons in the formula so leveraged operators are not priced as bond
      // funds (see sharePriceFormula reliance block).
      bondInterestExpenseAnchor:
        Math.max(
          0,
          corpCapitalToAnchor(hist.perTurnBondDragOnNetIncome ?? 0, homeCurrency, fxRate)
        ) * TURNS_PER_YEAR,
      sectorGrowthRate,
      constructionInProgressAnchor,
      costOfCapital: corpPrimeRate + riskPremium,
      totalShares: corp.totalShares ?? 10_000_000,
      ceoOwnershipFraction: ceoOwnershipFraction(corp),
      // Suggestion #62: index-fund ownership earns a bounded price premium.
      indexFundOwnershipFraction: indexFundOwnershipFraction(corp),
      isPrivate: corp.isPrivate ?? false,
      // Smoothing-prior selection:
      //   - In split cooldown: use corp.sharePrice (the post-split-scaled value
      //     written by the consolidate route on the split turn). Using turn-1
      //     history here would be the PRE-SPLIT price, undoing the scaling.
      //   - Outside cooldown: use turn-1 history as the true prior (avoids
      //     double-applying smoothing already baked into corp.sharePrice this turn).
      previousSharePrice: readCorpEconomicAnchor(
        isInSplitCooldown(corp.lastShareStructureTurn ?? null, turn)
          ? (corp.sharePrice ?? 0.1)
          : (prevPriceByCorpId.get(id) ?? corp.sharePrice ?? 0.1),
        homeCurrency,
        fxRate
      ),
      imfBailoutActive: corp.imfBailoutActive === true,
      lastShareStructureTurn: corp.lastShareStructureTurn ?? null,
      techAssetValueAnchor: computeTechAssetValueAnchor(corp, currentYear),
    });
  }

  if (inputs.length === 0) {
    return { corpsRepriced: 0, corpsSkipped: skipped };
  }

  const newPrices = computeSharePrices(inputs, turn);

  // Persist new prices to BOTH corporations.sharePrice AND the same-turn
  // corporationHistory entry — otherwise the chart would show the placeholder
  // and the live price would diverge. Formula output is ₳; convert to the
  // owning corp's home currency for persistence (Task 18A).
  const corpOps: AnyBulkWriteOperation<Corporation>[] = [];
  const histOps: AnyBulkWriteOperation<CorporationHistory>[] = [];
  const now = new Date();
  const corpById = new Map(lookups.corporations.map((c) => [c._id.toString(), c]));
  for (const input of inputs) {
    const oid = new ObjectId(input.corpId);
    const anchorPrice = newPrices.get(input.corpId);
    if (anchorPrice == null) continue;
    const corp = corpById.get(input.corpId);
    const code = corp ? resolveCorpLiquidCurrencyCode(corp) : undefined;
    const rate = corp ? fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency) : 1;
    const localPrice = writeCorpEconomicLocal(anchorPrice, code, rate);
    corpOps.push({
      updateOne: {
        filter: { _id: oid },
        update: {
          $set: { sharePrice: localPrice, fundamentalSharePrice: localPrice, updatedAt: now },
        },
      },
    });
    histOps.push({
      updateOne: {
        filter: { corporationId: oid, turn },
        update: {
          $set: {
            sharePrice: localPrice,
            marketCap: Math.round(localPrice * input.totalShares),
            // Persist the post-bondTurn liquidCapital so the Cash-on-Hand
            // chart matches the live corp.liquidCapital. The corp turn writes
            // its snapshot before bondTurn applies coupon flows, so without
            // this overwrite the history row stays stale by exactly the per-
            // turn net bond cash flow (visible as a chart-vs-header divergence
            // for any corp with a non-trivial bond position).
            ...(corp ? { liquidCapital: corp.liquidCapital } : {}),
          },
        },
      },
    });
  }

  if (corpOps.length > 0) {
    await Promise.all([
      database.collection<Corporation>("corporations").bulkWrite(corpOps),
      database.collection<CorporationHistory>("corporationHistory").bulkWrite(histOps),
    ]);
  }

  return { corpsRepriced: corpOps.length, corpsSkipped: skipped };
}

/**
 * Returns true when a corp is within the post-structure-change smoothing
 * cooldown window. Mirrors the same check inside computeSharePrices so the
 * recompute pass can select its smoothing prior (corp.sharePrice during
 * cooldown vs turn-1 history outside it).
 */
function isInSplitCooldown(
  lastShareStructureTurn: number | null | undefined,
  currentTurn: number
): boolean {
  if (lastShareStructureTurn == null) return false;
  const elapsed = currentTurn - lastShareStructureTurn;
  return elapsed >= 0 && elapsed <= STOCK_SPLIT_PRICE_SMOOTHING_TURNS;
}
