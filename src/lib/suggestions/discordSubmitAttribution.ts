import type { Suggestion } from "@/lib/db/types/suggestion";

type DiscordSubmitFields = Pick<
  Suggestion,
  "discordSubmitDisplayName" | "discordSubmitUsername" | "discordSubmitUserId"
>;

/** Primary label for forum UI when the suggestion came from Discord without a linked game account. */
export function discordSubmitPrimaryLabel(s: DiscordSubmitFields): string | null {
  const d = s.discordSubmitDisplayName?.trim();
  if (d) return d;
  const u = s.discordSubmitUsername?.trim();
  if (u) return `@${u}`;
  const id = s.discordSubmitUserId?.trim();
  if (id) return `Discord (${id.length > 14 ? `${id.slice(0, 10)}…` : id})`;
  return null;
}

/** Discord handle for the "Discord: …" chip (without @). */
export function discordSubmitHandleForChip(s: DiscordSubmitFields): string | null {
  return s.discordSubmitUsername?.trim() ?? null;
}
