import { createHash, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db, Filter } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  insertKeyedDoc,
  keyedInsertId,
  makeInsertStep,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  runMoneyFlowSteps,
  type MoneyFlowAccount,
  type MoneyFlowLegOutcome,
  type MoneyFlowOptions,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import { FUND_TRANSACTION_COLLECTION } from "@/lib/indexFunds/fundQueries";
import type { IndexFundHolding, IndexFundTransaction } from "@/lib/db/types";

/** Fund holdings pull failed (the fund row went between plan and apply): nothing applied, caller skips. */
export const HOLDING_WRITEOFF_PULL = "HOLDING_WRITEOFF_PULL";
/** Write-off audit-row insert failed after the pull: prefix compensates, caller retries next cycle. */
export const HOLDING_WRITEOFF_TX = "HOLDING_WRITEOFF_TX";

/** Domain salt for the deterministic write-off audit-row `_id` derived from the flow key. */
const WRITEOFF_TX_DOMAIN = "holding-writeoff-tx";

export interface HoldingWriteOffSpendInput {
  fundId: ObjectId;
  /** The fund's quoted NAV at plan time, for the audit row (never a guard). */
  quotedNav: number;
  /**
   * The removal list the rebalance flagged (holdings out of the target that
   * the sale pass could not clear). Stable across same-turn retries: it is
   * computed from target constituents, not from live holdings, so a retry
   * after partial pulls names the same attempt and reconciles the stored
   * plan instead of auditing a remainder twice.
   */
  flagged: IndexFundHolding[];
  /** Cron turn, for keying. */
  turn: number;
  /**
   * Caller-chosen fingerprint of the intended write-off (see
   * `buildHoldingWriteOffFingerprint`). A retry with the same key and
   * fingerprint reconciles the stored plan; a different fingerprint is a
   * different write-off and stays a `MoneyFlowKeyConflictError`.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key. The rebalance pass derives one per fund
   * and flagged set (see `buildHoldingWriteOffKey`) so a same-turn retry
   * resumes instead of writing off twice. Omit to mint one.
   */
  idempotencyKey?: string;
  /** Pass timestamp pinned by the caller; defaults to now. Excluded from the fingerprint. */
  now?: Date;
}

export interface HoldingWriteOffOutcome {
  /** Holdings removed at zero because the corporation no longer exists. */
  writtenOffCount: number;
  writtenOffValueAnchor: number;
  /** Holdings the fund still cannot sell, but whose corporation is alive. */
  unsellableCount: number;
  unsellableValueAnchor: number;
}

export function isHoldingWriteOffOutcome(value: unknown): value is HoldingWriteOffOutcome {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.writtenOffCount === "number" &&
    typeof v.writtenOffValueAnchor === "number" &&
    typeof v.unsellableCount === "number" &&
    typeof v.unsellableValueAnchor === "number"
  );
}

/**
 * Short stable hash of the flagged removal list (sorted corporation ids), so
 * the key stays within the key cap no matter how many holdings were flagged.
 * Retry-stable: the same flagged list hashes the same way.
 */
export function hashFlaggedHoldings(flagged: IndexFundHolding[]): string {
  const ids = flagged.map((h) => h.corporationId.toString()).sort();
  return createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 16);
}

/**
 * Deterministic idempotency key for one fund's write-off in one turn: the
 * fund plus the flagged removal list names the attempt. A same-key retry
 * (crash recovery, same-turn double-fire) reuses it and reconciles; a
 * different removal list (or turn) gets a new key and plans fresh.
 */
export function buildHoldingWriteOffKey(
  fundId: ObjectId,
  turn: number,
  flagged: IndexFundHolding[]
): string {
  return `holding-writeoff:${fundId.toHexString()}:turn:${turn}:flagged:${hashFlaggedHoldings(flagged)}`;
}

/**
 * Deterministic fingerprint for one write-off attempt. Covers the fund, the
 * turn, the flagged removal list, and the quoted NAV on the audit row, so a
 * key reused for a different write-off fails closed instead of replaying the
 * wrong outcome.
 */
