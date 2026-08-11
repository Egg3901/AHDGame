import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUserWithCharacter()
import { handleRouteError } from "@/lib/api/errors";
import { getViewerCampaigns } from "@/lib/campaigns/queries/campaignQueries";

/**
 * Lightweight endpoint for navbar: returns the user's own campaign and
 * their party's campaign (if different) for the active presidential election.
 */
// GET /api/campaigns/mine — Returns the current user's own campaign and their party's campaign for the active election.
// Auth: public
// Errors: 400
export async function GET() {
  try {
    const user = await getAuthUserWithCharacter();
    const db = await getDb();
    const campaigns = await getViewerCampaigns(db, user);
    return NextResponse.json(campaigns);
  } catch (error) {
    return handleRouteError(error);
  }
}
