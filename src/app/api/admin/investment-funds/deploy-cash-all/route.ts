import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import { isIndexFundsEnabled, INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import { listFunds, insertFundTransaction } from "@/lib/indexFunds/fundQueries";
import { calculateBackingRatio } from "@/lib/indexFunds/unitAccounting";
import { recomputeNav } from "@/lib/indexFunds/fundCron";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import { createAdminLog } from "@/lib/adminLog";
import { emitFundAdminMintLeg } from "@/lib/indexFunds/adminMintLedger";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { sumFundBondHoldingsValueAnchor } from "@/lib/bonds/fundBondHoldings";
import { loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import {
  loadOpenOrdersEscrowByFundId,
  loadQueuedRedemptionUnitsByFundId,
} from "@/lib/indexFunds/fundValuation";

const schema = z.object({
  /** Flat anchor-currency cash amount to inject into every active fund as deployable buying power. */
  amountAnchor: z.number().finite().positive(),
});

// POST /api/admin/investment-funds/deploy-cash-all
// Injects a flat deployable cash amount into every ACTIVE fund without minting units.
// Unlike inject-capital-all (which tops funds to a target backing ratio), this
// unconditionally adds buying power to every active fund. NAV and backing ratio
// are recomputed and persisted after injection.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return NextResponse.json({ error: INDEX_FUNDS_DISABLED_MESSAGE }, { status: 403 });
    }

    const { amountAnchor } = parsed.data;
    const funds = await listFunds(db, { status: "active" });
    const exchangeRates = await loadFxRatesRecord(db);
    const fundIds = funds.map((fund) => fund._id);
    const openOrdersEscrowByFundId = await loadOpenOrdersEscrowByFundId(db, fundIds);
    const queuedUnitsByFundId = await loadQueuedRedemptionUnitsByFundId(db, fundIds);

    const now = new Date();
    const results: {
      slug: string;
      ticker: string;
      anchorCurrencyCode: string;
      injected: number;
      backingRatio: number;
    }[] = [];
    const totalsByCurrency: Record<string, number> = {};
    let injectedCount = 0;

    for (const fund of funds) {
      const holdingsValueAnchor = computeHoldingsValueAnchor(fund);
      const bondPrincipalAnchor = await sumFundBondHoldingsValueAnchor(db, fund, exchangeRates);
      const openOrdersEscrowAnchor = openOrdersEscrowByFundId.get(fund._id.toString()) ?? 0;
      const queuedRedemptionUnits = queuedUnitsByFundId.get(fund._id.toString()) ?? 0;
      const newCashAnchor = fund.cashAnchor + amountAnchor;
      const newNav =
        recomputeNav(
          { ...fund, cashAnchor: newCashAnchor },
          { bondPrincipalAnchor, openOrdersEscrowAnchor, queuedRedemptionUnits }
        ) ?? fund.quotedNav;
      const backing = calculateBackingRatio({
        cashAnchor: newCashAnchor,
        holdingsValueAnchor,
        bondPrincipalAnchor,
        openOrdersEscrowAnchor,
        queuedRedemptionUnits,
        quotedNav: newNav,
        unitSupply: fund.unitSupply,
      });

      const updateResult = await db.collection("indexFunds").updateOne(
        { _id: fund._id },
        {
          $inc: { cashAnchor: amountAnchor },
          $set: { quotedNav: newNav, backingRatio: backing.backingRatio, updatedAt: now },
        }
      );
      if (updateResult.matchedCount === 0) continue;

      await emitFundAdminMintLeg(db, {
        fundId: fund._id,
        fundName: fund.name,
        fundSlug: fund.slug,
        amountAnchor: amountAnchor,
        currencyCode: fund.anchorCurrencyCode,
        adminName: auth.admin.username,
        turn: await getCurrentTurn(db),
        tool: "deploy_cash_all",
      });

      await insertFundTransaction(db, {
        fundId: fund._id,
        kind: "capital_injection",
        amountAnchor,
        navAnchor: newNav,
        createdAt: now,
        note: `Admin bulk deployable cash by ${auth.admin.username} (${amountAnchor.toLocaleString()} ${fund.anchorCurrencyCode})`,
      });

      totalsByCurrency[fund.anchorCurrencyCode] =
        (totalsByCurrency[fund.anchorCurrencyCode] ?? 0) + amountAnchor;
      injectedCount++;
      results.push({
        slug: fund.slug,
        ticker: fund.tickerSymbol,
        anchorCurrencyCode: fund.anchorCurrencyCode,
        injected: amountAnchor,
        backingRatio: backing.backingRatio,
      });
    }

    await createAdminLog({
      category: "system",
      action: "index_fund_deployable_cash_bulk",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: `Bulk deployable cash injection by ${auth.admin.username} — ${amountAnchor.toLocaleString()} per fund, ${injectedCount} fund(s) injected: ${Object.entries(
        totalsByCurrency
      )
        .map(([code, amt]) => `${amt.toLocaleString()} ${code}`)
        .join(", ")}`,
    });

    return NextResponse.json({
      success: true,
      amountAnchor,
      fundsProcessed: funds.length,
      fundsInjected: injectedCount,
      totalsByCurrency,
      results,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