export function buildHoldingWriteOffFingerprint(input: {
  fundId: ObjectId;
  turn: number;
  flagged: IndexFundHolding[];
  quotedNav: number;
}): string {
  return (
    `holding-writeoff:${input.fundId.toHexString()}:turn:${input.turn}` +
    `:flagged:${hashFlaggedHoldings(input.flagged)}:nav:${input.quotedNav}`
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type HoldingWriteOffReceipt = MoneyFlowReceipt & { holdingWriteOffPlan?: unknown };

interface HoldingWriteOffStoredHolding {
  corporationIdHex: string;
  shares: number;
  avgCostPerShareAnchor?: number;
  lastValueAnchor?: number;
}

interface HoldingWriteOffStoredPlan {
  version: 1;
  fundIdHex: string;
  quotedNav: number;
  turn: number;
  /** Flagged corporation ids at plan time, for the key/conflict narrative. */
  flaggedHexes: string[];
  dead: HoldingWriteOffStoredHolding[];
  valueAnchor: number;
  /** Still-held flagged count/value at plan time (dead + unsellable). */
  stillHeldCount: number;
  stillHeldValueAnchor: number;
  nowIso: string;
  outcome?: HoldingWriteOffOutcome;
}

interface NormalizedHoldingWriteOffPlan {
  fundId: ObjectId;
  quotedNav: number;
  turn: number;
  flaggedHexes: string[];
  dead: {
    corporationId: ObjectId;
    shares: number;
    avgCostPerShareAnchor?: number;
    lastValueAnchor?: number;
  }[];
  valueAnchor: number;
  /** Still-held flagged count/value at plan time (dead + unsellable). */
  stillHeldCount: number;
  stillHeldValueAnchor: number;
  now: Date;
  outcome?: HoldingWriteOffOutcome;
}

function toStoredHolding(
  h: NormalizedHoldingWriteOffPlan["dead"][number]
): HoldingWriteOffStoredHolding {
  return {
    corporationIdHex: h.corporationId.toHexString(),
    shares: h.shares,
    ...(h.avgCostPerShareAnchor !== undefined
      ? { avgCostPerShareAnchor: h.avgCostPerShareAnchor }
      : {}),
    ...(h.lastValueAnchor !== undefined ? { lastValueAnchor: h.lastValueAnchor } : {}),
  };
}

function toStoredPlan(plan: NormalizedHoldingWriteOffPlan): HoldingWriteOffStoredPlan {
  return {
    version: 1,
    fundIdHex: plan.fundId.toHexString(),
    quotedNav: plan.quotedNav,
    turn: plan.turn,
    flaggedHexes: [...plan.flaggedHexes],
    dead: plan.dead.map(toStoredHolding),
    valueAnchor: plan.valueAnchor,
    stillHeldCount: plan.stillHeldCount,
    stillHeldValueAnchor: plan.stillHeldValueAnchor,
    nowIso: plan.now.toISOString(),
    ...(plan.outcome ? { outcome: { ...plan.outcome } } : {}),
  };
}

function isStoredHolding(value: unknown): value is HoldingWriteOffStoredHolding {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.corporationIdHex === "string" && typeof v.shares === "number";
}

function isStoredPlan(value: unknown): value is HoldingWriteOffStoredPlan {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.fundIdHex === "string" &&
    typeof v.quotedNav === "number" &&
    Number.isInteger(v.turn) &&
    Array.isArray(v.flaggedHexes) &&
    Array.isArray(v.dead) &&
    (v.dead as unknown[]).every(isStoredHolding) &&
    typeof v.valueAnchor === "number" &&
    typeof v.stillHeldCount === "number" &&
    typeof v.stillHeldValueAnchor === "number" &&
    typeof v.nowIso === "string"
  );
}

function planFromStored(stored: HoldingWriteOffStoredPlan): NormalizedHoldingWriteOffPlan {
  return {
    fundId: new ObjectId(stored.fundIdHex),
    quotedNav: stored.quotedNav,
    turn: stored.turn,
    flaggedHexes: [...stored.flaggedHexes],
    dead: stored.dead.map((h) => ({
      corporationId: new ObjectId(h.corporationIdHex),
      shares: h.shares,
      ...(h.avgCostPerShareAnchor !== undefined
        ? { avgCostPerShareAnchor: h.avgCostPerShareAnchor }
        : {}),
      ...(h.lastValueAnchor !== undefined ? { lastValueAnchor: h.lastValueAnchor } : {}),
    })),
    valueAnchor: stored.valueAnchor,
    stillHeldCount: stored.stillHeldCount,
    stillHeldValueAnchor: stored.stillHeldValueAnchor,
    now: new Date(stored.nowIso),
    ...(stored.outcome && isHoldingWriteOffOutcome(stored.outcome)
      ? { outcome: { ...stored.outcome } }
      : {}),
  };
}

function planOutcome(plan: NormalizedHoldingWriteOffPlan): HoldingWriteOffOutcome {
  if (plan.outcome) return { ...plan.outcome };
  // A completed receipt always carries the stored outcome; this fallback only
  // runs when the process crashed between settling `completed` and writing
  // the outcome row. Every number is pinned in the plan, so no live read is
  // needed and the report is exactly the attempted write-off. Unsellable is
  // the still-held remainder the split left alive.
  return {
    writtenOffCount: plan.dead.length,
    writtenOffValueAnchor: plan.valueAnchor,
    unsellableCount: plan.stillHeldCount - plan.dead.length,
    unsellableValueAnchor: plan.stillHeldValueAnchor - plan.valueAnchor,
  };
}

/** Fund document shape touched by the write-off pull. */
interface WriteOffFundAccount extends MoneyFlowAccount {
  holdings?: IndexFundHolding[];
}

/**
 * Split the flagged removal list into dead holdings (corporation gone: write
 * off at zero) and unsellable ones (corporation alive: count only). Reads the
 * live corporation ids only; every number below is pinned on the receipt plan
 * at claim time so a retry never recomputes from post-pull state.
 */
async function splitDeadHoldings(
  db: Db,
  fundId: ObjectId,
  flagged: IndexFundHolding[],
  sessionOpts: MoneyFlowOptions
): Promise<{ dead: IndexFundHolding[]; liveIds: Set<string> }> {
  const stillHeld = flagged.filter((h) => h.shares > 0);
  if (stillHeld.length === 0) return { dead: [], liveIds: new Set() };
  const live = await db
    .collection("corporations")
    .find(
      { _id: { $in: stillHeld.map((h) => h.corporationId) } },
      { projection: { _id: 1 }, ...(sessionOpts.session ? { session: sessionOpts.session } : {}) }
    )
    .toArray();
  const liveIds = new Set(live.map((c) => String(c._id)));
  return { dead: stillHeld.filter((h) => !liveIds.has(h.corporationId.toString())), liveIds };
}

/**
 * Build the ordered keyed steps for one write-off. Exported for focused
 * compensation tests. Production always runs these through
 * `applyHoldingWriteOffSpend` (claim + stored plan + settlement).
 */
export function buildHoldingWriteOffSteps(
  db: Db,
  key: string,
  plan: NormalizedHoldingWriteOffPlan
): MoneyFlowStep[] {
  const funds = db.collection<WriteOffFundAccount>("indexFunds");
  const txs = db.collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION);
  const deadIds = plan.dead.map((h) => h.corporationId);

  const steps: MoneyFlowStep[] = [];
  if (deadIds.length > 0) {
    // One surgical `$pull` of exactly the dead rows. Unlike the legacy
    // full-array `$set` rewrite, a concurrent float-buy `$push` or holdings
    // image write that lands in between keeps its rows: the pull only names
    // dead corporation ids. The key record makes the retry converge, and the
    // revert pushes the pinned images back exactly.
    const subkey = deriveMoneyFlowKey(key, "pull");
    steps.push({
      name: "pull",
      apply: (stepOpts) =>
        applyKeyedUpdate(
          subkey,
          {
            collection: funds,
            filter: { _id: plan.fundId } as Filter<WriteOffFundAccount>,
            update: {
              $pull: { holdings: { corporationId: { $in: deadIds } } },
              $set: { updatedAt: plan.now },
            },
          },
          stepOpts ?? {}
        ),
      revert: (stepOpts) =>
        applyKeyedUpdate(
          deriveMoneyFlowKey(subkey, "compensate", "pull"),
          {
            collection: funds,
            filter: { _id: plan.fundId } as Filter<WriteOffFundAccount>,
            update: {
              $push: {
                holdings: {
                  $each: plan.dead.map((h) => ({
                    corporationId: h.corporationId,
                    shares: h.shares,
                    ...(h.avgCostPerShareAnchor !== undefined
                      ? { avgCostPerShareAnchor: h.avgCostPerShareAnchor }
                      : {}),
                    ...(h.lastValueAnchor !== undefined
                      ? { lastValueAnchor: h.lastValueAnchor }
                      : {}),
                  })),
                },
              },
              $set: { updatedAt: plan.now },
            },
          },
          stepOpts ?? {}
        ),
    });
    // Terminal audit row: nothing runs after it, so it carries no inverse. A
    // survived insert error compensates the pull instead of stranding a
    // removed position with no row. The `_id` derives from the flow key, so a
    // crash between the insert and the receipt completion converges instead
    // of duplicating the row. Content matches the legacy row exactly (kind,
    // NAV, negative amount, note), only the `_id` generation changed.
    steps.push(
      makeInsertStep("writeoff-tx", txs, {
        _id: keyedInsertId(key, WRITEOFF_TX_DOMAIN),
        fundId: plan.fundId,
        kind: "holding_writeoff",
        navAnchor: plan.quotedNav,
        // Negative: this is backing leaving the fund, not proceeds arriving.
        amountAnchor: -plan.valueAnchor,
        note:
          `Wrote off ${plan.dead.length} holding(s) in dissolved corporations at zero. ` +
          `No buyer exists for a corporation that no longer exists, so the position ` +
          `could not be sold and was carried at a stale mark.`,
        createdAt: plan.now,
      } satisfies IndexFundTransaction)
    );
  }
  return steps;
}

