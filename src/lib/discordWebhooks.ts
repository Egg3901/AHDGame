/**
 * Discord webhook integration — server-only.
 * Sends rich embeds to configured webhook URLs.
 * Non-fatal: errors are caught and logged, never crash the caller.
 *
 * Import from this file (not discord.ts) so MongoDB is never bundled client-side.
 */
import { getDb } from "@/lib/mongodb";
import { ownsConfiguredWebhooks } from "@/lib/deploymentIdentity";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import type { CountryId } from "@/lib/constants/countries";
import type { GameConfig } from "@/lib/db/types";

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
  url?: string;
  footer?: { text: string };
  thumbnail?: { url: string };
  image?: { url: string };
  author?: { name: string; icon_url?: string };
}

/** Discord embed colors */
export const DISCORD_COLORS = {
  electionOpen: 0x5865f2, // Blue   — election/primary opening
  electionResult: 0xffd700, // Gold   — election resolved
  billEnacted: 0x57f287, // Green  — bill passed into law
  billVetoed: 0xed4245, // Red    — bill vetoed by the executive
  govFormed: 0x9b59b6, // Purple — government formed
  govCollapsed: 0xed4245, // Red    — government collapsed/no-confidence
  leadership: 0x1abc9c, // Teal   — leadership elected
  nationalAddress: 0xc0a062, // Gold-bronze — head-of-government address to the nation
  newsPost: 0xffffff, // White  — player news post
  primeRateCut: 0x57f287, // Green  — central bank rate cut (stimulative)
  primeRateHike: 0xed4245, // Red    — central bank rate hike (restrictive)
  suggestion: 0x9b59b6, // Purple — player suggestion / feedback
  worldMilestone: 0x00b8d4, // Cyan   — world-development milestone (metric era activation)
  scotusRuling: 0x4b2e83, // Deep purple — Supreme Court Docket ruling (historical or diverged)
  warEscalation: 0xb03a2e, // Brick red - a war escalating (Vietnam ladder rungs and decisions)
  settlementBriefing: 0x8ab4f8, // Soft blue — periodic settlement-crisis sentiment briefing
  settlementBrink: 0xed4245, // Red    — settlement crisis armed or gone to war
  settlementSettled: 0xffd700, // Gold   — settlement crisis decided
} as const;

function truncateDiscordText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

export interface BillVetoedDiscordInput {
  /** Title of the bill that was vetoed. */
  billTitle: string;
  /** Name of the president who vetoed; falls back to "the President" when absent. */
  presidentName?: string;
  /** Optional veto message shown as a field. */
  vetoMessage?: string;
  /** Deep link to the bill page. */
  billUrl: string;
}

/**
 * Rich embed announcing a US presidential veto. Title links to the bill page.
 * Pure builder — emit with `sendCountryGameEvent("US", embed)`.
 */
export function buildBillVetoedDiscordEmbed(input: BillVetoedDiscordInput): DiscordEmbed {
  const vetoer = input.presidentName?.trim()
    ? `President ${input.presidentName.trim()}`
    : "the President";

  const fields: NonNullable<DiscordEmbed["fields"]> = [];
  if (input.vetoMessage?.trim()) {
    fields.push({
      name: "Veto Message",
      value: truncateDiscordText(input.vetoMessage.trim(), 1024),
      inline: false,
    });
  }
  fields.push({
    name: "View Bill",
    value: `[Open in A House Divided](${input.billUrl})`,
    inline: true,
  });

  return {
    title: "USA — Bill Vetoed — Federal",
    description: `**${truncateDiscordText(input.billTitle, 500)}** was vetoed by ${vetoer}. Congress may attempt an override.`,
    color: DISCORD_COLORS.billVetoed,
    fields,
    url: input.billUrl,
    footer: { text: "A House Divided" },
  };
}

/** Resolved suggestions webhook URL from `gameConfig`, if any. */
export async function getDiscordSuggestionsWebhookUrl(): Promise<string | undefined> {
  const { suggestions } = await getWebhookUrls();
  return suggestions;
}

