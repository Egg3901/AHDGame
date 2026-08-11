import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { Corporation } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/ceo/resign
 * Current CEO resigns from the position. Leaves it vacant.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // Only the current CEO can resign
    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (corporation.ceoVacant) {
      return NextResponse.json({ error: "CEO position is already vacant" }, { status: 400 });
    }

    const now = new Date();

    await db.collection<Corporation>("corporations").updateOne(
      { _id: corporation._id },
      {
        $set: {
          ceoVacant: true,
          updatedAt: now,
        },
        $unset: { pendingCeoCharacterId: "" },
      }
    );

    // Clear all CEO votes so the election starts fresh
    await db.collection("corporationCeoVotes").deleteMany({
      corporationId: corporation._id,
    });

    if (corporation.ceoId) {
      await closeCeoTenure(db, corporation._id, {
        holderId: corporation.ceoId,
        turn: await getCurrentTurn(db),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
