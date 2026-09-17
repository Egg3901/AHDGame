import { randomUUID } from "node:crypto";
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
  makeLegStep,
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
import {
  FUND_POSITION_COLLECTION,
  FUND_TRANSACTION_COLLECTION,
} from "@/lib/indexFunds/fundQueries";
import type { IndexFundPosition, IndexFundTransaction } from "@/lib/db/types";
import { PENSION_SCHEMES } from "./schemeAssets";

/** Scheme cash debit failed (cash moved since the read, or the row went): nothing applied, caller skips. */
export const PENSION_SCHEME_INVEST_DEBIT = "PENSION_SCHEME_INVEST_DEBIT";
/** Fund unit-supply/cash credit failed (the fund row went between plan and apply): prefix compensates, caller skips. */
export const PENSION_SCHEME_INVEST_FUND = "PENSION_SCHEME_INVEST_FUND";
/** Scheme position write failed (the position row went between plan and apply): prefix compensates, caller skips. */
export const PENSION_SCHEME_INVEST_POSITION = "PENSION_SCHEME_INVEST_POSITION";
/** Subscription audit-row insert failed after money moved: prefix compensates, caller retries next turn. */
export const PENSION_SCHEME_INVEST_TX = "PENSION_SCHEME_INVEST_TX";

/** Domain salt for the deterministic new-position `_id` derived from the flow key. */
const POSITION_INSERT_DOMAIN = "pension-scheme-invest-position";
/** Domain salt for the deterministic subscription audit-row `_id` derived from the flow key. */
const SUBSCRIPTION_TX_DOMAIN = "pension-scheme-invest-subscription";

export interface PensionSchemeInvestSpendInput {
  schemeId: ObjectId;
  /** Cron turn, for keying and the audit row. */
  turn: number;
  fundId: ObjectId;
  /** Fund slug at plan time, for debugging only (never a guard). */
  fundSlug: string;
  /** Scheme display name at plan time, for the audit note (never a guard). */
  schemeName: string;
  /** Pinned execution price: the fund's quotedNav at plan time. */
  quotedNav: number;
  /** Pinned whole units bought (floor(investable / quotedNav), always > 0). */
  units: number;
  /** Pinned anchor cost (units * quotedNav). */
  costAnchor: number;
  /** True when the caller saw an existing (fund, scheme) position at plan time. */
  existingPosition: boolean;
  /**
   * Caller-chosen fingerprint of the intended investment (see
   * `buildPensionSchemeInvestFingerprint`). A retry with the same key and
   * fingerprint reconciles the stored plan; a different fingerprint is a
   * different investment and stays a `MoneyFlowKeyConflictError`.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key. The pension pass derives one per scheme
   * and turn (see `buildPensionSchemeInvestKey`) so a same-turn retry resumes
   * instead of investing twice. Omit to mint one: the attempt is still
   * crash-safe within itself, but a retry mints a new key and is treated as a
   * new investment (still guarded by the keyed steps).
   */
  idempotencyKey?: string;
  /** Pass timestamp pinned by the caller; defaults to now. Excluded from the fingerprint. */
  now?: Date;
}

export interface PensionSchemeInvestOutcome {
  investedAnchor: number;
  units: number;
}

export function isPensionSchemeInvestOutcome(value: unknown): value is PensionSchemeInvestOutcome {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.investedAnchor === "number" && typeof v.units === "number";
}

/**
 * Deterministic idempotency key for one scheme's investment in one turn: one
 * scheme invests at most once per turn, so scheme + turn names the attempt. A
 * same-key retry (crash recovery, same-turn double-fire) reuses it and
 * reconciles; the next cycle gets a new key.
 */
export function buildPensionSchemeInvestKey(schemeId: ObjectId, turn: number): string {
  return `pension-scheme-invest:${schemeId.toHexString()}:turn:${turn}`;
}

