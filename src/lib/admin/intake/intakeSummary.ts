import type { Db, Document } from "mongodb";

/**
 * First-party intake funnel, computed from the game database.
 *
 * This is the complete count: every signup method, with or without analytics
 * consent. PostHog only sees the consented subset plus anonymous totals, so
 * this is the number to reconcile against. Staff accounts are excluded.
 */
export interface IntakeDay {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  accounts: number;
  byProvider: Record<string, number>;
  /** Accounts whose first character was created within an hour of signup. */
  characterWithin1h: number;
  characterWithin24h: number;
  /** Accounts with any character, at any time since signup. */
  characterEver: number;
  /**
   * Accounts that loaded the game on a later UTC day than signup, and a week
   * or more after signup. Day-level `users.lastSeenAt` only exists from the
   * rollout of that field, so earlier cohorts read low.
   */
  seenAfterSignupDay: number;
  seenAfter7Days: number;
}

export interface IntakeSummary {
  since: string;
  days: IntakeDay[];
  totals: Omit<IntakeDay, "date">;
  /** Accounts by first-party acquisition source (referring domain or "none"). */
  byReferrerDomain: Record<string, number>;
  byUtmSource: Record<string, number>;
}

const DAY_MS = 86_400_000;

/** Provider is derived inside the database so password hashes never leave it. */
const PROVIDER_EXPR = {
  $switch: {
    branches: [
      { case: { $gt: [{ $strLenCP: { $ifNull: ["$password", ""] } }, 0] }, then: "email" },
      { case: { $ifNull: ["$googleId", false] }, then: "google" },
      { case: { $ifNull: ["$discordId", false] }, then: "discord" },
      { case: { $ifNull: ["$appleId", false] }, then: "apple" },
    ],
    default: "unknown",
  },
};

interface Row {
  _id: unknown;
  createdAt: Date;
  provider: string;
  lastSeenAt?: Date;
  referrerDomain?: string;
  utmSource?: string;
  firstCharacterAt?: Date | null;
}

function emptyDay(date: string): IntakeDay {
  return {
    date,
    accounts: 0,
    byProvider: {},
    characterWithin1h: 0,
    characterWithin24h: 0,
    characterEver: 0,
    seenAfterSignupDay: 0,
    seenAfter7Days: 0,
  };
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

export async function computeIntakeSummary(
  db: Db,
  days: number,
  now = new Date()
): Promise<IntakeSummary> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = new Date(end.getTime() - (days - 1) * DAY_MS);

  const firstCharacter = (collection: string): Document => ({
    $lookup: {
      from: collection,
      let: { uid: "$_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
        { $group: { _id: null, first: { $min: "$createdAt" } } },
      ],
      as: collection,
    },
  });

  const rows = (await db
    .collection("users")
    .aggregate([
      {
        $match: {
          createdAt: { $gte: since },
          isAdmin: { $ne: true },
          role: { $nin: ["admin", "moderator"] },
        },
      },
      firstCharacter("characters"),
      firstCharacter("retiredCharacters"),
      {
        $project: {
          createdAt: 1,
          lastSeenAt: 1,
          provider: PROVIDER_EXPR,
          referrerDomain: "$acquisition.referrerDomain",
          utmSource: "$acquisition.utmSource",
          firstCharacterAt: {
            $min: [{ $first: "$characters.first" }, { $first: "$retiredCharacters.first" }],
          },
        },
      },
    ])
    .toArray()) as Row[];

  const dayMap = new Map<string, IntakeDay>();
  for (let t = since.getTime(); t <= end.getTime(); t += DAY_MS) {
    const key = new Date(t).toISOString().slice(0, 10);
    dayMap.set(key, emptyDay(key));
  }
  const totals = emptyDay("total");
  const byReferrerDomain: Record<string, number> = {};
  const byUtmSource: Record<string, number> = {};

  for (const row of rows) {
    if (!(row.createdAt instanceof Date)) continue;
    const key = row.createdAt.toISOString().slice(0, 10);
    const day = dayMap.get(key);
    if (!day) continue;
    const created = row.createdAt.getTime();
    const signupDayEnd =
      Date.UTC(
        row.createdAt.getUTCFullYear(),
        row.createdAt.getUTCMonth(),
        row.createdAt.getUTCDate()
      ) + DAY_MS;
    const firstChar = row.firstCharacterAt instanceof Date ? row.firstCharacterAt.getTime() : null;
    const seen = row.lastSeenAt instanceof Date ? row.lastSeenAt.getTime() : null;

    for (const target of [day, totals]) {
      target.accounts++;
      bump(target.byProvider, row.provider);
      if (firstChar !== null) {
        target.characterEver++;
        if (firstChar - created <= 3_600_000) target.characterWithin1h++;
        if (firstChar - created <= DAY_MS) target.characterWithin24h++;
      }
      if (seen !== null && seen >= signupDayEnd) target.seenAfterSignupDay++;
      if (seen !== null && seen >= created + 7 * DAY_MS) target.seenAfter7Days++;
    }
    bump(byReferrerDomain, row.referrerDomain ?? "none");
    if (row.utmSource) bump(byUtmSource, row.utmSource);
  }

  const { date: _ignored, ...totalCounts } = totals;
  void _ignored;
  return {
    since: since.toISOString(),
    days: [...dayMap.values()],
    totals: totalCounts,
    byReferrerDomain,
    byUtmSource,
  };
}
