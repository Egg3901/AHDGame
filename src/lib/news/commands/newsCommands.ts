import { ApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import { sendNewsEvent, DISCORD_COLORS, type DiscordEmbed } from "@/lib/discordWebhooks";
import { getSiteUrl } from "@/lib/siteMetadata";
import { containsSlur } from "@/lib/moderation";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, getTotalPersonalWealth } from "@/lib/currency/characterFunds";
import { isTrustedNewsImageUrl } from "@/lib/news/trustedImageUrl";
import { ObjectId, type Db } from "mongodb";
import type {
  Character,
  NewsFeedType,
  NewsPost,
  NewsReaction,
  PoliticalParty,
  User,
  UserSubscription,
} from "@/lib/db/types";
import type { NewsPostView, NewsReplyView } from "@/lib/news/dto/newsView";
import { serializeNewsPost, serializeNewsReply } from "@/lib/news/dto/newsView";

interface CreateNewsPostInput {
  userId: string;
  title?: string;
  content: string;
  feedType: NewsFeedType;
  imageUrl?: string;
}

interface EditNewsPostInput {
  userId: string;
  postId: string;
  title?: string;
  content: string;
  imageUrl?: string;
}

interface CreateNewsReplyInput {
  userId: string;
  postId: string;
  content: string;
}

interface ReactToNewsPostInput {
  userId: string;
  postId: string;
  reaction: "agree" | "disagree";
}

