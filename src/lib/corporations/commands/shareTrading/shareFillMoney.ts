import { ObjectId, type Db, type Filter } from "mongodb";
import {
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  runMoneyFlowSteps,
  type MoneyFlowStep,
} from "@/lib/db/nonAtomicMoneyFlow";
import { markShareFillMoneyCommitted } from "@/lib/corporations/commands/shareTrading/shareFillAudit";
import {
  isShareFillMoneyPlan,
  buildShareFillMoneyKey,
  buildShareFillMoneyFingerprint,
  receipts,
  receiptsEx,
  mapMoneyError,
  makeCapDebitStep,
  makeCapCreditStep,
  applyHoldingsCreditKeyed,
  revertHoldingsCreditKeyed,
  makeCashStep,
  makeFundInventoryDebitStep,
  type ShareFillMoneyPlan,
  type ShareFillMoneyOutcome,
  type ShareFillMoneyReceipt,
} from "./shareFillMoneyLegs";
export {
  isShareFillMoneyPlan,
  buildShareFillMoneyKey,
  personalBalanceField,
  buildShareFillMoneyFingerprint,
  SHARE_FILL_FUND_SELL_TX_DOMAIN,
  SHARE_FILL_MONEY_INSUFFICIENT_FUNDS,
  SHARE_FILL_MONEY_SELLER_SHARES,
  SHARE_FILL_MONEY_LIQUIDITY_SHARES,
  applyCapCreditKeyed,
  applyHoldingsCreditKeyed,
} from "./shareFillMoneyLegs";
export type {
  ShareFillCapEntryField,
  ShareFillCashCollection,
  ShareFillCashLeg,
  ShareFillCapLeg,
  ShareFillMoneyDirection,
  ShareFillMoneyPlan,
  ShareFillMoneyOutcome,
} from "./shareFillMoneyLegs";

/**
 * Keyed money legs for peer order-book fills (issue #1672).
 *
 * The audit slice (shareFillAudit.ts) made audit rows convergent but left
 * every money write on legacy debit-first-plus-compensation: a crash between
 * the filler debit and the seller credit left the filler down with the
 * seller unpaid (`in_progress` for ops), a crash between the seller share
 * debit and the buyer credit stranded shares, and the buy-fill escrow
 * release had the same window. This module moves those legs onto the
 * established keyed-step primitives (claim receipt, stored immutable plan,
 * compare-and-set step claims, deterministic keys, orphan recovery):
 *
 * - One money receipt per fill attempt, keyed
 *   `share-fill-money:<fillKey>` (derived from the audit attempt key, so a
 *   restart from only the fill key recovers). The resume plan is persisted
 *   on the receipt before any money moves; a same-key retry rebuilds its
 *   steps from the STORED plan, never from live caller input.
 * - Every leg is a compare-and-set write carrying its subkey: balance debits
 *   gate `$gte` + `$ne: key` in one atomic update, cap-table debits gate
 *   `$elemMatch` sufficiency + `$ne: key`, credits use the inc/push/inc
 *   triple under one subkey so a retry converges instead of double-moving.
 * - `runMoneyFlowSteps` reverses the applied prefix with keyed inverses
 *   before settling, so the receipt never rests partial: the
 *   filler-debited-then-crash, seller-shares-stranded, and escrow-release
 *   windows close without guessing and without double-moving money/shares.
 * - On success the primitive flips the audit receipt's `moneyCommitted`
 *   (pinning the post-debit filler balance for the audit rows), so the
 *   existing audit recovery and the orphan driver converge money first,
 *   audit second.
 *
 * Error mapping preserves the legacy route surface: insufficient filler
 * funds stays a 400 `Insufficient funds`, lost seller-share races stay 409,
 * exhausted liquidity-provider inventory stays 409. Anything later is
 * pathological (the legacy path had no recovery there either) and throws
 * for `handleRouteError`.
 */

