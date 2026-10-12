import { withNoStore } from "@/lib/api/withNoStore";
import { getAuthUser } from "@/lib/auth";
import { fundCreationEligibility } from "@/lib/indexFunds/sponsorship/eligibility";
import type { Corporation } from "@/lib/db/types";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireCeo, resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { listFundsBySponsor } from "@/lib/indexFunds/fundQueries";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/corporations/[id]/funds - Index funds this corporation sponsors.
// Public listing (fund existence is public). Fixes ticket 1088: a chartered
// fund was invisible to its owner after the charter session.
// Errors: 404
export const GET = withNoStore(async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;

    const auth = await getAuthUser();
    const sponsor = resolved.corporation;
    const canCreate =
      !!auth && !requireCeo(sponsor, auth.userId) && !(await fundCreationEligibility(db, sponsor));
    const stockChoices =
      canCreate && sponsor.bankCharter
        ? await db
            .collection<Corporation>("corporations")
            .find(
              {
                countryId: sponsor.countryId,
                isPrivate: { $ne: true },
                hiddenFromExchange: { $ne: true },
                isNationalized: { $ne: true },
                countryOwnerId: { $exists: false },
                sharePrice: { $gt: 0 },
                totalShares: { $gt: 0 },
                liquidCapital: { $gte: 0 },
                userId: { $ne: sponsor.userId },
                _id: { $ne: sponsor._id },
              },
              { projection: { name: 1, tickerSymbol: 1, sharePrice: 1 } }
            )
            .sort({ name: 1 })
            .toArray()
        : [];
    const funds = await listFundsBySponsor(db, resolved.corporation._id);
    const response = NextResponse.json({
      canCreate,
      countryId: sponsor.countryId ?? null,
      stockChoices: stockChoices
        .filter((c) => Number.isFinite(c.sharePrice))
        .map((c) => ({ id: String(c._id), name: c.name, ticker: c.tickerSymbol })),
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
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
});
