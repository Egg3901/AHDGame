import type { DeviceType } from "@/lib/db/types/siteTrafficPageview";

const MAX_PATH_LEN = 512;

/** Crawlers and prefetchers we skip so aggregates reflect human traffic. */
const BOT_UA_SUBSTRINGS = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "bingpreview",
  "facebookexternalhit",
  "embedly",
  "quora link preview",
  "whatsapp",
  "telegrambot",
  "discordbot",
  "google-read-aloud",
  "ahrefs",
  "semrush",
  "mj12bot",
  "petalbot",
  "bytespider",
  "amazonbot",
  "applebot",
  "gptbot",
  "claudebot",
  "anthropic-ai",
];

export function isLikelyBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const lower = userAgent.toLowerCase();
  return BOT_UA_SUBSTRINGS.some((s) => lower.includes(s));
}

/**
 * Normalizes pathname from the App Router for storage.
 * Returns null when the path should not be recorded.
 */
/**
 * Best-effort device classification from the User-Agent string. We only care
 * about mobile/tablet/desktop; anything else (e.g. missing UA) becomes "other".
 */
export function classifyDevice(userAgent: string | null | undefined): DeviceType {
  if (!userAgent) return "other";
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|kindle|playbook/.test(ua)) return "tablet";
  if (/(android(?!.*mobi))/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|blackberry|opera mini|iemobile|windows phone/.test(ua)) return "mobile";
  if (/mozilla|chrome|safari|firefox|edge|opera/.test(ua)) return "desktop";
  return "other";
}

/** Max client-reported load time we'll store (20s) — anything higher is almost
 *  certainly a background tab resume rather than a real paint. */
export const MAX_LOAD_TIME_MS = 20_000;

export function normalizeAnalyticsPath(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  let path = raw.trim();
  if (!path.startsWith("/")) return null;
  if (path.length > MAX_PATH_LEN) path = path.slice(0, MAX_PATH_LEN);
  if (path.includes("..")) return null;
  // Strip hash-only noise (pathname should not include hash; guard anyway)
  const q = path.indexOf("#");
  if (q !== -1) path = path.slice(0, q);
  return path || null;
}