function mapWriteOffError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // The pull is step zero, so its failure settles `failed` with nothing
  // applied (the old full-array rewrite either matched or silently no-matched
  // on a gone fund; failing closed here refuses to audit a removal that never
  // landed). A later-step failure compensates the pull (the legacy
  // pull-then-insert had no recovery there either: a crash between them left
  // backing removed with no row, and a retry reported EMPTY, so the loss was
  // permanently unaudited).
  if (stepName === "pull") return new Error(`${HOLDING_WRITEOFF_PULL}:${outcome}`);
  return new Error(`${HOLDING_WRITEOFF_TX}:${outcome}`);
}

function validateInput(input: HoldingWriteOffSpendInput): void {
  if (!input.fundId) {
    throw new TypeError("Holding write-off spend needs fundId");
  }
  if (!Number.isFinite(input.quotedNav)) {
    throw new TypeError("Holding write-off spend needs a finite quotedNav");
  }
  if (!Array.isArray(input.flagged)) {
    throw new TypeError("Holding write-off spend needs a flagged array");
  }
  for (const h of input.flagged) {
    if (!h?.corporationId) {
      throw new TypeError("Holding write-off flagged entry needs corporationId");
    }
    if (!Number.isFinite(h.shares)) {
      throw new TypeError("Holding write-off flagged entry needs finite shares");
    }
  }
  if (!Number.isInteger(input.turn)) {
    throw new TypeError("Holding write-off spend needs an integer turn");
  }
  if (typeof input.fingerprint !== "string" || input.fingerprint.length === 0) {
    throw new TypeError("Holding write-off needs a non-empty fingerprint");
  }
}

