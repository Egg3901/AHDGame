import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { BOND_MARKET_POOLS_COLLECTION } from "@/lib/db/types/bondMarketPool";
import type { Bond, Character, Corporation } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";

export type BondSellerKind = "character" | "imperial" | "corporation";

export interface BondSellSpendInput {
  bondId: ObjectId;
  sellerKind: BondSellerKind;
  /** Character, imperial character, or corporation id holding the units. */
  sellerId: ObjectId;
  units: number;
  /** LOCAL proceeds in the bond's currency: pool debit and payout basis. */
  proceedsLocal: number;
  /**
   * Payout credit in the seller's own denomination. Characters and imperials
   * are paid `proceedsLocal` in the bond currency; corporations are paid the
   * FX-normalized `proceedsLocal` in their liquid capital.
   */
  payoutAmount: number;
  /** Bond currency (pool debit + personal payout denomination). */
  bondCurrency: CurrencyCode;
  /** Personal payout field set (`currencyBalances.personal.*` vs `cashOnHand`). */
  forexEnabled: boolean;
  now: Date;
  /**
   * Caller-chosen fingerprint of the intended sale
   * (e.g. `bond-sell:<bondId>:<kind>:<sellerId>:<units>:<proceeds>`). A retry
   * presenting the same key with a different fingerprint is rejected instead
   * of returning the stored outcome for the wrong sale.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same sale replays the stored outcome instead of
   * moving money again. Omit to mint one: the attempt is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated as
   * a new attempt (still guarded by the atomic holder claim).
   */
  idempotencyKey?: string;
}

/** Holder claim failed: units raced, bond defaulted/matured, or row gone. */
export const BOND_SELL_INSUFFICIENT = "BOND_SELL_INSUFFICIENT";
/** Pool debit failed: the market's cash raced below the proceeds. */
export const BOND_SELL_POOL_DEPTH = "BOND_SELL_POOL_DEPTH";
/** Payout failed: the seller row is gone (claim + pool compensated). */
export const BOND_SELL_PAYOUT_MISSING = "BOND_SELL_PAYOUT_MISSING";

function mapSellError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost holder race was `Insufficient
  // bond holdings` (400), a lost pool race was the depth refusal (400 after
  // the upfront 409 pre-check), and a vanished seller was the 404.
  // Anything after money moved compensates the prefix instead of stranding
  // a half-landed sale.
  if (stepName === "holder-claim") return new Error(`${BOND_SELL_INSUFFICIENT}:${outcome}`);
  if (stepName === "pool-debit") return new Error(`${BOND_SELL_POOL_DEPTH}:${outcome}`);
  return new Error(`${BOND_SELL_PAYOUT_MISSING}:${outcome}`);
}

const HOLDER_KEY: Record<BondSellerKind, "characterId" | "imperialCharacterId" | "corporationId"> =
  {
    character: "characterId",
    imperial: "imperialCharacterId",
    corporation: "corporationId",
  };

/**
 * Sell bond units to the currency's bond market pool so the result is
 * exactly-once on every topology (issue #1672). Step order mirrors the
 * historical write order: the positional holder claim lands first, the gated
 * pool debit second, the seller payout third, and a later failure
 * compensates its own prefix (claim refund, pool refund) instead of leaving
 * a strand where the holder lost units but was never paid.
 *
 * The zero-unit holder cleanup stays OUTSIDE the keyed flow as a post-commit
 * best effort: it removes no value (only empty holder rows), so skipping it
 * on failure is harmless, while making it a terminal step would settle
 * `UNCOMPENSATED` on money that already moved.
 *
 * Under real transactions the claim, the pool debit, the payout, and the
 * idempotency receipt join the transaction and commit atomically, preserving
 * the old behavior. On a standalone deployment the fallback runs the same
 * writes as keyed idempotent steps: a crash between any two writes leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to exactly
 * one sale. A retry after a terminal failure throws `MoneyFlowTerminalError`
 * (fail closed); a new attempt needs a new key.
 */