/** Step build shared by first attempt and crash recovery (always from the stored plan). */
export function buildShareFillMoneySteps(
  db: Db,
  moneyKey: string,
  plan: ShareFillMoneyPlan
): MoneyFlowStep[] {
  const now = new Date(plan.nowIso);
  const corpId = new ObjectId(plan.corpIdHex);
  const steps: MoneyFlowStep[] = [];
  if (plan.direction === "sell-fill") {
    // 1. Filler cash debit. Guard failure with an empty prefix settles
    // `failed` (nothing moved, so that verdict is truthful) and maps to
    // the legacy `Insufficient funds` 400.
    if (!plan.fillerDebit) throw new Error("share-fill-money:sell-fill-needs-filler-debit");
    steps.push(
      makeCashStep(
        db,
        "filler-debit",
        deriveMoneyFlowKey(moneyKey, "filler-debit"),
        plan.fillerDebit,
        true,
        now
      )
    );
    // 2. Seller side: fund inventory dual debit, or the placer cap-table
    // debit (skipped when placement pre-debited the shares).
    if (plan.fundInventoryDebit) {
      steps.push(
        makeFundInventoryDebitStep(
          db,
          moneyKey,
          corpId,
          new ObjectId(plan.fundInventoryDebit.fundIdHex),
          plan.shares,
          plan.fundInventoryDebit.pricePerShareAnchor,
          now
        )
      );
    } else if (plan.sellerDebit) {
      const sellerStep = makeCapDebitStep(
        db,
        deriveMoneyFlowKey(moneyKey, "seller-debit"),
        corpId,
        plan.sellerDebit,
        plan.shares,
        now
      );
      steps.push(sellerStep);
    }
    // 3. Buyer (filler) cap-table credit.
    steps.push(
      makeCapCreditStep(
        db,
        "buyer-credit",
        deriveMoneyFlowKey(moneyKey, "buyer-credit"),
        corpId,
        plan.buyerCredit,
        plan.shares,
        now
      )
    );
    // 4. Seller proceeds.
    if (plan.sellerProceeds) {
      steps.push(
        makeCashStep(
          db,
          "seller-credit",
          deriveMoneyFlowKey(moneyKey, "seller-credit"),
          plan.sellerProceeds,
          false,
          now
        )
      );
    }
  } else {
    // Buy-fill: the filler sells, the placer buys, escrow releases to the filler.
    // 1. Filler share debit. Guard failure with an empty prefix settles
    // `failed` and maps to the legacy 409 (no longer enough shares).
    if (!plan.sellerDebit) throw new Error("share-fill-money:buy-fill-needs-filler-debit");
    const fillerSharesStep = makeCapDebitStep(
      db,
      deriveMoneyFlowKey(moneyKey, "filler-shares-debit"),
      corpId,
      plan.sellerDebit,
      plan.shares,
      now
    );
    steps.push({ ...fillerSharesStep, name: "filler-shares-debit" });
    // 2. Buyer cap-table credit.
    steps.push(
      makeCapCreditStep(
        db,
        "buyer-credit",
        deriveMoneyFlowKey(moneyKey, "buyer-credit"),
        corpId,
        plan.buyerCredit,
        plan.shares,
        now
      )
    );
    // 3. Fund-buyer holdings credit.
    if (plan.buyerHoldingsCredit) {
      const fundId = new ObjectId(plan.buyerHoldingsCredit.fundIdHex);
      const priceAnchor = plan.buyerHoldingsCredit.pricePerShareAnchor;
      const holdingsSub = deriveMoneyFlowKey(moneyKey, "buyer-holdings-credit");
      steps.push({
        name: "buyer-holdings-credit",
        apply: () =>
          applyHoldingsCreditKeyed(db, holdingsSub, fundId, corpId, plan.shares, priceAnchor, now),
        revert: () =>
          revertHoldingsCreditKeyed(
            db,
            deriveMoneyFlowKey(holdingsSub, "compensate", "buyer-holdings-credit"),
            fundId,
            corpId,
            plan.shares,
            priceAnchor,
            now
          ),
      });
    }
    // 4. Escrow release to the filler.
    if (!plan.fillerCredit) throw new Error("share-fill-money:buy-fill-needs-filler-credit");
    steps.push(
      makeCashStep(
        db,
        "filler-credit",
        deriveMoneyFlowKey(moneyKey, "filler-credit"),
        plan.fillerCredit,
        false,
        now
      )
    );
  }
  return steps;
}

function readFillerBalance(doc: Record<string, unknown> | null, field: string): number | undefined {
  if (!doc) return undefined;
  const value = field
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], doc);
  return typeof value === "number" ? value : undefined;
}

/**
 * Bridge money completion into the audit receipt: flip `moneyCommitted`
 * with the post-debit filler balance (live-read at bridge time; the audit
 * rows are display-pinned on first write and converge by deterministic
 * `_id`, so a later bridge never rewrites landed rows). Idempotent: safe
 * to re-run when the money receipt already settled `completed` but the
 * process died before the first bridge.
 */
