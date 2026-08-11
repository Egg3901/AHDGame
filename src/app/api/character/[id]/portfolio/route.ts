import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation, Character, Bond } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE, BOND_MATURITY_LABELS } from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import { getGameState } from "@/lib/gameState";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import { getBondIssuerDisplayName, isCorporateBond } from "@/lib/bonds/sovereign";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getTotalPersonalWealth } from "@/lib/currency/characterFunds";
import { computeLocDebtInternal, loadExchangeRatesMap } from "@/lib/lineOfCredit/netWorth";
import { getPublicShareQuote } from "@/lib/corporations/marketQuote";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { parseCharacterId } from "@/lib/utils/profileUrls";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface Holding {
  corporationId: string;
  corporationName: string;
  sequentialId?: number;
  shares: number;
  sharePrice: number;
  totalValue: number;
  logoUrl?: string;
  brandColor?: string;
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

interface HistoryPoint {
  turn: number;
  totalValue: number;
  netValue?: number;
  stockValue?: number;
  bondValue?: number;
  cashValue?: number;
  liquidCashValue?: number;
  savingsCashValue?: number;
  locDebtValue?: number;
  exchangeRatesSnapshot?: Partial<Record<CurrencyCode, number>>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;

    const parsed = parseCharacterId(id);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }

    const [db, forexEnabled] = await Promise.all([getDb(), isForexEnabled()]);
    const exchangeRates = forexEnabled ? await loadExchangeRatesMap(db) : undefined;

    let character: Character | null = null;

    if (parsed.type === "sequential") {
      character = await db
        .collection<Character>("characters")
        .findOne({ sequentialId: parsed.value });
    } else {
      // ObjectId lookup
      character = await db
        .collection<Character>("characters")
        .findOne({ _id: new ObjectId(parsed.value) });
    }

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
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
    // each corp's liquidCurrencyCode (v0.2.6).
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const holdings: Holding[] = [];
    let totalValue = 0;

    for (const corp of corporations) {
      // Shareholder rows can be character / imperial / corp-owned; only char rows
      // have `characterId` set. Non-char rows anywhere before the target row
      // would crash on `.toString()` without the guard.
      const sh = corp.shareholders.find(
        (s: { characterId?: ObjectId; shares: number }) =>
          s.characterId?.toString() === charId.toString()
      );
      if (!sh || sh.shares <= 0) continue;

      const quote = getPublicShareQuote(corp);
      const value = sh.shares * quote;
      const corpFxRate = fxRateForCorpFromMap(corp, fxByCurrency);
      totalValue += corpLiquidCapitalToAnchor(value, corp, corpFxRate);

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
        currencyCode: corpCurrency,
      });
    }

    // Sort by value descending
    holdings.sort((a, b) => b.totalValue - a.totalValue);

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
        // Bond face values denominate in bond.currencyCode (v0.2.6); normalize
        // to ₳ for cross-bond summation.
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
    // reverse to ascending for the chart consumer.
    const historyDescending = await db
      .collection("portfolioHistory")
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
      .toArray();
    const history = historyDescending.reverse();

    // Preserve historical truth: if an older snapshot lacks a breakdown field,
    // leave it missing instead of backfilling today's values into the past.
    const currentCashWealth = getTotalPersonalWealth(character, forexEnabled, exchangeRates);
    const currentLocDebt = computeLocDebtInternal(character, exchangeRates ?? {});
    const historyWithBreakdown: HistoryPoint[] = history.map((h) => ({
      turn: h.turn,
      totalValue: h.totalValue,
      netValue:
        h.netValue ??
        (h.turn === currentTurn ? Math.max(0, h.totalValue - currentLocDebt) : h.totalValue),
      stockValue: h.stockValue,
      bondValue: h.bondValue,
      cashValue: h.cashValue,
      liquidCashValue: h.liquidCashValue,
      savingsCashValue: h.savingsCashValue,
      locDebtValue:
        h.locDebtValue ?? (h.turn === currentTurn ? Math.round(currentLocDebt * 100) / 100 : 0),
      exchangeRatesSnapshot: h.exchangeRatesSnapshot,
    }));

    return NextResponse.json({
      holdings,
      bondHoldings,
      totalValue: Math.round(totalValue * 100) / 100,
      totalBondValue: Math.round(totalBondValue * 100) / 100,
      totalBondIncomePerTurn: Math.round(totalBondIncomePerTurn * 100) / 100,
      cashOnHand: currentCashWealth,
      locDebtValue: currentLocDebt,
      characterName: character.name,
      characterId: charId.toString(),
      isOwnProfile: false,
      history: historyWithBreakdown,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
