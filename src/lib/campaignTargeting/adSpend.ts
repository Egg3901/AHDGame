import { randomUUID } from "node:crypto";
import type { ClientSession, Collection, Db, Filter, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyIdempotentLeg,
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  runMoneyFlowSteps,
  type MoneyFlowAccount,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Character, ElectionCandidate } from "@/lib/db/types";
import type { TargetedAd } from "./rules";

export type AdSpendOwnerKind = "candidate" | "character";

/**
 * The ad-inventory row the spend writes: an NPP-bound election candidate
 * (campaign targeting) or a character (standing ads bought for someone
 * else). The spend stores the already-computed purchase result and guards on
 * the revision it was quoted against, so a concurrent purchase fails the
 * guard instead of clobbering.
 */
export interface AdSpendTarget {
  kind: AdSpendOwnerKind;
  ownerDocId: ObjectId;
  /** Ads array to store; computed by the caller before the flow starts. */
  ads: TargetedAd[];
  /**
   * Extra guard clauses merged into the write filter (revision match, active
   * status). Dropped on compensation so a revert is never guard-blocked.
   */
  guardFilter: Record<string, unknown>;
}

export interface AdSpendInput {
  target: AdSpendTarget;
  /** Buyer spending personal actions + campaign funds. */
  payerId: ObjectId;
  costFunds: number;
  costActions: number;
  /** Forex-aware campaign-funds field (`currencyBalances.campaign` / `funds`). */
  fundsField: string;
  /**
   * Caller-chosen fingerprint of the intended purchase
   * (e.g. `payer:owner:state:dimension:bucket:count:turn:cost:revision`). A
   * retry presenting the same key with a different fingerprint is rejected
   * instead of returning the stored outcome for the wrong purchase.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same purchase replays the stored outcome instead
   * of charging again. Omit to mint one: the purchase is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated as
   * a new purchase (still guarded by the revision re-check in the flow).
   */
  idempotencyKey?: string;
}

/** Payer debit leg failed: actions/funds raced, or the payer row is gone. */
export const AD_SPEND_INSUFFICIENT = "AD_SPEND_INSUFFICIENT";
/** Ad-write step failed: the inventory row raced (revision/status guard). */
export const AD_SPEND_CONFLICT = "AD_SPEND_CONFLICT";

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the guarded payer
  // debit (a raced balance was `Insufficient personal actions or campaign
  // funds`, 409). Index 1 is the guarded ad-write (a raced inventory was
  // `... Refresh before buying`, 409); the debit prefix is compensated.
  if (step.index === 0) return new Error(`${AD_SPEND_INSUFFICIENT}:${outcome}`);
  return new Error(`${AD_SPEND_CONFLICT}:${outcome}`);
}

/**
 * Build the payer debit as one leg: actions carry the `minBalance` guard and
 * the funds guard rides `extraFilter`, so the check and the combined debit
 * are one atomic step (same shape as the recruit-spend debit).
 */
function payerDebitStep(key: string, db: Db, input: AdSpendInput, now: Date): MoneyFlowStep {
  return {
    name: "payer-debit",
    apply: (stepOpts) =>
      applyIdempotentLeg(
        key,
        {
          name: "payer-debit",
          collection: db.collection<Character>("characters"),
          docId: input.payerId,
          field: "actions",
          delta: -input.costActions,
          minBalance: input.costActions,
          extraIncs: { [input.fundsField]: -input.costFunds },
          extraFilter: { [input.fundsField]: { $gte: input.costFunds } } as Filter<Character>,
          set: { updatedAt: now },
        },
        stepOpts ?? {}
      ),
    revert: (stepOpts) =>
      applyIdempotentLeg(
        `${key}:compensate:payer-debit`,
        {
          name: "payer-debit",
          collection: db.collection<Character>("characters"),
          docId: input.payerId,
          field: "actions",
          delta: input.costActions,
          extraIncs: { [input.fundsField]: input.costFunds },
          set: { updatedAt: new Date() },
        },
        stepOpts ?? {}
      ),
  };
}

