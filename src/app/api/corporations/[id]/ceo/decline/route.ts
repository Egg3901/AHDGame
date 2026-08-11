import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import type { Corporation } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/ceo/decline
 * Decline the CEO offer. Position remains vacant. User must be the pending CEO candidate.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    if (!corporation.pendingCeoCharacterId) {
      return NextResponse.json(
        { error: "No CEO offer is pending for this corporation" },
        { status: 400 }
      );
    }

    const myChar = auth.user.character;

    // Verify this user is the one being offered the position
    if (corporation.pendingCeoCharacterId.toString() !== myChar._id.toString()) {
      return NextResponse.json(
        { error: "You have not been offered the CEO position" },
        { status: 403 }
      );
    }

    // Clear pending offer.
    // Only mark the seat vacant if it was already vacant before the offer.
    // If the current CEO declines a re-election offer, the seat stays filled.
    const wasAlreadyVacant = corporation.ceoVacant === true;
    await db.collection<Corporation>("corporations").updateOne(
      { _id: corporation._id },
      {
        $set: {
          ...(wasAlreadyVacant ? { ceoVacant: true } : {}),
          updatedAt: new Date(),
        },
        $unset: { pendingCeoCharacterId: "" },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
