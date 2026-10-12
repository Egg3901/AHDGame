import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

export const PROMO_GRANTS_COLLECTION = "promoGrants";

/** A pending attempt older than this is presumed dead and may be retried. */
export const PROMO_GRANT_STALE_PENDING_MS = 10 * 60 * 1000;

export type PromoGrantStatus = "pending" | "granted" | "failed";

/**
 * One claim of one promotional campaign by one player. The unique indexes on
 * `{campaign, userId}` and `{campaign, discordId}` make the database the
 * once-per-player guard, so concurrent claims cannot both insert.
 */
export interface PromoGrant {
  _id: ObjectId;
  campaign: string;
  userId: ObjectId;
  discordId: string;
  characterId: ObjectId;
  characterName: string;
  countryId: string;
  claimRef: string;
  amountAnchor: number;
  currency: CurrencyCode;
  amountLocal: number;
  rate: number;
  status: PromoGrantStatus;
  createdAt: Date;
  /** Start of the most recent credit attempt; drives stale-pending detection. */
  attemptStartedAt: Date;
  attempts: number;
  grantedAt: Date | null;
  failedAt?: Date;
  error?: string;
}

export function getPromoGrantsCollection(db: Db) {
  return db.collection<PromoGrant>(PROMO_GRANTS_COLLECTION);
}

let indexesReady: Promise<void> | null = null;

/**
 * Create the uniqueness indexes once per process. `createIndex` is idempotent,
 * so a cold start or a second instance re-running it is harmless. A failure
 * clears the memo so the next request tries again instead of granting
 * without the guard.
 */
export function ensurePromoGrantIndexes(db: Db): Promise<void> {
  if (!indexesReady) {
    const col = getPromoGrantsCollection(db);
    indexesReady = Promise.all([
      col.createIndex({ campaign: 1, userId: 1 }, { unique: true, name: "campaign_user_unique" }),
      col.createIndex(
        { campaign: 1, discordId: 1 },
        { unique: true, name: "campaign_discord_unique" }
      ),
    ]).then(
      () => undefined,
      (error: unknown) => {
        indexesReady = null;
        throw error;
      }
    );
  }
  return indexesReady;
}

/** Test hook: forget the memoized index creation. */
export function resetPromoGrantIndexMemo(): void {
  indexesReady = null;
}
