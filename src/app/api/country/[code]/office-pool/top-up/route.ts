// POST /api/country/[code]/office-pool/top-up
// Auth: requireHumanSessionWithCharacter; must hold the office whose pool is topped up.
// Spends OFFICE_POOL_TOP_UP_AP_COST main AP for +1 action in a ministerial,
// vice-president, Justice, or gubernatorial pool, once per pool per turn, never above cap.
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/currentTurn";
import { topUpOfficePool, type OfficePoolTarget } from "@/lib/actions/officePoolTopUp";

const bodySchema = z.discriminatedUnion("pool", [
  z.object({ pool: z.literal("ministerial"), positionId: z.string().min(1).max(120) }),
  z.object({ pool: z.literal("vp") }),
  z.object({ pool: z.literal("justice"), seatNumber: z.number().int().min(1).max(9) }),
  z.object({ pool: z.literal("gubernatorial"), stateId: z.string().min(1).max(40) }),
]);

function toTarget(body: z.infer<typeof bodySchema>, countryId: CountryId): OfficePoolTarget {
  switch (body.pool) {
    case "ministerial":
      return { kind: "ministerial", countryId, positionId: body.positionId };
    case "vp":
      return { kind: "vp", countryId };
    case "justice":
      return { kind: "justice", countryId, seatNumber: body.seatNumber };
    case "gubernatorial":
      return { kind: "gubernatorial", countryId, stateId: body.stateId };
  }
}

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const target = toTarget(parsed.data, countryId);

    const db = await getDb();
    const currentTurn = await getCurrentTurn(db);
    const result = await topUpOfficePool(db, auth.user.character._id, target, currentTurn);
    if (!result.ok) return errorResponse(result.status, result.error);

    return NextResponse.json({
      success: true,
      actionsRemaining: result.remaining,
      actionCap: result.cap,
      playerActions: result.actionsLeft,
      message: `Bought 1 office action. ${result.remaining}/${result.cap} available.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
