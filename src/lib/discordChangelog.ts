/**
 * Discord changelog integration — server-only.
 *
 * Reads per-version public posts from `content/changelog/public/`, formats into
 * Discord embeds, tracks what has already been posted per version, and only
 * sends deltas when a previously-posted version is updated.
 */
import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { sendDiscordWebhookMultiple, type DiscordEmbed } from "@/lib/discordWebhooks";
import { createNotification } from "@/lib/notifications";
import type { GameConfig } from "@/lib/db/types";
import { loadPublicPosts } from "@/lib/changelog/posts";
import type { ChangelogPost } from "@/lib/changelog/types";
import { getCanonicalUrl, getWikiCanonicalUrl } from "@/lib/siteMetadata";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChangelogSentRecord {
  _id: string; // version key e.g. "v0.4.0"
  contentHash: string;
  sentAt: Date;
  /** Store the raw item texts so we can diff */
  sentItems: string[];
}

// ─── Category styling for Discord ─────────────────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  Highlights: "✨",
  Mechanics: "⚙️",
  UI: "🎨",
  Content: "📚",
  Platform: "🔧",
  Performance: "⚡",
  "Bug Fixes": "🐛",
};

const CATEGORY_COLOR: Record<string, number> = {
  Highlights: 0xef4444, // Red — primary brand accent
  Mechanics: 0xf59e0b, // Amber
  UI: 0x3b82f6, // Blue
  Content: 0xa855f7, // Purple
  Platform: 0x10b981, // Emerald
  Performance: 0xeab308, // Yellow
  "Bug Fixes": 0xf97316, // Orange
};

/** Default color for the version header embed */
const VERSION_COLOR = 0x5865f2; // Discord blurple
const UPDATE_COLOR = 0x2ecc71; // Green — used for update-only posts

// Canonical category names that CATEGORY_EMOJI / CATEGORY_COLOR are keyed on.
const DISCORD_CANONICAL_CATEGORIES = [
  "Highlights",
  "Mechanics",
  "UI",
  "Content",
  "Platform",
  "Performance",
  "Bug Fixes",
];

/** Map v0.4.0+ post-style section headings to Discord category styling. */
const DISCORD_SECTION_ALIASES: Record<string, string> = {
  "What you'll notice": "Highlights",
  "Rolling out in phases": "Mechanics",
};

// ─── Post-based formatting (v0.4.0+ feed) ─────────────────────────────────────

interface PostSection {
  heading: string | null;
  lines: string[];
}

function parsePostSections(body: string): PostSection[] {
  const sections: PostSection[] = [];
  let currentHeading: string | null = null;
  let lines: string[] = [];

  function flush() {
    const content = lines.join("\n").trim();
    if (content || currentHeading) {
      sections.push({ heading: currentHeading, lines: content ? content.split("\n") : [] });
    }
    lines = [];
  }

  for (const line of body.split("\n")) {
    const headingMatch = line.match(/^## (.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      continue;
    }
    lines.push(line);
  }
  flush();
  return sections;
}

function canonicalDiscordCategory(name: string): string {
  const t = name.trim();
  if (DISCORD_SECTION_ALIASES[t]) return DISCORD_SECTION_ALIASES[t];
  if (DISCORD_CANONICAL_CATEGORIES.includes(t)) return t;
  const stripped = t.replace(/^[\p{Extended_Pictographic}️‍\s]+/u, "").trim();
  if (DISCORD_SECTION_ALIASES[stripped]) return DISCORD_SECTION_ALIASES[stripped];
  return DISCORD_CANONICAL_CATEGORIES.includes(stripped) ? stripped : t;
}

/** Expand relative markdown links so Discord embeds get clickable URLs. */
export function formatChangelogTextForDiscord(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    if (href.startsWith("/wiki")) {
      return `[${label}](${getWikiCanonicalUrl(href)})`;
    }
    if (href.startsWith("/")) {
      return `[${label}](${getCanonicalUrl(href)})`;
    }
    return `[${label}](${href})`;
  });
}

function collectPostItems(post: ChangelogPost): string[] {
  const items: string[] = [];
  if (post.summary) items.push(post.summary);
  for (const line of post.body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) items.push(trimmed.slice(2));
    else if (trimmed.length > 0 && !trimmed.startsWith("#")) items.push(trimmed);
  }
  return items;
}

