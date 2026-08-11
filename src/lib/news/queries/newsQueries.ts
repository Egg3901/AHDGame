import { formatSectorTypeSlugsInText } from "@/lib/utils/formatSectorTypeSlugsInText";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { badRequest } from "@/lib/api/errors";
import { ObjectId, type Db } from "mongodb";
import type { Character, NewsPost, NewsReaction } from "@/lib/db/types";
import {
  serializeNewsPost,
  serializeNewsReply,
  type NewsAuthorPresentation,
  type NewsPostView,
  type NewsReplyView,
} from "@/lib/news/dto/newsView";

export interface GetNewsFeedInput {
  limit: number;
  offset: number;
  authorId: string | null;
  feed: string | null;
  userId: string | null;
}

export async function getNewsFeed(
  db: Db,
  { limit, offset, authorId, feed, userId }: GetNewsFeedInput
): Promise<{ posts: NewsPostView[] }> {
  const feedParam = feed ?? "article";
  const userOid = userId ? new ObjectId(userId) : null;

  const query: Record<string, unknown> = { parentId: { $exists: false } };
  if (feedParam === "ticker") {
    query.isSystem = { $ne: true };
  } else if (feedParam === "advertisement") {
    query.feedType = "advertisement";
    query.isSystem = { $ne: true };
  } else {
    query.$or = [{ isSystem: true }, { feedType: { $ne: "advertisement" } }];
  }
  if (authorId && ObjectId.isValid(authorId)) {
    query.authorId = new ObjectId(authorId);
  }

  const posts = await db
    .collection<NewsPost>("newsPosts")
    .find(query)
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(limit)
    .toArray();

  const userReactionMap = await getUserReactionMap(db, posts, userOid);
  const authorPresentationMap = await getAuthorPresentationMap(db, posts);

  return {
    posts: posts.map((post) => {
      const author =
        authorPresentationMap.get(post.authorId.toString()) ?? emptyAuthorPresentation();
      const title = post.title
        ? post.isSystem
          ? formatSectorTypeSlugsInText(post.title)
          : post.title
        : null;
      const content = post.isSystem ? formatSectorTypeSlugsInText(post.content) : post.content;
      return serializeNewsPost(
        post,
        author,
        userReactionMap.get(post._id.toString()) ?? null,
        title,
        content
      );
    }),
  };
}

export async function getNewsReplies(
  db: Db,
  postId: string
): Promise<{ replies: NewsReplyView[] }> {
  if (!ObjectId.isValid(postId)) {
    throw badRequest("Invalid post ID");
  }

  const postOid = new ObjectId(postId);
  const replies = await db
    .collection<NewsPost>("newsPosts")
    .find({ parentId: postOid })
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray();

  const authorPresentationMap = await getAuthorPresentationMap(db, replies);

  return {
    replies: replies.map((reply) => {
      const author =
        authorPresentationMap.get(reply.authorId.toString()) ?? emptyAuthorPresentation();
      return serializeNewsReply(reply, author.authorBorderKey, author.authorTintColor);
    }),
  };
}

async function getUserReactionMap(
  db: Db,
  posts: NewsPost[],
  userId: ObjectId | null
): Promise<Map<string, "agree" | "disagree">> {
  if (!userId || posts.length === 0) {
    return new Map();
  }

  const reactions = await db
    .collection<NewsReaction>("newsReactions")
    .find({ postId: { $in: posts.map((post) => post._id) }, userId })
    .toArray();

  return new Map(reactions.map((reaction) => [reaction.postId.toString(), reaction.reaction]));
}

async function getAuthorPresentationMap(
  db: Db,
  posts: NewsPost[]
): Promise<Map<string, NewsAuthorPresentation>> {
  const authorIds = [
    ...new Set(posts.filter((post) => !post.isSystem).map((post) => post.authorId.toString())),
  ];
  if (authorIds.length === 0) {
    return new Map();
  }

  const authorOids = authorIds.map((id) => new ObjectId(id));
  const characters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: authorOids } }, { projection: { _id: 1, sequentialId: 1, userId: 1 } })
    .toArray();

  const borderMap = await fetchBordersByUserIds(
    db,
    characters.map((character) => character.userId)
  );

  return new Map(
    characters.map((character) => [
      character._id.toString(),
      {
        authorSequentialId: character.sequentialId ?? null,
        authorBorderKey: borderMap.get(character.userId.toString())?.borderKey ?? null,
        authorTintColor: borderMap.get(character.userId.toString())?.tintColor ?? null,
      },
    ])
  );
}

function emptyAuthorPresentation(): NewsAuthorPresentation {
  return {
    authorSequentialId: null,
    authorBorderKey: null,
    authorTintColor: null,
  };
}
