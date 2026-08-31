import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import type { Corporation, PortfolioHistory, Bond } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE, BOND_MATURITY_LABELS } from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import { getGameState } from "@/lib/gameState";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import { getBondIssuerDisplayName, isCorporateBond } from "@/lib/bonds/sovereign";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getTotalPersonalWealth,
  getTotalPersonalLiquidWealth,
  getTotalSavingsWealth,
  getHomeCurrency,
} from "@/lib/currency/characterFunds";
import { computeLocDebtInternal } from "@/lib/lineOfCredit/netWorth";
import { loadSavingsApyByCurrency } from "@/lib/api/savings/savingsApy";
import {
  estimateSavingsAccrualFromApy,
  turnsUntilSavingsCredit,
} from "@/lib/currency/savingsInterest";
import { getPublicShareQuote } from "@/lib/corporations/marketQuote";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadValuationFxRates,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";

interface Holding {
  corporationId: string;
  corporationName: string;
  sequentialId?: number;
  shares: number;
  sharePrice: number;
  totalValue: number;
  logoUrl?: string;
  brandColor?: string;
  avgCostPerShare: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  currencyCode?: CurrencyCode;
}

interface BondHolding {
  bondId: string;
  corporationId: string;
  corporationName: string;
  sequentialId?: number;
  units: number;
  faceValuePerUnit: number;
  couponRate: number;
  maturityLabel: string;
  maturityTurn: number;
  turnsRemaining: number;
  marketPrice: number;
  totalValue: number;
  defaulted: boolean;
  brandColor?: string;
  currencyCode?: CurrencyCode;
}

/**
 * Compute the authenticated character's portfolio payload (stock + bond holdings,
 * cash/savings, history). Shared by the GET route and the /portfolio server
 * component so the page can seed its initial data with a direct DB call instead
 * of a client self-fetch through the CDN.
 */
