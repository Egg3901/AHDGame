import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getAuthUser } from "@/lib/auth";
import { shouldRedactCorporation } from "@/lib/corporations/redaction";
import { getRoundedPublicMarketCap } from "@/lib/corporations/marketQuote";
import { loadCorporationHistoryComparePoints } from "@/lib/corporations/queries/corporationHistoryCompare";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/corporations/[id]/history/compare — per-turn snapshots reduced to the
// five compare metrics (revenue, net income, market cap, share price, liquid
// capital), most-recent turns ascending. Powers the Snapshot compare table
// (suggestion #97). Read-only; no writes.
// Auth: public (private corps' financial history redacted from non-CEO viewers).
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // Fog of war: private corps disclose no historical financials to non-CEO
    // viewers — return an empty set so the tab renders its "not disclosed" note.
    const authUser = await getAuthUser().catch(() => null);
    const modViewEnabled =
      !authUser?.isAdmin &&
      authUser?.isModerator === true &&
      new URL(request.url).searchParams.get("modView") === "1";
    if (
      shouldRedactCorporation(
        corporation,
        authUser?.userId,
        authUser?.isAdmin === true,
        modViewEnabled
      )
    ) {
      return NextResponse.json(
        { points: [], isPrivate: true },
        {
          headers: {
            "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
          },
        }
      );
    }

    const data = await loadCorporationHistoryComparePoints({ db, corporation });

    // Mirror the /history route (#963): the newest snapshot's market cap freezes
    // at last turn-processing time and can disagree with the live Overview card
    // (getRoundedPublicMarketCap, recomputed from the live corp each request).
    // Overwrite just the latest point's market cap with that live figure and
    // stamp the corp's current currency (dropping fxRateAtWrite so the client
    // converts this one live-valued point at the live rate), so the "now" column
    // agrees with the header. Older points stay frozen snapshots.
    const latest = data.points[data.points.length - 1];
    if (latest) {
      latest.marketCap = getRoundedPublicMarketCap(corporation, corporation.totalShares ?? 0);
      latest.currencyCode = corporation.liquidCurrencyCode;
      delete latest.fxRateAtWrite;
      data.currencyCode = corporation.liquidCurrencyCode ?? data.currencyCode;
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
