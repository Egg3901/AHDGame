import type { Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types";

export const INDEX_FUNDS_COLLECTION = "indexFunds";

function fundSummary(f: IndexFund) {
  return {
    slug: f.slug,
    name: f.name,
    tickerSymbol: f.tickerSymbol,
    scope: f.scope,
    kind: f.kind,
    countryId: f.countryId ?? null,
    sectorType: f.sectorType ?? null,
    status: f.status,
    pauseReason: f.pauseReason ?? null,
    quotedNav: f.quotedNav,
    unitSupply: f.unitSupply,
    anchorCurrencyCode: f.anchorCurrencyCode,
    backingRatio: f.backingRatio ?? null,
    sponsorName: f.sponsorName ?? null,
    expenseRatioAnnual: f.expenseRatioAnnual ?? null,
    updatedAt: f.updatedAt?.toISOString() ?? null,
  };
}

export async function queryIndexFunds(db: Db, params: { country?: string; scope?: string } = {}) {
  const filter: Record<string, unknown> = {};
  if (params.country) filter.countryId = params.country.toUpperCase();
  if (params.scope) filter.scope = params.scope;

  const funds = await db
    .collection<IndexFund>(INDEX_FUNDS_COLLECTION)
    .find(filter)
    .sort({ quotedNav: -1 })
    .toArray();

  if (funds.length === 0) return { found: false, funds: [] as unknown[] };

  return { found: true, funds: funds.map(fundSummary) };
}

export async function queryIndexFundDetail(db: Db, slug: string) {
  const fund = await db.collection<IndexFund>(INDEX_FUNDS_COLLECTION).findOne({ slug });

  if (!fund) return null;

  const topHoldings = [...fund.holdings]
    .sort((a, b) => (b.lastValueAnchor ?? 0) - (a.lastValueAnchor ?? 0))
    .slice(0, 25);
  const corpIds = topHoldings.map((h) => h.corporationId).filter(Boolean);
  const corps =
    corpIds.length > 0
      ? await db
          .collection<{ _id: import("mongodb").ObjectId; name: string }>("corporations")
          .find({ _id: { $in: corpIds } })
          .project({ name: 1 })
          .toArray()
      : [];
  const nameById = new Map(corps.map((c) => [c._id.toString(), c.name]));

  const holdings = topHoldings.map((h) => ({
    corporationId: h.corporationId?.toString() ?? null,
    corporationName: h.corporationId ? (nameById.get(h.corporationId.toString()) ?? null) : null,
    shares: h.shares ?? null,
    lastValueAnchor: h.lastValueAnchor ?? null,
    avgCostPerShareAnchor: h.avgCostPerShareAnchor ?? null,
  }));

  return {
    found: true,
    fund: {
      ...fundSummary(fund),
      reserveUnits: fund.reserveUnits,
      cashAnchor: fund.cashAnchor,
      lastRebalancedAt: fund.lastRebalancedAt?.toISOString() ?? null,
      charteredAtTurn: fund.charteredAtTurn ?? null,
      seedCapitalAnchor: fund.seedCapitalAnchor ?? null,
      windDownStartedAtTurn: fund.windDownStartedAtTurn ?? null,
      topHoldings: holdings,
    },
  };
}
