import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { withNoStore } from "@/lib/api/withNoStore";
import { handleRouteError } from "@/lib/api/errors";
import { getSentMailPage } from "@/lib/mail/queries/playerMail";

// GET /api/mail/sent — Returns the authenticated character's paginated sent mail
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
    return NextResponse.json(await getSentMailPage(db, auth.user.character._id, offset, limit));
  } catch (err) {
    return handleRouteError(err);
  }
});
