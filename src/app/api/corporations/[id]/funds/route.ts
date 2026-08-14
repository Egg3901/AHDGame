import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { listFundsBySponsor } from "@/lib/indexFunds/fundQueries";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/corporations/[id]/funds — Index funds this corporation sponsors.
// Public listing (fund existence is public). Fixes ticket 1088: a chartered
// fund was invisible to its owner after the charter session.
// Errors: 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;

    const funds = await listFundsBySponsor(db, resolved.corporation._id);
    return NextResponse.json({
      funds: funds.map((f) => ({
        id: f._id.toString(),
        slug: f.slug,
        name: f.name,
        ticker: f.tickerSymbol,
        status: f.status,
        scope: f.scope,
        kind: f.kind,
        countryId: f.countryId ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
