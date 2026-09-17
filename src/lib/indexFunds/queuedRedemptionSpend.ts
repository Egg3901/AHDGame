import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db, Filter } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  runMoneyFlowSteps,
  type MoneyFlowAccount,
  type MoneyFlowLegOutcome,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { IndexFundTransaction } from "@/lib/db/types";
import {
  FUND_REDEMPTION_QUEUE_COLLECTION,
  type IndexFundRedemptionQueueEntry,
} from "@/lib/indexFunds/fundQueries";
import { resolveIndexFundHolder, logIndexFundRedeem } from "@/lib/indexFunds/fundTxLog";

/** Fund debit lost its race (cash drained) or the fund row went: caller breaks the pass. */
export const QUEUED_REDEMPTION_FUNDS = "QUEUED_REDEMPTION_FUNDS";
/** Holder credit failed (unknown holder kind, or the holder row went): caller restores and continues. */
export const QUEUED_REDEMPTION_HOLDER = "QUEUED_REDEMPTION_HOLDER";
/** Queue settle lost its race: caller leaves the row quarantined and continues. */
export const QUEUED_REDEMPTION_QUEUE = "QUEUED_REDEMPTION_QUEUE";
/** Redemption audit-row insert failed after the prefix applied: prefix compensated, caller retries next turn. */
export const QUEUED_REDEMPTION_TX = "QUEUED_REDEMPTION_TX";

/** Domain for the deterministic redemption audit-row `_id` derived from the flow key. */
const TX_INSERT_DOMAIN = "indexfund-queued-redemption-tx";

/** Holder targets the queued payout can credit. `unknown` is the legacy no-holder row. */
export type QueuedRedemptionHolderKind = "character" | "imperial_character" | "npp" | "unknown";

export interface QueuedRedemptionSpendInput {
  fundId: ObjectId;
  fundSlug: string;
  fundName: string;
  fundTicker: string;
  anchorCurrencyCode: string;
  /** Queue row being paid. */
  entryId: ObjectId;
  holderKind: QueuedRedemptionHolderKind;
  characterId?: ObjectId;
  imperialCharacterId?: ObjectId;
  nppId?: ObjectId;
  /** `paidAmountAnchor` on the row before this payout, for stable resume. */
  entryPaidBefore: number;
  /** Whole units still owed before this payout. */
  unitsRemaining: number;
  /** Forward-priced NAV struck by the caller (the fund's current quoted NAV). */
  redemptionNav: number;
  /** Pinned ticket-#857 grandfather multiplier for wallet credits. */
  redeemFxRate: number;
  forexEnabled: boolean;
  /** Native-currency wallet credit actually moved (paidAmount x redeemFxRate when forex is on). */
  paidNative: number;
  /** This entry's pro-rata slice of available cash, pinned by the caller. */
  cashForThisEntry: number;
  /** Whole units this payout settles (floor of slice / NAV, at least 1). */
  redeemableUnits: number;
  /** Anchor actually moved (redeemableUnits x NAV). */
  paidAmount: number;
  /** Units still owed after this payout. */
  remainingAfterPay: number;
  /** False for rows whose supply burned at request time (no unitSupply write). */
  shouldBurnUnitsNow: boolean;
  /** Cron turn, for keying and the holder log. */
  turn: number;
  /**
   * Caller-chosen fingerprint of the intended payout (see
   * `buildQueuedRedemptionFingerprint`). A retry with the same key and
   * fingerprint reconciles the stored plan; a different fingerprint is a
   * different payout and stays a `MoneyFlowKeyConflictError`.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key. The cron derives one per entry and turn
   * (see `buildQueuedRedemptionKey`) so a same-turn retry resumes instead of
   * double-paying. Omit to mint one: the attempt is still crash-safe within
   * itself, but a client retry mints a new key and is treated as a new payout
   * (still guarded by the atomic debit).
   */
  idempotencyKey?: string;
}

/**
 * Deterministic idempotency key for one queued payout: one entry is visited at
 * most once per pass, so entry + turn names the attempt. A same-turn retry
 * (crash recovery, same-turn double-fire) reuses it and reconciles; next
 * turn's remainder gets a new key.
 */
export function buildQueuedRedemptionKey(entryId: ObjectId, turn: number): string {
  return `queued-redemption:${entryId.toHexString()}:turn:${turn}`;
}

/**
 * Deterministic fingerprint for a queued payout attempt. Covers the operation
 * identity (fund, entry, holder, turn) plus every pinned amount, so a key
 * reused for a different payout fails closed instead of replaying the wrong
 * outcome.
 */
