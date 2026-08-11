import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { deleteReceivedMail, markReceivedMailRead } from "@/lib/mail/commands/playerMail";

// PATCH /api/mail/[id] — Marks a received mail as read for the authenticated recipient
// Auth: requireAuthWithCharacter
// Errors: 401, 404, 429
export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const { id } = await params;
    await markReceivedMailRead(db, auth.user.userId, id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}

// DELETE /api/mail/[id] — Soft-deletes a received mail from the recipient's inbox
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
    await deleteReceivedMail(db, auth.user.userId, id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
