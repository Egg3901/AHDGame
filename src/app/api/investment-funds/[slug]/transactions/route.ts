import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { isIndexFundsEnabled, INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import { resolveFundBySlugOrId, listFundTransactions } from "@/lib/indexFunds/fundQueries";

// GET /api/investment-funds/[slug]/transactions — recent fund transactions for income-statement display
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return NextResponse.json({ error: INDEX_FUNDS_DISABLED_MESSAGE }, { status: 403 });
    }

    const { slug } = await params;
    const fund = await resolveFundBySlugOrId(db, slug);
    if (!fund) throw notFound("Fund not found");

    const transactions = await listFundTransactions(db, fund._id, 200);

    return NextResponse.json({
      fundId: fund.slug,
      anchorCurrencyCode: fund.anchorCurrencyCode,
      transactions: transactions.map((tx) => ({
        id: tx._id.toString(),
        kind: tx.kind,
        turn: tx.turn ?? null,
        amountAnchor: tx.amountAnchor,
        navAnchor: tx.navAnchor ?? null,
        units: tx.units ?? null,
        shares: tx.shares ?? null,
        corporationId: tx.corporationId?.toString() ?? null,
        note: tx.note ?? null,
        createdAt: tx.createdAt,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