export function buildQueuedRedemptionFingerprint(input: {
  fundId: ObjectId;
  entryId: ObjectId;
  holderKind: QueuedRedemptionHolderKind;
  holderId?: ObjectId;
  unitsRemaining: number;
  redemptionNav: number;
  redeemFxRate: number;
  paidNative: number;
  redeemableUnits: number;
  paidAmount: number;
  remainingAfterPay: number;
  turn: number;
}): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  return [
    "queued-redemption",
    input.fundId.toHexString(),
    input.entryId.toHexString(),
    input.holderKind,
    input.holderId ? input.holderId.toHexString() : "none",
    `units:${input.unitsRemaining}`,
    `nav:${cents(input.redemptionNav)}`,
    `fx:${cents(input.redeemFxRate)}`,
    `native:${cents(input.paidNative)}`,
    `redeemable:${input.redeemableUnits}`,
    `paid:${cents(input.paidAmount)}`,
    `remaining:${input.remainingAfterPay}`,
    `turn:${input.turn}`,
  ].join(":");
}

/** Stored payout numbers, written post-commit so a replay reports stably. */
export interface QueuedRedemptionOutcome {
  paidAmountAnchor: number;
  redeemableUnits: number;
  remainingUnits: number;
  entryStatus: "paid" | "partial";
}

export function isQueuedRedemptionOutcome(value: unknown): value is QueuedRedemptionOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return (
    typeof outcome.paidAmountAnchor === "number" &&
    typeof outcome.redeemableUnits === "number" &&
    typeof outcome.remainingUnits === "number" &&
    (outcome.entryStatus === "paid" || outcome.entryStatus === "partial")
  );
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any money moves. A same-key retry after a crash rebuilds its
 * steps from THIS plan, never from the caller's live input: the cron derives
 * every payout from live pass state (available cash, pro-rata share, current
 * NAV), so post-crash input is computed from post-debit reads and running it
 * would double-pay or misprice. Resuming the stored plan keeps the fund
 * debit, the holder credit, the queue settle, and every compensation inverse
 * at exactly the attempted amounts.
 *
 * The liquidity pre-steps (equity and bond sales that raised the cash) stay
 * caller-side convergent pre-steps: a sale is an exchange, not a strand, so
 * re-running them is safe and they need no pinning here.
 */
export interface QueuedRedemptionStoredPlan {
  version: 1;
  fundIdHex: string;
  fundSlug: string;
  fundName: string;
  fundTicker: string;
  anchorCurrencyCode: string;
  entryIdHex: string;
  holderKind: QueuedRedemptionHolderKind;
  characterIdHex: string | null;
  imperialCharacterIdHex: string | null;
  nppIdHex: string | null;
  entryPaidBefore: number;
  unitsRemaining: number;
  redemptionNav: number;
  redeemFxRate: number;
  forexEnabled: boolean;
  paidNative: number;
  cashForThisEntry: number;
  redeemableUnits: number;
  paidAmount: number;
  remainingAfterPay: number;
  shouldBurnUnitsNow: boolean;
  turn: number;
  nowIso: string;
  outcome?: QueuedRedemptionOutcome;
}

function toStoredPlan(input: QueuedRedemptionSpendInput, now: Date): QueuedRedemptionStoredPlan {
  return {
    version: 1,
    fundIdHex: input.fundId.toHexString(),
    fundSlug: input.fundSlug,
    fundName: input.fundName,
    fundTicker: input.fundTicker,
    anchorCurrencyCode: input.anchorCurrencyCode,
    entryIdHex: input.entryId.toHexString(),
    holderKind: input.holderKind,
    characterIdHex: input.characterId ? input.characterId.toHexString() : null,
    imperialCharacterIdHex: input.imperialCharacterId
      ? input.imperialCharacterId.toHexString()
      : null,
    nppIdHex: input.nppId ? input.nppId.toHexString() : null,
    entryPaidBefore: input.entryPaidBefore,
    unitsRemaining: input.unitsRemaining,
    redemptionNav: input.redemptionNav,
    redeemFxRate: input.redeemFxRate,
    forexEnabled: input.forexEnabled,
    paidNative: input.paidNative,
    cashForThisEntry: input.cashForThisEntry,
    redeemableUnits: input.redeemableUnits,
    paidAmount: input.paidAmount,
    remainingAfterPay: input.remainingAfterPay,
    shouldBurnUnitsNow: input.shouldBurnUnitsNow,
    turn: input.turn,
    nowIso: now.toISOString(),
  };
}

function isStoredPlan(value: unknown): value is QueuedRedemptionStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.fundIdHex === "string" &&
    typeof plan.entryIdHex === "string" &&
    typeof plan.holderKind === "string" &&
    typeof plan.anchorCurrencyCode === "string"
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type QueuedRedemptionReceipt = MoneyFlowReceipt & { queuedRedemptionPlan?: unknown };