export async function createNewsPost(
  db: Db,
  { userId, title, content, feedType, imageUrl: imageUrlRaw }: CreateNewsPostInput
): Promise<{ post: NewsPostView }> {
  const character = await db
    .collection<Character>("characters")
    .findOne({ userId: new ObjectId(userId) });
  if (!character) {
    throw forbidden("Character required to post");
  }

  const forexEnabled = await isForexEnabled();

  if (imageUrlRaw !== undefined && imageUrlRaw !== "" && !isTrustedNewsImageUrl(imageUrlRaw)) {
    throw badRequest("Invalid or untrusted image URL. Upload an image using the post composer.");
  }
  const imageUrl = imageUrlRaw && imageUrlRaw.length > 0 ? imageUrlRaw : undefined;

  const textToCheck = [title, content].filter(Boolean).join(" ");
  if (containsSlur(textToCheck)) {
    throw badRequest("Your post contains prohibited language and cannot be submitted.");
  }

  const actionCostAd = 5;
  const personalCashAd = 100_000;
  const cooldownMs = feedType === "advertisement" ? 30 * 60 * 1000 : 12 * 60 * 60 * 1000;

  if (feedType === "advertisement") {
    if (character.actions < actionCostAd) {
      throw badRequest(`You need at least ${actionCostAd} actions to place a sponsored post.`);
    }
    const personal = getTotalPersonalWealth(character, forexEnabled);
    if (personal < personalCashAd) {
      throw badRequest(
        `You need at least $${personalCashAd.toLocaleString()} personal cash to place a sponsored post. Available: $${personal.toLocaleString()}.`
      );
    }
  }

  const lastSameKind = await db.collection<NewsPost>("newsPosts").findOne(
    {
      authorId: character._id,
      parentId: { $exists: false },
      isSystem: { $ne: true },
      ...(feedType === "advertisement"
        ? { feedType: "advertisement" }
        : { $or: [{ feedType: "article" }, { feedType: { $exists: false } }] }),
    },
    { sort: { createdAt: -1 } }
  );
  if (lastSameKind) {
    const elapsed = Date.now() - lastSameKind.createdAt.getTime();
    if (elapsed < cooldownMs) {
      const remainingMs = cooldownMs - elapsed;
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      if (feedType === "article" && remainingHours >= 2) {
        throw new ApiError(
          429,
          `You can post free news again in about ${remainingHours} hour${remainingHours !== 1 ? "s" : ""}.`
        );
      }
      throw new ApiError(
        429,
        `You can post again in ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}.`
      );
    }
  }

  const now = new Date();
  const post: Omit<NewsPost, "_id"> = {
    authorId: character._id,
    authorName: character.name,
    authorAvatarUrl: character.avatarUrl,
    authorParty: character.party,
    feedType,
    ...(title ? { title } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    content,
    reactions: { agree: 0, disagree: 0 },
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  if (feedType === "advertisement") {
    const homeCurrency = getHomeCurrency(character);
    const balanceField = forexEnabled ? `currencyBalances.personal.${homeCurrency}` : "cashOnHand";
    const spendResult = await db.collection<Character>("characters").updateOne(
      {
        _id: character._id,
        actions: { $gte: actionCostAd },
        [balanceField]: { $gte: personalCashAd },
      },
      {
        $inc: {
          actions: -actionCostAd,
          [balanceField]: -personalCashAd,
        },
        $set: { updatedAt: now },
      }
    );
    if (spendResult.modifiedCount === 0) {
      throw new ApiError(
        409,
        "Your available actions or personal funds changed. Please try again."
      );
    }

    try {
      const result = await db.collection("newsPosts").insertOne(post);
      return finishNewsPost(db, userId, character, post, result.insertedId, now);
    } catch (error) {
      await db.collection<Character>("characters").updateOne(
        { _id: character._id },
        {
          $inc: {
            actions: actionCostAd,
            [balanceField]: personalCashAd,
          },
          $set: { updatedAt: new Date() },
        }
      );
      throw error;
    }
  }

  const result = await db.collection("newsPosts").insertOne(post);
  return finishNewsPost(db, userId, character, post, result.insertedId, now);
}

export async function editNewsPost(
  db: Db,
  { userId, postId, title, content, imageUrl: imageUrlRaw }: EditNewsPostInput
): Promise<{ post: NewsPostView }> {
  if (!ObjectId.isValid(postId)) {
    throw badRequest("Invalid post ID");
  }

  const character = await db
    .collection<Character>("characters")
    .findOne({ userId: new ObjectId(userId) });
  if (!character) {
    throw forbidden("Character required to edit a post");
  }

  const postOid = new ObjectId(postId);
  const post = await db.collection<NewsPost>("newsPosts").findOne({ _id: postOid });
  if (!post) {
    throw notFound("Post not found");
  }
  if (post.isSystem) {
    throw forbidden("System posts cannot be edited.");
  }
  if (post.parentId) {
    throw forbidden("Replies cannot be edited.");
  }
  if (!post.authorId.equals(character._id)) {
    throw forbidden("You can only edit your own posts.");
  }

  if (imageUrlRaw !== undefined && imageUrlRaw !== "" && !isTrustedNewsImageUrl(imageUrlRaw)) {
    throw badRequest("Invalid or untrusted image URL. Upload an image using the post composer.");
  }
  const imageUrl = imageUrlRaw && imageUrlRaw.length > 0 ? imageUrlRaw : undefined;

  const textToCheck = [title, content].filter(Boolean).join(" ");
  if (containsSlur(textToCheck)) {
    throw badRequest("Your post contains prohibited language and cannot be submitted.");
  }

  const nextTitle = title && title.length > 0 ? title : undefined;
  const now = new Date();

  const set: Record<string, unknown> = { content, updatedAt: now, editedAt: now };
  const unset: Record<string, ""> = {};
  if (nextTitle) {
    set.title = nextTitle;
  } else {
    unset.title = "";
  }
  if (imageUrl) {
    set.imageUrl = imageUrl;
  } else {
    unset.imageUrl = "";
  }

  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length > 0) {
    update.$unset = unset;
  }
  await db.collection<NewsPost>("newsPosts").updateOne({ _id: postOid }, update);

  // Rebuild the view the same way finishNewsPost does — reuse the border fetch.
  const updatedPost: NewsPost = { ...post, content, editedAt: now, updatedAt: now };
  if (nextTitle) {
    updatedPost.title = nextTitle;
  } else {
    delete updatedPost.title;
  }
  if (imageUrl) {
    updatedPost.imageUrl = imageUrl;
  } else {
    delete updatedPost.imageUrl;
  }

  const postBorderMap = await fetchBordersByUserIds(db, [new ObjectId(userId)]);
  const postBorder = postBorderMap.get(userId);

  return {
    post: serializeNewsPost(
      updatedPost,
      {
        authorSequentialId: character.sequentialId ?? null,
        authorBorderKey: postBorder?.borderKey ?? null,
        authorTintColor: postBorder?.tintColor ?? null,
      },
      null,
      nextTitle ?? null,
      content
    ),
  };
}

export async function createNewsReply(
  db: Db,
  { userId, postId, content }: CreateNewsReplyInput
): Promise<{ reply: NewsReplyView }> {
  if (!ObjectId.isValid(postId)) {
    throw badRequest("Invalid post ID");
  }
  if (containsSlur(content)) {
    throw badRequest("Your reply contains prohibited language and cannot be submitted.");
  }

  const postOid = new ObjectId(postId);
  const parentPost = await db.collection<NewsPost>("newsPosts").findOne({ _id: postOid });
  if (!parentPost) {
    throw notFound("Post not found");
  }

  const character = await db
    .collection<Character>("characters")
    .findOne({ userId: new ObjectId(userId) });
  if (!character) {
    throw forbidden("Character required to reply");
  }

  const now = new Date();
  const reply: Omit<NewsPost, "_id"> = {
    stateId: parentPost.stateId,
    parentId: postOid,
    authorId: character._id,
    authorName: character.name,
    authorAvatarUrl: character.avatarUrl,
    authorParty: character.party,
    content,
    reactions: { agree: 0, disagree: 0 },
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection("newsPosts").insertOne(reply);
  await db.collection("newsPosts").updateOne({ _id: postOid }, { $inc: { replyCount: 1 } });

  try {
    const { checkNewsReplyAchievements } = await import("@/lib/achievements/triggers");
    await checkNewsReplyAchievements(new ObjectId(userId), character._id);
  } catch (error) {
    console.error("Achievement check failed:", error);
  }

  const replyBorders = await fetchBordersByUserIds(db, [new ObjectId(userId)]);
  const replyBorder = replyBorders.get(userId);

  return {
    reply: serializeNewsReply(
      { ...reply, _id: result.insertedId },
      replyBorder?.borderKey ?? null,
      replyBorder?.tintColor ?? null
    ),
  };
}

export async function reactToNewsPost(
  db: Db,
  { userId, postId, reaction }: ReactToNewsPostInput
): Promise<{ reactions: NewsPost["reactions"]; userReaction: "agree" | "disagree" | null }> {
  if (!ObjectId.isValid(postId)) {
    throw badRequest("Invalid post ID");
  }

  const postOid = new ObjectId(postId);
  const userOid = new ObjectId(userId);
  const post = await db.collection<NewsPost>("newsPosts").findOne({ _id: postOid });
  if (!post) {
    throw notFound("Post not found");
  }

  const existing = await db
    .collection<NewsReaction>("newsReactions")
    .findOne({ postId: postOid, userId: userOid });

  let agreeChange = 0;
  let disagreeChange = 0;
  let userReaction: "agree" | "disagree" | null = null;

  if (existing) {
    if (existing.reaction === reaction) {
      await db.collection("newsReactions").deleteOne({ _id: existing._id });
      if (reaction === "agree") {
        agreeChange = -1;
      } else {
        disagreeChange = -1;
      }
      userReaction = null;
    } else {
      await db.collection("newsReactions").updateOne({ _id: existing._id }, { $set: { reaction } });
      if (reaction === "agree") {
        agreeChange = 1;
        disagreeChange = -1;
      } else {
        agreeChange = -1;
        disagreeChange = 1;
      }
      userReaction = reaction;
    }
  } else {
    const newReaction: Omit<NewsReaction, "_id"> = {
      postId: postOid,
      userId: userOid,
      reaction,
      createdAt: new Date(),
    };
    await db.collection("newsReactions").insertOne(newReaction);
    if (reaction === "agree") {
      agreeChange = 1;
    } else {
      disagreeChange = 1;
    }
    userReaction = reaction;
  }

  const update: Record<string, number> = {};
  if (agreeChange !== 0) {
    update["reactions.agree"] = agreeChange;
  }
  if (disagreeChange !== 0) {
    update["reactions.disagree"] = disagreeChange;
  }
  await db.collection("newsPosts").updateOne({ _id: postOid }, { $inc: update });

  const updatedPost = await db.collection<NewsPost>("newsPosts").findOne({ _id: postOid });
  return {
    reactions: updatedPost?.reactions ?? { agree: 0, disagree: 0 },
    userReaction,
  };
}

async function finishNewsPost(
  db: Db,
  userId: string,
  character: Character,
  post: Omit<NewsPost, "_id">,
  resultId: ObjectId,
  now: Date
): Promise<{ post: NewsPostView }> {
  try {
    const { checkNewsPostAchievements } = await import("@/lib/achievements/triggers");
    await checkNewsPostAchievements(new ObjectId(userId), character._id);
  } catch (error) {
    console.error("Achievement check failed:", error);
  }

  void autoReactFromDiscordLinkedUser(db, userId, resultId, now);
  void sendNewsDiscordWebhook(db, character, post, resultId, now);
  void notifySubscribers(db, character, post.content, resultId);

  const postBorderMap = await fetchBordersByUserIds(db, [new ObjectId(userId)]);
  const postBorder = postBorderMap.get(userId);

  return {
    post: serializeNewsPost(
      { ...post, _id: resultId },
      {
        authorSequentialId: character.sequentialId ?? null,
        authorBorderKey: postBorder?.borderKey ?? null,
        authorTintColor: postBorder?.tintColor ?? null,
      },
      null,
      post.title ?? null,
      post.content
    ),
  };
}

async function autoReactFromDiscordLinkedUser(
  db: Db,
  userId: string,
  postId: ObjectId,
  now: Date
): Promise<void> {
  try {
    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(userId) }, { projection: { discordId: 1 } });
    if (!userDoc?.discordId) {
      return;
    }

    const reactingUserId = new ObjectId(userId);
    const alreadyReacted = await db
      .collection<NewsReaction>("newsReactions")
      .findOne({ postId, userId: reactingUserId });
    if (alreadyReacted) {
      return;
    }

    await db.collection<NewsReaction>("newsReactions").insertOne({
      postId,
      userId: reactingUserId,
      reaction: "agree",
      createdAt: now,
    } as NewsReaction);
    await db
      .collection<NewsPost>("newsPosts")
      .updateOne({ _id: postId }, { $inc: { "reactions.agree": 1 } });
  } catch {
    // non-fatal
  }
}

