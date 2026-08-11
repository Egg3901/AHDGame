import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import { isIndexFundsEnabled, INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import { resolveFundBySlugOrId, insertFundTransaction } from "@/lib/indexFunds/fundQueries";
import { calculateBackingRatio } from "@/lib/indexFunds/unitAccounting";
import { recomputeNav } from "@/lib/indexFunds/fundCron";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import { createAdminLog } from "@/lib/adminLog";
import { sumFundBondHoldingsValueAnchor } from "@/lib/bonds/fundBondHoldings";
import { loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import {
  getOpenOrdersEscrowAnchor,
  getQueuedRedemptionLiabilityAnchor,
} from "@/lib/indexFunds/fundValuation";

const injectCapitalSchema = z.object({
  amount: z.number().finite().positive("Amount must be positive"),
});

// POST /api/admin/investment-funds/[slug]/inject-capital
// Injects anchor-currency cash into an index fund without minting units.
// Increases NAV and resets backing ratio toward 1.0.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, injectCapitalSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return NextResponse.json({ error: INDEX_FUNDS_DISABLED_MESSAGE }, { status: 403 });
    }

    const { slug } = await params;
    const fund = await resolveFundBySlugOrId(db, slug);
    if (!fund) throw notFound("Fund not found");

    const { amount } = parsed.data;

    const holdingsValueAnchor = computeHoldingsValueAnchor(fund);
    const exchangeRates = await loadFxRatesRecord(db);
    const bondPrincipalAnchor = await sumFundBondHoldingsValueAnchor(db, fund, exchangeRates);
    const openOrdersEscrowAnchor = await getOpenOrdersEscrowAnchor(db, fund._id);
    const queuedRedemptionLiabilityAnchor = await getQueuedRedemptionLiabilityAnchor(db, fund._id);
    const newCashAnchor = fund.cashAnchor + amount;
    const newNav =
      recomputeNav(
        {
          ...fund,
          cashAnchor: newCashAnchor,
          holdings: fund.holdings,
          bondAllocations: fund.bondAllocations,
        },
        { bondPrincipalAnchor, openOrdersEscrowAnchor, queuedRedemptionLiabilityAnchor }
      ) ?? fund.quotedNav;
    const backing = calculateBackingRatio({
      cashAnchor: newCashAnchor,
      holdingsValueAnchor,
      bondPrincipalAnchor,
      openOrdersEscrowAnchor,
      queuedRedemptionLiabilityAnchor,
      quotedNav: newNav,
      unitSupply: fund.unitSupply,
    });

    const now = new Date();
    const updateResult = await db.collection("indexFunds").updateOne(
      { _id: fund._id },
      {
        $inc: { cashAnchor: amount },
        $set: {
          quotedNav: newNav,
          backingRatio: backing.backingRatio,
          updatedAt: now,
        },
      }
    );

    if (updateResult.matchedCount === 0) {
      return NextResponse.json({ error: "Fund update failed" }, { status: 500 });
    }

    await insertFundTransaction(db, {
      fundId: fund._id,
      kind: "capital_injection",
      amountAnchor: amount,
      navAnchor: newNav,
      createdAt: now,
      note: `Admin capital injection by ${auth.admin.username}`,
    });

    await createAdminLog({
      category: "system",
      action: "index_fund_capital_injected",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: `Injected ${amount.toLocaleString()} ${fund.anchorCurrencyCode} into ${fund.slug}. NAV ${fund.quotedNav.toFixed(4)} → ${newNav.toFixed(4)}, backing ${(fund.backingRatio ?? 0).toFixed(4)} → ${backing.backingRatio.toFixed(4)}`,
    });

    return NextResponse.json({
      success: true,
      slug: fund.slug,
      amount,
      cashAnchor: newCashAnchor,
      quotedNav: newNav,
      backingRatio: backing.backingRatio,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