interface NormalizedRedemptionPlan {
  fundId: ObjectId;
  fundSlug: string;
  fundName: string;
  fundTicker: string;
  anchorCurrencyCode: string;
  entryId: ObjectId;
  holderKind: QueuedRedemptionHolderKind;
  characterId: ObjectId | null;
  imperialCharacterId: ObjectId | null;
  nppId: ObjectId | null;
  entryPaidBefore: number;
  unitsRemaining: number;
  redemptionNav: number;
  redeemFxRate: number;
  forexEnabled: boolean;
  paidNative: number;
  cashForThisEntry: number;
  redeemableUnits: number;
  paidAmount: number;
  remainingAfterPay: number;
  shouldBurnUnitsNow: boolean;
  turn: number;
  now: Date;
  outcome?: QueuedRedemptionOutcome;
}

function planFromInput(live: QueuedRedemptionSpendInput, now: Date): NormalizedRedemptionPlan {
  return {
    fundId: live.fundId,
    fundSlug: live.fundSlug,
    fundName: live.fundName,
    fundTicker: live.fundTicker,
    anchorCurrencyCode: live.anchorCurrencyCode,
    entryId: live.entryId,
    holderKind: live.holderKind,
    characterId: live.characterId ?? null,
    imperialCharacterId: live.imperialCharacterId ?? null,
    nppId: live.nppId ?? null,
    entryPaidBefore: live.entryPaidBefore,
    unitsRemaining: live.unitsRemaining,
    redemptionNav: live.redemptionNav,
    redeemFxRate: live.redeemFxRate,
    forexEnabled: live.forexEnabled,
    paidNative: live.paidNative,
    cashForThisEntry: live.cashForThisEntry,
    redeemableUnits: live.redeemableUnits,
    paidAmount: live.paidAmount,
    remainingAfterPay: live.remainingAfterPay,
    shouldBurnUnitsNow: live.shouldBurnUnitsNow,
    turn: live.turn,
    now,
  };
}

function planFromStored(stored: QueuedRedemptionStoredPlan): NormalizedRedemptionPlan {
  return {
    fundId: new ObjectId(stored.fundIdHex),
    fundSlug: stored.fundSlug,
    fundName: stored.fundName,
    fundTicker: stored.fundTicker,
    anchorCurrencyCode: stored.anchorCurrencyCode,
    entryId: new ObjectId(stored.entryIdHex),
    holderKind: stored.holderKind,
    characterId: stored.characterIdHex ? new ObjectId(stored.characterIdHex) : null,
    imperialCharacterId: stored.imperialCharacterIdHex
      ? new ObjectId(stored.imperialCharacterIdHex)
      : null,
    nppId: stored.nppIdHex ? new ObjectId(stored.nppIdHex) : null,
    entryPaidBefore: stored.entryPaidBefore,
    unitsRemaining: stored.unitsRemaining,
    redemptionNav: stored.redemptionNav,
    redeemFxRate: stored.redeemFxRate,
    forexEnabled: stored.forexEnabled,
    paidNative: stored.paidNative,
    cashForThisEntry: stored.cashForThisEntry,
    redeemableUnits: stored.redeemableUnits,
    paidAmount: stored.paidAmount,
    remainingAfterPay: stored.remainingAfterPay,
    shouldBurnUnitsNow: stored.shouldBurnUnitsNow,
    turn: stored.turn,
    now: new Date(stored.nowIso),
    outcome:
      stored.outcome && isQueuedRedemptionOutcome(stored.outcome)
        ? { ...stored.outcome }
        : undefined,
  };
}

function planOutcome(plan: NormalizedRedemptionPlan): QueuedRedemptionOutcome {
  if (plan.outcome) return { ...plan.outcome };
  // A completed receipt always carries the stored outcome; this fallback only
  // runs when the process crashed between settling `completed` and writing
  // the outcome row. Every number is pinned in the plan, so no live read is
  // needed and the report is exactly the attempted payout.
  return {
    paidAmountAnchor: plan.paidAmount,
    redeemableUnits: plan.redeemableUnits,
    remainingUnits: plan.remainingAfterPay,
    entryStatus: plan.remainingAfterPay <= 0 ? "paid" : "partial",
  };
}

function mapRedemptionError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost cash race breaks the pass (the
  // old guarded debit restored the claim and broke out of the loop), a gone
  // holder restores the claim and moves on (the old code refunded the fund
  // debit, which compensation now does), and a lost queue race quarantines
  // the row for ops instead of paying twice.
  if (stepName === "fund-debit") return new Error(`${QUEUED_REDEMPTION_FUNDS}:${outcome}`);
  if (stepName === "holder-credit") return new Error(`${QUEUED_REDEMPTION_HOLDER}:${outcome}`);
  if (stepName === "queue-settle") return new Error(`${QUEUED_REDEMPTION_QUEUE}:${outcome}`);
  return new Error(`${QUEUED_REDEMPTION_TX}:${outcome}`);
}

