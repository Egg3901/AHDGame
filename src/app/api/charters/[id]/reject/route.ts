import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { rejectCharterSchema } from "@/lib/api/schemas/charters";
import { rejectCharter } from "@/lib/charters/rejectCharter";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/charters/[id]/reject — Records the caller's rejection on the
 * founder slot bound to their **active character**, transitions the
 * charter to `founder-replacement` with a fresh deadline.
 *
 * Auth: requireAuthWithCharacter
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(`charter-reject:${auth.user.userId}`, 10, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid charter ID" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, rejectCharterSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await rejectCharter(
      new ObjectId(id),
      auth.user.character._id,
      new ObjectId(auth.user.userId),
      parsed.data.reason,
      db
    );

    if (!result.ok) {
      const status = result.reason === "charter-not-found" ? 404 : 400;
      const message =
        result.reason === "charter-not-found"
          ? "Charter not found"
          : result.reason === "not-rejectable"
            ? "Charter is not in a rejectable state"
            : result.reason === "not-a-founder"
              ? "Your active character is not listed as a founder on this charter"
              : result.reason === "not-character-owner"
                ? "Active character mismatch — re-authenticate and try again"
                : "Your active character has already signed this charter";
      return NextResponse.json({ error: message, reason: result.reason }, { status });
    }

    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