export async function loadCharacterPortfolio(userId: string) {
  const [db, forexEnabled] = await Promise.all([getDb(), isForexEnabled()]);
  const character = await getCharacterByUserId(db, userId);

  if (!character) {
    return {
      holdings: [],
      bondHoldings: [],
      totalValue: 0,
      totalBondValue: 0,
      totalBondIncomePerTurn: 0,
      totalCapitalGains: 0,
      capitalGainsBaselineTurn: null,
      history: [],
    };
  }

  const charId = character._id;
  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;

  // Find all corporations where this character is a shareholder
  const corporations = await db
    .collection<Corporation>("corporations")
    .find({ "shareholders.characterId": charId })
    .project({
      name: 1,
      sequentialId: 1,
      sharePrice: 1,
      shareholders: 1,
      logoUrl: 1,
      brandColor: 1,
      liquidCurrencyCode: 1,
      countryId: 1,
    })
    .toArray();

  // Cross-corp share totals must anchor-normalize: sharePrice is stored in
  // each corp's liquidCurrencyCode (v0.2.6), so raw value += shares × quote
  // would mix ¥, £, $ numbers. Per-holding totalValue stays in the held
  // corp's local currency so the UI can render it with its own code.
  const fxByCurrency = await loadValuationFxRates(db);
  const holdings: Holding[] = [];
  let totalValue = 0;

  for (const corp of corporations) {
    const sh = corp.shareholders.find(
      (s: { characterId?: ObjectId; shares: number }) =>
        s.characterId?.toString() === charId.toString()
    );
    if (!sh || sh.shares <= 0) continue;

    const quote = getPublicShareQuote(corp);
    const value = sh.shares * quote;
    const corpFxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    totalValue += corpLiquidCapitalToAnchor(value, corp, corpFxRate);

    const avgCostPerShare = sh.avgCostPerShare ?? null;
    const unrealizedPnl =
      avgCostPerShare !== null
        ? Math.round((quote - avgCostPerShare) * sh.shares * 100) / 100
        : null;
    const unrealizedPnlPct =
      avgCostPerShare !== null && avgCostPerShare > 0
        ? Math.round(((quote - avgCostPerShare) / avgCostPerShare) * 10000) / 100
        : null;

    const corpCurrency = (corp.liquidCurrencyCode ??
      (corp.countryId && corp.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[corp.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;

    holdings.push({
      corporationId: corp._id.toString(),
      corporationName: corp.name,
      sequentialId: corp.sequentialId,
      shares: sh.shares,
      sharePrice: quote,
      totalValue: Math.round(value * 100) / 100,
      logoUrl: corp.logoUrl,
      brandColor: corp.brandColor,
      avgCostPerShare,
      unrealizedPnl,
      unrealizedPnlPct,
      currencyCode: corpCurrency,
    });
  }

  // Sort by anchor-normalized value — cross-currency comparison requires normalizing first
  // so ¥13M CNY doesn't incorrectly outrank $500K USD purely due to exchange rate magnitude.
  holdings.sort((a, b) => {
    const aRate = a.currencyCode ? (fxByCurrency.get(a.currencyCode) ?? 1) : 1;
    const bRate = b.currencyCode ? (fxByCurrency.get(b.currencyCode) ?? 1) : 1;
    const aAnchor = aRate > 0 ? a.totalValue / aRate : a.totalValue;
    const bAnchor = bRate > 0 ? b.totalValue / bRate : b.totalValue;
    return bAnchor - aAnchor;
  });

  // Find all bonds where this character is a holder
  const bonds = await db
    .collection<Bond>("bonds")
    .find({ "holders.characterId": charId, matured: false })
    .toArray();

  const bondHoldings: BondHolding[] = [];
  let totalBondValue = 0;
  let totalBondIncomePerTurn = 0;

  if (bonds.length > 0) {
    // Get corporation names for bonds
    const bondCorpIds = [
      ...new Set(bonds.filter(isCorporateBond).map((bond) => bond.corporationId.toString())),
    ];
    const bondCorps = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: bondCorpIds.map((id) => new ObjectId(id)) } })
      .project({ name: 1, sequentialId: 1, brandColor: 1 })
      .toArray();
    const bondCorpMap = new Map(bondCorps.map((c) => [c._id.toString(), c]));

    for (const bond of bonds) {
      const holder = bond.holders.find((h) => h.characterId?.toString() === charId.toString());
      if (!holder || holder.units <= 0) continue;

      const corp = bondCorpMap.get(bond.corporationId.toString());
      const value = holder.units * BOND_UNIT_FACE_VALUE * bond.marketPrice;
      // Bond face values are denominated in bond.currencyCode (v0.2.6);
      // normalize to ₳ for cross-bond summation.
      const bondCcy = (bond.currencyCode ??
        (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
          ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
          : undefined)) as CurrencyCode | undefined;
      const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
      totalBondValue += bondCcy && bondRate > 0 ? value / bondRate : value;
      if (!bond.defaulted) {
        const couponLocal =
          perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * holder.units;
        totalBondIncomePerTurn += bondCcy && bondRate > 0 ? couponLocal / bondRate : couponLocal;
      }

      bondHoldings.push({
        bondId: bond._id.toString(),
        corporationId: bond.corporationId.toString(),
        corporationName: getBondIssuerDisplayName(bond, corp?.name),
        sequentialId: corp?.sequentialId,
        units: holder.units,
        faceValuePerUnit: BOND_UNIT_FACE_VALUE,
        couponRate: bond.couponRate,
        maturityLabel:
          BOND_MATURITY_LABELS[bond.maturityTurns as BondMaturityTurns] ??
          `${bond.maturityTurns} turns`,
        maturityTurn: bond.maturityTurn,
        turnsRemaining: Math.max(0, bond.maturityTurn - currentTurn),
        marketPrice: bond.marketPrice,
        totalValue: Math.round(value * 100) / 100,
        defaulted: bond.defaulted,
        brandColor: corp?.brandColor,
        currencyCode: bondCcy,
      });
    }

    bondHoldings.sort((a, b) => b.totalValue - a.totalValue);
  }

  // Fetch portfolio history for chart — most recent 500 turns. Sort descending
  // server-side so a long-lived character's latest snapshots are returned, then
  // reverse to ascending for the chart consumer. The `earliestSnapshot` query
  // intentionally remains ascending+limit(1) — it anchors the capital-gains
  // baseline, not the chart.
  const [historyDescending, earliestSnapshot] = await Promise.all([
    db
      .collection<PortfolioHistory>("portfolioHistory")
      .find({ characterId: charId })
      .sort({ turn: -1 })
      .limit(500)
      .project({
        _id: 0,
        turn: 1,
        totalValue: 1,
        netValue: 1,
        stockValue: 1,
        bondValue: 1,
        cashValue: 1,
        liquidCashValue: 1,
        savingsCashValue: 1,
        locDebtValue: 1,
        exchangeRatesSnapshot: 1,
      })
      .toArray(),
    db
      .collection<PortfolioHistory>("portfolioHistory")
      .find({ characterId: charId })
      .sort({ turn: 1 })
      .limit(1)
      .project({
        _id: 0,
        turn: 1,
        totalValue: 1,
        netValue: 1,
        stockValue: 1,
        bondValue: 1,
        cashValue: 1,
        liquidCashValue: 1,
        savingsCashValue: 1,
        locDebtValue: 1,
        exchangeRatesSnapshot: 1,
      })
      .next(),
  ]);
  const history = historyDescending.reverse();

  // Load exchange rates so multi-currency personal wealth is correctly summed
  let exchangeRates: Partial<Record<CurrencyCode, number>> | undefined;
  if (forexEnabled) {
    const ratesDocs = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
    exchangeRates = Object.fromEntries(ratesDocs.map((r) => [r.currencyCode, r.rate])) as Partial<
      Record<CurrencyCode, number>
    >;
  }

  const currentCashWealth = getTotalPersonalWealth(character, forexEnabled, exchangeRates);
  const currentLocDebt = computeLocDebtInternal(character, exchangeRates ?? {});
  const historyWithDerivedNet = history.map((point) => ({
    ...point,
    netValue:
      point.netValue ??
      (point.turn === currentTurn
        ? Math.max(0, point.totalValue - currentLocDebt)
        : point.totalValue),
    locDebtValue:
      point.locDebtValue ??
      (point.turn === currentTurn ? Math.round(currentLocDebt * 100) / 100 : 0),
  }));
  const combinedTotal = totalValue + totalBondValue + currentCashWealth;
  const baselineValue = earliestSnapshot?.totalValue ?? combinedTotal;
  const totalCapitalGains = combinedTotal - baselineValue;

  const apyByCurrency = await loadSavingsApyByCurrency(db);

  const interestEarnedByCurrency: Partial<Record<CurrencyCode, number>> =
    forexEnabled && character.currencyBalances?.interestEarned
      ? { ...character.currencyBalances.interestEarned }
      : !forexEnabled
        ? { [getHomeCurrency(character)]: character.savingsInterestEarnedLifetime ?? 0 }
        : {};

  const pendingSavingsInterestByCurrency: Partial<Record<CurrencyCode, number>> =
    forexEnabled && character.currencyBalances?.pendingSavingsInterest
      ? { ...character.currencyBalances.pendingSavingsInterest }
      : {};

  const estimatedSavingsAccrualPerTurn: Partial<Record<CurrencyCode, number>> = {};
  if (forexEnabled && character.currencyBalances?.savings) {
    for (const [code, bal] of Object.entries(character.currencyBalances.savings)) {
      const c = code as CurrencyCode;
      const apy = apyByCurrency[c];
      if (typeof bal === "number" && bal > 0 && apy != null && apy > 0) {
        estimatedSavingsAccrualPerTurn[c] = estimateSavingsAccrualFromApy(bal, apy, c);
      }
    }
  }

  return {
    holdings,
    bondHoldings,
    totalValue: Math.round(totalValue * 100) / 100,
    totalBondValue: Math.round(totalBondValue * 100) / 100,
    totalBondIncomePerTurn: Math.round(totalBondIncomePerTurn * 100) / 100,
    totalCapitalGains: Math.round(totalCapitalGains * 100) / 100,
    capitalGainsBaselineTurn: earliestSnapshot?.turn ?? null,
    history: historyWithDerivedNet,
    cashOnHand: currentCashWealth,
    liquidCashWealth: getTotalPersonalLiquidWealth(character, forexEnabled, exchangeRates),
    totalSavingsWealth: getTotalSavingsWealth(character, forexEnabled, exchangeRates),
    savingsBalances: character.currencyBalances?.savings ?? {},
    savingsAccountsOpened: character.savingsAccountsOpened ?? {},
    interestEarnedByCurrency,
    pendingSavingsInterestByCurrency,
    turnsUntilSavingsCredit: forexEnabled ? turnsUntilSavingsCredit(currentTurn) : null,
    estimatedSavingsAccrualPerTurn,
    apyByCurrency,
  };
}