function holderCollectionFor(kind: QueuedRedemptionHolderKind): string | null {
  if (kind === "character") return "characters";
  if (kind === "imperial_character") return "imperialCharacters";
  if (kind === "npp") return "npps";
  return null;
}

function buildRedemptionSteps(
  db: Db,
  key: string,
  plan: NormalizedRedemptionPlan
): MoneyFlowStep[] {
  const funds = db.collection<MoneyFlowAccount>("indexFunds");
  const queue = db.collection<MoneyFlowAccount>(FUND_REDEMPTION_QUEUE_COLLECTION);
  const txs = db.collection<IndexFundTransaction>("indexFundTransactions");

  // Legacy-burn rows also require supply because their units were not
  // burned at request time. Both guards ride one atomic write (one leg: two
  // legs on one document under one key would collide and skip the second).
  const debitStep = makeLegStep(deriveMoneyFlowKey(key, "fund-debit"), {
    name: "fund-debit",
    collection: funds,
    docId: plan.fundId,
    field: "cashAnchor",
    delta: -plan.paidAmount,
    minBalance: plan.paidAmount,
    ...(plan.shouldBurnUnitsNow
      ? {
          extraIncs: { unitSupply: -plan.redeemableUnits },
          extraFilter: { unitSupply: { $gte: plan.redeemableUnits } } as Filter<MoneyFlowAccount>,
        }
      : {}),
    set: { updatedAt: plan.now },
  });

  // The holder credit mirrors the legacy per-kind credit exactly: personal
  // wallet credits use the pinned native figure (paidAmount x redeemFxRate),
  // NPP credits move anchor. A row with no holder target (the legacy
  // unknown-holder path, which refunded the fund and restored the claim) is a
  // guard-rejected step so the applied fund debit compensates instead of
  // stranding paid-but-unowned cash.
  const holderStep: MoneyFlowStep = (() => {
    const collectionName = holderCollectionFor(plan.holderKind);
    const holderId = plan.characterId ?? plan.imperialCharacterId ?? plan.nppId;
    if (collectionName === null || holderId === null) {
      return {
        name: "holder-credit",
        apply: async () => "guard-rejected" as MoneyFlowLegOutcome,
      };
    }
    if (plan.holderKind === "npp") {
      return makeLegStep(deriveMoneyFlowKey(key, "holder-credit"), {
        name: "holder-credit",
        collection: db.collection<MoneyFlowAccount>(collectionName),
        docId: holderId,
        field: "nppInvestmentCashAnchor",
        delta: plan.paidAmount,
        set: { updatedAt: plan.now },
      });
    }
    const inc = buildPersonalBalanceInc(
      plan.paidNative,
      plan.anchorCurrencyCode as CurrencyCode,
      plan.forexEnabled
    );
    const entries = Object.entries(inc);
    const [field, delta] = entries[0]!;
    const extraIncs = Object.fromEntries(entries.slice(1));
    return makeLegStep(deriveMoneyFlowKey(key, "holder-credit"), {
      name: "holder-credit",
      collection: db.collection<MoneyFlowAccount>(collectionName),
      docId: holderId,
      field,
      delta,
      ...(Object.keys(extraIncs).length > 0 ? { extraIncs } : {}),
      set: { updatedAt: plan.now },
    });
  })();

  const settleKey = deriveMoneyFlowKey(key, "queue-settle");
  const postImage = {
    status: plan.remainingAfterPay <= 0 ? "paid" : "partial",
    paidAmountAnchor: plan.entryPaidBefore + plan.paidAmount,
    units: plan.remainingAfterPay,
    requestedAmountAnchor: plan.remainingAfterPay * plan.redemptionNav,
  };
  const queueSettleStep: MoneyFlowStep = {
    name: "queue-settle",
    apply: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const outcome = await applyKeyedUpdate(
        settleKey,
        {
          collection: queue,
          filter: { _id: plan.entryId, status: "processing" } as Filter<MoneyFlowAccount>,
          update: {
            $set: { ...postImage, updatedAt: plan.now },
            $unset: { processingStartedAt: "" },
          },
        },
        opts
      );
      if (outcome === "applied" || outcome === "already-applied") return outcome;
      // The row left `processing` without this step applying (an operator
      // restored it, or a legacy write landed first). Converge instead of
      // double-paying or clawing back a credited holder: when the row already
      // shows this payout, the step is done; otherwise fail closed so the
      // applied prefix compensates for ops.
      const live = (await queue.findOne({ _id: plan.entryId } as Filter<MoneyFlowAccount>, {
        projection: { status: 1, paidAmountAnchor: 1, units: 1, appliedMoneyFlowKeys: 1 },
        ...(opts.session ? { session: opts.session } : {}),
      })) as unknown as
        | (Pick<IndexFundRedemptionQueueEntry, "status" | "paidAmountAnchor" | "units"> &
            MoneyFlowAccount)
        | null;
      if (!live) return "missing";
      if (live.appliedMoneyFlowKeys?.includes(settleKey)) return "already-applied";
      if (
        (live.status === "paid" || live.status === "partial") &&
        live.paidAmountAnchor === postImage.paidAmountAnchor &&
        live.units === postImage.units
      ) {
        return "already-applied";
      }
      return "guard-rejected";
    },
    revert: (stepOpts) =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(settleKey, "compensate", "queue-settle"),
        {
          collection: queue,
          filter: { _id: plan.entryId } as Filter<MoneyFlowAccount>,
          update: {
            $set: {
              status: "processing",
              paidAmountAnchor: plan.entryPaidBefore,
              units: plan.unitsRemaining,
              processingStartedAt: plan.now,
              updatedAt: plan.now,
            },
          },
        },
        stepOpts ?? {}
      ),
  };

  // Terminal: nothing runs after it, so it carries no inverse. A survived
  // insert error compensates the prefix instead of stranding paid cash with
  // no audit row. The `_id` derives from the flow key, so a crash between
  // the insert and the receipt completion converges instead of duplicating
  // the row.
  const txStep = makeInsertStep("redemption-tx", txs, {
    _id: keyedInsertId(key, TX_INSERT_DOMAIN),
    fundId: plan.fundId,
    kind: "redemption",
    holderKind:
      plan.holderKind === "unknown"
        ? "character"
        : (plan.holderKind as "character" | "imperial_character" | "npp"),
    ...(plan.characterId ? { characterId: plan.characterId } : {}),
    ...(plan.imperialCharacterId ? { imperialCharacterId: plan.imperialCharacterId } : {}),
    ...(plan.nppId ? { nppId: plan.nppId } : {}),
    units: plan.redeemableUnits,
    navAnchor: plan.redemptionNav,
    amountAnchor: plan.paidAmount,
    note: "Paid from queued redemption",
    createdAt: plan.now,
  } satisfies IndexFundTransaction);

  return [debitStep, holderStep, queueSettleStep, txStep];
}

