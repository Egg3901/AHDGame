import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getAuthUser } from "@/lib/auth";
import { shouldRedactCorporation } from "@/lib/corporations/redaction";
import { loadReservedPositionsPlacedBy } from "@/lib/corporations/reservedCorporateHoldings";
import type { Bond, Corporation, CorporationPortfolioHistory, Shareholder } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE, BOND_MATURITY_LABELS } from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import { getBondIssuerDisplayName } from "@/lib/bonds/sovereign";
import { getGameState } from "@/lib/gameState";
import { getPublicShareQuote } from "@/lib/corporations/marketQuote";
import { findImfFacilityReceivablesForLender } from "@/lib/corporations/imfPortfolioReceivables";
import { computeCorporationLiabilityValueAnchor } from "@/lib/corporations/netWorth";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/corporations/[id]/portfolio
 * Returns equity and bond holdings owned by this corporation.
 * Public — no auth required.
 * Error codes: 400 (invalid id), 404 (not found)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();
    const currentTurn = (await getGameState())?.currentTurn ?? 0;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // Fog of war: hide the entire portfolio for private corps. Holdings + cash
    // are pure financial signal; non-CEO viewers see an empty result + flag.
    const authUser = await getAuthUser().catch(() => null);
    const modViewEnabled =
      !authUser?.isAdmin &&
      authUser?.isModerator === true &&
      new URL(request.url).searchParams.get("modView") === "1";
    if (
      shouldRedactCorporation(
        corporation,
        authUser?.userId,
        authUser?.isAdmin === true,
        modViewEnabled
      )
    ) {
      return NextResponse.json({
        corporationName: corporation.name,
        isPrivate: true,
        stockHoldings: [],
        bondHoldings: [],
        totalStockValue: 0,
        totalBondValue: 0,
        totalLiabilityValue: 0,
        grossPortfolioValue: 0,
        cashOnHand: 0,
        totalPortfolioValue: 0,
        totalUnrealizedPnl: 0,
        totalCouponIncomePerTurn: 0,
        history: [],
      });
    }

    const [heldCorps, activeBonds, fxByCurrency, reservedPlaced] = await Promise.all([
      db
        .collection<Corporation>("corporations")
        .find({ "shareholders.corporationId": corporation._id })
        .project({
          _id: 1,
          name: 1,
          sequentialId: 1,
          sharePrice: 1,
          shareholders: 1,
          logoUrl: 1,
          brandColor: 1,
          liquidCurrencyCode: 1,
          countryId: 1,
        })
        .toArray(),
      db
        .collection<Bond>("bonds")
        .find({
          matured: false,
          $or: [{ "holders.corporationId": corporation._id }, { corporationId: corporation._id }],
        })
        .toArray(),
      loadFxRatesByCurrency(db),
      loadReservedPositionsPlacedBy(db, corporation._id),
    ]);

    let totalStockValueAnchor = 0;
    let totalUnrealizedPnlAnchor = 0;

    const reservedByTarget = new Map(
      reservedPlaced.map((r) => [r.targetCorpId.toString(), r.shares])
    );
    const heldById = new Map(heldCorps.map((c) => [c._id.toString(), c]));
    const missingReservedIds = reservedPlaced
      .map((r) => r.targetCorpId)
      .filter((id) => !heldById.has(id.toString()));
    if (missingReservedIds.length > 0) {
      const extraHeld = await db
        .collection<Corporation>("corporations")
        .find({ _id: { $in: missingReservedIds } })
        .project({
          _id: 1,
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
      heldCorps.push(...extraHeld);
    }

    const stockHoldings = heldCorps
      .map((heldCorp) => {
        const entry = (heldCorp.shareholders as Shareholder[] | undefined)?.find(
          (sh) => sh.corporationId?.toString() === corporation._id.toString()
        );
        const reservedShares = reservedByTarget.get(heldCorp._id.toString()) ?? 0;
        const shares = (entry?.shares ?? 0) + reservedShares;
        if (shares <= 0) return null;

        const sharePrice = getPublicShareQuote(heldCorp);
        const totalValue = Math.round(shares * sharePrice * 100) / 100;
        const avgCostPerShare = entry?.avgCostPerShare ?? null;
        const unrealizedPnl =
          avgCostPerShare !== null
            ? Math.round((sharePrice - avgCostPerShare) * shares * 100) / 100
            : null;
        const unrealizedPnlPct =
          avgCostPerShare !== null && avgCostPerShare > 0
            ? Math.round(((sharePrice - avgCostPerShare) / avgCostPerShare) * 10000) / 100
            : null;

        const heldFxRate = fxRateForCorpFromMap(heldCorp, fxByCurrency);
        const totalValueAnchor = corpLiquidCapitalToAnchor(totalValue, heldCorp, heldFxRate);
        totalStockValueAnchor += totalValueAnchor;
        if (unrealizedPnl !== null) {
          totalUnrealizedPnlAnchor += corpLiquidCapitalToAnchor(
            unrealizedPnl,
            heldCorp,
            heldFxRate
          );
        }

        const heldCurrency = (heldCorp.liquidCurrencyCode ??
          (heldCorp.countryId && heldCorp.countryId in COUNTRY_CURRENCY_MAP
            ? COUNTRY_CURRENCY_MAP[heldCorp.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
            : undefined)) as CurrencyCode | undefined;

        return {
          corporationId: heldCorp._id.toString(),
          corporationName: heldCorp.name,
          sequentialId: heldCorp.sequentialId,
          logoUrl: heldCorp.logoUrl ?? null,
          brandColor: heldCorp.brandColor ?? null,
          currencyCode: heldCurrency,
          shares,
          avgCostPerShare,
          sharePrice: Math.round(sharePrice * 100) / 100,
          totalValue,
          unrealizedPnl,
          unrealizedPnlPct,
        };
      })
      .filter(Boolean);

    stockHoldings.sort((a, b) => {
      const aRate = a!.currencyCode ? (fxByCurrency.get(a!.currencyCode) ?? 1) : 1;
      const bRate = b!.currencyCode ? (fxByCurrency.get(b!.currencyCode) ?? 1) : 1;
      return b!.totalValue / (bRate || 1) - a!.totalValue / (aRate || 1);
    });

    const heldBonds = activeBonds.filter((bond) =>
      bond.holders.some((holder) => holder.corporationId?.equals(corporation._id))
    );
    const issuedBonds = activeBonds.filter((bond) => bond.corporationId?.equals(corporation._id));

    const issuerCorpIds = [
      ...new Set(
        heldBonds
          .filter((bond) => bond.corporationId && bond.issuerType !== "sovereign")
          .map((bond) => bond.corporationId.toString())
      ),
    ];
    const issuerCorps =
      issuerCorpIds.length > 0
        ? await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: issuerCorpIds.map((cid) => new ObjectId(cid)) } })
            .project({ _id: 1, name: 1, sequentialId: 1, brandColor: 1 })
            .toArray()
        : [];
    const issuerCorpMap = new Map(issuerCorps.map((corp) => [corp._id.toString(), corp]));

    let totalBondValueAnchor = 0;
    let totalCouponIncomePerTurnAnchor = 0;

    const bondHoldings = heldBonds
      .map((bond) => {
        const holding = bond.holders.find(
          (h) => h.corporationId?.toString() === corporation._id.toString()
        );
        if (!holding || holding.units <= 0) return null;

        const issuerCorp = issuerCorpMap.get(bond.corporationId?.toString() ?? "");
        const issuerName = getBondIssuerDisplayName(bond, issuerCorp?.name);
        const totalValue =
          Math.round(holding.units * BOND_UNIT_FACE_VALUE * bond.marketPrice * 100) / 100;
        const couponPerTurn =
          perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * holding.units;

        const bondCcy = (bond.currencyCode ??
          (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
            ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
            : undefined)) as CurrencyCode | undefined;
        const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
        totalBondValueAnchor += bondCcy && bondRate > 0 ? totalValue / bondRate : totalValue;
        if (!bond.defaulted) {
          totalCouponIncomePerTurnAnchor +=
            bondCcy && bondRate > 0 ? couponPerTurn / bondRate : couponPerTurn;
        }

        return {
          bondId: bond._id.toString(),
          issuerName,
          issuerSequentialId: issuerCorp?.sequentialId ?? null,
          issuerBrandColor: issuerCorp?.brandColor ?? null,
          corporationId: bond.corporationId?.toString() ?? null,
          holderCorpId: corporation._id.toString(),
          currencyCode: bondCcy,
          units: holding.units,
          couponRate: bond.couponRate,
          marketPrice: bond.marketPrice,
          maturityLabel:
            BOND_MATURITY_LABELS[bond.maturityTurns as BondMaturityTurns] ??
            `${bond.maturityTurns} turns`,
          turnsRemaining: Math.max(0, bond.maturityTurn - currentTurn),
          avgCostPerUnit: holding.avgCostPerUnit ?? null,
          totalValue,
          dailyIncomePerTurn: Math.round(couponPerTurn * 100) / 100,
          defaulted: bond.defaulted,
        };
      })
      .filter(Boolean);

    bondHoldings.sort((a, b) => {
      const aRate = a!.currencyCode ? (fxByCurrency.get(a!.currencyCode) ?? 1) : 1;
      const bRate = b!.currencyCode ? (fxByCurrency.get(b!.currencyCode) ?? 1) : 1;
      return b!.totalValue / (bRate || 1) - a!.totalValue / (aRate || 1);
    });

    const { receivables: imfRows, totalPrincipal: totalImfFacilityReceivable } =
      await findImfFacilityReceivablesForLender(db, corporation._id);

    const holderId = corporation._id.toString();
    const imfBondRows = imfRows.map((row) => ({
      bondId: `imf-facility:${row.borrowerCorporationId}`,
      issuerName: row.borrowerName,
      issuerSequentialId: row.sequentialId,
      issuerBrandColor: row.brandColor ?? undefined,
      corporationId: row.borrowerCorporationId,
      holderCorpId: holderId,
      units: 0,
      couponRate: row.annualRatePercent,
      marketPrice: 1,
      maturityLabel: `${row.amortizationTurnsRemaining} turns`,
      turnsRemaining: row.amortizationTurnsRemaining,
      avgCostPerUnit: null,
      totalValue: Math.round(row.principalOutstanding * 100) / 100,
      dailyIncomePerTurn: 0,
      defaulted: false,
      imfFacilityLoan: true as const,
    }));

    const mergedBondHoldings = [...bondHoldings, ...imfBondRows].sort(
      (a, b) => b!.totalValue - a!.totalValue
    );

    const totalBondValueWithImf =
      Math.round((totalBondValueAnchor + totalImfFacilityReceivable) * 100) / 100;

    const ownFxRate = fxRateForCorpFromMap(corporation, fxByCurrency);
    const cashOnHandAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital ?? 0,
      corporation,
      ownFxRate
    );
    const cashOnHand = Math.round(cashOnHandAnchor * 100) / 100;
    const totalLiabilityValue =
      Math.round(
        computeCorporationLiabilityValueAnchor(corporation, issuedBonds, fxByCurrency) * 100
      ) / 100;
    const grossPortfolioValue =
      Math.round((totalStockValueAnchor + totalBondValueWithImf + cashOnHandAnchor) * 100) / 100;
    const totalPortfolioValue = Math.round((grossPortfolioValue - totalLiabilityValue) * 100) / 100;

    // Most recent 500 turns; sort descending server-side then reverse for the
    // chart consumer (ascending) so long-lived corps don't see the chart
    // truncate to the oldest 500 snapshots.
    const historyDescending = await db
      .collection<CorporationPortfolioHistory>("corporationPortfolioHistory")
      .find({ corporationId: corporation._id })
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
        liabilityValue: 1,
        exchangeRatesSnapshot: 1,
      })
      .toArray();
    const history = historyDescending.reverse();

    return NextResponse.json({
      corporationName: corporation.name,
      isNationalCorp: !!corporation.countryOwnerId,
      stockHoldings,
      bondHoldings: mergedBondHoldings,
      totalStockValue: Math.round(totalStockValueAnchor * 100) / 100,
      totalBondValue: totalBondValueWithImf,
      totalLiabilityValue,
      grossPortfolioValue,
      cashOnHand,
      totalPortfolioValue,
      totalUnrealizedPnl: Math.round(totalUnrealizedPnlAnchor * 100) / 100,
      totalCouponIncomePerTurn: Math.round(totalCouponIncomePerTurnAnchor * 100) / 100,
      history,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
