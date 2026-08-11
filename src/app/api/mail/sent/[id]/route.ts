import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { deleteSentMail } from "@/lib/mail/commands/playerMail";

// DELETE /api/mail/sent/[id] — Soft-deletes a sent message from the sender's sent box
// Auth: requireAuthWithCharacter
// Errors: 401, 404, 429
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const { id } = await params;
    await deleteSentMail(db, auth.user.character._id, id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