async function bridgeAuditFromPlan(db: Db, plan: ShareFillMoneyPlan): Promise<number | undefined> {
  const fillerLeg = plan.direction === "sell-fill" ? plan.fillerDebit : plan.fillerCredit;
  let balance: number | undefined;
  if (fillerLeg && fillerLeg.collection !== "indexFunds") {
    const fillerDoc = await db
      .collection<Record<string, unknown>>(fillerLeg.collection)
      .findOne({ _id: new ObjectId(fillerLeg.idHex) });
    balance = readFillerBalance(fillerDoc as Record<string, unknown> | null, fillerLeg.field);
  }
  await markShareFillMoneyCommitted(db, plan.fillKey, balance);
  return balance;
}

/**
 * Execute one fill's money legs to exactly one terminal state. First
 * attempt persists the immutable plan on the money receipt, then runs the
 * steps; a same-key retry (crash recovery, competing retry, orphan driver)
 * rebuilds the steps from the STORED plan and converges. On success the
 * audit receipt flips `moneyCommitted` with the post-debit filler balance,
 * bridging money completion into the existing audit recovery.
 *
 * Throws the legacy-mapped error for the failed step; the caller restores
 * the order claim and returns the matching route response.
 */
export async function executeShareFillMoneyFlow(
  db: Db,
  plan: ShareFillMoneyPlan,
  fingerprint?: string
): Promise<ShareFillMoneyOutcome> {
  const moneyKey = buildShareFillMoneyKey(plan.fillKey);
  const print = fingerprint ?? buildShareFillMoneyFingerprint(plan);
  const claim = await claimMoneyFlowReceipt(receipts(db), moneyKey, print);
  if (claim === "duplicate") {
    const settled = await receiptsEx(db).findOne({ _id: moneyKey });
    const stored = settled?.shareFillMoneyPlan as ShareFillMoneyPlan | undefined;
    const outcome = stored?.outcome;
    if (outcome && typeof outcome.sharesMoved === "number") return { ...outcome };
    return { sharesMoved: plan.shares };
  }
  let active: ShareFillMoneyPlan = plan;
  if (claim === "in-progress") {
    const existing = await receiptsEx(db).findOne({ _id: moneyKey });
    const stored = existing?.shareFillMoneyPlan;
    if (!isShareFillMoneyPlan(stored)) {
      throw new Error("share-fill-money:plan-never-stored");
    }
    active = stored;
  } else {
    // Persist the resume plan before any money moves. Deliberately unsettled
    // on failure: a real crash here runs no further code, leaving the receipt
    // plan-less `in_progress`, so settling here would mask the crash with a
    // write the dead process could never have run. Key recovery owns the
    // settlement and fails the plan-less receipt without guessing.
    await receiptsEx(db).updateOne(
      { _id: moneyKey },
      { $set: { shareFillMoneyPlan: plan, updatedAt: new Date() } }
    );
  }
  await runMoneyFlowSteps(
    receipts(db),
    moneyKey,
    buildShareFillMoneySteps(db, moneyKey, active),
    mapMoneyError
  );
  const outcome: ShareFillMoneyOutcome = { sharesMoved: active.shares };
  const bridged = await bridgeAuditFromPlan(db, active);
  if (bridged !== undefined) outcome.fillerBalanceAfter = bridged;
  await receiptsEx(db).updateOne(
    { _id: moneyKey },
    { $set: { "shareFillMoneyPlan.outcome": outcome, updatedAt: new Date() } }
  );
  return outcome;
}

export type ShareFillMoneyRecoveryAction =
  | "money-recovered"
  | "money-incomplete"
  | "settled-failed-no-plan"
  | "skipped-settled"
  | "skipped-missing";

export interface ShareFillMoneyRecoveryResult {
  moneyKey: string;
  action: ShareFillMoneyRecoveryAction;
}

/**
 * Crash recovery for one money flow, from only the fill key: derives the
 * money key, reloads the stored plan, and re-runs the keyed steps to
 * convergence. Never invents amounts; a missing plan settles `failed`
 * (nothing is recoverable, ops owns it).
 */