/**
 * Write off one fund's dead holdings (one surgical pull + one deterministic
 * audit row) so the result is exactly-once on every topology (issue #1672).
 *
 * No money moves: a dead corporation's shares are worth zero, so this is loss
 * recognition, not a transfer — no counterparty, no cash, no unit-supply
 * change. What must not happen is (a) silently minting or destroying value
 * beyond the intended loss (the pull names exactly the dead ids, and the
 * audit row carries exactly the removed value anchor), or (b) repeating the
 * loss on retry (the pull is idempotent and the audit row converges on its
 * key-derived `_id`).
 *
 * The caller (the rebalance pass) owns the flagged removal list. It arrives
 * here and is persisted on the receipt plan at claim time along with the
 * pinned dead split, so a same-key retry never recomputes liveness from
 * post-pull state.
 *
 * Under real transactions the pull, the audit row, and the idempotency
 * receipt join the transaction and commit atomically, preserving the old
 * behavior. On a standalone deployment the fallback runs the same writes as
 * keyed idempotent steps: a crash between them leaves an `in_progress`
 * receipt, and retrying with the same key and fingerprint reconciles to
 * exactly one write-off. A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyHoldingWriteOffSpend(
  db: Db,
  input: HoldingWriteOffSpendInput
): Promise<{ duplicate: boolean; outcome: HoldingWriteOffOutcome }> {
  validateInput(input);
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Holding write-off idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<HoldingWriteOffReceipt>;
  const now = input.now ?? new Date();

  const persistOutcome = async (
    plan: NormalizedHoldingWriteOffPlan,
    outcome: HoldingWriteOffOutcome,
    opts: { session?: ClientSession }
  ): Promise<HoldingWriteOffOutcome> => {
    const stored = { ...toStoredPlan({ ...plan, outcome }), outcome: { ...outcome } };
    await receiptCollection.updateOne(
      { _id: key },
      { $set: { holdingWriteOffPlan: stored, updatedAt: new Date() } },
      opts.session ? { session: opts.session } : {}
    );
    return outcome;
  };

  const runPlan = async (
    plan: NormalizedHoldingWriteOffPlan,
    opts: { session?: ClientSession }
  ): Promise<HoldingWriteOffOutcome> => {
    const steps = buildHoldingWriteOffSteps(db, key, plan);
    if (steps.length === 0) {
      // Nothing dead: settle completed with the pinned zero outcome so a
      // same-key retry reports the stored counts instead of re-planning.
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { status: "completed", updatedAt: new Date() } },
        opts.session ? { session: opts.session } : {}
      );
    } else {
      await runMoneyFlowSteps(
        receipts,
        key,
        steps,
        (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) =>
          mapWriteOffError(step.name, outcome),
        opts
      );
    }
    return persistOutcome(plan, planOutcome(plan), opts);
  };

  const buildPlan = (
    dead: IndexFundHolding[],
    stillHeld: IndexFundHolding[]
  ): NormalizedHoldingWriteOffPlan => ({
    fundId: input.fundId,
    quotedNav: input.quotedNav,
    turn: input.turn,
    flaggedHexes: input.flagged.map((h) => h.corporationId.toString()),
    dead: dead.map((h) => ({
      corporationId: h.corporationId,
      shares: h.shares,
      ...(h.avgCostPerShareAnchor !== undefined
        ? { avgCostPerShareAnchor: h.avgCostPerShareAnchor }
        : {}),
      ...(h.lastValueAnchor !== undefined ? { lastValueAnchor: h.lastValueAnchor } : {}),
    })),
    valueAnchor: computeHoldingsValueAnchor({ holdings: dead }),
    stillHeldCount: stillHeld.length,
    stillHeldValueAnchor: computeHoldingsValueAnchor({ holdings: stillHeld }),
    now,
  });

  const runSpend = async (
    session?: ClientSession
  ): Promise<{ duplicate: boolean; outcome: HoldingWriteOffOutcome }> => {
    const opts = session ? { session } : {};
    // Same key, different fingerprint: a genuinely different removal list
    // reusing the key, not a post-crash remainder. Fail closed. (Crash
    // recovery resumes by key through `resumeHoldingWriteOffByKey`, which
    // rebuilds from the stored plan without presenting a live fingerprint.)
    const claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>> = await claimMoneyFlowReceipt(
      receipts,
      key,
      input.fingerprint,
      opts
    );
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.holdingWriteOffPlan;
      if (!isStoredPlan(stored)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return {
        duplicate: true,
        outcome: await persistOutcome(
          planFromStored(stored),
          planOutcome(planFromStored(stored)),
          opts
        ),
      };
    }
    if (claim === "in-progress") {
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.holdingWriteOffPlan;
      if (isStoredPlan(stored)) {
        const plan = planFromStored(stored);
        const outcome = await runPlan(plan, opts);
        return { duplicate: true, outcome };
      }
      // Crashed between the claim insert and the plan write: nothing applied
      // yet. Fall through and plan fresh below.
    } else {
      // A fresh claim with no plan yet: split liveness now, before the first
      // step, so every retry replays THIS split instead of recomputing it
      // from post-pull state.
      const stillHeld = input.flagged.filter((h) => h.shares > 0);
      const { dead } = await splitDeadHoldings(db, input.fundId, input.flagged, opts);
      const plan = buildPlan(dead, stillHeld);
      try {
        await receiptCollection.updateOne(
          { _id: key },
          { $set: { holdingWriteOffPlan: toStoredPlan(plan), updatedAt: new Date() } },
          opts
        );
      } catch (planError) {
        await failMoneyFlowReceipt(receipts, key, `${HOLDING_WRITEOFF_TX}:plan-store`, opts);
        throw planError;
      }
      const outcome = await runPlan(plan, opts);
      return { duplicate: false, outcome };
    }
    // In-progress without a stored plan: plan fresh under the stored
    // fingerprint (the live input names the same write-off: same key, same
    // fingerprint was required to reach this branch).
    const stillHeld = input.flagged.filter((h) => h.shares > 0);
    const { dead } = await splitDeadHoldings(db, input.fundId, input.flagged, opts);
    const plan = buildPlan(dead, stillHeld);
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { holdingWriteOffPlan: toStoredPlan(plan), updatedAt: new Date() } },
        opts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${HOLDING_WRITEOFF_TX}:plan-store`, opts);
      throw planError;
    }
    const outcome = await runPlan(plan, opts);
    return { duplicate: true, outcome };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

export interface HoldingWriteOffResumeResult {
  /** Stored write-off numbers for the resumed attempt. */
  outcome: HoldingWriteOffOutcome;
}

