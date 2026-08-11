import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { isIndexFundsEnabled } from "@/lib/indexFunds/featureFlag";
import { listFunds } from "@/lib/indexFunds/fundQueries";
import { INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import { sumFundBondHoldingsValueAnchor } from "@/lib/bonds/fundBondHoldings";
import { loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import {
  loadOpenOrdersEscrowByFundId,
  loadQueuedRedemptionLiabilityByFundId,
} from "@/lib/indexFunds/fundValuation";

// GET /api/admin/investment-funds — Admin list of all funds (including paused/delisted)
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return NextResponse.json({ error: INDEX_FUNDS_DISABLED_MESSAGE }, { status: 403 });
    }

    const funds = await listFunds(db);
    const exchangeRates = await loadFxRatesRecord(db);
    const fundIds = funds.map((fund) => fund._id);
    const openOrdersEscrowByFundId = await loadOpenOrdersEscrowByFundId(db, fundIds);
    const queuedLiabilityByFundId = await loadQueuedRedemptionLiabilityByFundId(db, fundIds);
    const bondPrincipalByFundId = new Map<string, number>();
    await Promise.all(
      funds.map(async (fund) => {
        bondPrincipalByFundId.set(
          fund._id.toString(),
          await sumFundBondHoldingsValueAnchor(db, fund, exchangeRates)
        );
      })
    );

    return NextResponse.json({
      funds: funds.map((fund) => {
        const fundId = fund._id.toString();
        const holdingsValueAnchor = computeHoldingsValueAnchor(fund);
        const bondPrincipalAnchor = bondPrincipalByFundId.get(fundId) ?? 0;
        const openOrdersEscrowAnchor = openOrdersEscrowByFundId.get(fundId) ?? 0;
        const queuedRedemptionLiabilityAnchor = queuedLiabilityByFundId.get(fundId) ?? 0;
        const netBackingAnchor =
          fund.cashAnchor +
          holdingsValueAnchor +
          bondPrincipalAnchor +
          openOrdersEscrowAnchor -
          queuedRedemptionLiabilityAnchor;
        return {
          id: fundId,
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
          pausedAt: fund.pausedAt ?? null,
          quotedNav: fund.quotedNav,
          unitSupply: fund.unitSupply,
          reserveUnits: fund.reserveUnits,
          cashAnchor: fund.cashAnchor,
          holdingsValueAnchor,
          bondPrincipalAnchor,
          openOrdersEscrowAnchor,
          queuedRedemptionLiabilityAnchor,
          netBackingAnchor,
          backingRatio: fund.backingRatio ?? null,
          lastRebalancedAt: fund.lastRebalancedAt ?? null,
          holdingsCount: fund.holdings.length,
          targetConstituentsCount: fund.targetConstituents.length,
          createdAt: fund.createdAt,
          updatedAt: fund.updatedAt,
        };
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
