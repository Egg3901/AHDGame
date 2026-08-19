import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { NewsPost } from "@/lib/db/types";

// DELETE /api/admin/news/[id] — Delete a news post and all its replies and reactions.
// Auth: requireAdmin
// Errors: 403, 404
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const postId = new ObjectId(id);

    const db = await getDb();

    const post = await db.collection<NewsPost>("newsPosts").findOne({ _id: postId });
    if (!post) throw notFound("News post not found");

    // Collect reply IDs before deleting anything
    const replies = await db
      .collection<NewsPost>("newsPosts")
      .find({ parentId: postId }, { projection: { _id: 1 } })
      .toArray();
    const replyIds = replies.map((r) => r._id);
    const allIds = [postId, ...replyIds];

    // Delete reactions for post and all replies
    await db.collection("newsReactions").deleteMany({ postId: { $in: allIds } });

    // Delete post and all replies
    await db.collection<NewsPost>("newsPosts").deleteMany({ _id: { $in: allIds } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