async function getWebhookUrls(): Promise<{
  game?: string;
  countryGame?: Record<string, string>;
  news?: string;
  suggestions?: string;
}> {
  try {
    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
    // #1208 — a restored database must not post into the players' channels.
    if (!ownsConfiguredWebhooks(config?.discordWebhookOwnerService)) return {};
    return {
      game: config?.discordGameWebhookUrl || undefined,
      countryGame: config?.discordCountryGameWebhookUrls || undefined,
      news: config?.discordNewsWebhookUrl || undefined,
      suggestions: config?.discordSuggestionsWebhookUrl || undefined,
    };
  } catch {
    return {};
  }
}

export async function sendDiscordWebhook(url: string, embed: DiscordEmbed): Promise<void> {
  await sendDiscordWebhookMultiple(url, [embed]);
}

/** Send multiple embeds in a single webhook call (Discord allows up to 10) */
export async function sendDiscordWebhookMultiple(
  url: string,
  embeds: DiscordEmbed[]
): Promise<void> {
  const payload = {
    embeds: embeds.map((embed) => ({
      ...embed,
      timestamp: embed.timestamp ?? new Date().toISOString(),
    })),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${res.status} ${text}`);
  }
}

/**
 * Post embeds with ?wait=true so Discord returns the message object.
 * Returns the Discord message ID, or undefined if the response can't be parsed.
 */
async function sendDiscordWebhookForId(
  url: string,
  embeds: DiscordEmbed[]
): Promise<string | undefined> {
  const waitUrl = new URL(url);
  waitUrl.searchParams.set("wait", "true");
  const payload = {
    embeds: embeds.map((embed) => ({
      ...embed,
      timestamp: embed.timestamp ?? new Date().toISOString(),
    })),
  };
  const res = await fetch(waitUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${res.status} ${text}`);
  }
  const data = (await res.json().catch(() => null)) as { id?: string } | null;
  return typeof data?.id === "string" ? data.id : undefined;
}

/** Resolve `discordCountryGameWebhookUrls` entry with flexible key casing (JP vs jp). */
function countryMapUrl(
  map: Record<string, string> | undefined,
  countryId: string
): string | undefined {
  if (!map || !countryId) return undefined;
  const direct = map[countryId];
  if (direct) return direct;
  const upper = countryId.toUpperCase();
  const lower = countryId.toLowerCase();
  if (map[upper]) return map[upper];
  if (map[lower]) return map[lower];
  for (const [k, v] of Object.entries(map)) {
    if (v && k.toUpperCase() === upper) return v;
  }
  return undefined;
}

/** Resolve a country's configured webhook URL from `discordCountryGameWebhookUrls`. */
function resolveCountryWebhookUrl(
  urls: Awaited<ReturnType<typeof getWebhookUrls>>,
  countryId: string
): string | undefined {
  return countryMapUrl(urls.countryGame, countryId);
}

/**
 * The country's own webhook only fires while the country is enabled for
 * players. Disabling a country in Admin Panel > Countries silences its channel
 * without destroying the stored URL. The global game webhook is unaffected —
 * it stays the catch-all feed, matching how an unconfigured country behaves.
 */
async function resolveEnabledCountryUrl(
  urls: Awaited<ReturnType<typeof getWebhookUrls>>,
  countryId: string
): Promise<string | undefined> {
  const countryUrl = resolveCountryWebhookUrl(urls, countryId);
  if (!countryUrl) return undefined;
  try {
    const db = await getDb();
    const enabled = await isCountryEnabledForPlayers(db, countryId as CountryId);
    return enabled ? countryUrl : undefined;
  } catch {
    // Access lookup failed — fall back to posting, matching prior behavior.
    return countryUrl;
  }
}

/** Send embed to the country-specific webhook (+ global game webhook). */
export async function sendCountryGameEvent(countryId: string, embed: DiscordEmbed): Promise<void> {
  try {
    const urls = await getWebhookUrls();
    const countryUrl = await resolveEnabledCountryUrl(urls, countryId);
    // Dedup: if countryUrl and game point to the same webhook, only send once
    const targets = [...new Set([countryUrl, urls.game].filter(Boolean) as string[])];
    await Promise.all(
      targets.map((url) =>
        sendDiscordWebhook(url, embed).catch((e) => {
          console.error(`[Discord] ${countryId} webhook POST failed (${url.slice(0, 48)}…):`, e);
        })
      )
    );
  } catch (err) {
    console.error(`[Discord] ${countryId} game event failed:`, err);
  }
}

