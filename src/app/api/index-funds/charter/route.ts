// POST /api/index-funds/charter — a finance corporation charters a sponsored fund (A5).
// Auth: requireBasicAuth, CEO of the sponsoring corporation
// Errors: 400, 401, 403, 404, 409, 429

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { corporationQueryFromParamId, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { Corporation } from "@/lib/db/types";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isIndexFundsEnabled } from "@/lib/indexFunds/featureFlag";
import { charterFund } from "@/lib/indexFunds/sponsorship/charterFund";
import { INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/fundCron";

const schema = z.object({
  sponsorCorporationId: z.string(),
  name: z.string().trim().min(4).max(60),
  tickerSymbol: z.string().trim().min(3).max(8),
  scope: z.enum(["country", "global"]),
  countryId: z.string().optional(),
  kind: z.enum(["broad", "sector"]),
  sectorType: z.string().optional(),
  expenseRatioAnnual: z.number(),
  seedCapitalAnchor: z.number(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`fund-charter:${auth.user.userId}`, 5, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    if (!(await isIndexFundsEnabled()))
      return NextResponse.json({ error: INDEX_FUNDS_DISABLED_MESSAGE }, { status: 403 });

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const body = parsed.data;

    if (body.countryId && !COUNTRY_CONFIGS[body.countryId as never])
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    if (body.sectorType && !CORPORATION_TYPES.includes(body.sectorType as never))
      return NextResponse.json({ error: "Unknown industry" }, { status: 400 });

    const query = corporationQueryFromParamId(body.sponsorCorporationId);
    if (!query) return NextResponse.json({ error: "Invalid corporation id" }, { status: 400 });
    const sponsor = await db.collection<Corporation>("corporations").findOne(query);
    if (!sponsor) return NextResponse.json({ error: "Corporation not found" }, { status: 404 });

    const ceoCheck = requireCeo(sponsor, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const result = await charterFund(db, {
      sponsor,
      name: body.name,
      tickerSymbol: body.tickerSymbol,
      scope: body.scope,
      ...(body.countryId ? { countryId: body.countryId as never } : {}),
      kind: body.kind,
      ...(body.sectorType ? { sectorType: body.sectorType as never } : {}),
      expenseRatioAnnual: body.expenseRatioAnnual,
      seedCapitalAnchor: body.seedCapitalAnchor,
      currentTurn: await getCurrentTurn(db),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({
      success: true,
      fundId: result.fundId.toString(),
      slug: result.slug,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
