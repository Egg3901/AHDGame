import { NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCanvassState } from "@/lib/canvassing/eligibility";

// GET /api/canvassing/eligibility — Returns the authenticated character's canvass target state, or a blocked reason.
// Auth: requireAuthWithCharacter
// Errors: 401
export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const eligibility = await resolveCanvassState(db, auth.user.character);

    return NextResponse.json(eligibility);
  } catch (error) {
    return handleRouteError(error);
  }
}
