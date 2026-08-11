import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { NewsPost } from "@/lib/db/types";

export type PublicNewsPostView = {
  title: string | null;
  content: string;
  authorName: string;
  imageUrl: string | null;
  feedType: string;
  isSystem: boolean;
  createdAt: Date;
};

/**
 * Load a single top-level news post for public permalink + OG metadata.
 * Replies (parentId set) are not addressable by this route.
 */
export async function loadNewsPostPublic(id: string): Promise<PublicNewsPostView | null> {
  if (!ObjectId.isValid(id)) return null;

  const db = await getDb();
  const post = await db.collection<NewsPost>("newsPosts").findOne({
    _id: new ObjectId(id),
    parentId: { $exists: false },
    $or: [{ moderation: { $exists: false } }, { "moderation.status": "visible" }],
  });
  if (!post) return null;

  return {
    title: post.title ?? null,
    content: post.content,
    authorName: post.authorName,
    imageUrl: post.imageUrl ?? null,
    feedType: post.feedType ?? "article",
    isSystem: post.isSystem ?? false,
    createdAt: post.createdAt,
  };
}