/**
 * Pay one queued index-fund redemption slice (fund debit + holder credit +
 * queue settle + audit row) so the result is exactly-once on every topology
 * (issue #1672).
 *
 * Step order mirrors the historical write order, and a later-step failure
 * compensates its own prefix (fund refunded, holder clawed back, queue claim
 * restored) instead of leaving a strand where the fund paid but the holder
 * was never credited, or the holder was credited but the queue still shows
 * the units as owed.
 *
 * Fan-out keying: every step carries its own idempotent sub-operation key
 * derived from the flow key via `deriveMoneyFlowKey` (`fund-debit`,
 * `holder-credit`, `queue-settle` suffixes, plus the deterministic audit-row
 * `_id`), so a crash between any two writes resumes per step: applied steps
 * report `already-applied` and are skipped while the rest still land.
 *
 * The caller (the cron pass) owns everything ambient: queue ordering,
 * liquidity pre-steps, the FX-availability gate, pro-rata slicing, and the
 * forward-priced NAV. Those arrive here as pinned amounts on the input and
 * are persisted on the receipt plan at claim time, so a same-key retry never
 * recomputes them from post-debit state.
 *
 * Under real transactions the debit, the credit, the settle, the audit row,
 * and the idempotency receipt join the transaction and commit atomically,
 * preserving the old behavior. On a standalone deployment the fallback runs
 * the same writes as keyed idempotent steps: a crash between them leaves an
 * `in_progress` receipt, and retrying with the same key and fingerprint
 * reconciles to exactly one payout. A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyQueuedRedemptionSpend(
  db: Db,
  input: QueuedRedemptionSpendInput
): Promise<{ duplicate: boolean; outcome: QueuedRedemptionOutcome }> {
  if (!input.fundId) {
    throw new TypeError("Queued redemption spend needs fundId");
  }
  if (!input.entryId) {
    throw new TypeError("Queued redemption spend needs entryId");
  }
  if (typeof input.anchorCurrencyCode !== "string" || input.anchorCurrencyCode.length === 0) {
    throw new TypeError("Queued redemption spend needs anchorCurrencyCode");
  }
  if (!Number.isInteger(input.unitsRemaining) || input.unitsRemaining <= 0) {
    throw new RangeError("Queued redemption unitsRemaining must be a positive integer");
  }
  if (!Number.isFinite(input.redemptionNav) || input.redemptionNav <= 0) {
    throw new RangeError("Queued redemption redemptionNav must be a positive finite amount");
  }
  if (!Number.isFinite(input.redeemFxRate) || input.redeemFxRate < 0) {
    throw new RangeError("Queued redemption redeemFxRate must be a finite non-negative amount");
  }
  if (!Number.isInteger(input.redeemableUnits) || input.redeemableUnits <= 0) {
    throw new RangeError("Queued redemption redeemableUnits must be a positive integer");
  }
  if (!Number.isInteger(input.remainingAfterPay) || input.remainingAfterPay < 0) {
    throw new RangeError("Queued redemption remainingAfterPay must be a non-negative integer");
  }
  if (input.redeemableUnits + input.remainingAfterPay !== input.unitsRemaining) {
    throw new RangeError("Queued redemption slice must partition the remaining units");
  }
  if (!Number.isFinite(input.paidAmount) || input.paidAmount <= 0) {
    throw new RangeError("Queued redemption paidAmount must be a positive finite amount");
  }
  if (!Number.isFinite(input.paidNative) || input.paidNative < 0) {
    throw new RangeError("Queued redemption paidNative must be a finite non-negative amount");
  }
  if (!Number.isFinite(input.entryPaidBefore) || input.entryPaidBefore < 0) {
    throw new RangeError("Queued redemption entryPaidBefore must be a finite non-negative amount");
  }
  if (!Number.isFinite(input.cashForThisEntry) || input.cashForThisEntry < 0) {
    throw new RangeError("Queued redemption cashForThisEntry must be a finite non-negative amount");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Queued redemption idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<QueuedRedemptionReceipt>;
  const now = new Date();

  const persistOutcome = async (
    plan: NormalizedRedemptionPlan,
    opts: { session?: ClientSession }
  ): Promise<QueuedRedemptionOutcome> => {
    const outcome = planOutcome(plan);
    await receiptCollection.updateOne(
      { _id: key },
      {
        $set: {
          queuedRedemptionPlan: { ...toStoredPlanLike(plan), outcome },
          updatedAt: new Date(),
        },
      },
      opts.session ? { session: opts.session } : {}
    );
    return outcome;
  };

  const runPlan = async (
    plan: NormalizedRedemptionPlan,
    opts: { session?: ClientSession }
  ): Promise<QueuedRedemptionOutcome> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildRedemptionSteps(db, key, plan),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) =>
        mapRedemptionError(step.name, outcome),
      opts
    );
    return persistOutcome(plan, opts);
  };

  /** Post-commit holder notification (best effort, like the legacy void log). */
  const notifyHolder = (plan: NormalizedRedemptionPlan): void => {
    if (plan.holderKind !== "character" && plan.holderKind !== "imperial_character") return;
    const notify = async (): Promise<void> => {
      const holder = await resolveIndexFundHolder(db, {
        holderKind: plan.holderKind as "character" | "imperial_character",
        ...(plan.characterId ? { characterId: plan.characterId } : {}),
        ...(plan.imperialCharacterId ? { imperialCharacterId: plan.imperialCharacterId } : {}),
      });
      if (!holder) return;
      await logIndexFundRedeem(db, {
        fund: {
          _id: plan.fundId,
          slug: plan.fundSlug,
          name: plan.fundName,
          tickerSymbol: plan.fundTicker,
          anchorCurrencyCode: plan.anchorCurrencyCode,
        },
        holder,
        units: plan.redeemableUnits,
        navAnchor: plan.redemptionNav,
        amountAnchor: plan.paidAmount,
        source: "cron_queue",
        queuedRemainder: plan.remainingAfterPay,
        turn: plan.turn,
      });
    };
    void notify();
  };

  const runSpend = async (
    session?: ClientSession
  ): Promise<{ duplicate: boolean; outcome: QueuedRedemptionOutcome }> => {
    const opts = session ? { session } : {};
    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same key, different fingerprint. The cron keys one payout per entry
      // and turn and never recomputes a live slice for a settled turn, so a
      // conflict here is a genuinely different payout reusing the key, not a
      // post-crash remainder: fail closed. (Crash recovery resumes by key
      // through `resumeQueuedRedemptionByKey`, which rebuilds from the stored
      // plan without presenting a live fingerprint at all.)
      throw err;
    }
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.queuedRedemptionPlan;
      if (!isStoredPlan(stored)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return { duplicate: true, outcome: await persistOutcome(planFromStored(stored), opts) };
    }
    if (claim === "in-progress") {
      // Same fingerprint, so the live input names the same payout — but the
      // steps run from the STORED plan when one exists, never the live input:
      // post-crash reads are post-debit state and would double-pay or
      // misprice. No stored plan means the crash landed between the claim
      // insert and the plan write below (nothing applied yet), so the live
      // input under the stored fingerprint is exact.
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.queuedRedemptionPlan;
      const plan = isStoredPlan(stored) ? planFromStored(stored) : planFromInput(input, now);
      const outcome = await runPlan(plan, opts);
      notifyHolder(plan);
      return { duplicate: true, outcome };
    }
    // A fresh claim owns the attempt. Persist the resume plan before the
    // first step: a crash from here on resumes this exact plan under the same
    // key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { queuedRedemptionPlan: toStoredPlan(input, now), updatedAt: new Date() } },
        opts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${QUEUED_REDEMPTION_TX}:plan-store`, opts);
      throw planError;
    }

    const plan = planFromInput(input, now);
    const outcome = await runPlan(plan, opts);
    notifyHolder(plan);
    return { duplicate: false, outcome };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

export interface QueuedRedemptionResumeResult {
  /** Stored payout numbers for the resumed attempt. */
  outcome: QueuedRedemptionOutcome;
}

/**
 * Key-only crash recovery for a queued payout (issue #1672): the cron pass
 * re-drives this for every `in_progress` receipt carrying a queued-redemption
 * plan before it loads the pending queue, so no receipt strands
 * `in_progress` and no processing row waits forever.
 *
 * Returns null when there is nothing to resume (no receipt under the key, an
 * already-`completed` receipt, or an `in_progress` receipt with no usable
 * stored plan): the caller keeps its public result. Throws
 * `MoneyFlowTerminalError` when the receipt settled `failed`/`compensated`,
 * and `MoneyFlowKeyConflictError` when the stored attempt names a different
 * fund or entry (fail closed on cross-entry key reuse).
 */
export async function resumeQueuedRedemptionByKey(
  db: Db,
  key: string,
  expectedFundId: ObjectId,
  expectedEntryId: ObjectId
): Promise<QueuedRedemptionResumeResult | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Queued redemption idempotency key must be 1-128 characters");
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<QueuedRedemptionReceipt>;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  const stored = existing.queuedRedemptionPlan;
  if (existing.status === "completed") {
    if (
      isStoredPlan(stored) &&
      (stored.fundIdHex !== expectedFundId.toHexString() ||
        stored.entryIdHex !== expectedEntryId.toHexString())
    ) {
      throw new MoneyFlowKeyConflictError(key);
    }
    return null;
  }
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "in_progress") return null;
  // Crashed between the claim insert and the plan write: nothing applied yet,
  // and the queue row still shows the pre-claim units — the caller restores
  // the row and settles the receipt, then the entry pays fresh next turn.
  if (!isStoredPlan(stored)) return null;
  if (
    stored.fundIdHex !== expectedFundId.toHexString() ||
    stored.entryIdHex !== expectedEntryId.toHexString()
  ) {
    throw new MoneyFlowKeyConflictError(key);
  }
  const plan = planFromStored(stored);
  const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
    mapRedemptionError(step.name, outcome);
  let outcome: QueuedRedemptionOutcome;
  await runWithOptionalTransaction(
    async (session) => {
      await runMoneyFlowSteps(receipts, key, buildRedemptionSteps(db, key, plan), mapError, {
        session,
      });
      outcome = await persistResumeOutcome(receiptCollection, key, plan, { session });
    },
    async () => {
      await runMoneyFlowSteps(receipts, key, buildRedemptionSteps(db, key, plan), mapError);
      outcome = await persistResumeOutcome(receiptCollection, key, plan, {});
    }
  );
  return { outcome: outcome! };
}

async function persistResumeOutcome(
  receiptCollection: Collection<QueuedRedemptionReceipt>,
  key: string,
  plan: NormalizedRedemptionPlan,
  opts: { session?: ClientSession }
): Promise<QueuedRedemptionOutcome> {
  const outcome = planOutcome(plan);
  await receiptCollection.updateOne(
    { _id: key },
    {
      $set: {
        queuedRedemptionPlan: { ...toStoredPlanLike(plan), outcome },
        updatedAt: new Date(),
      },
    },
    opts.session ? { session: opts.session } : {}
  );
  return outcome;
}

/**
 * Reconcile rows a crashed pass left behind before the fresh queue loads.
 *
 * Two stuck shapes: `in_progress` receipts carrying a queued-redemption plan
 * (resume under the stored key — applied steps converge, the rest land), and
 * `processing` rows whose receipt never landed or settled terminal (nothing
 * applied, or the applied prefix was compensated, so restoring the exact
 * prior claim is safe and the entry pays fresh next turn). Anything else —
 * a terminal receipt that disagrees, a foreign key — stays quarantined for
 * ops and never breaks the pass.
 *
 * Returns the number of resumed payouts that moved cash (for the pass tally).
 */
export async function recoverQueuedRedemptionOrphans(db: Db, fundId: ObjectId): Promise<number> {
  let resumed = 0;
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const fundHex = fundId.toHexString();

  // All `in_progress` receipts (the collection is TTL-bounded and unsettled
  // receipts are rare); a plan-less receipt carries no fund link, so it joins
  // via its queue row instead of the query filter.
  const stuckReceipts = await receipts.find({ status: "in_progress" }).toArray();
  const seenKeys = new Set<string>();
  for (const receipt of stuckReceipts) {
    const key = receipt._id;
    const stored = (receipt as QueuedRedemptionReceipt).queuedRedemptionPlan;
    if (!isStoredPlan(stored)) {
      // Crashed between the claim insert and the plan write: nothing applied
      // yet (the plan lands before the first step), so settle the receipt and
      // restore the row; the entry pays fresh next turn under a new key.
      const owner = await findOrphanRow(db, key);
      if (!owner || !owner.fundId.equals(fundId)) continue;
      seenKeys.add(key);
      await failMoneyFlowReceipt(receipts, key, `${QUEUED_REDEMPTION_QUEUE}:orphan-no-plan`);
      await restoreOrphanRow(db, key);
      continue;
    }
    if (stored.fundIdHex !== fundHex) continue;
    seenKeys.add(key);
    try {
      const result = await resumeQueuedRedemptionByKey(
        db,
        key,
        fundId,
        new ObjectId(stored.entryIdHex)
      );
      if (result && result.outcome.redeemableUnits > 0) resumed += 1;
    } catch (err) {
      console.warn(
        `[indexfund-cron] orphan queued redemption ${key} did not resume: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  const stuckRows = await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .find({
      fundId,
      status: "processing",
      processingFlowKey: { $exists: true },
    })
    .toArray();
  for (const row of stuckRows) {
    const rowKey = row.processingFlowKey;
    if (!rowKey || seenKeys.has(rowKey)) continue;
    const receipt = await receipts.findOne({ _id: rowKey } as Filter<MoneyFlowReceipt>);
    if (!receipt) {
      // The queue claim landed but the receipt claim never did: no step ran.
      await restoreOrphanRow(db, rowKey);
      continue;
    }
    if (receipt.status === "failed" || receipt.status === "compensated") {
      // Terminal invariant: no partial effect, so restoring the claim is
      // safe; the entry pays fresh next turn under a new key.
      await restoreOrphanRow(db, rowKey);
    }
    // `in_progress` without a usable plan was settled above; `completed`
    // implies the settle landed, so both stay out of the way here.
  }
  return resumed;
}

