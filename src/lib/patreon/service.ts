/**
 * Supporter benefits follow their granting provider. Reconciliation writes can
 * require an unchanged provider, linked identity, tier and expiry before applying.
 */
import { ObjectId, type Db, type Filter } from "mongodb";
import { awardAchievement } from "@/lib/achievements";
import { createNotification } from "@/lib/notifications";
import type { PatreonTier, SupporterProvider, User } from "@/lib/db/types";
import { isPatreonActive, isPlusOrBetter } from "@/lib/db/types";
import { getPatreonGracePeriodMs, getPatreonTierMap } from "./config";

export interface ApplyPatreonStatusInput {
  userId: ObjectId;
  tier: PatreonTier;
  expiresAt?: Date | null;
  adsDisabledDefault?: boolean;
  patreonUserId?: string;
  /**
   * Which system is granting these benefits. Defaults to "patreon" so all
   * existing callers keep their current behaviour unchanged. The Discord bot
   * passes "bot" and the Lakeside Stripe webhook passes "stripe".
   */
  provider?: SupporterProvider;
}

export interface PatreonEventIdentity {
  patreonUserId: string;
  tierId?: string;
}

export type SupporterStatusSnapshot = Pick<
  User,
  "supporterProvider" | "patreonUserId" | "patreonTier" | "patreonExpiresAt"
>;

export class PatreonReconcileWriteConflictError extends Error {
  constructor() {
    super("Supporter status changed during Patreon reconciliation");
    this.name = "PatreonReconcileWriteConflictError";
  }
}

function supporterStatusFilter(expected?: SupporterStatusSnapshot): Filter<User> {
  if (!expected) return {};
  return {
    supporterProvider:
      expected.supporterProvider === undefined ? { $exists: false } : expected.supporterProvider,
    patreonUserId:
      expected.patreonUserId === undefined ? { $exists: false } : expected.patreonUserId,
    patreonTier: expected.patreonTier === undefined ? { $exists: false } : expected.patreonTier,
    patreonExpiresAt:
      expected.patreonExpiresAt === undefined ? { $exists: false } : expected.patreonExpiresAt,
  };
}

function checkSupporterWrite(expected: SupporterStatusSnapshot | undefined, matchedCount: number) {
  if (expected && matchedCount !== 1) throw new PatreonReconcileWriteConflictError();
}

export function mapPatreonTierId(tierId?: string | null): PatreonTier {
  if (!tierId) return null;
  return getPatreonTierMap()[tierId] ?? null;
}

export function getGracePeriodEnd(from = new Date()): Date {
  return new Date(from.getTime() + getPatreonGracePeriodMs());
}

export async function findUserByPatreonUserId(db: Db, patreonUserId: string): Promise<User | null> {
  return db.collection<User>("users").findOne({ patreonUserId });
}

export async function applyPatreonStatus(
  db: Db,
  input: ApplyPatreonStatusInput,
  expected?: SupporterStatusSnapshot
): Promise<{ supporterPlusAwarded: boolean }> {
  const existing = await db.collection<User>("users").findOne({ _id: input.userId });
  const nextAdsDisabled =
    input.tier !== null && existing?.patreonTier == null
      ? (input.adsDisabledDefault ?? true)
      : existing?.adsDisabled;
  const nextAdPreference =
    input.tier !== null && existing?.patreonTier == null
      ? "ad-free"
      : existing?.patreonAdPreference;

  const result = await db.collection<User>("users").updateOne(
    { _id: input.userId, ...supporterStatusFilter(expected) },
    {
      $set: {
        patreonTier: input.tier,
        // Record the granting system. Defaults to "patreon" for existing callers.
        // Cleared to null when the tier is removed so a former Stripe subscriber
        // does not stay flagged as Stripe once benefits are gone.
        supporterProvider: input.tier !== null ? (input.provider ?? "patreon") : null,
        patreonExpiresAt: input.expiresAt ?? null,
        adsDisabled: nextAdsDisabled,
        patreonAdPreference: nextAdPreference,
        ...(input.patreonUserId ? { patreonUserId: input.patreonUserId } : {}),
        ...(input.tier !== null && !existing?.patreonSince ? { patreonSince: new Date() } : {}),
      },
    }
  );
  checkSupporterWrite(expected, result.matchedCount);

  let supporterPlusAwarded = false;
  if (isPlusOrBetter(input.tier)) {
    // Supporter++ includes everything Supporter+ does, so it earns the same
    // achievement. characterAchievements unique index includes characterId;
    // omitting it collides across users at null.
    supporterPlusAwarded = await awardAchievement(
      input.userId,
      "patreon_supporter_plus",
      existing?.activeCharacterId
    );
  }

  // Notify user of benefit update
  const tierName =
    input.tier === "supporter-plus-plus"
      ? "Supporter Plus Plus"
      : input.tier === "supporter-plus"
        ? "Supporter Plus"
        : input.tier === "supporter"
          ? "Supporter"
          : null;
  if (tierName) {
    const provider = input.provider ?? "patreon";
    await createNotification({
      userId: input.userId,
      type: "system",
      title: "Supporter Benefits Updated",
      message: `Your supporter benefits have been updated to ${tierName}. Thank you for supporting A House Divided! Check out the latest updates in the changelog.`,
      metadata: {
        tier: input.tier,
        provider,
        patreonUserId: input.patreonUserId,
        changelogUrl: "/changelog",
      },
    });
  }

  return { supporterPlusAwarded };
}

export async function startPatreonGracePeriod(
  db: Db,
  userId: ObjectId,
  from = new Date(),
  expected?: SupporterStatusSnapshot
): Promise<void> {
  const result = await db.collection<User>("users").updateOne(
    { _id: userId, ...supporterStatusFilter(expected) },
    {
      $set: {
        patreonExpiresAt: getGracePeriodEnd(from),
      },
    }
  );
  checkSupporterWrite(expected, result.matchedCount);
}

export async function clearExpiredPatreonBenefits(
  db: Db,
  userId: ObjectId,
  expected?: SupporterStatusSnapshot
): Promise<void> {
  const user = await db.collection<User>("users").findOne({ _id: userId });
  if (!user || isPatreonActive(user.patreonTier ?? null, user.patreonExpiresAt ?? null)) {
    return;
  }

  const result = await db.collection<User>("users").updateOne(
    { _id: userId, ...supporterStatusFilter(expected) },
    {
      $set: {
        patreonTier: null,
        patreonExpiresAt: user.patreonExpiresAt ?? new Date(),
      },
      $unset: {
        patreonProfileBorder: "",
        patreonHighlightColor: "",
      },
    }
  );
  checkSupporterWrite(expected, result.matchedCount);
}
