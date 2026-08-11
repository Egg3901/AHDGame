import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, notFound } from "@/lib/api/errors";
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
      return NextResponse.json({ error: INDEX_FUNDS_DISABLED_MESSAGE }, { status: 403 });
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

    const corpIds = [
      ...new Set([
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

    return NextResponse.json({
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
        backingRatio: fund.backingRatio ?? null,
        lastRebalancedAt: fund.lastRebalancedAt ?? null,
        navChange1: navMetrics.navChange1,
        navChange24: navMetrics.navChange24,
        navChange48: navMetrics.navChange48,
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
  } catch (error) {
    return handleRouteError(error);
  }
}
