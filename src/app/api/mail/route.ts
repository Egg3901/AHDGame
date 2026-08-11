import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { withNoStore } from "@/lib/api/withNoStore";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { sendPlayerMail } from "@/lib/mail/commands/playerMail";
import { getInboxMailPage } from "@/lib/mail/queries/playerMail";

const sendMailSchema = z.object({
  toCharacterId: schemas.objectId,
  subject: z.string().min(1).max(80),
  body: z.string().min(1).max(1000),
});

// GET /api/mail — Returns the authenticated character's paginated inbox with unread count
// Auth: requireAuthWithCharacter
// Errors: 401
export const GET = withNoStore(async (request: Request) => {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const offsetRaw = Number.parseInt(searchParams.get("offset") ?? "0", 10);
    const limitRaw = Number.parseInt(searchParams.get("limit") ?? "20", 10);
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 20;

    const db = await getDb();
    return NextResponse.json(
      await getInboxMailPage(db, new ObjectId(auth.user.userId), offset, limit)
    );
  } catch (err) {
    return handleRouteError(err);
  }
});

// POST /api/mail — Sends a mail message from the authenticated character to another character
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404, 429
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, sendMailSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { character } = auth.user;

    const rateCheck = checkRateLimit(character._id.toString(), 1, 60_000);
    if (!rateCheck.ok) return rateLimitResponse(rateCheck.retryAfter);

    const db = await getDb();
    await sendPlayerMail(
      db,
      character,
      parsed.data.toCharacterId,
      parsed.data.subject,
      parsed.data.body
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
