import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";
import { resolvePollBannerSnapshot, type PollBannerSnapshot } from "@/lib/pollBanner";

/**
 * SERVER half of the poll banner: the cached `gameConfig` read.
 *
 * Split from `@/lib/pollBanner` so the admin editor, which is a client
 * component and needs the validator and the field limits, does not drag the
 * mongodb driver into the browser bundle.
 */
let pollBannerCache: { snapshot: PollBannerSnapshot; expiresAt: number } | null = null;
const POLL_BANNER_CACHE_TTL_MS = 10_000;

/**
 * Drop the in-process snapshot so this process picks up an admin's save on its
 * next request instead of waiting out the TTL. Other server processes still
 * serve their own cached copy until theirs expires, which is the same
 * best-effort behaviour maintenance has.
 */
export function invalidatePollBannerCache(): void {
  pollBannerCache = null;
}

/**
 * Reads the banner from `gameConfig` behind a short TTL. Every page view of
 * every visitor polls this, so the cache is what keeps an announcement banner
 * from turning into a per-request database read.
 */
export async function getCachedPollBanner(): Promise<PollBannerSnapshot> {
  const now = Date.now();
  if (pollBannerCache && now < pollBannerCache.expiresAt) {
    return pollBannerCache.snapshot;
  }

  const db = await getDb();
  const config = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        pollBannerEnabled: 1,
        pollBannerMessage: 1,
        pollBannerLinkLabel: 1,
        pollBannerUrl: 1,
        pollBannerTone: 1,
      },
    }
  );

  const snapshot = resolvePollBannerSnapshot(config);
  pollBannerCache = { snapshot, expiresAt: now + POLL_BANNER_CACHE_TTL_MS };
  return snapshot;
}