/**
 * Key-only crash recovery for one write-off (issue #1672).
 *
 * Returns null when there is nothing to resume. Throws
 * `MoneyFlowTerminalError` when the receipt settled `failed`/`compensated`,
 * and `MoneyFlowKeyConflictError` when the stored attempt names a different
 * fund or turn.
 */
export async function resumeHoldingWriteOffByKey(
  db: Db,
  key: string,
  expectedFundId: ObjectId,
  expectedTurn: number
): Promise<HoldingWriteOffResumeResult | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Holding write-off idempotency key must be 1-128 characters");
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<HoldingWriteOffReceipt>;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  const stored = existing.holdingWriteOffPlan;
  if (existing.status === "completed") {
    if (
      isStoredPlan(stored) &&
      (stored.fundIdHex !== expectedFundId.toHexString() || stored.turn !== expectedTurn)
    ) {
      throw new MoneyFlowKeyConflictError(key);
    }
    return null;
  }
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "in_progress") return null;
  if (!isStoredPlan(stored)) return null;
  if (stored.fundIdHex !== expectedFundId.toHexString() || stored.turn !== expectedTurn) {
    throw new MoneyFlowKeyConflictError(key);
  }
  const plan = planFromStored(stored);
  const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
    mapWriteOffError(step.name, outcome);
  const steps = buildHoldingWriteOffSteps(db, key, plan);
  let outcome: HoldingWriteOffOutcome;
  await runWithOptionalTransaction(
    async (session) => {
      if (steps.length === 0) {
        await receiptCollection.updateOne(
          { _id: key },
          { $set: { status: "completed", updatedAt: new Date() } },
          { session }
        );
      } else {
        await runMoneyFlowSteps(receipts, key, steps, mapError, { session });
      }
      outcome = await persistResumeOutcome(receiptCollection, key, plan, { session });
    },
    async () => {
      if (steps.length === 0) {
        await receiptCollection.updateOne(
          { _id: key },
          { $set: { status: "completed", updatedAt: new Date() } }
        );
      } else {
        await runMoneyFlowSteps(receipts, key, steps, mapError);
      }
      outcome = await persistResumeOutcome(receiptCollection, key, plan, {});
    }
  );
  return { outcome: outcome! };
}

