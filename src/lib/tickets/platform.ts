/**
 * Where a reporter was playing when they hit a problem.
 *
 * The values match the Discord ticket bot's picker (adhd-bot
 * src/utils/ticketPlatform.ts) so tickets and in-game reports share one
 * vocabulary. The bot asks the player; in-game reports are detected from the
 * user agent, since the apps identify themselves.
 */

export const TICKET_PLATFORMS = [
  { value: "mobile_web", label: "Mobile: web browser" },
  { value: "mobile_android", label: "Mobile: Android app" },
  { value: "mobile_ios", label: "Mobile: iOS app" },
  { value: "desktop_web", label: "Desktop: web browser" },
  { value: "desktop_client", label: "Desktop: client app" },
  { value: "desktop_singleplayer", label: "Desktop: single player" },
] as const;

export type TicketPlatform = (typeof TICKET_PLATFORMS)[number]["value"];

export const TICKET_PLATFORM_VALUES = TICKET_PLATFORMS.map((p) => p.value) as [
  TicketPlatform,
  ...TicketPlatform[],
];

const LABELS: Record<string, string> = Object.fromEntries(
  TICKET_PLATFORMS.map((p) => [p.value, p.label])
);
const BY_LABEL: Record<string, TicketPlatform> = Object.fromEntries(
  TICKET_PLATFORMS.map((p) => [p.label.toLowerCase(), p.value])
);

export function isTicketPlatform(value: unknown): value is TicketPlatform {
  return typeof value === "string" && value in LABELS;
}

/** Human label for a stored value; unknown values pass through unchanged. */
export function formatTicketPlatform(value: string): string {
  return LABELS[value] ?? value;
}

/**
 * The bot predates a platform field on the ticket API and prepends
 * "Platform: <label>" to the description instead. Recover the value from that
 * prefix so those tickets are filterable too.
 */
export function platformFromDescriptionPrefix(description: string): TicketPlatform | undefined {
  const match = /^Platform:\s*([^\n]+)\n/i.exec(description);
  return match ? BY_LABEL[match[1].trim().toLowerCase()] : undefined;
}

/**
 * The description without the bot's "Platform: <label>" line, for anything
 * that reads the player's own words. The labels contain "web browser" and
 * "Mobile", which read as page words and asked for a page on reports that
 * named none (ticket 1448).
 */
export function stripPlatformPrefix(description: string): string {
  return description.replace(/^Platform:\s*[^\n]+\n+/i, "");
}

/**
 * Platform from a user agent. AHDClient appends `AHDClient-Mobile/<v>` (iOS
 * and Android) or `AHDClient-Desktop/<v>`; the old Capacitor Android app sends
 * `AHD-Android`. Single player is the desktop client talking to its own local
 * server, which the caller knows and passes in.
 */
export function platformFromUserAgent(
  userAgent: string | null | undefined,
  options: { singleplayer?: boolean } = {}
): TicketPlatform {
  const ua = userAgent ?? "";
  if (options.singleplayer) return "desktop_singleplayer";
  if (ua.includes("AHDClient-Mobile/")) {
    return /\b(iPhone|iPad|iPod)\b/.test(ua) ? "mobile_ios" : "mobile_android";
  }
  if (ua.includes("AHD-Android")) return "mobile_android";
  if (ua.includes("AHDClient-Desktop/")) return "desktop_client";
  if (/\b(iPhone|iPad|iPod|Android)\b|Mobi/.test(ua)) return "mobile_web";
  return "desktop_web";
}
