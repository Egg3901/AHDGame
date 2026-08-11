import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { reportReceivedMail } from "@/lib/mail/commands/playerMail";

// POST /api/mail/[id]/report — Reports a received mail to admins (recipient only, one report per mail)
// Auth: requireAuthWithCharacter
// Errors: 401, 403, 409, 429
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const { id } = await params;
    await reportReceivedMail(db, auth.user.userId, id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