export async function applyBondSellSpend(
  db: Db,
  input: BondSellSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.bondId || !input.sellerId) {
    throw new TypeError("Bond sell spend needs bondId and sellerId");
  }
  if (!Number.isInteger(input.units) || input.units <= 0) {
    throw new RangeError("Bond sell units must be a positive integer");
  }
  if (!Number.isFinite(input.proceedsLocal) || input.proceedsLocal < 0) {
    throw new RangeError("Bond sell proceeds must be finite and non-negative");
  }
  if (!Number.isFinite(input.payoutAmount) || input.payoutAmount < 0) {
    throw new RangeError("Bond sell payout must be finite and non-negative");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond sell idempotency key must be 1-128 characters");
  }

  const holderKey = HOLDER_KEY[input.sellerKind];
  const bonds = db.collection<Bond>("bonds");
  const pools = db.collection(BOND_MARKET_POOLS_COLLECTION);
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const now = input.now;

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    // A fresh claim owns the attempt, so a validation failure settles the
    // receipt `failed` (nothing applied yet — truthful). A resumed
    // `in-progress` claim never settles here: the crashed prefix may have
    // moved money, so it reconciles through the keyed steps below instead.
    const fresh = claim === "fresh";
    if (fresh && input.proceedsLocal === 0) {
      await failMoneyFlowReceipt(receipts, key, `${BOND_SELL_POOL_DEPTH}:zero-proceeds`, opts);
      throw new Error(`${BOND_SELL_POOL_DEPTH}:zero-proceeds`);
    }

    const holderClaimStep: MoneyFlowStep = {
      name: "holder-claim",
      apply: (stepOpts) =>
        applyKeyedUpdate(
          key,
          {
            collection: bonds,
            filter: {
              _id: input.bondId,
              defaulted: false,
              holders: {
                $elemMatch: { [holderKey]: input.sellerId, units: { $gte: input.units } },
              },
            },
            update: {
              $inc: { "holders.$.units": -input.units, publicFloat: input.units },
              $set: { updatedAt: now },
            },
          },
          stepOpts ?? {}
        ),
      revert: (stepOpts) =>
        applyKeyedUpdate(
          deriveMoneyFlowKey(key, "compensate", "holder-claim"),
          {
            collection: bonds,
            filter: { _id: input.bondId, [`holders.${holderKey}`]: input.sellerId },
            update: {
              $inc: { "holders.$.units": input.units, publicFloat: -input.units },
              $set: { updatedAt: now },
            },
          },
          stepOpts ?? {}
        ),
    };

    const poolDebitStep: MoneyFlowStep = {
      name: "pool-debit",
      apply: (stepOpts) =>
        applyKeyedUpdate(
          key,
          {
            collection: pools,
            filter: { _id: input.bondCurrency, cashLocal: { $gte: input.proceedsLocal } },
            update: {
              $inc: { cashLocal: -input.proceedsLocal, "lifetime.salesOut": input.proceedsLocal },
              $set: { updatedAt: now },
            },
          },
          stepOpts ?? {}
        ),
      revert: (stepOpts) =>
        applyKeyedUpdate(
          deriveMoneyFlowKey(key, "compensate", "pool-debit"),
          {
            collection: pools,
            filter: { _id: input.bondCurrency },
            update: {
              $inc: { cashLocal: input.proceedsLocal, "lifetime.salesOut": -input.proceedsLocal },
              $set: { updatedAt: now },
            },
          },
          stepOpts ?? {}
        ),
    };

    const payoutStep: MoneyFlowStep =
      input.sellerKind === "corporation"
        ? makeLegStep(key, {
            name: "seller-payout",
            collection: db.collection<Corporation>("corporations"),
            docId: input.sellerId,
            field: "liquidCapital",
            delta: input.payoutAmount,
            set: { updatedAt: now },
          })
        : makeLegStep(key, {
            name: "seller-payout",
            collection:
              input.sellerKind === "character"
                ? db.collection<Character>("characters")
                : db.collection<ImperialCharacter>("imperialCharacters"),
            docId: input.sellerId,
            field: input.forexEnabled
              ? `currencyBalances.personal.${input.bondCurrency}`
              : "cashOnHand",
            delta: input.payoutAmount,
            set: { updatedAt: now },
          });

    await runMoneyFlowSteps(
      receipts,
      key,
      [holderClaimStep, poolDebitStep, payoutStep],
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => mapSellError(step.name, outcome),
      opts
    );
    return { duplicate: claim === "in-progress" };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
