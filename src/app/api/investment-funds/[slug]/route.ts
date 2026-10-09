import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, notFound, errorResponse } from "@/lib/api/errors";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { isIndexFundsEnabled, INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import {
  resolveFundBySlugOrId,
  listFundPositions,
  listFundSnapshots,
  getPosition,
  FUND_TRANSACTION_COLLECTION,
} from "@/lib/indexFunds/fundQueries";
import type { IndexFundTransaction } from "@/lib/db/types";
import { buildFundNavMetrics } from "@/lib/indexFunds/fundNavMetrics";

import { getOpenOrdersEscrowAnchor } from "@/lib/indexFunds/fundValuation";
import { listFundBondHoldings } from "@/lib/bonds/fundBondHoldings";
import { corpCapitalToAnchor, loadValuationFxRates } from "@/lib/currency/corporationCapital";

type CorpSummary = {
  _id: ObjectId;
  name: string;
  tickerSymbol?: string;
  sequentialId?: number;
  typeLabel?: string;
};

// GET /api/investment-funds/[slug] — Fund detail with holdings, positions summary, and NAV history
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return errorResponse(403, INDEX_FUNDS_DISABLED_MESSAGE);
    }

    const { slug } = await params;
    const fund = await resolveFundBySlugOrId(db, slug);
    if (!fund) throw notFound("Fund not found");

    const snapshots = await listFundSnapshots(db, fund._id, 1000);
    const navMetrics = buildFundNavMetrics(snapshots);

    const positions = await listFundPositions(db, fund._id);
    const nonReservePositions = positions.filter((p) => p.holderKind !== "fund_reserve");
    const totalHolders = nonReservePositions.length;
    const totalNonReserveUnits = nonReservePositions.reduce((sum, p) => sum + p.units, 0);

    const openOrdersEscrowAnchor = await getOpenOrdersEscrowAnchor(db, fund._id);
    const bondPositions = await listFundBondHoldings(db, fund._id);
    const fxRates = bondPositions.length
      ? await loadValuationFxRates(db)
      : new Map<string, number>();
    const bondHoldings = bondPositions.map((row) => {
      const rate = fxRates.get(row.currencyCode);
      if (!rate || rate <= 0)
        throw new Error(`Missing exchange rate for bond currency ${row.currencyCode}`);
      return {
        bondId: row.bondId.toString(),
        corporationId: row.issuerType === "corporation" ? row.corporationId.toString() : null,
        issuerType: row.issuerType,
        issuerName: row.issuerName ?? row.countryId ?? "Unknown",
        countryId: row.countryId ?? null,
        units: row.units,
        couponRate: row.couponRate,
        marketPrice: row.marketPrice,
        maturityTurn: row.maturityTurn,
        valueAnchor: corpCapitalToAnchor(row.valueAnchor, row.currencyCode, rate),
      };
    });

    const corpIds = [
      ...new Set([
        ...bondHoldings.filter((h) => h.corporationId).map((h) => h.corporationId!),
        ...fund.holdings.map((h) => h.corporationId.toString()),
        ...fund.targetConstituents.map((c) => c.corporationId.toString()),
      ]),
    ].map((id) => new ObjectId(id));

    const corps = corpIds.length
      ? await db
          .collection<CorpSummary>("corporations")
          .find({ _id: { $in: corpIds } })
          .project({ name: 1, tickerSymbol: 1, sequentialId: 1, type: 1 })
          .toArray()
      : [];

    const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

    const enrichCorp = (corporationId: string) => {
      const corp = corpById.get(corporationId);
      return {
        corporationId,
        corporationName: corp?.name ?? "Unknown",
        tickerSymbol: corp?.tickerSymbol ?? null,
        sequentialId: corp?.sequentialId ?? null,
      };
    };

    // Aggregate lifetime dividends received per constituent corp.
    const dividendAgg = await db
      .collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION)
      .aggregate<{ _id: string; total: number }>([
        {
          $match: {
            fundId: fund._id,
            kind: "dividend_pass_through",
            corporationId: { $exists: true },
          },
        },
        { $group: { _id: { $toString: "$corporationId" }, total: { $sum: "$amountAnchor" } } },
      ])
      .toArray();
    const dividendByCorpId = new Map(dividendAgg.map((r) => [r._id, r.total]));

    const auth = await getAuthUserWithCharacter();

    // A5 sponsorship: the sponsor's CEO gets the wind-up control on this page,
    // mirroring the check the wind-up route enforces.
    let viewerIsSponsorCeo = false;
    if (fund.sponsorCorporationId && auth) {
      const sponsor = await db
        .collection<{ _id: ObjectId; userId?: ObjectId }>("corporations")
        .findOne({ _id: fund.sponsorCorporationId }, { projection: { userId: 1 } });
      viewerIsSponsorCeo = !!sponsor?.userId && sponsor.userId.toString() === auth.userId;
    }

    let myPosition: {
      units: number;
      legacyUnits: number;
      avgNavAnchor: number | null;
    } | null = null;
    const characterId = auth?.character?._id;
    if (characterId) {
      const pos = await getPosition(db, fund._id, "character", { characterId });
      if (pos && pos.units > 0) {
        myPosition = {
          units: pos.units,
          // #857 grandfather: legacy units redeem rate-free. Default absent →
          // full position (matches the redeem debit's `legacyUnits ?? units`).
          legacyUnits: pos.legacyUnits ?? pos.units,
          avgNavAnchor: pos.avgNavAnchor ?? null,
        };
      }
    }

    const corporations = auth
      ? await db
          .collection<import("@/lib/db/types").Corporation>("corporations")
          .find(
            { userId: new ObjectId(auth.userId) },
            { projection: { name: 1, liquidCapital: 1, liquidCurrencyCode: 1, countryId: 1 } }
          )
          .toArray()
      : [];
    const corporationAccounts = corporations.map((corp) => {
      const position = positions.find(
        (p) => p.holderKind === "corporation" && p.corporationId?.equals(corp._id)
      );
      return {
        id: corp._id.toHexString(),
        name: corp.name,
        liquidCapital: corp.liquidCapital,
        currencyCode: resolveCorpLiquidCurrencyCode(corp) ?? null,
        units: position?.units ?? 0,
      };
    });
    const response = NextResponse.json({
      corporationAccounts,
      fund: {
        id: fund.slug,
        slug: fund.slug,
        name: fund.name,
        tickerSymbol: fund.tickerSymbol,
        scope: fund.scope,
        kind: fund.kind,
        countryId: fund.countryId ?? null,
        sectorType: fund.sectorType ?? null,
        anchorCurrencyCode: fund.anchorCurrencyCode,
        status: fund.status,
        pauseReason: fund.pauseReason ?? null,
        quotedNav: fund.quotedNav,
        unitSupply: fund.unitSupply,
        aumAnchor: fund.quotedNav * fund.unitSupply,
        cashAnchor: fund.cashAnchor,
        openOrdersEscrowAnchor,
        backingRatio: fund.backingRatio ?? null,
        lastRebalancedAt: fund.lastRebalancedAt ?? null,
        // A5 sponsorship (all null for the seeded system funds)
        sponsorCorporationId: fund.sponsorCorporationId?.toString() ?? null,
        sponsorName: fund.sponsorName ?? null,
        expenseRatioAnnual: fund.expenseRatioAnnual ?? null,
        seedCapitalAnchor: fund.seedCapitalAnchor ?? null,
        feesPaidToSponsorAnchor: fund.feesPaidToSponsorAnchor ?? null,
        charteredAtTurn: fund.charteredAtTurn ?? null,
        windDownStartedAtTurn: fund.windDownStartedAtTurn ?? null,
        viewerIsSponsorCeo,
        navChange1: navMetrics.navChange1,
        navChange24: navMetrics.navChange24,
        navChange48: navMetrics.navChange48,
        bondHoldings: bondHoldings.map((h) => ({
          ...h,
          issuerName: h.corporationId
            ? (corpById.get(h.corporationId)?.name ?? h.issuerName)
            : h.issuerName,
          sequentialId: h.corporationId
            ? (corpById.get(h.corporationId)?.sequentialId ?? null)
            : null,
        })),
        bondHoldingsValueAnchor: bondHoldings.reduce((sum, h) => sum + h.valueAnchor, 0),
        holdings: fund.holdings.map((h) => ({
          ...enrichCorp(h.corporationId.toString()),
          shares: h.shares,
          avgCostPerShareAnchor: h.avgCostPerShareAnchor ?? null,
          lastValueAnchor: h.lastValueAnchor ?? null,
          dividendsReceivedAnchor: dividendByCorpId.get(h.corporationId.toString()) ?? null,
        })),
        targetConstituents: fund.targetConstituents.map((c) => ({
          ...enrichCorp(c.corporationId.toString()),
          targetWeight: c.targetWeight,
          marketCapAnchor: c.marketCapAnchor,
        })),
      },
      summary: {
        totalHolders,
        totalNonReserveUnits,
      },
      myPosition,
      navHistory: [...snapshots].reverse().map((s) => ({
        turn: s.turn,
        quotedNav: s.quotedNav,
        unitSupply: s.unitSupply,
        cashAnchor: s.cashAnchor,
        totalHoldingsValueAnchor: s.totalHoldingsValueAnchor,
        backingRatio: s.backingRatio,
        createdAt: s.createdAt,
      })),
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
