import { COMMUNITY_DISCORD_INVITE_CODE } from "@/lib/communityLinks";

export type DiscordInviteStats = {
  guildName: string;
  memberCount: number;
  onlineCount: number;
};

type DiscordInviteApiResponse = {
  guild?: { name?: string };
  approximate_member_count?: number;
  approximate_presence_count?: number;
};

const INVITE_CODE = COMMUNITY_DISCORD_INVITE_CODE;
const DISCORD_INVITE_API = `https://discord.com/api/v10/invites/${INVITE_CODE}?with_counts=true`;

let cachedStats: DiscordInviteStats | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function parseInviteStats(payload: DiscordInviteApiResponse): DiscordInviteStats | null {
  const memberCount = payload.approximate_member_count;
  const onlineCount = payload.approximate_presence_count;
  if (typeof memberCount !== "number" || typeof onlineCount !== "number") {
    return null;
  }

  return {
    guildName: payload.guild?.name?.trim() || "A House Divided",
    memberCount,
    onlineCount,
  };
}

/** Fetch approximate Discord guild stats via the public invite API. */
export async function fetchDiscordInviteStats(options?: {
  forceRefresh?: boolean;
}): Promise<DiscordInviteStats | null> {
  const now = Date.now();
  if (!options?.forceRefresh && cachedStats && now - cachedAt < CACHE_TTL_MS) {
    return cachedStats;
  }

  try {
    const response = await fetch(DISCORD_INVITE_API, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });

    if (!response.ok) return cachedStats;

    const payload = (await response.json()) as DiscordInviteApiResponse;
    const stats = parseInviteStats(payload);
    if (!stats) return cachedStats;

    cachedStats = stats;
    cachedAt = now;
    return stats;
  } catch {
    return cachedStats;
  }
}
