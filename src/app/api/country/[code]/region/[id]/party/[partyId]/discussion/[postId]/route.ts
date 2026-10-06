import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireModerator } from "@/lib/api/requireModerator";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { PartyDiscussionPost } from "@/lib/db/types";

// DELETE /api/country/[code]/region/[id]/party/[partyId]/discussion/[postId]
// Auth: mod or admin only
// Errors: 400, 403, 404

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string; postId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { code, partyId, postId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    if (!ObjectId.isValid(postId)) {
      return errorResponse(400, "Invalid post ID");
    }

    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;
    if (!character) return errorResponse(403, "Character required");

    const db = await getDb();
    const col = db.collection<PartyDiscussionPost>("partyDiscussionPosts");
    const post = await col.findOne({ _id: new ObjectId(postId), countryId, partyId });

    if (!post || post.deletedAt) {
      return errorResponse(404, "Post not found");
    }

    await col.updateOne(
      { _id: new ObjectId(postId), countryId, partyId },
      { $set: { deletedAt: new Date(), deletedBy: character._id } }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
