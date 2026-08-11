import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireModerator } from "@/lib/api/requireModerator";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { PartyDiscussionPost } from "@/lib/db/types";

// DELETE /api/country/[code]/parties/[id]/discussion/[postId]
// Auth: mod or admin only
// Errors: 400, 403, 404

interface RouteParams {
  params: Promise<{ code: string; id: string; postId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { code, id, postId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    if (!ObjectId.isValid(postId)) {
      return NextResponse.json({ error: "Invalid post ID" }, { status: 400 });
    }

    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;
    if (!character) return NextResponse.json({ error: "Character required" }, { status: 403 });

    const db = await getDb();
    const col = db.collection<PartyDiscussionPost>("partyDiscussionPosts");
    const post = await col.findOne({ _id: new ObjectId(postId), countryId, partyId: id });

    if (!post || post.deletedAt) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    await col.updateOne(
      { _id: new ObjectId(postId), countryId, partyId: id },
      { $set: { deletedAt: new Date(), deletedBy: character._id } }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
