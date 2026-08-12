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
  loadQueuedRedemptionLiabilityByFundId,
} from "@/lib/indexFunds/fundValuation";

const schema = z.object({
  /** Target backing ratio to top each fund up to. Default 1.0 (100%). */
  targetBackingRatio: z.number().finite().positive().max(5).optional(),
});

// POST /api/admin/investment-funds/inject-capital-all
// Tops every fund up to the target backing ratio (default 100%) by injecting
// anchor-currency cash without minting units. Funds already at/above target are
// skipped. Each fund's NAV and backing ratio are recomputed and persisted.
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

    const targetRatio = parsed.data.targetBackingRatio ?? 1.0;
    // Include paused/delisted funds — those are exactly the ones needing a top-up.
    const funds = await listFunds(db, {});
    const exchangeRates = await loadFxRatesRecord(db);
    const fundIds = funds.map((fund) => fund._id);
    const openOrdersEscrowByFundId = await loadOpenOrdersEscrowByFundId(db, fundIds);
    const queuedLiabilityByFundId = await loadQueuedRedemptionLiabilityByFundId(db, fundIds);

    const now = new Date();
    const results: {
      slug: string;
      ticker: string;
      anchorCurrencyCode: string;
      injected: number;
      backingRatio: number;
      skipped: boolean;
    }[] = [];
    const totalsByCurrency: Record<string, number> = {};
    let injectedCount = 0;

    // One turn read for the whole sweep rather than one per fund.
    const injectionTurn = await getCurrentTurn(db);
    for (const fund of funds) {
      const holdingsValueAnchor = computeHoldingsValueAnchor(fund);
      const bondPrincipalAnchor = await sumFundBondHoldingsValueAnchor(db, fund, exchangeRates);
      const openOrdersEscrowAnchor = openOrdersEscrowByFundId.get(fund._id.toString()) ?? 0;
      const queuedRedemptionLiabilityAnchor = queuedLiabilityByFundId.get(fund._id.toString()) ?? 0;
      const currentBacking =
        fund.cashAnchor +
        holdingsValueAnchor +
        bondPrincipalAnchor +
        openOrdersEscrowAnchor -
        queuedRedemptionLiabilityAnchor;
      const liability = fund.quotedNav * fund.unitSupply;
      const target = targetRatio * liability;
      const shortfall = target - currentBacking;

      // Nothing to do if already funded, or if the fund has no quoted liability
      // (e.g. NAV collapsed to ~0 — those need manual unit repair, not cash).
      if (!Number.isFinite(shortfall) || shortfall <= 0.01 || liability <= 0) {
        results.push({
          slug: fund.slug,
          ticker: fund.tickerSymbol,
          anchorCurrencyCode: fund.anchorCurrencyCode,
          injected: 0,
          backingRatio: fund.backingRatio ?? 1,
          skipped: true,
        });
        continue;
      }

      const amount = shortfall;
      const newCashAnchor = fund.cashAnchor + amount;
      const newNav =
        recomputeNav(
          { ...fund, cashAnchor: newCashAnchor },
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

      const updateResult = await db.collection("indexFunds").updateOne(
        { _id: fund._id },
        {
          $inc: { cashAnchor: amount },
          $set: { quotedNav: newNav, backingRatio: backing.backingRatio, updatedAt: now },
        }
      );
      if (updateResult.matchedCount === 0) continue;

      await emitFundAdminMintLeg(db, {
        fundId: fund._id,
        fundName: fund.name,
        fundSlug: fund.slug,
        amountAnchor: amount,
        currencyCode: fund.anchorCurrencyCode,
        adminName: auth.admin.username,
        turn: await getCurrentTurn(db),
        tool: "inject_capital_all",
      });

      await insertFundTransaction(db, {
        fundId: fund._id,
        kind: "capital_injection",
        amountAnchor: amount,
        navAnchor: newNav,
        createdAt: now,
        note: `Admin bulk capital injection by ${auth.admin.username} (target ${(targetRatio * 100).toFixed(0)}% backing)`,
      });

      totalsByCurrency[fund.anchorCurrencyCode] =
        (totalsByCurrency[fund.anchorCurrencyCode] ?? 0) + amount;
      injectedCount++;
      results.push({
        slug: fund.slug,
        ticker: fund.tickerSymbol,
        anchorCurrencyCode: fund.anchorCurrencyCode,
        injected: amount,
        backingRatio: backing.backingRatio,
        skipped: false,
      });
    }

    await createAdminLog({
      category: "system",
      action: "index_fund_capital_injected_bulk",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: `Bulk capital injection by ${auth.admin.username} to ${(targetRatio * 100).toFixed(0)}% backing — ${injectedCount} fund(s) topped up: ${Object.entries(
        totalsByCurrency
      )
        .map(([code, amt]) => `${amt.toLocaleString()} ${code}`)
        .join(", ")}`,
    });

    return NextResponse.json({
      success: true,
      targetBackingRatio: targetRatio,
      fundsProcessed: funds.length,
      fundsInjected: injectedCount,
      totalsByCurrency,
      results,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