async function persistResumeOutcome(
  receiptCollection: Collection<HoldingWriteOffReceipt>,
  key: string,
  plan: NormalizedHoldingWriteOffPlan,
  opts: { session?: ClientSession }
): Promise<HoldingWriteOffOutcome> {
  const outcome = planOutcome(plan);
  const stored = { ...toStoredPlan({ ...plan, outcome }), outcome: { ...outcome } };
  await receiptCollection.updateOne(
    { _id: key },
    { $set: { holdingWriteOffPlan: stored, updatedAt: new Date() } },
    opts.session ? { session: opts.session } : {}
  );
  return outcome;
}

/**
 * Reconcile write-offs a crashed rebalance left behind for one fund before
 * the fresh removal list loads.
 *
 * Two stuck shapes: `in_progress` receipts carrying a write-off plan for
 * this fund and turn (resume under the stored key: the applied pull
 * converges, the missing audit row lands), and `in_progress` receipts under
 * this turn's key shape with no plan (crashed between the claim insert and
 * the plan write: nothing applied yet, so settle the receipt and let the
 * rebalance plan fresh; retrying the same key this turn would hit the
 * terminal receipt). Anything else stays quarantined for ops and never
 * breaks the pass.
 *
 * This driver is what closes the legacy audit gap: without it, a crash
 * between the pull and the audit insert leaves backing removed with no row,
 * and the next rebalance never re-flags the gone rows, so the loss is
 * permanently unaudited. Returns the resumed write-off outcome for the pass
 * tally (null when nothing was stuck).
 */
