import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { isIndexFundsEnabled, INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import { listActiveFunds, listSnapshotsForFunds } from "@/lib/indexFunds/fundQueries";
import { buildFundNavMetrics } from "@/lib/indexFunds/fundNavMetrics";
import { filterFundsForExchange } from "@/lib/indexFunds/fundExchangeFilter";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

// GET /api/investment-funds — List active funds available for subscription
// Query: exchange=global|US|JP|... (matches stock market exchange selector)
export async function GET(request: Request) {
  try {
    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return NextResponse.json({ error: INDEX_FUNDS_DISABLED_MESSAGE }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const exchangeParam = (searchParams.get("exchange") ?? "global").toUpperCase();
    const exchange: "global" | CountryId =
      exchangeParam === "GLOBAL" || exchangeParam === ""
        ? "global"
        : exchangeParam in COUNTRY_CONFIGS
          ? (exchangeParam as CountryId)
          : "global";

    let funds = await listActiveFunds(db);
    funds = filterFundsForExchange(funds, exchange);

    const fundIds = funds.map((f) => f._id);
    const snapshotMap = await listSnapshotsForFunds(db, fundIds, 50);

    const publicFunds = funds.map((fund) => {
      const snapshots = snapshotMap.get(fund._id.toString()) ?? [];
      const metrics = buildFundNavMetrics(snapshots);
      const aumAnchor = fund.quotedNav * fund.unitSupply;

      return {
        id: fund.slug,
        slug: fund.slug,
        name: fund.name,
        tickerSymbol: fund.tickerSymbol,
        scope: fund.scope,
        kind: fund.kind,
        countryId: fund.countryId ?? null,
        sectorType: fund.sectorType ?? null,
        anchorCurrencyCode: fund.anchorCurrencyCode,
        quotedNav: fund.quotedNav,
        unitSupply: fund.unitSupply,
        aumAnchor,
        backingRatio: fund.backingRatio ?? null,
        status: fund.status,
        navChange1: metrics.navChange1,
        navChange24: metrics.navChange24,
        navChange48: metrics.navChange48,
        navSparkline: metrics.sparkline,
        topHoldings: fund.targetConstituents.slice(0, 5).map((c) => ({
          corporationId: c.corporationId.toString(),
          weight: c.targetWeight,
        })),
      };
    });

    return NextResponse.json({ funds: publicFunds, exchange });
  } catch (error) {
    return handleRouteError(error);
  }
}
