import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { signCharter } from "@/lib/charters/signCharter";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/charters/[id]/sign — Records the caller's signature on the
 * founder slot bound to their **active character**. Idempotent:
 * re-signing returns the current signature count. Triggers ratification
 * when 3-of-3 sign.
 *
 * To sign as a different character, switch the active character first
 * (the standard multi-character UX).
 *
 * Auth: requireAuthWithCharacter
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(`charter-sign:${auth.user.userId}`, 10, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid charter ID" }, { status: 400 });
    }

    const db = await getDb();
    const result = await signCharter(
      new ObjectId(id),
      auth.user.character._id,
      new ObjectId(auth.user.userId),
      db
    );

    if (!result.ok) {
      const status = result.reason === "charter-not-found" ? 404 : 400;
      const message =
        result.reason === "charter-not-found"
          ? "Charter not found"
          : result.reason === "not-signable"
            ? "Charter is not in a signable state"
            : result.reason === "not-a-founder"
              ? "Your active character is not listed as a founder on this charter"
              : result.reason === "not-character-owner"
                ? "Active character mismatch — re-authenticate and try again"
                : "Your active character has already rejected this charter";
      return NextResponse.json({ error: message, reason: result.reason }, { status });
    }

    return NextResponse.json({
      ok: true,
      ratified: result.ratified,
      signedCount: result.signedCount,
      requiredCount: result.requiredCount,
      ratifiedPartyId: result.ratifiedPartyId,
      bannedAtCreation: result.bannedAtCreation ?? false,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
