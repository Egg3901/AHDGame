import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { setSectorDisplayNameSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { CorporateSector } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

export async function renameSector(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const parsed = await parseJsonBody(request, setSectorDisplayNameSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const sector = await db.collection<CorporateSector>("corporateSectors").findOne({
      _id: new ObjectId(sectorId),
      corporationId: corporation._id,
    });
    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    const trimmedName = parsed.data.displayName?.trim() ?? "";

    const update: Parameters<ReturnType<typeof db.collection<CorporateSector>>["updateOne"]>[1] =
      trimmedName
        ? {
            $set: {
              displayName: trimmedName,
              updatedAt: new Date(),
            },
          }
        : {
            $set: {
              updatedAt: new Date(),
            },
            $unset: {
              displayName: 1,
            },
          };

    await db.collection<CorporateSector>("corporateSectors").updateOne({ _id: sector._id }, update);

    return NextResponse.json({
      success: true,
      displayName: trimmedName || null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
