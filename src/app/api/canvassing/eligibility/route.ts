import { NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCanvassState, resolveRunningMateCanvassState } from "@/lib/canvassing/eligibility";

// GET /api/canvassing/eligibility — Returns the authenticated character's canvass target state, or a blocked reason.
// Auth: requireAuthWithCharacter
// Errors: 401
export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // A running mate on an active general-phase presidential ticket canvasses AS
    // a surrogate: their eligible state is the ticket's travel state, not their
    // own home / candidacy. Surface that branch first so the canvass panel
    // targets the ticket state (which routes the POST through the surrogate
    // pool). `needs_travel` means they are a running mate but the ticket has no
    // travel state set yet.
    const mate = await resolveRunningMateCanvassState(db, auth.user.character);
    if (mate.ok) {
      return NextResponse.json({ ok: true, stateId: mate.stateId, source: "runningMateSurrogate" });
    }
    if (mate.reason === "needs_travel") {
      return NextResponse.json({ ok: false, reason: "needs_travel" });
    }

    const eligibility = await resolveCanvassState(db, auth.user.character);
    return NextResponse.json(eligibility);
  } catch (error) {
    return handleRouteError(error);
  }
}
