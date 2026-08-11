import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { isIndexFundsEnabled, INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import {
  resolveFundBySlugOrId,
  listFundPositions,
  listPendingRedemptions,
} from "@/lib/indexFunds/fundQueries";
import { enrichFundPositions } from "@/lib/indexFunds/fundHolderEnrichment";

// GET /api/investment-funds/[slug]/holders — Unit holders (NPP transparency + player breakdown)
// Auth: requireAuth — exposes per-player positions and queued redemptions.
// Errors: 401, 403, 404
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return NextResponse.json({ error: INDEX_FUNDS_DISABLED_MESSAGE }, { status: 403 });
    }

    const { slug } = await params;
    const fund = await resolveFundBySlugOrId(db, slug);
    if (!fund) throw notFound("Fund not found");

    const positions = await listFundPositions(db, fund._id);
    const holders = await enrichFundPositions(db, positions, fund.quotedNav);

    const byKind = {
      players: holders.filter((h) => h.holderKind === "character"),
      npps: holders.filter((h) => h.holderKind === "npp"),
      imperial: holders.filter((h) => h.holderKind === "imperial_character"),
      reserve: holders.filter((h) => h.holderKind === "fund_reserve"),
    };

    const queued = await listPendingRedemptions(db, fund._id);

    return NextResponse.json({
      fundId: fund.slug,
      quotedNav: fund.quotedNav,
      holders,
      byKind,
      queuedRedemptions: queued.map((q) => ({
        id: q._id.toString(),
        holderKind: q.holderKind,
        characterId: q.characterId?.toString() ?? null,
        nppId: q.nppId?.toString() ?? null,
        units: q.units,
        requestedAmountAnchor: q.requestedAmountAnchor,
        paidAmountAnchor: q.paidAmountAnchor,
        status: q.status,
        createdAt: q.createdAt,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