async function sendNewsDiscordWebhook(
  db: Db,
  character: Character,
  post: Omit<NewsPost, "_id">,
  resultId: ObjectId,
  now: Date
): Promise<void> {
  try {
    let partyName: string | undefined;
    const partyId = character.party ? parseInt(String(character.party), 10) : Number.NaN;
    if (!Number.isNaN(partyId)) {
      const partyDoc = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne(
          { sequentialId: partyId, countryId: character.countryId } as Record<string, unknown>,
          { projection: { name: 1 } }
        );
      partyName = partyDoc?.name ?? String(character.party);
    }

    const publicBase = getSiteUrl().replace(/\/$/, "");
    const avatarUrl = toAbsoluteUrl(
      publicBase,
      character.avatarUrl
        ? character.avatarUrl.startsWith("http")
          ? character.avatarUrl
          : character.avatarUrl.startsWith("/")
            ? character.avatarUrl
            : `/${character.avatarUrl}`
        : undefined
    );
    const hero = toAbsoluteUrl(
      publicBase,
      post.imageUrl != null
        ? post.imageUrl.startsWith("http")
          ? post.imageUrl
          : post.imageUrl.startsWith("/")
            ? post.imageUrl
            : `/${post.imageUrl}`
        : undefined
    );
    const permalink = `${publicBase}/news/post/${resultId.toString()}`;
    const isAd = post.feedType === "advertisement";

    const embed: DiscordEmbed = {
      author: {
        name: `${character.name}${partyName ? ` (${partyName})` : ""}`,
        ...(avatarUrl ? { icon_url: avatarUrl } : {}),
      },
      title: isAd ? (post.title ?? "Sponsored Post") : (post.title ?? "New News Post!"),
      url: permalink,
      description: post.content.length > 300 ? `${post.content.slice(0, 300)}…` : post.content,
      color: isAd ? DISCORD_COLORS.electionOpen : DISCORD_COLORS.newsPost,
      footer: { text: isAd ? "A House Divided — Sponsored" : "A House Divided — News Feed" },
      timestamp: now.toISOString(),
    };

    if (hero && discordCanFetch(hero)) {
      embed.image = { url: hero };
    } else if (avatarUrl && discordCanFetch(avatarUrl)) {
      embed.thumbnail = { url: avatarUrl };
    }

    const discordMsgId = await sendNewsEvent(embed);
    if (discordMsgId) {
      await db
        .collection("newsPosts")
        .updateOne({ _id: resultId }, { $set: { discordMessageId: discordMsgId } });
    }
  } catch {
    // non-fatal
  }
}

async function notifySubscribers(
  db: Db,
  character: Character,
  content: string,
  postId: ObjectId
): Promise<void> {
  try {
    const subscriptions = await db
      .collection<UserSubscription>("userSubscriptions")
      .find({ subscribedToCharacterId: character._id })
      .toArray();
    if (subscriptions.length === 0) {
      return;
    }

    const preview = content.length > 80 ? `${content.slice(0, 80)}…` : content;
    await Promise.all(
      subscriptions.map((subscription) =>
        createNotification({
          userId: subscription.subscriberUserId,
          type: "new_post",
          title: `${character.name} posted an update`,
          message: preview,
          metadata: {
            authorCharacterId: character._id.toString(),
            authorName: character.name,
            postId: postId.toString(),
          },
        })
      )
    );
  } catch (error) {
    console.error("[news POST] Failed to notify subscribers:", error);
  }
}

function toAbsoluteUrl(publicBase: string, href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }
  return `${publicBase}${href.startsWith("/") ? "" : "/"}${href}`;
}

function discordCanFetch(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return false;
    }
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
