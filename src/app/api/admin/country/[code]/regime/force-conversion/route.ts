/**
 * POST /api/admin/country/[code]/regime/force-conversion
 *
 * Admin-only escape hatch: fire `triggerSystemConversion` directly
 * with admin-supplied target system and legacy reservation. Bypasses
 * the convention / Stage-4 gates. Use for testing the post-conversion
 * shape OR for unsticking a stuck game state.
 *
 * Body: {
 *   targetSystem: GovernmentType (NOT "onePartyState" — conversion is one-way),
 *   legacyReservation: 0..35,
 *   path?: "voluntary" | "forced" (default "forced"),
 *   forcedVoteSharePenalty?: number,
 *   electionAtTurn?: number,
 * }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { triggerSystemConversion } from "@/lib/onePartyState/systemConversion";
import { getRegimeEscalationCollection } from "@/lib/db/collections/regimeEscalation";

const bodySchema = z.object({
  targetSystem: z.enum(["presidential", "parliamentaryMonarchy", "parliamentaryRepublic"]),
  legacyReservation: z.number().int().min(0).max(35),
  path: z.enum(["voluntary", "forced"]).optional(),
  forcedVoteSharePenalty: z.number().optional(),
  electionAtTurn: z.number().int().nonnegative().optional(),
});

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const currentTurn = await getCurrentTurn(db);

    await triggerSystemConversion(db, countryId, currentTurn, {
      targetSystem: parsed.data.targetSystem,
      legacyReservation: parsed.data.legacyReservation,
      path: parsed.data.path ?? "forced",
      forcedVoteSharePenalty: parsed.data.forcedVoteSharePenalty,
      electionAtTurn: parsed.data.electionAtTurn ?? currentTurn,
    });

    // Clean up any in-flight convention + decision-queue state so the
    // post-conversion regime row doesn't carry orphaned references to
    // the (now-irrelevant) OPS mechanics. Per-turn drivers gate on
    // governmentType so they wouldn't tick this anyway, but the
    // leader-API still reads + surfaces these fields.
    await getRegimeEscalationCollection(db).findOneAndUpdate(
      { _id: countryId },
      {
        $unset: { convention: "", conversionPendingAtTurn: "", stage4Delay: "" },
        $set: {
          conventionInProgress: false,
          activeDecision: null,
          decisionQueue: [],
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      ok: true,
      countryId,
      targetSystem: parsed.data.targetSystem,
      atTurn: currentTurn,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
