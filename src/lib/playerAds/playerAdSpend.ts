import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import { getPlayerBannerAdsCollection } from "@/lib/db/collections/playerBannerAds";
import {
  claimMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Character } from "@/lib/db/types";
import type { PlayerBannerAd } from "@/lib/db/types/playerBannerAd";

/** Thrown when the turn-window rate limit filled between the pre-check and the spend. */
export class PlayerAdSlotUnavailableError extends Error {
  readonly turnsUntilEligible: number | null;
  constructor(turnsUntilEligible: number | null) {
    super("PLAYER_AD_SLOT_UNAVAILABLE");
    this.name = "PlayerAdSlotUnavailableError";
    this.turnsUntilEligible = turnsUntilEligible;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface PlayerAdSpendInput {
  characterId: ObjectId;
  userId: ObjectId;
  characterName: string;
  countryId: string;
  /**
   * Forex-aware personal balance field
   * (`currencyBalances.personal.<code>` post-forex, `cashOnHand` pre-forex).
   */
  balanceField: string;
  /** Full price when paid; ignored when `isFree`. */
  cost: number;
  /** Free-tier ad: no debit leg, only the deterministic ad-row insert. */
  isFree: boolean;
  imageUrl: string;
  linkUrl?: string;
  altText?: string;
  createdTurn: number;
  currencyCode: string;
  /**
   * Turn-window rate-limit state re-checked inside the flow so a concurrent
   * submit cannot slip past the route's pre-check on either topology.
   */
  windowStartTurn: number;
  maxFree: number;
  windowTurns: number;
  /**
   * Caller-chosen fingerprint of the intended purchase
   * (e.g. `character:turn:paid:cost:currency`). A retry presenting the same
   * key with a different fingerprint is rejected instead of returning the
   * stored outcome for the wrong purchase.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same purchase replays the stored outcome instead
   * of charging again. Omit to mint one: the purchase is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated
   * as a new purchase (still guarded by the window re-check in the flow).
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: the guarded cash debit (a raced
  // balance and a missing row were both `PLAYER_AD_FUNDS_CHANGED`). The
  // terminal ad-row insert can only report applied/already-applied (a
  // duplicate `_id` IS the convergence case); anything else compensates the
  // debit prefix and fails closed.
  if (step.name === "cash-debit") return new Error("PLAYER_AD_FUNDS_CHANGED");
  return new Error(`PLAYER_AD_CONFLICT:${outcome}`);
}

/**
 * Charge a player banner ad (personal cash debit unless free-tier) and record
 * the ad row so the result is exactly-once on every topology (issue #1672).
 *
 * Under real transactions the leg, the row insert, and the idempotency
 * receipt join the transaction and commit atomically, preserving the old
 * behavior. On a standalone deployment the fallback runs the same writes as
 * keyed idempotent steps: a crash between the debit and the insert leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to
 * exactly one charged ad instead of charging for an ad that never landed
 * (or landing it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyPlayerAdSpend(
  db: Db,
  input: PlayerAdSpendInput
): Promise<{ duplicate: boolean; adId: ObjectId }> {
  if (!input.characterId || !input.userId) {
    throw new TypeError("Player ad spend needs characterId and userId");
  }
  if (typeof input.balanceField !== "string" || input.balanceField.length === 0) {
    throw new TypeError("Player ad spend needs a balance field");
  }
  if (!input.isFree && (!Number.isFinite(input.cost) || input.cost <= 0)) {
    throw new RangeError("Player ad cost must be positive");
  }
  if (typeof input.imageUrl !== "string" || input.imageUrl.length === 0) {
    throw new TypeError("Player ad spend needs an imageUrl");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Player ad idempotency key must be 1-128 characters");
  }

  const characters = db.collection<Character>("characters");
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const ads = await getPlayerBannerAdsCollection(db);
  const adId = keyedInsertId(key, "player-ad");
  const now = new Date();
  const costPaid = input.isFree ? 0 : input.cost;

  const ad: PlayerBannerAd = {
    _id: adId,
    characterId: input.characterId,
    userId: input.userId,
    characterName: input.characterName,
    countryId: input.countryId,
    imageUrl: input.imageUrl,
    ...(input.linkUrl ? { linkUrl: input.linkUrl } : {}),
    ...(input.altText ? { altText: input.altText } : {}),
    viewCount: 0,
    isActive: true,
    moderationStatus: "pending",
    createdAt: now,
    createdTurn: input.createdTurn,
    costPaid,
    currencyCode: input.currencyCode,
  };

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    // A completed key replays the stored outcome without re-running the
    // window check: the ad already landed inside this window, so re-checking
    // would 429 the replay instead of converging.
    if (claim === "duplicate") return { duplicate: true as boolean, adId };
    // Window re-check after the claim so a concurrent submit cannot slip past
    // the route's pre-check on either topology. The flow's own deterministic
    // ad `_id` is excluded: a crash-recovery retry must reconcile its
    // already-landed row (replay steps converge, receipt settles completed),
    // not 429 against itself. A raced submit settles no receipt (the throw
    // below leaves `in_progress`, TTL-cleaned); retrying with the same key
    // re-runs this check and converges.
    const recentAds = await ads
      .find(
        {
          characterId: input.characterId,
          createdTurn: { $gte: input.windowStartTurn },
          _id: { $ne: adId },
        },
        { ...opts, projection: { costPaid: 1, createdTurn: 1 } }
      )
      .sort({ createdTurn: -1 })
      .toArray();
    const freeUsed = recentAds.filter((entry) => entry.costPaid === 0).length;
    if (freeUsed >= input.maxFree && recentAds.length > 0) {
      const turnsLeft = Math.max(
        0,
        recentAds[0]!.createdTurn + input.windowTurns - input.createdTurn
      );
      throw new PlayerAdSlotUnavailableError(turnsLeft);
    }
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        ...(input.isFree
          ? []
          : [
              makeLegStep(key, {
                name: "cash-debit",
                collection: characters,
                docId: input.characterId,
                field: input.balanceField,
                delta: -input.cost,
                minBalance: input.cost,
                set: { updatedAt: now },
              }),
            ]),
        makeInsertStep("ad-row", ads, ad),
      ],
      mapSpendError,
      opts
    );
    return { duplicate: claim === "in-progress", adId };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
