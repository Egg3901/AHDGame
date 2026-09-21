import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { addOperatingModelSchema } from "@/lib/api/schemas/corporations";
import { parseJsonBody } from "@/lib/api/validate";
import { getCurrentTurn } from "@/lib/currentTurn";
import { MEDIA_OPERATING_MODELS } from "@/lib/products/types";
import { isCorporationProductsEnabled } from "@/lib/products/featureFlag";
import { addOperatingModelPersistent } from "@/lib/products/persistence";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/corporations/[id]/operating-models — Attach a Media and
// Entertainment operating model. A corporation may own several; re-adding an
// owned model is an idempotent success.
// Auth: CEO only. Errors: 400, 401, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, addOperatingModelSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!(await isCorporationProductsEnabled(db))) {
      return NextResponse.json(
        { error: "Corporation products are not enabled in this world" },
        { status: 403 }
      );
    }

    const result = await addOperatingModelPersistent(db, {
      enabled: true,
      corporationId: corporation._id.toString(),
      operatingModel: parsed.data.operatingModel,
      turn: await getCurrentTurn(db),
    });
    if (!result.ok) {
      if (result.reason === "unknown_operating_model") {
        return NextResponse.json(
          {
            error: `Unknown operating model "${parsed.data.operatingModel}"`,
            legalOperatingModels: [...MEDIA_OPERATING_MODELS],
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: "Could not add this operating model" }, { status: 400 });
    }

    return NextResponse.json(
      {
        success: true,
        model: {
          operatingModel: result.model.operatingModel,
          acquiredTurn: result.model.acquiredTurn,
        },
        ...(result.idempotent ? { idempotent: true } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