export async function recoverShareFillMoneyByFillKey(
  db: Db,
  fillKey: string
): Promise<ShareFillMoneyRecoveryResult> {
  const moneyKey = buildShareFillMoneyKey(fillKey);
  const receipt = await receiptsEx(db).findOne({ _id: moneyKey });
  if (!receipt) return { moneyKey, action: "skipped-missing" };
  if (receipt.status !== "in_progress") {
    // A crash between money-commit and the audit bridge leaves a completed
    // money receipt with an uncommitted audit receipt: re-bridge from the
    // stored plan (idempotent) instead of leaving audit stuck.
    if (receipt.status === "completed" && isShareFillMoneyPlan(receipt.shareFillMoneyPlan)) {
      await bridgeAuditFromPlan(db, receipt.shareFillMoneyPlan);
    }
    return { moneyKey, action: "skipped-settled" };
  }
  const stored = receipt.shareFillMoneyPlan;
  if (!isShareFillMoneyPlan(stored)) {
    await failMoneyFlowReceipt(receipts(db), moneyKey, "share-fill-money:plan-never-stored");
    return { moneyKey, action: "settled-failed-no-plan" };
  }
  try {
    await runMoneyFlowSteps(
      receipts(db),
      moneyKey,
      buildShareFillMoneySteps(db, moneyKey, stored),
      mapMoneyError
    );
  } catch {
    return { moneyKey, action: "money-incomplete" };
  }
  const outcome: ShareFillMoneyOutcome = { sharesMoved: stored.shares };
  const bridged = await bridgeAuditFromPlan(db, stored);
  if (bridged !== undefined) outcome.fillerBalanceAfter = bridged;
  await receiptsEx(db).updateOne(
    { _id: moneyKey },
    { $set: { "shareFillMoneyPlan.outcome": outcome, updatedAt: new Date() } }
  );
  return { moneyKey, action: "money-recovered" };
}

/**
 * Age grace before a money orphan candidate is eligible: a live route fill
 * sits between `claimMoneyFlowReceipt`, the plan store, and the money legs
 * with a fresh `updatedAt` while this pass runs, and the turn lock does not
 * guard API routes, so the pass must not re-drive it. Candidates younger
 * than this stay untouched for a later pass and are not reported. The
 * per-key path (`recoverShareFillMoneyByFillKey`) keeps its immediate
 * behavior: it is driven by the owning attempt, so it cannot race itself.
 */
export const SHARE_FILL_MONEY_ORPHAN_MIN_AGE_MS = 5 * 60 * 1000;

/**
 * Per-world rotation cursor for the money orphan scan. A head-of-queue scan
 * re-reads the same stuck prefix every pass: persistently incomplete
 * receipts (a step builder that keeps throwing, a guard that never clears)
 * never settle, so later receipts behind a full page of them are never
 * examined. The scan therefore resumes after the last key it examined,
 * wrapping to the head when it runs past the tail, so repeated bounded
 * passes visit every receipt once per cycle.
 *
 * Keyed by stable MongoClient identity plus databaseName, never by Db
 * handle and never module-global state: production `getDb()` calls
 * `client.db(dbName)` on every invocation and the driver returns a NEW Db
 * wrapper each time, so a `WeakMap<Db, ...>` would reset rotation on every
 * cron tick and re-read the same stuck prefix forever. Db handles without a
 * client identity (in-memory test fakes) fall back to per-handle cursors.
 * Keyset pagination (`_id` bounds on a sorted scan) survives rows settling
 * between passes: a settled row simply drops out of the filter while the
 * cursor stays a valid lower bound.
 *
 * Never key by URI or connection string: those are secrets and must not be
 * retained in module state or logged.
 *
 * This mirrors `orphanCursorsFor` in shareFillAudit.ts with its own module
 * state on purpose: shareFillAudit.ts already imports this module, so
 * importing its cursor helper back would widen the existing cycle.
 */
interface ShareFillMoneyOrphanCursor {
  moneyAfter?: string;
}

const shareFillMoneyCursorsByClient = new WeakMap<
  object,
  Map<string, ShareFillMoneyOrphanCursor>
>();
const shareFillMoneyCursorsByHandle = new WeakMap<object, ShareFillMoneyOrphanCursor>();

function moneyOrphanCursorFor(db: Db): ShareFillMoneyOrphanCursor {
  const maybeIdentity = db as Partial<{ client: unknown; databaseName: unknown }>;
  const client = maybeIdentity.client;
  const databaseName = maybeIdentity.databaseName;
  if (
    typeof client === "object" &&
    client !== null &&
    typeof databaseName === "string" &&
    databaseName.length > 0
  ) {
    let byDatabase = shareFillMoneyCursorsByClient.get(client);
    if (!byDatabase) {
      byDatabase = new Map<string, ShareFillMoneyOrphanCursor>();
      shareFillMoneyCursorsByClient.set(client, byDatabase);
    }
    let cursor = byDatabase.get(databaseName);
    if (!cursor) {
      cursor = {};
      byDatabase.set(databaseName, cursor);
    }
    return cursor;
  }
  let cursor = shareFillMoneyCursorsByHandle.get(db);
  if (!cursor) {
    cursor = {};
    shareFillMoneyCursorsByHandle.set(db, cursor);
  }
  return cursor;
}