/**
 * Deterministic fingerprint for one scheme investment attempt. Covers the
 * scheme, the fund, the turn, and every pinned amount, so a key reused for a
 * different investment fails closed instead of replaying the wrong outcome.
 * Audit-only text (fund slug, scheme name, timestamps) is not covered: a
 * rename is the same money.
 */
export function buildPensionSchemeInvestFingerprint(input: {
  schemeId: ObjectId;
  fundId: ObjectId;
  turn: number;
  quotedNav: number;
  units: number;
  costAnchor: number;
}): string {
  return (
    `pension-scheme-invest:${input.schemeId.toHexString()}` +
    `:fund:${input.fundId.toHexString()}:turn:${input.turn}` +
    `:nav:${input.quotedNav}:units:${input.units}:cost:${input.costAnchor}`
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type PensionSchemeInvestReceipt = MoneyFlowReceipt & { pensionSchemeInvestPlan?: unknown };

interface PensionSchemeInvestStoredPlan {
  version: 1;
  schemeIdHex: string;
  turn: number;
  fundIdHex: string;
  fundSlug: string;
  schemeName: string;
  quotedNav: number;
  units: number;
  costAnchor: number;
  existingPosition: boolean;
  nowIso: string;
  outcome?: PensionSchemeInvestOutcome;
}

interface NormalizedPensionSchemeInvestPlan {
  schemeId: ObjectId;
  turn: number;
  fundId: ObjectId;
  fundSlug: string;
  schemeName: string;
  quotedNav: number;
  units: number;
  costAnchor: number;
  existingPosition: boolean;
  now: Date;
  outcome?: PensionSchemeInvestOutcome;
}

function toStoredPlan(
  input: PensionSchemeInvestSpendInput,
  now: Date
): PensionSchemeInvestStoredPlan {
  return {
    version: 1,
    schemeIdHex: input.schemeId.toHexString(),
    turn: input.turn,
    fundIdHex: input.fundId.toHexString(),
    fundSlug: input.fundSlug,
    schemeName: input.schemeName,
    quotedNav: input.quotedNav,
    units: input.units,
    costAnchor: input.costAnchor,
    existingPosition: input.existingPosition,
    nowIso: now.toISOString(),
  };
}

function toStoredPlanLike(plan: NormalizedPensionSchemeInvestPlan): PensionSchemeInvestStoredPlan {
  return {
    version: 1,
    schemeIdHex: plan.schemeId.toHexString(),
    turn: plan.turn,
    fundIdHex: plan.fundId.toHexString(),
    fundSlug: plan.fundSlug,
    schemeName: plan.schemeName,
    quotedNav: plan.quotedNav,
    units: plan.units,
    costAnchor: plan.costAnchor,
    existingPosition: plan.existingPosition,
    nowIso: plan.now.toISOString(),
    ...(plan.outcome ? { outcome: { ...plan.outcome } } : {}),
  };
}

function isStoredPlan(value: unknown): value is PensionSchemeInvestStoredPlan {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.schemeIdHex === "string" &&
    Number.isInteger(v.turn) &&
    typeof v.fundIdHex === "string" &&
    typeof v.fundSlug === "string" &&
    typeof v.schemeName === "string" &&
    typeof v.quotedNav === "number" &&
    typeof v.units === "number" &&
    typeof v.costAnchor === "number" &&
    typeof v.existingPosition === "boolean" &&
    typeof v.nowIso === "string"
  );
}

function planFromInput(
  input: PensionSchemeInvestSpendInput,
  now: Date
): NormalizedPensionSchemeInvestPlan {
  return {
    schemeId: input.schemeId,
    turn: input.turn,
    fundId: input.fundId,
    fundSlug: input.fundSlug,
    schemeName: input.schemeName,
    quotedNav: input.quotedNav,
    units: input.units,
    costAnchor: input.costAnchor,
    existingPosition: input.existingPosition,
    now,
  };
}

function planFromStored(stored: PensionSchemeInvestStoredPlan): NormalizedPensionSchemeInvestPlan {
  return {
    schemeId: new ObjectId(stored.schemeIdHex),
    turn: stored.turn,
    fundId: new ObjectId(stored.fundIdHex),
    fundSlug: stored.fundSlug,
    schemeName: stored.schemeName,
    quotedNav: stored.quotedNav,
    units: stored.units,
    costAnchor: stored.costAnchor,
    existingPosition: stored.existingPosition,
    now: new Date(stored.nowIso),
    ...(stored.outcome && isPensionSchemeInvestOutcome(stored.outcome)
      ? { outcome: { ...stored.outcome } }
      : {}),
  };
}

function planOutcome(plan: NormalizedPensionSchemeInvestPlan): PensionSchemeInvestOutcome {
  if (plan.outcome) return { ...plan.outcome };
  // A completed receipt always carries the stored outcome; this fallback only
  // runs when the process crashed between settling `completed` and writing
  // the outcome row. Every number is pinned in the plan, so no live read is
  // needed and the report is exactly the attempted investment.
  return { investedAnchor: plan.costAnchor, units: plan.units };
}

interface SchemePositionAccount extends MoneyFlowAccount {
  fundId?: ObjectId;
  holderKind?: string;
  pensionSchemeId?: ObjectId;
  units?: number;
  avgNavAnchor?: number;
}

/**
 * Position image after buying units: the exact weighted-average formula the
 * legacy `creditFundPosition` aggregation-pipeline update used (prior average,
 * or the pinned NAV when the row carries none, blended with the purchase).
 * `legacyUnits` is untouched, exactly like the legacy increment path: new
 * scheme units are post-fix units, never grandfathered.
 */
function positionAfterPurchase(
  priorUnits: number,
  priorAvg: number | undefined,
  buyUnits: number,
  nav: number
): { units: number; avgNavAnchor: number } {
  const total = priorUnits + buyUnits;
  const basis = priorAvg ?? nav;
  return { units: total, avgNavAnchor: (priorUnits * basis + buyUnits * nav) / total };
}

/**
 * Inverse of the position write, computed from live state: removes exactly
 * this purchase. When the remainder is gone the caller deletes the row
 * instead of writing a zero-unit image. Schemes have no redemption path, so
 * the only writer of a scheme position is this pass; the delete is exact.
 */
function positionBeforePurchase(
  liveUnits: number,
  liveAvg: number | undefined,
  boughtUnits: number,
  nav: number
): { units: number; avgNavAnchor: number } | null {
  const remainder = liveUnits - boughtUnits;
  if (remainder <= 0) return null;
  const basis = liveAvg ?? nav;
  return {
    units: remainder,
    avgNavAnchor: (liveUnits * basis - boughtUnits * nav) / remainder,
  };
}

/**
 * One scheme position write as a revertible keyed step (issue #1672): for a
 * position the caller saw at plan time, the image is computed from a live
 * read inside the apply and written in one guarded update, so a crash between
 * the read and the write retries from the same live state and converges, and
 * a same-key replay finds its key recorded and skips. The revert removes
 * exactly this purchase from the live image (deleting when nothing remains).
 * For a new position the deterministic insert converges on its key-derived
 * `_id` (with `legacyUnits: 0`, exactly like `creditFundPosition`), and the
 * revert deletes exactly that row.
 */
function makeSchemePositionStep(
  db: Db,
  key: string,
  plan: NormalizedPensionSchemeInvestPlan
): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(key, "position");
  const positions = db.collection<SchemePositionAccount>(FUND_POSITION_COLLECTION);
  const positionFilter = {
    fundId: plan.fundId,
    holderKind: "pension_scheme",
    pensionSchemeId: plan.schemeId,
  } as Filter<SchemePositionAccount>;

  if (!plan.existingPosition) {
    const docId = keyedInsertId(key, POSITION_INSERT_DOMAIN);
    return {
      name: "position",
      apply: async (stepOpts) =>
        insertKeyedDoc(
          positions as unknown as Collection<IndexFundPosition>,
          {
            _id: docId,
            fundId: plan.fundId,
            holderKind: "pension_scheme",
            pensionSchemeId: plan.schemeId,
            units: plan.units,
            avgNavAnchor: plan.quotedNav,
            legacyUnits: 0,
            createdAt: plan.now,
            updatedAt: plan.now,
          } satisfies IndexFundPosition,
          stepOpts ?? {}
        ),
      revert: async (stepOpts) => {
        const res = await (positions as unknown as Collection<IndexFundPosition>).deleteOne(
          { _id: docId } as Filter<IndexFundPosition>,
          (stepOpts as MoneyFlowOptions | undefined)?.session
            ? { session: (stepOpts as MoneyFlowOptions).session }
            : {}
        );
        return res.deletedCount === 1 ? "applied" : "already-applied";
      },
    };
  }

  const readPosition = async (
    sessionOpts: MoneyFlowOptions
  ): Promise<SchemePositionAccount | null> => {
    const live = await positions.findOne(positionFilter, {
      projection: { units: 1, avgNavAnchor: 1 },
      ...(sessionOpts.session ? { session: sessionOpts.session } : {}),
    });
    return live ?? null;
  };
  return {
    name: "position",
    apply: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const live = await readPosition(opts);
      // The row the caller saw is gone: fail closed and compensate the prefix
      // instead of stranding fund units with no position (the legacy
      // `creditFundPosition` increment silently no-matched here, then the
      // insert raced: on a dup-key loss the retry converged, but a deleted
      // row mid-flow minted units against nothing).
      if (live === null) return "missing";
      const image = positionAfterPurchase(
        live.units ?? 0,
        live.avgNavAnchor,
        plan.units,
        plan.quotedNav
      );
      return applyKeyedUpdate(
        subkey,
        {
          collection: positions,
          filter: positionFilter,
          update: {
            $set: { units: image.units, avgNavAnchor: image.avgNavAnchor, updatedAt: plan.now },
          },
        },
        opts
      );
    },
    revert: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const live = await readPosition(opts);
      if (live === null) return "missing";
      const image = positionBeforePurchase(
        live.units ?? 0,
        live.avgNavAnchor,
        plan.units,
        plan.quotedNav
      );
      if (image === null) {
        const res = await (positions as unknown as Collection<IndexFundPosition>).deleteOne(
          {
            fundId: plan.fundId,
            holderKind: "pension_scheme",
            pensionSchemeId: plan.schemeId,
          } as Filter<IndexFundPosition>,
          (opts as MoneyFlowOptions).session ? { session: (opts as MoneyFlowOptions).session } : {}
        );
        return res.deletedCount === 1 ? "applied" : "already-applied";
      }
      return applyKeyedUpdate(
        deriveMoneyFlowKey(subkey, "compensate", "position"),
        {
          collection: positions,
          filter: positionFilter,
          update: {
            $set: { units: image.units, avgNavAnchor: image.avgNavAnchor, updatedAt: plan.now },
          },
        },
        opts
      );
    },
  };
}