/**
 * Send embed to multiple country-specific webhooks (+ global game webhook), deduped by URL.
 * Use when one event concerns several countries at once — e.g., a shared central bank
 * (ECB → DE + IE) where pinning the notification to a single COUNTRY_ORDER winner would
 * silently drop sibling members' webhooks.
 */
export async function sendMultiCountryGameEvent(
  countryIds: readonly string[],
  embed: DiscordEmbed
): Promise<void> {
  try {
    const urls = await getWebhookUrls();
    const countryUrls = await Promise.all(
      countryIds.map((id) => resolveEnabledCountryUrl(urls, id))
    );
    const targets = [...new Set([...countryUrls, urls.game].filter(Boolean) as string[])];
    await Promise.all(
      targets.map((url) =>
        sendDiscordWebhook(url, embed).catch((e) => {
          console.error(`[Discord] multi-country webhook POST failed (${url.slice(0, 48)}…):`, e);
        })
      )
    );
  } catch (err) {
    console.error("[Discord] multi-country game event failed:", err);
  }
}

/** Send multiple embeds to the country-specific webhook (+ global game webhook). */
export async function sendCountryGameEventMultiple(
  countryId: string,
  embeds: DiscordEmbed[]
): Promise<void> {
  try {
    const urls = await getWebhookUrls();
    const countryUrl = await resolveEnabledCountryUrl(urls, countryId);
    const targets = [...new Set([countryUrl, urls.game].filter(Boolean) as string[])];
    await Promise.all(
      targets.map((url) =>
        sendDiscordWebhookMultiple(url, embeds).catch((e) => {
          console.error(`[Discord] ${countryId} webhook POST failed (${url.slice(0, 48)}…):`, e);
        })
      )
    );
  } catch (err) {
    console.error(`[Discord] ${countryId} game event failed:`, err);
  }
}

/** Dedup window for identical news embeds — long enough to swallow a double
 * turn-execution (a stale-lock takeover re-running a phase the still-alive
 * original also ran, #1208), short enough not to block a legitimately-repeated
 * headline in a later iteration. */
const NEWS_DEDUP_WINDOW_MS = 10 * 60 * 1000;

/* The separator is written as the ESCAPE \u0000, never a literal NUL byte:
 * the same string at runtime, but a literal one makes this file binary to grep,
 * ripgrep and Semgrep, which then skip it silently. */
/** djb2 string hash → short hex, to keep the dedup `_id` small and stable. */
function newsDedupHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/**
 * True when an identical news embed was already claimed within the dedup window.
 * Atomic: the claim is an insert keyed on `_id = news:<bucket>:<hash>`, so two
 * concurrent turn runs racing on the same event have exactly one winner (the
 * loser hits a duplicate-key error and is told to skip). Best-effort — any
 * failure falls through to "not a duplicate" so a dedup outage never silences
 * real news.
 */
async function claimNewsEmbed(embed: DiscordEmbed, now: Date): Promise<boolean> {
  try {
    const db = await getDb();
    const bucket = Math.floor(now.getTime() / NEWS_DEDUP_WINDOW_MS);
    const key = newsDedupHash(`${embed.title ?? ""}\u0000${embed.description ?? ""}`);
    const coll = db.collection<{ _id: string; sentAt: Date }>("sentNewsDedup");
    // Best-effort TTL so the collection self-cleans; ignore if it already exists.
    await coll.createIndex({ sentAt: 1 }, { expireAfterSeconds: 3600 }).catch(() => {});
    await coll.insertOne({ _id: `news:${bucket}:${key}`, sentAt: now });
    return true; // we inserted → we are the first, send it
  } catch (err) {
    // Duplicate key (11000) → someone already claimed this embed this window.
    if ((err as { code?: number })?.code === 11000) return false;
    return true; // any other failure: don't suppress real news
  }
}

export async function sendNewsEvent(embed: DiscordEmbed): Promise<string | undefined> {
  try {
    const { news } = await getWebhookUrls();
    if (!news) return undefined;
    // Idempotency: a double turn-execution must not post the same headline twice
    // (#1208 — duplicate SCOTUS rulings / cabinet "Established" webhooks).
    if (!(await claimNewsEmbed(embed, new Date()))) return undefined;
    return await sendDiscordWebhookForId(news, [embed]);
  } catch (err) {
    console.error("[Discord] News event failed:", err);
    return undefined;
  }
}

