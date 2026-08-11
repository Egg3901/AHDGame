import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { loadLatestWatchtowerSection } from "@/lib/ledger/report";
import { LEDGER_RECONCILIATIONS_COLLECTION } from "@/lib/ledger/reconcile";
import type { LedgerReconciliation } from "@/lib/ledger/types";

/**
 * Shadow-ledger reconciliation feed for the ops-dashboard Watchtower / daily
 * report (see docs/plans/2026-07-05-shadow-ledger-plan.md §2.4). Returns the
 * latest reconciliation rendered as a green/amber/red section plus a short
 * trend of recent runs. Admin-only.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const trendLimit = Math.min(Number(url.searchParams.get("trend") ?? "30") || 30, 200);

    const db = await getDb();
    const section = await loadLatestWatchtowerSection(db);

    const trend = await db
      .collection<LedgerReconciliation>(LEDGER_RECONCILIATIONS_COLLECTION)
      .find(
        {},
        {
          projection: {
            turn: 1,
            status: 1,
            entriesChecked: 1,
            "trialBalance.unbalancedCount": 1,
            "stockVsFlow.divergentCount": 1,
            generatedAt: 1,
          },
          sort: { turn: -1 },
          limit: trendLimit,
        }
      )
      .toArray();

    return NextResponse.json({ section, trend });
  } catch (error) {
    return handleRouteError(error, {
      request,
      route: "GET /api/admin/ledger/reconciliation",
    });
  }
}