/**
 * Build the ordered keyed steps for one scheme investment. Exported for
 * focused compensation tests: a test can sabotage one step and assert the
 * applied prefix reverses exactly. Production always runs these through
 * `applyPensionSchemeInvestSpend` (claim + stored plan + settlement).
 */
export function buildPensionSchemeInvestSteps(
  db: Db,
  key: string,
  input: PensionSchemeInvestSpendInput,
  now: Date
): MoneyFlowStep[] {
  const plan = planFromInput(input, now);
  const schemes = db.collection<MoneyFlowAccount>(PENSION_SCHEMES);
  const funds = db.collection<MoneyFlowAccount>("indexFunds");
  const txs = db.collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION);

  const steps: MoneyFlowStep[] = [
    // The legacy guarded debit first: the scheme's cash must still cover the
    // pinned cost (the benefit pass runs earlier in the same turn). The
    // `totalInvestedAnchor` cumulative rides the SAME atomic write via
    // extraIncs: a second same-document leg under this key would collide on
    // the key guard and silently skip.
    makeLegStep(deriveMoneyFlowKey(key, "debit"), {
      name: "debit",
      collection: schemes,
      docId: plan.schemeId,
      field: "assetsAnchor",
      delta: -plan.costAnchor,
      minBalance: plan.costAnchor,
      extraIncs: { totalInvestedAnchor: plan.costAnchor },
      set: { updatedAt: plan.now },
    }),
    // One fund credit: unitSupply and cashAnchor move in one leg (same
    // document, one key), so the fund receives exactly the ₳ the units are
    // worth and the backing ratio is unaffected, exactly like the legacy
    // paired `$inc`.
    makeLegStep(deriveMoneyFlowKey(key, "fund"), {
      name: "fund",
      collection: funds,
      docId: plan.fundId,
      field: "unitSupply",
      delta: plan.units,
      extraIncs: { cashAnchor: plan.costAnchor },
      set: { updatedAt: plan.now },
    }),
    makeSchemePositionStep(db, key, plan),
    // Terminal audit row: nothing runs after it, so it carries no inverse. A
    // survived insert error compensates the prefix instead of stranding
    // invested cash with no row. The `_id` derives from the flow key, so a
    // crash between the insert and the receipt completion converges instead
    // of duplicating the row. Content matches the legacy row exactly (kind,
    // holder, units, NAV, amount, note), only the `_id` generation changed.
    makeInsertStep("invest-tx", txs, {
      _id: keyedInsertId(key, SUBSCRIPTION_TX_DOMAIN),
      fundId: plan.fundId,
      kind: "subscription",
      turn: plan.turn,
      holderKind: "pension_scheme",
      pensionSchemeId: plan.schemeId,
      units: plan.units,
      navAnchor: plan.quotedNav,
      amountAnchor: plan.costAnchor,
      note: `${plan.schemeName} pension scheme`,
      createdAt: plan.now,
    } satisfies IndexFundTransaction),
  ];

  return steps;
}

