/**
 * Supporter-tier allowances for the public API.
 *
 * Every personal API key starts on the base read allowance
 * ({@link BOT_READ_LIMITS}, 60 req/min per endpoint bucket). Active Supporter+
 * and Supporter++ pledges multiply that allowance on the keys they own, so a
 * supporter's dashboard or bot can poll harder without the operator having to
 * hand out bespoke limits.
 *
 * Plain Supporter is deliberately unchanged: the perk starts at Supporter+.
 */
import { ObjectId } from "mongodb";
import { BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { isPatreonActive, type PatreonTier } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";

/** Multiplier applied to the base public-read allowance, per active tier. */
export const PUBLIC_API_TIER_MULTIPLIERS: Record<Exclude<PatreonTier, null>, number> = {
  supporter: 1,
  "supporter-plus": 1.5,
  "supporter-plus-plus": 3,
};

/**
 * Requests per window allowed for a key owned by `tier`. A lapsed or absent
 * pledge resolves to `null` upstream and lands on the base allowance.
 */
export function publicApiMaxRequests(tier: PatreonTier): number {
  const multiplier = tier ? PUBLIC_API_TIER_MULTIPLIERS[tier] : 1;
  return Math.round(BOT_READ_LIMITS.maxRequests * multiplier);
}

/**
 * How long a resolved tier is trusted before the users collection is read
 * again. Matched to the rate-limit window: a pledge change takes effect on the
 * next window at worst, and a busy key costs at most one extra read per minute.
 */
const TIER_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 10_000;

const tierCache = new Map<string, { tier: PatreonTier; expiresAt: number }>();

function pruneTierCache(now: number) {
  for (const [userId, entry] of tierCache.entries()) {
    if (entry.expiresAt <= now) tierCache.delete(userId);
  }
}

/** Test seam — drops the memoised tiers so cases don't leak into each other. */
export function clearPublicApiTierCache() {
  tierCache.clear();
}

/**
 * Resolve the API key owner's active supporter tier.
 *
 * Fails closed to `null` (base allowance) on a bad id or an unavailable
 * database: a lookup problem must never hand out a larger allowance than the
 * account has earned, and must never fail the request.
 */
export async function resolvePublicApiTier(userId: string): Promise<PatreonTier> {
  const now = Date.now();
  const cached = tierCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.tier;

  let tier: PatreonTier = null;
  try {
    if (ObjectId.isValid(userId)) {
      const db = await getDb();
      const user = await db
        .collection("users")
        .findOne(
          { _id: new ObjectId(userId) },
          { projection: { patreonTier: 1, patreonExpiresAt: 1 } }
        );
      const stored = (user?.patreonTier ?? null) as PatreonTier;
      if (isPatreonActive(stored, user?.patreonExpiresAt ?? null)) tier = stored;
    }
  } catch {
    // Storage unavailable: serve the base allowance rather than 500 the request.
    return null;
  }

  if (tierCache.size > MAX_CACHE_ENTRIES) pruneTierCache(now);
  tierCache.set(userId, { tier, expiresAt: now + TIER_CACHE_TTL_MS });
  return tier;
}