async function findOrphanRow(
  db: Db,
  flowKey: string
): Promise<IndexFundRedemptionQueueEntry | null> {
  const queue = db.collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION);
  return queue.findOne({ processingFlowKey: flowKey } as Filter<IndexFundRedemptionQueueEntry>);
}

async function restoreOrphanRow(db: Db, flowKey: string): Promise<void> {
  const queue = db.collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION);
  const row = await findOrphanRow(db, flowKey);
  if (!row || row.status !== "processing") return;
  await queue.updateOne(
    { _id: row._id, status: "processing" },
    {
      $set: { status: row.processingFromStatus ?? "queued", updatedAt: new Date() },
      $unset: { processingStartedAt: "", processingFlowKey: "", processingFromStatus: "" },
    }
  );
}

/** Rebuild a storable plan snapshot from a normalized plan (for outcome writes). */
function toStoredPlanLike(plan: NormalizedRedemptionPlan): QueuedRedemptionStoredPlan {
  return {
    version: 1,
    fundIdHex: plan.fundId.toHexString(),
    fundSlug: plan.fundSlug,
    fundName: plan.fundName,
    fundTicker: plan.fundTicker,
    anchorCurrencyCode: plan.anchorCurrencyCode,
    entryIdHex: plan.entryId.toHexString(),
    holderKind: plan.holderKind,
    characterIdHex: plan.characterId ? plan.characterId.toHexString() : null,
    imperialCharacterIdHex: plan.imperialCharacterId
      ? plan.imperialCharacterId.toHexString()
      : null,
    nppIdHex: plan.nppId ? plan.nppId.toHexString() : null,
    entryPaidBefore: plan.entryPaidBefore,
    unitsRemaining: plan.unitsRemaining,
    redemptionNav: plan.redemptionNav,
    redeemFxRate: plan.redeemFxRate,
    forexEnabled: plan.forexEnabled,
    paidNative: plan.paidNative,
    cashForThisEntry: plan.cashForThisEntry,
    redeemableUnits: plan.redeemableUnits,
    paidAmount: plan.paidAmount,
    remainingAfterPay: plan.remainingAfterPay,
    shouldBurnUnitsNow: plan.shouldBurnUnitsNow,
    turn: plan.turn,
    nowIso: plan.now.toISOString(),
    ...(plan.outcome ? { outcome: { ...plan.outcome } } : {}),
  };
}