function hashPost(post: ChangelogPost): string {
  const payload = JSON.stringify({
    title: post.title,
    summary: post.summary,
    body: post.body,
    items: collectPostItems(post),
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function buildEmbedsForChangelogPost(
  post: ChangelogPost,
  isUpdate: boolean,
  newItemsOnly?: Set<string>
): DiscordEmbed[] {
  const embeds: DiscordEmbed[] = [];
  const versionLabel = `v${post.version} — ${post.date}`;
  const titleSuffix = isUpdate ? " — Update" : "";

  embeds.push({
    title: `📋 ${versionLabel}${titleSuffix}`,
    description: isUpdate
      ? "*New additions to this release:*"
      : `**${post.title}**\n\n${post.summary}`,
    color: isUpdate ? UPDATE_COLOR : VERSION_COLOR,
    footer: { text: "A House Divided" },
    timestamp: new Date().toISOString(),
  });

  const sections = parsePostSections(post.body);
  for (const section of sections) {
    const heading = canonicalDiscordCategory(section.heading ?? "Highlights");
    const emoji = CATEGORY_EMOJI[heading] ?? "📌";
    const color = CATEGORY_COLOR[heading] ?? VERSION_COLOR;

    const lines: string[] = [];
    for (const line of section.lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("- ")) {
        const item = trimmed.slice(2);
        if (newItemsOnly && !newItemsOnly.has(item)) continue;
        lines.push(formatItem(item));
      } else if (!trimmed.startsWith("#")) {
        if (!newItemsOnly || newItemsOnly.has(trimmed)) {
          lines.push(formatChangelogTextForDiscord(trimmed));
        }
      }
    }

    if (lines.length === 0) continue;

    const chunks = splitIntoChunks(lines, 3900);
    for (let i = 0; i < chunks.length; i++) {
      const suffix = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : "";
      embeds.push({
        title: `${emoji} ${heading}${suffix}`,
        description: chunks[i],
        color,
      });
    }
  }

  return embeds;
}

function postVersionKey(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function formatItem(text: string): string {
  return `• ${formatChangelogTextForDiscord(text)}`;
}

/** Split lines into chunks where each chunk's joined text is ≤ maxLen chars */
function splitIntoChunks(lines: string[], maxLen: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    const lineLen = line.length + 1; // +1 for newline
    if (currentLen + lineLen > maxLen && current.length > 0) {
      chunks.push(current.join("\n").trim());
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += lineLen;
  }
  if (current.length > 0) {
    const text = current.join("\n").trim();
    if (text) chunks.push(text);
  }

  return chunks;
}

// ─── Sending (with batching for Discord limits) ──────────────────────────────

/** Estimate total character count of an embed (title + description + fields + footer) */
function embedCharCount(embed: DiscordEmbed): number {
  let count = (embed.title?.length ?? 0) + (embed.description?.length ?? 0);
  if (embed.fields) {
    for (const f of embed.fields) {
      count += (f.name?.length ?? 0) + (f.value?.length ?? 0);
    }
  }
  if (embed.footer) count += embed.footer.text?.length ?? 0;
  if (embed.author) count += embed.author.name?.length ?? 0;
  return count;
}

/**
 * Send embeds in batches that respect Discord's limits:
 * - Max 10 embeds per message
 * - Max 6000 total characters across all embeds in a single message
 */
async function sendEmbedsBatched(url: string, embeds: DiscordEmbed[]): Promise<void> {
  const MAX_EMBEDS = 10;
  const MAX_CHARS = 6000;

  const batches: DiscordEmbed[][] = [];
  let current: DiscordEmbed[] = [];
  let currentChars = 0;

  for (const embed of embeds) {
    const chars = embedCharCount(embed);

    // If adding this embed would exceed limits, flush current batch
    if (current.length > 0 && (current.length >= MAX_EMBEDS || currentChars + chars > MAX_CHARS)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(embed);
    currentChars += chars;
  }
  if (current.length > 0) batches.push(current);

  for (let i = 0; i < batches.length; i++) {
    await sendDiscordWebhookMultiple(url, batches[i]);
    // Small delay between batches to avoid rate limits
    if (i + 1 < batches.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function getChangelogWebhookUrl(): Promise<string | undefined> {
  const db = await getDb();
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { discordChangelogWebhookUrl: 1 } });
  return config?.discordChangelogWebhookUrl || undefined;
}

/**
 * Notify all users in-game about a new changelog version.
 * Creates a system notification for every user with a character.
 */
async function notifyAllUsersOfUpdate(version: string): Promise<void> {
  try {
    const db = await getDb();

    // Get all users who have a character (active players). The link lives on
    // the character (characters.userId), not on the user document — users have
    // no characterId field, so the old users.characterId query matched nobody.
    const userIds = (await db
      .collection("characters")
      .distinct("userId", { userId: { $exists: true, $ne: null } })) as ObjectId[];

    const notificationPromises = userIds.map((userId) =>
      createNotification({
        userId,
        type: "system",
        title: "Game Update",
        message: `A House Divided has been updated to ${version}. Check out what's new!`,
        metadata: {
          version,
          changelogUrl: "/changelog",
          isUpdateNotification: true,
        },
      })
    );

    // Batch to avoid overwhelming the DB
    const BATCH_SIZE = 100;
    for (let i = 0; i < notificationPromises.length; i += BATCH_SIZE) {
      const batch = notificationPromises.slice(i, i + BATCH_SIZE);
      await Promise.all(batch);
      // Small delay between batches
      if (i + BATCH_SIZE < notificationPromises.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    console.log(
      `[notifyAllUsersOfUpdate] Sent notifications to ${userIds.length} users for ${version}`
    );
  } catch (err) {
    // Non-fatal — log but don't fail the changelog post
    console.error("[notifyAllUsersOfUpdate] Failed:", err);
  }
}

/**
 * Post the most recent version from `content/changelog/public/` to Discord.
 * Used by the admin test button. Always sends the full version (ignores diff tracking).
 */
export async function postLatestChangelog(
  webhookUrl?: string
): Promise<{ version: string; embeds: number }> {
  const url = webhookUrl ?? (await getChangelogWebhookUrl());
  if (!url) throw new Error("No changelog webhook URL configured");

  const latest = loadPublicPosts()[0];
  if (!latest) throw new Error("No versioned changelog entry found");

  const embeds = buildEmbedsForChangelogPost(latest, false);
  await sendEmbedsBatched(url, embeds);

  return { version: postVersionKey(latest.version), embeds: embeds.length };
}

/**
 * Post changelog updates to Discord. Compares current public posts against
 * previously sent content. Only sends new/changed versions or the delta for
 * updated versions.
 */
export async function postChangelogUpdates(webhookUrl?: string): Promise<{
  sent: { version: string; type: "new" | "update"; embeds: number }[];
  skipped: string[];
}> {
  const url = webhookUrl ?? (await getChangelogWebhookUrl());
  if (!url) throw new Error("No changelog webhook URL configured");

  const posts = loadPublicPosts();
  const db = await getDb();
  const sentCol = db.collection<ChangelogSentRecord>("changelogSentHistory");

  const sent: { version: string; type: "new" | "update"; embeds: number }[] = [];
  const skipped: string[] = [];

  for (const post of posts) {
    const key = postVersionKey(post.version);
    const currentItems = collectPostItems(post);
    const currentHash = hashPost(post);

    const existing = await sentCol.findOne({ _id: key });

    if (existing && existing.contentHash === currentHash) {
      skipped.push(key);
      continue;
    }

    if (existing) {
      const previousItems = new Set(existing.sentItems);
      const newItems = currentItems.filter((item) => !previousItems.has(item));

      if (newItems.length === 0) {
        await sentCol.updateOne(
          { _id: key },
          { $set: { contentHash: currentHash, sentItems: currentItems, sentAt: new Date() } }
        );
        skipped.push(key);
        continue;
      }

      const embeds = buildEmbedsForChangelogPost(post, true, new Set(newItems));
      await sendEmbedsBatched(url, embeds);
      sent.push({ version: key, type: "update", embeds: embeds.length });
    } else {
      const embeds = buildEmbedsForChangelogPost(post, false);
      await sendEmbedsBatched(url, embeds);
      sent.push({ version: key, type: "new", embeds: embeds.length });
      await notifyAllUsersOfUpdate(key);
    }

    await sentCol.updateOne(
      { _id: key },
      {
        $set: {
          contentHash: currentHash,
          sentItems: currentItems,
          sentAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  return { sent, skipped };
}
