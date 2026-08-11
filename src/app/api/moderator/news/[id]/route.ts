import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { createModAuditLog } from "@/lib/modAuditLog";
import type { Character, NewsPost, User } from "@/lib/db/types";

// DELETE /api/moderator/news/[id] — Delete a player news post and all its replies and reactions.
// Auth: requireModerator
// Errors: 401, 403, 404
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const { id } = await params;
    const postId = new ObjectId(id);

    const db = await getDb();
    const post = await db.collection<NewsPost>("newsPosts").findOne({ _id: postId });
    if (!post) throw notFound("News post not found");

    if (post.isSystem) {
      return NextResponse.json(
        { error: "System-generated posts cannot be removed by moderators" },
        { status: 403 }
      );
    }

    const authorCharacter = await db
      .collection<Character>("characters")
      .findOne({ _id: post.authorId }, { projection: { userId: 1 } });
    const authorUser = authorCharacter?.userId
      ? await db
          .collection<User>("users")
          .findOne({ _id: authorCharacter.userId }, { projection: { username: 1, role: 1 } })
      : null;

    if (authorUser?.role === "admin") {
      return NextResponse.json(
        { error: "Cannot perform actions on admin-authored posts" },
        { status: 403 }
      );
    }

    const replies = await db
      .collection<NewsPost>("newsPosts")
      .find({ parentId: postId }, { projection: { _id: 1 } })
      .toArray();
    const replyIds = replies.map((reply) => reply._id);
    const allIds = [postId, ...replyIds];

    await db.collection("newsReactions").deleteMany({ postId: { $in: allIds } });
    await db.collection<NewsPost>("newsPosts").deleteMany({ _id: { $in: allIds } });

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "delete_news_post",
      targetUserId: authorUser?._id?.toString(),
      targetUsername: authorUser?.username ?? post.authorName,
      details: post.title?.trim() || post.content.slice(0, 160),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
