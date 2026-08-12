// POST /api/index-funds/[slug]/wind-up — the sponsor closes a fund it charters (A5).
// Auth: requireBasicAuth, CEO of the sponsoring corporation
// Errors: 400, 401, 403, 404, 409, 429

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";
import { resolveFundBySlugOrId } from "@/lib/indexFunds/fundQueries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { beginWindUp } from "@/lib/indexFunds/sponsorship/windUp";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`fund-windup:${auth.user.userId}`, 5, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { slug } = await params;
    const db = await getDb();
    const fund = await resolveFundBySlugOrId(db, slug);
    if (!fund) return NextResponse.json({ error: "Fund not found" }, { status: 404 });

    if (!fund.sponsorCorporationId)
      return NextResponse.json(
        { error: "This is a system fund. It has no sponsor and cannot be wound up." },
        { status: 400 }
      );

    const sponsor = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: fund.sponsorCorporationId });
    if (!sponsor || !sponsor.userId || sponsor.userId.toString() !== auth.user.userId)
      return NextResponse.json(
        { error: "Only the sponsoring corporation's CEO can wind up this fund." },
        { status: 403 }
      );

    const result = await beginWindUp(db, fund, await getCurrentTurn(db));
    if (!result.ok)
      return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({
      success: true,
      status: result.status,
      message:
        "Wind-up has begun. The fund will sell its holdings over the coming turns, pay every unit holder at the final value, and return what remains of the seed capital to the sponsor.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