/**
 * Build the guarded ad-inventory write. Terminal step (nothing runs after
 * it), so it carries no inverse: when its guard rejects, our `$set` never
 * applied, so a concurrent purchase's array is left untouched — exactly the
 * old refund-and-throw shape, with the debit prefix compensated by the flow.
 */
function adWriteStep<TDoc extends MoneyFlowAccount>(
  key: string,
  collection: Collection<TDoc>,
  target: AdSpendTarget
): MoneyFlowStep {
  return {
    name: "ad-write",
    apply: (stepOpts) =>
      applyKeyedUpdate(
        key,
        {
          collection,
          filter: { _id: target.ownerDocId, ...target.guardFilter } as Filter<TDoc>,
          update: {
            $set: { targetedAds: target.ads },
            $inc: { targetedAdsRevision: 1 },
          },
        },
        stepOpts ?? {}
      ),
  };
}

async function runAdSpend(
  db: Db,
  input: AdSpendInput,
  buildWriteStep: (key: string) => MoneyFlowStep
): Promise<{ duplicate: boolean }> {
  if (!input.payerId || !input.target.ownerDocId) {
    throw new TypeError("Ad spend needs payerId and ownerDocId");
  }
  if (!Number.isFinite(input.costActions) || input.costActions <= 0) {
    throw new RangeError("Ad costActions must be positive");
  }
  if (!Number.isFinite(input.costFunds) || input.costFunds <= 0) {
    throw new RangeError("Ad costFunds must be positive");
  }
  if (typeof input.fundsField !== "string" || input.fundsField.length === 0) {
    throw new TypeError("Ad spend needs a funds field");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Ad spend idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const now = new Date();
  const writeStep = buildWriteStep(key);

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    // The write step converts a survived write error into a compensatable
    // failure (a real crash runs no code at all): without this a lived-
    // through inventory failure would strand the receipt in_progress.
    const guardedWrite: MoneyFlowStep = {
      name: writeStep.name,
      apply: async (stepOpts) => {
        try {
          return await writeStep.apply!(stepOpts);
        } catch {
          return "guard-rejected";
        }
      },
      ...(writeStep.revert ? { revert: writeStep.revert } : {}),
    };
    await runMoneyFlowSteps(
      receipts,
      key,
      [payerDebitStep(key, db, input, now), guardedWrite],
      mapSpendError,
      opts
    );
    return { duplicate: claim === "in-progress" };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

/**
 * Charge a campaign-targeted ad purchase on an NPP-bound candidate
 * (payer-character debit + guarded candidate inventory write) so the result
 * is exactly-once on every topology (issue #1672).
 *
 * Under real transactions the debit, the write, and the idempotency receipt
 * join the transaction and commit atomically, preserving the old behavior.
 * On a standalone deployment the fallback runs the same writes as keyed
 * idempotent steps: a crash between the debit and the write leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to exactly
 * one charged purchase instead of charging for ads that never landed (or
 * landing them twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export function applyTargetedAdSpend(db: Db, input: AdSpendInput): Promise<{ duplicate: boolean }> {
  if (input.target.kind !== "candidate") {
    throw new TypeError("Targeted ad spend needs a candidate target");
  }
  return runAdSpend(db, input, (key) =>
    adWriteStep(key, db.collection<ElectionCandidate>("electionCandidates"), input.target)
  );
}

/**
 * Charge a standing ad purchase for another character (payer debit + guarded
 * owner inventory write) with the same exactly-once shape. The self-
 * purchase path stays a single atomic update in `standingCommands` and never
 * reaches this flow.
 */
export function applyStandingAdSpend(db: Db, input: AdSpendInput): Promise<{ duplicate: boolean }> {
  if (input.target.kind !== "character") {
    throw new TypeError("Standing ad spend needs a character target");
  }
  return runAdSpend(db, input, (key) =>
    adWriteStep(key, db.collection<Character>("characters"), input.target)
  );
}