export type PlayerSuggestionDiscordDelivery = "posted" | "no_webhook" | "failed";

export interface SuggestionDiscordDeliveryResult {
  status: PlayerSuggestionDiscordDelivery;
  messageId?: string;
}

/**
 * Posts one suggestion embed to the configured suggestions webhook.
 * Uses ?wait=true so Discord returns the message ID, which callers can store for reaction tracking.
 */
export async function deliverPlayerSuggestionDiscordEmbed(
  embed: DiscordEmbed
): Promise<SuggestionDiscordDeliveryResult> {
  try {
    const { suggestions } = await getWebhookUrls();
    if (!suggestions) return { status: "no_webhook" };
    const messageId = await sendDiscordWebhookForId(suggestions, [embed]);
    return { status: "posted", messageId };
  } catch (err) {
    console.error("[Discord] Suggestions event failed:", err);
    return { status: "failed" };
  }
}

export type PlayerSuggestionDiscordInput = {
  issueNumber: number;
  category: string;
  title: string;
  description: string;
  impact?: string;
  priority?: number;
  reporterUsername: string | null;
  reporterDiscordUsername: string | null;
  /** From Discord bot when submitter has no linked game account */
  discordSubmitDisplayName?: string;
  discordSubmitUsername?: string;
  detailUrl: string;
  githubIssueUrl?: string;
  /** Shown as an embed field when set (player suggestion form). */
  gameSystem?: string;
};

/** Rich embed for a player suggestion (forum) — title links to `detailUrl`. */
export function buildPlayerSuggestionDiscordEmbed(
  input: PlayerSuggestionDiscordInput
): DiscordEmbed {
  const discordOnlyLabel =
    input.discordSubmitDisplayName?.trim() ||
    (input.discordSubmitUsername?.trim() ? `@${input.discordSubmitUsername.trim()}` : null);
  const reporter =
    input.reporterUsername != null && input.reporterUsername.length > 0
      ? `@${input.reporterUsername}`
      : discordOnlyLabel
        ? discordOnlyLabel
        : "Anonymous";

  const fields: NonNullable<DiscordEmbed["fields"]> = [
    { name: "Category", value: truncateDiscordText(input.category, 256), inline: true },
    { name: "Reporter", value: truncateDiscordText(reporter, 256), inline: true },
  ];

  if (input.gameSystem) {
    fields.push({
      name: "Game system",
      value: truncateDiscordText(input.gameSystem, 256),
      inline: true,
    });
  }

  if (input.priority != null && Number.isFinite(input.priority)) {
    fields.push({ name: "Priority", value: String(input.priority), inline: true });
  }
  const discordField =
    input.reporterDiscordUsername?.trim() ||
    (input.discordSubmitUsername?.trim() ? input.discordSubmitUsername.trim() : null);
  if (discordField) {
    fields.push({
      name: "Discord",
      value: truncateDiscordText(discordField, 256),
      inline: true,
    });
  }
  if (input.impact) {
    fields.push({
      name: "Expected impact",
      value: truncateDiscordText(input.impact, 1024),
      inline: false,
    });
  }
  if (input.githubIssueUrl) {
    fields.push({ name: "GitHub", value: input.githubIssueUrl, inline: false });
  }

  const body = `**${truncateDiscordText(input.title, 500)}**\n\n${input.description}`;
  return {
    title: `New suggestion S#${input.issueNumber}`,
    url: input.detailUrl,
    description: truncateDiscordText(body, 4096),
    color: DISCORD_COLORS.suggestion,
    fields,
    footer: { text: "A House Divided — player suggestions" },
  };
}

/**
 * Posts a rich embed when a player submits a suggestion via `POST /api/suggestions`.
 * Does not throw. Returns status and the Discord message ID (for reaction tracking).
 */
export async function notifyNewSuggestionDiscord(
  input: PlayerSuggestionDiscordInput
): Promise<SuggestionDiscordDeliveryResult> {
  return deliverPlayerSuggestionDiscordEmbed(buildPlayerSuggestionDiscordEmbed(input));
}