export async function recoverHoldingWriteOffOrphans(
  db: Db,
  fundId: ObjectId,
  turn: number
): Promise<HoldingWriteOffOutcome | null> {
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const stuckReceipts = await receipts.find({ status: "in_progress" }).toArray();
  let resumedOutcome: HoldingWriteOffOutcome | null = null;
  for (const receipt of stuckReceipts) {
    const key = receipt._id;
    const stored = (receipt as HoldingWriteOffReceipt).holdingWriteOffPlan;
    if (!isStoredPlan(stored)) {
      if (
        !key.startsWith(`holding-writeoff:${fundId.toHexString()}:turn:${turn}:`) ||
        !key.includes(":flagged:")
      ) {
        continue;
      }
      await failMoneyFlowReceipt(receipts, key, `${HOLDING_WRITEOFF_TX}:orphan-no-plan`);
      continue;
    }
    if (stored.fundIdHex !== fundId.toHexString() || stored.turn !== turn) continue;
    try {
      const result = await resumeHoldingWriteOffByKey(db, key, fundId, turn);
      // Keep scanning: a plan-less claim later in the set still needs
      // settling in the same pass. First resumed outcome wins the tally.
      if (result && !resumedOutcome) resumedOutcome = result.outcome;
    } catch (err) {
      console.warn(
        `[indexfund-cron] orphan holding write-off ${key} did not resume: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return resumedOutcome;
}