function mapInvestError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface per step: the debit is step zero, so its
  // failure settles `failed` with nothing applied (the old guarded update
  // simply did not match and no units were issued); a later-step failure
  // compensates the applied prefix (the old code had no such path: a fund or
  // position that vanished mid-pass stranded a scheme debit with nothing to
  // show for it, or minted units against a debit that never matched, so
  // failing closed here is the crash-safe replacement, and the pass skips
  // just that scheme).
  if (stepName === "debit") return new Error(`${PENSION_SCHEME_INVEST_DEBIT}:${outcome}`);
  if (stepName === "fund") return new Error(`${PENSION_SCHEME_INVEST_FUND}:${outcome}`);
  if (stepName === "position") return new Error(`${PENSION_SCHEME_INVEST_POSITION}:${outcome}`);
  return new Error(`${PENSION_SCHEME_INVEST_TX}:${outcome}`);
}

function validateInput(input: PensionSchemeInvestSpendInput): void {
  if (!input.schemeId) {
    throw new TypeError("Pension scheme invest spend needs schemeId");
  }
  if (!Number.isInteger(input.turn)) {
    throw new TypeError("Pension scheme invest spend needs an integer turn");
  }
  if (!input.fundId) {
    throw new TypeError("Pension scheme invest spend needs fundId");
  }
  if (typeof input.fundSlug !== "string" || input.fundSlug.length === 0) {
    throw new TypeError("Pension scheme invest spend needs fundSlug");
  }
  if (typeof input.schemeName !== "string" || input.schemeName.length === 0) {
    throw new TypeError("Pension scheme invest spend needs schemeName");
  }
  if (!Number.isFinite(input.quotedNav) || input.quotedNav <= 0) {
    throw new RangeError("Pension scheme invest quotedNav must be a positive finite amount");
  }
  if (!Number.isInteger(input.units) || input.units <= 0) {
    throw new RangeError("Pension scheme invest units must be a positive integer");
  }
  if (!Number.isFinite(input.costAnchor) || input.costAnchor <= 0) {
    throw new RangeError("Pension scheme invest costAnchor must be a positive finite amount");
  }
  if (input.costAnchor !== input.units * input.quotedNav) {
    throw new RangeError("Pension scheme invest costAnchor must equal units * quotedNav");
  }
  if (typeof input.existingPosition !== "boolean") {
    throw new TypeError("Pension scheme invest spend needs existingPosition");
  }
  if (typeof input.fingerprint !== "string" || input.fingerprint.length === 0) {
    throw new TypeError("Pension scheme invest needs a non-empty fingerprint");
  }
}

