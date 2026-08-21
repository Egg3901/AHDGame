import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { loadGermanQuestionDossier } from "@/lib/settlement/queries/dossier";

// GET /api/world/german-question - The dossier read model for the current viewer.
// Auth: requireAuthWithCharacter
// Errors: 401, 404
//
// The lighter guard than the sibling POST is deliberate: this reads, it does not
// spend, so it needs neither the same-origin assertion nor the bot-token
// rejection that guarding a national treasury requires. No rate limit either —
// read-only and bounded by one crisis document.
export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const view = await loadGermanQuestionDossier(db, auth.user.character._id);
    // Null covers both "the feature is off" and "no crisis is open"; neither is
    // an error, but neither has a board to render.
    if (!view) throw notFound("No settlement crisis is open.");

    return NextResponse.json({ view });
  } catch (error) {
    return handleRouteError(error);
  }
}