/**
 * One bounded sorted window of the money orphan queue with wrap-around:
 * rows after the cursor first, then rows at/before it to fill the window.
 * Never examines more than `window` rows; an empty window leaves the cursor
 * untouched. The `_id` sort rides the recurring `{status:1,_id:1}` index
 * (seeded in `src/lib/admin/seed/indexes/moneyFlow.ts`).
 */
async function fetchMoneyReceiptWindow(
  db: Db,
  afterKey: string | undefined,
  window: number
): Promise<ShareFillMoneyReceipt[]> {
  const filter: Filter<ShareFillMoneyReceipt> = {
    status: "in_progress",
    shareFillMoneyPlan: { $exists: true },
  };
  if (window <= 0) return [];
  const tail =
    afterKey === undefined
      ? await receiptsEx(db).find(filter).sort({ _id: 1 }).limit(window).toArray()
      : await receiptsEx(db)
          .find({ ...filter, _id: { $gt: afterKey } })
          .sort({ _id: 1 })
          .limit(window)
          .toArray();
  if (tail.length >= window || afterKey === undefined) return tail;
  const seen = new Set<unknown>(tail.map((doc) => doc._id));
  const head = await receiptsEx(db)
    .find({ ...filter, _id: { $lte: afterKey } })
    .sort({ _id: 1 })
    .limit(window - tail.length)
    .toArray();
  for (const doc of head) {
    if (!seen.has(doc._id)) tail.push(doc);
  }
  return tail;
}

/** Newest string key in a window, for advancing the cursor. */
function lastMoneyWindowKey(docs: ShareFillMoneyReceipt[]): string | undefined {
  for (let index = docs.length - 1; index >= 0; index -= 1) {
    const id: unknown = docs[index]!._id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

function isFreshMoneyCandidate(receipt: ShareFillMoneyReceipt, now: Date): boolean {
  const updatedAt: unknown = (receipt as { updatedAt?: unknown }).updatedAt;
  // Unknown age (legacy rows without a stamp) stays eligible so old rows
  // always drain; only provably-fresh rows wait.
  if (!(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime())) return false;
  return now.getTime() - updatedAt.getTime() < SHARE_FILL_MONEY_ORPHAN_MIN_AGE_MS;
}

/**
 * Bounded money orphan scan for the periodic driver. Recovers every
 * `in_progress` money receipt from its stored plan so money converges
 * before the audit orphan pass runs. Returns per-receipt results; a
 * receipt whose steps throw stays `in_progress` (TTL-visible) for the
 * next pass instead of being guessed at.
 *
 * Fairness: the scan rotates over `_id` with a stable per-world cursor and
 * wraps to the head, so a persistent incomplete prefix cannot starve later
 * receipts across repeated bounded passes. Fresh candidates (a live fill
 * mid-write) are skipped by age grace and never reported.
 */
export async function recoverShareFillMoneyOrphans(
  db: Db,
  limit = 50,
  now: Date = new Date()
): Promise<ShareFillMoneyRecoveryResult[]> {
  const budget = Math.max(0, Math.floor(limit));
  if (budget === 0) return [];
  const cursor = moneyOrphanCursorFor(db);
  const window = await fetchMoneyReceiptWindow(db, cursor.moneyAfter, budget);
  const windowKey = lastMoneyWindowKey(window);
  if (windowKey !== undefined) cursor.moneyAfter = windowKey;
  const results: ShareFillMoneyRecoveryResult[] = [];
  for (const receipt of window) {
    if (isFreshMoneyCandidate(receipt, now)) continue;
    const stored = receipt.shareFillMoneyPlan;
    if (!isShareFillMoneyPlan(stored)) {
      await failMoneyFlowReceipt(receipts(db), receipt._id, "share-fill-money:plan-never-stored");
      results.push({ moneyKey: receipt._id, action: "settled-failed-no-plan" });
      continue;
    }
    try {
      await runMoneyFlowSteps(
        receipts(db),
        receipt._id,
        buildShareFillMoneySteps(db, receipt._id, stored),
        mapMoneyError
      );
    } catch {
      results.push({ moneyKey: receipt._id, action: "money-incomplete" });
      continue;
    }
    await receiptsEx(db).updateOne(
      { _id: receipt._id },
      {
        $set: {
          "shareFillMoneyPlan.outcome": { sharesMoved: stored.shares },
          updatedAt: new Date(),
        },
      }
    );
    await bridgeAuditFromPlan(db, stored);
    results.push({ moneyKey: receipt._id, action: "money-recovered" });
  }
  return results;
}