/**
 * Invest one scheme's pinned subscription (cash debit + fund credit +
 * position write + audit row) so the result is exactly-once on every
 * topology (issue #1672).
 *
 * Step order mirrors the historical write order (debit, fund credit,
 * position write, audit row), and a later-step failure compensates its own
 * prefix instead of leaving a strand where the scheme paid but holds
 * nothing, or the fund minted units against a debit that never matched.
 *
 * The caller (the pension pass) owns everything ambient: the roster read,
 * the investable-cash rule, the fund choice, and the forward-priced NAV.
 * Those arrive here as pinned amounts on the input and are persisted on the
 * receipt plan at claim time, so a same-key retry never recomputes them from
 * post-debit state or changed prices.
 *
 * Under real transactions the debit, the fund credit, the position write,
 * the audit row, and the idempotency receipt join the transaction and commit
 * atomically, preserving the old behavior. On a standalone deployment the
 * fallback runs the same writes as keyed idempotent steps: a crash between
 * them leaves an `in_progress` receipt, and retrying with the same key and
 * fingerprint reconciles to exactly one investment. A retry after a terminal
 * failure throws `MoneyFlowTerminalError` (fail closed); a new attempt needs
 * a new key.
 */
export async function applyPensionSchemeInvestSpend(
  db: Db,
  input: PensionSchemeInvestSpendInput
): Promise<{ duplicate: boolean; outcome: PensionSchemeInvestOutcome }> {
  validateInput(input);
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Pension scheme invest idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<PensionSchemeInvestReceipt>;
  const now = input.now ?? new Date();

  const persistOutcome = async (
    plan: NormalizedPensionSchemeInvestPlan,
    opts: { session?: ClientSession }
  ): Promise<PensionSchemeInvestOutcome> => {
    const outcome = planOutcome(plan);
    await receiptCollection.updateOne(
      { _id: key },
      {
        $set: {
          pensionSchemeInvestPlan: { ...toStoredPlanLike(plan), outcome },
          updatedAt: new Date(),
        },
      },
      opts.session ? { session: opts.session } : {}
    );
    return outcome;
  };

  const runPlan = async (
    plan: NormalizedPensionSchemeInvestPlan,
    stepInput: PensionSchemeInvestSpendInput,
    opts: { session?: ClientSession }
  ): Promise<PensionSchemeInvestOutcome> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildPensionSchemeInvestSteps(db, key, stepInput, plan.now),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => mapInvestError(step.name, outcome),
      opts
    );
    return persistOutcome(plan, opts);
  };

  const storedInput = (stored: PensionSchemeInvestStoredPlan): PensionSchemeInvestSpendInput => ({
    schemeId: new ObjectId(stored.schemeIdHex),
    turn: stored.turn,
    fundId: new ObjectId(stored.fundIdHex),
    fundSlug: stored.fundSlug,
    schemeName: stored.schemeName,
    quotedNav: stored.quotedNav,
    units: stored.units,
    costAnchor: stored.costAnchor,
    existingPosition: stored.existingPosition,
    fingerprint: input.fingerprint,
    idempotencyKey: key,
    now: new Date(stored.nowIso),
  });

  const runSpend = async (
    session?: ClientSession
  ): Promise<{ duplicate: boolean; outcome: PensionSchemeInvestOutcome }> => {
    const opts = session ? { session } : {};
    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same key, different fingerprint: a genuinely different investment
      // reusing the key, not a post-crash remainder. Fail closed. (Crash
      // recovery resumes by key through `resumePensionSchemeInvestByKey`,
      // which rebuilds from the stored plan without presenting a live
      // fingerprint at all.)
      throw err;
    }
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.pensionSchemeInvestPlan;
      if (!isStoredPlan(stored)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return { duplicate: true, outcome: await persistOutcome(planFromStored(stored), opts) };
    }
    if (claim === "in-progress") {
      // Same fingerprint, so the live input names the same investment, but
      // the steps run from the STORED plan when one exists, never the live
      // input: post-crash reads are post-debit state under possibly changed
      // prices and would invest twice. No stored plan means the crash landed
      // between the claim insert and the plan write below (nothing applied
      // yet), so the live input under the stored fingerprint is exact.
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.pensionSchemeInvestPlan;
      if (isStoredPlan(stored)) {
        const plan = planFromStored(stored);
        const outcome = await runPlan(plan, storedInput(stored), opts);
        return { duplicate: true, outcome };
      }
      const plan = planFromInput(input, now);
      const outcome = await runPlan(plan, input, opts);
      return { duplicate: true, outcome };
    }
    // A fresh claim owns the attempt. Persist the resume plan before the
    // first step: a crash from here on resumes this exact plan under the same
    // key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { pensionSchemeInvestPlan: toStoredPlan(input, now), updatedAt: new Date() } },
        opts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${PENSION_SCHEME_INVEST_TX}:plan-store`, opts);
      throw planError;
    }

    const plan = planFromInput(input, now);
    const outcome = await runPlan(plan, input, opts);
    return { duplicate: false, outcome };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

export interface PensionSchemeInvestResumeResult {
  /** Stored investment numbers for the resumed attempt. */
  outcome: PensionSchemeInvestOutcome;
}

/**
 * Key-only crash recovery for one scheme investment (issue #1672): a
 * same-turn re-run of the pension pass resumes under the stored key, so no
 * receipt strands `in_progress` and no scheme invests twice.
 *
 * Returns null when there is nothing to resume (no receipt under the key, an
 * already-`completed` receipt, or an `in_progress` receipt with no usable
 * stored plan). Throws `MoneyFlowTerminalError` when the receipt settled
 * `failed`/`compensated`, and `MoneyFlowKeyConflictError` when the stored
 * attempt names a different scheme or turn (fail closed on cross-key reuse).
 */
export async function resumePensionSchemeInvestByKey(
  db: Db,
  key: string,
  expectedSchemeId: ObjectId,
  expectedTurn: number
): Promise<PensionSchemeInvestResumeResult | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Pension scheme invest idempotency key must be 1-128 characters");
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<PensionSchemeInvestReceipt>;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  const stored = existing.pensionSchemeInvestPlan;
  if (existing.status === "completed") {
    if (
      isStoredPlan(stored) &&
      (stored.schemeIdHex !== expectedSchemeId.toHexString() || stored.turn !== expectedTurn)
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
  // and the pass plans the scheme fresh under the same deterministic key, so
  // there is nothing to resume here.
  if (!isStoredPlan(stored)) return null;
  if (stored.schemeIdHex !== expectedSchemeId.toHexString() || stored.turn !== expectedTurn) {
    throw new MoneyFlowKeyConflictError(key);
  }
  const plan = planFromStored(stored);
  const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
    mapInvestError(step.name, outcome);
  const stepInput: PensionSchemeInvestSpendInput = {
    schemeId: plan.schemeId,
    turn: plan.turn,
    fundId: plan.fundId,
    fundSlug: plan.fundSlug,
    schemeName: plan.schemeName,
    quotedNav: plan.quotedNav,
    units: plan.units,
    costAnchor: plan.costAnchor,
    existingPosition: plan.existingPosition,
    fingerprint: "",
    idempotencyKey: key,
    now: plan.now,
  };
  let outcome: PensionSchemeInvestOutcome;
  await runWithOptionalTransaction(
    async (session) => {
      await runMoneyFlowSteps(
        receipts,
        key,
        buildPensionSchemeInvestSteps(db, key, stepInput, plan.now),
        mapError,
        {
          session,
        }
      );
      outcome = await persistResumeOutcome(receiptCollection, key, plan, { session });
    },
    async () => {
      await runMoneyFlowSteps(
        receipts,
        key,
        buildPensionSchemeInvestSteps(db, key, stepInput, plan.now),
        mapError
      );
      outcome = await persistResumeOutcome(receiptCollection, key, plan, {});
    }
  );
  return { outcome: outcome! };
}

async function persistResumeOutcome(
  receiptCollection: Collection<PensionSchemeInvestReceipt>,
  key: string,
  plan: NormalizedPensionSchemeInvestPlan,
  opts: { session?: ClientSession }
): Promise<PensionSchemeInvestOutcome> {
  const outcome = planOutcome(plan);
  await receiptCollection.updateOne(
    { _id: key },
    {
      $set: {
        pensionSchemeInvestPlan: { ...toStoredPlanLike(plan), outcome },
        updatedAt: new Date(),
      },
    },
    opts.session ? { session: opts.session } : {}
  );
  return outcome;
}

/**
 * Reconcile scheme investments a crashed pass left behind before the fresh
 * roster loads.
 *
 * Two stuck shapes: `in_progress` receipts carrying a scheme-invest plan for
 * this turn (resume under the stored key: applied steps converge, the rest
 * land), and `in_progress` receipts under this turn's key shape with no plan
 * (crashed between the claim insert and the plan write: nothing applied yet,
 * so settle the receipt and let the scheme invest fresh next cycle under a
 * new key; retrying the same key this turn would hit the terminal receipt).
 * Anything else stays quarantined for ops and never breaks the pass.
 *
 * Returns the resumed count and invested total for the pass tally. A resumed
 * scheme carries its key-recorded debit, so the fresh loop below replays the
 * same deterministic key and converges instead of investing twice.
 */
export async function recoverPensionSchemeInvestOrphans(
  db: Db,
  turn: number
): Promise<{ resumed: number; investedAnchor: number }> {
  let resumed = 0;
  let investedAnchor = 0;
  const receipts = await getMoneyFlowReceiptsCollection(db);

  // All `in_progress` receipts (the collection is TTL-bounded and unsettled
  // receipts are rare); a plan-less receipt carries no turn link, so it joins
  // via the deterministic key shape instead of the stored plan.
  const stuckReceipts = await receipts.find({ status: "in_progress" }).toArray();
  for (const receipt of stuckReceipts) {
    const key = receipt._id;
    const stored = (receipt as PensionSchemeInvestReceipt).pensionSchemeInvestPlan;
    if (!isStoredPlan(stored)) {
      if (!key.startsWith("pension-scheme-invest:") || !key.endsWith(`:turn:${turn}`)) continue;
      // Crashed between the claim insert and the plan write: the plan lands
      // before the first step, so nothing applied yet. Settle the receipt;
      // the scheme invests fresh next cycle under a new key.
      await failMoneyFlowReceipt(receipts, key, `${PENSION_SCHEME_INVEST_TX}:orphan-no-plan`);
      continue;
    }
    if (stored.turn !== turn) continue;
    try {
      const result = await resumePensionSchemeInvestByKey(
        db,
        key,
        new ObjectId(stored.schemeIdHex),
        turn
      );
      if (result) {
        resumed += 1;
        investedAnchor += result.outcome.investedAnchor;
      }
    } catch (err) {
      console.warn(
        `[pension] orphan scheme investment ${key} did not resume: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return { resumed, investedAnchor };
}
