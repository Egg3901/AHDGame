import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter, type AuthUserWithCharacter } from "@/lib/auth"; // Optional auth - intentionally uses getAuthUserWithCharacter()
import { handleRouteError } from "@/lib/api/errors";
import { getCampaignDetail } from "@/lib/campaigns/queries/campaignQueries";
import { ObjectId } from "mongodb";
import { conditionalJson } from "@/lib/api/conditionalJson";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/campaigns/[id] - Returns campaign details with access-level-appropriate fog of war applied.
// Auth: public
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    if (!ObjectId.isValid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    // Auth is optional - public can view with fog of war.
    let user: AuthUserWithCharacter | null = null;
    try {
      user = await getAuthUserWithCharacter();
    } catch {
      // Not authenticated - will see public fog of war.
    }

    const db = await getDb();
    const campaign = await getCampaignDetail(db, new ObjectId(campaignId), user);
    // Per-user (fog-of-war applied per campaign relationship) and reactive to the
    // user's own spends — ETag/304 keeps it live while skipping unchanged bytes.
    return conditionalJson(request, { campaign });
  } catch (error) {
    return handleRouteError(error);
  }
}
