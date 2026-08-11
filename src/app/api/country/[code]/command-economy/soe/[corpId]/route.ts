// POST /api/country/[code]/command-economy/soe/[corpId]
// Command Economy v2 (P2) — the SOE Director operates their enterprise: sets a
// production target (within a band of the plan quota), the labour-vs-quality
// tradeoff, and an investment request to Gosbank. Writes soe.planTarget and
// soe.directive on the corp.
// Auth: only the character who holds this SOE's directorId. Errors: 401/403/404/429.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { forbidden, handleRouteError, notFound } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { Corporation } from "@/lib/db/types/corporation";
import {
  LABOR_QUALITY_RANGE,
  MAX_PLAN_TARGET_CAPACITY_MULTIPLE,
  clampRange,
} from "@/lib/constants/commandEconomyOffices";
import { isSoeDirector } from "@/lib/economy/commandEconomyAuth";
import { resolveWriteContext } from "@/lib/economy/queries/commandEconomyWriteContext";

interface RouteContext {
  params: Promise<{ code: string; corpId: string }>;
}

const schema = z.object({
  planTarget: z.number().min(0).max(1e15).optional(),
  laborQuality: z.number().min(0).max(1).optional(),
  investmentRequest: z.number().min(0).max(1e15).optional(),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const { code, corpId } = await context.params;
    const setup = await resolveWriteContext(code);
    if (!setup.ok) return setup.response;
    const { db, countryId, characterId, currentTurn } = setup.ctx;

    if (!ObjectId.isValid(corpId)) {
      return NextResponse.json(notFound("Enterprise not found").toJson(), { status: 404 });
    }
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne(
        { _id: new ObjectId(corpId), countryId, soe: { $exists: true } },
        { projection: { _id: 1, soe: 1 } }
      );
    if (!corp?.soe) {
      return NextResponse.json(notFound("Enterprise not found").toJson(), { status: 404 });
    }

    if (!isSoeDirector(corp.soe.directorId, characterId)) {
      return NextResponse.json(
        forbidden("Only the appointed director can operate this enterprise.").toJson(),
        { status: 403 }
      );
    }

    const rate = checkRateLimit(String(characterId), 20, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const set: Record<string, unknown> = { "soe.directive.setOnTurn": currentTurn };
    if (parsed.data.planTarget != null) {
      const cap = corp.soe.capacity ?? 0;
      const ceiling = cap > 0 ? cap * MAX_PLAN_TARGET_CAPACITY_MULTIPLE : parsed.data.planTarget;
      set["soe.planTarget"] = Math.round(Math.max(0, Math.min(ceiling, parsed.data.planTarget)));
    }
    if (parsed.data.laborQuality != null) {
      set["soe.directive.laborQuality"] = clampRange(parsed.data.laborQuality, LABOR_QUALITY_RANGE);
    }
    if (parsed.data.investmentRequest != null) {
      set["soe.directive.investmentRequest"] = Math.max(
        0,
        Math.round(parsed.data.investmentRequest)
      );
    }

    await db
      .collection<Corporation>("corporations")
      .updateOne({ _id: new ObjectId(corpId) }, { $set: set });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
