import type { NewsFeedType, NewsPost, ProfileBorderKey } from "@/lib/db/types";

export interface NewsAuthorPresentation {
  authorSequentialId: number | null;
  authorBorderKey: ProfileBorderKey | null;
  authorTintColor: string | null;
}

export interface NewsPostView {
  _id: string;
  authorId: string;
  authorSequentialId: number | null;
  authorName: string;
  authorAvatarUrl: string | null;
  authorParty: string | null;
  authorBorderKey: ProfileBorderKey | null;
  authorTintColor: string | null;
  title: string | null;
  content: string;
  imageUrl: string | null;
  isSystem: boolean;
  feedType: NewsFeedType | "article";
  category: NewsPost["category"] | null;
  reactions: NewsPost["reactions"];
  replyCount: number;
  userReaction: "agree" | "disagree" | null;
  createdAt: string;
  /** ISO timestamp of the last author edit, or null if never edited. */
  editedAt: string | null;
}

export interface NewsReplyView {
  _id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorParty: string | null;
  authorBorderKey: ProfileBorderKey | null;
  authorTintColor: string | null;
  content: string;
  reactions: NewsPost["reactions"];
  createdAt: string;
}

export function serializeNewsPost(
  post: NewsPost,
  author: NewsAuthorPresentation,
  userReaction: "agree" | "disagree" | null,
  title: string | null,
  content: string
): NewsPostView {
  return {
    _id: post._id.toString(),
    authorId: post.authorId.toString(),
    authorSequentialId: author.authorSequentialId,
    authorName: post.authorName,
    authorAvatarUrl: post.authorAvatarUrl ?? null,
    authorParty: post.authorParty ?? null,
    authorBorderKey: author.authorBorderKey,
    authorTintColor: author.authorTintColor,
    title,
    content,
    imageUrl: post.imageUrl ?? null,
    isSystem: post.isSystem ?? false,
    feedType: (post.feedType as NewsFeedType | undefined) ?? "article",
    category: post.category ?? null,
    reactions: post.reactions,
    replyCount: post.replyCount,
    userReaction,
    createdAt: post.createdAt.toISOString(),
    editedAt: post.editedAt ? post.editedAt.toISOString() : null,
  };
}

export function serializeNewsReply(
  reply: NewsPost,
  authorBorderKey: ProfileBorderKey | null,
  authorTintColor: string | null
): NewsReplyView {
  return {
    _id: reply._id.toString(),
    authorName: reply.authorName,
    authorAvatarUrl: reply.authorAvatarUrl ?? null,
    authorParty: reply.authorParty ?? null,
    authorBorderKey,
    authorTintColor,
    content: reply.content,
    reactions: reply.reactions,
    createdAt: reply.createdAt.toISOString(),
  };
}
