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
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import {
  FUND_POSITION_COLLECTION,
  FUND_TRANSACTION_COLLECTION,
} from "@/lib/indexFunds/fundQueries";
import type { IndexFundPosition, IndexFundTransaction } from "@/lib/db/types";
import type { NPRiskArchetype } from "@/lib/indexFunds/nppInvesting";

/** NPP cash accrual failed (the NPP row went missing or lost the turn race): nothing applied, caller skips the NPP. */
export const NPP_INVEST_ACCRUE = "NPP_INVEST_ACCRUE";
/** NPP investment debit failed (post-accrual cash below the pinned total): the accrual compensates, caller skips the NPP. */
export const NPP_INVEST_DEBIT = "NPP_INVEST_DEBIT";
/** Fund unit-supply/cash credit failed (the fund row went between plan and apply): applied prefix compensates, caller skips the NPP. */
export const NPP_INVEST_FUND = "NPP_INVEST_FUND";
/** NPP position write failed (the position row went between plan and apply): applied prefix compensates, caller skips the NPP. */
export const NPP_INVEST_POSITION = "NPP_INVEST_POSITION";
/** Subscription audit-row insert failed after money moved: prefix compensates, caller retries next cycle. */
export const NPP_INVEST_TX = "NPP_INVEST_TX";

/** Domain salt for the deterministic new-position `_id` derived from the flow key, per fund. */
const POSITION_INSERT_DOMAIN_PREFIX = "npp-invest-position";
/** Domain salt for the deterministic subscription audit-row `_id` derived from the flow key, per fund. */
const SUBSCRIPTION_TX_DOMAIN_PREFIX = "npp-invest-subscription";

/** One pinned fund purchase: resolved once by the caller, never recomputed on replay. */
export interface NppInvestSubscription {
  fundId: ObjectId;
  /** Fund slug at plan time, for debugging only (never a guard). */
  fundSlug: string;
  /** Pinned execution price: the fund's quotedNav at plan time. */
  quotedNav: number;
  /** Pinned whole units bought (floor(amount / quotedNav), always > 0). */
  units: number;
  /** Pinned anchor cost (units * quotedNav). */
  costAnchor: number;
  /** True when the caller saw an existing (fund, npp) position at plan time. */
  existingPosition: boolean;
}

export interface NppInvestSpendInput {
  nppId: ObjectId;
  /** Cron turn, for keying and the accrual turn guard. */
  turn: number;
  /** Damped per-turn accrual (the legacy budget: investable budget x multiplier x damping). Always > 0. */
  budget: number;
  /** Pinned sum of subscription costs (<= budget; 0 with no subscriptions or the canary). */
  investedAnchor: number;
  /** Risk archetype at plan time, for audit rows. */
  archetype: NPRiskArchetype;
  /** Pinned subscriptions in legacy write order. */
  subscriptions: NppInvestSubscription[];
  /**
   * True when the legacy invested-exceeds-budget canary fired: subscriptions
   * were dropped, so the flow accrues only. Preserves the historical accrue-
   * but-don't-invest outcome instead of risking an over-debit.
   */
  canarySkipped: boolean;
  /**
   * Caller-chosen fingerprint of the intended investment (see
   * `buildNppInvestFingerprint`). A retry with the same key and fingerprint
   * reconciles the stored plan; a different fingerprint is a different
   * investment and stays a `MoneyFlowKeyConflictError`.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key. The NPP pass derives one per NPP and
   * turn (see `buildNppInvestKey`) so a same-turn retry resumes instead of
   * accruing twice. Omit to mint one: the attempt is still crash-safe within
   * itself, but a client retry mints a new key and is treated as a new
   * investment (still guarded by the keyed steps and the turn stamp).
   */
  idempotencyKey?: string;
  /** Pass timestamp pinned by the caller; defaults to now. Excluded from the fingerprint. */
  now?: Date;
}

export interface NppInvestOutcome {
  budget: number;
  investedAnchor: number;
  subscriptions: number;
}

export function isNppInvestOutcome(value: unknown): value is NppInvestOutcome {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.budget === "number" &&
    typeof v.investedAnchor === "number" &&
    typeof v.subscriptions === "number"
  );
}

/**
 * Deterministic idempotency key for one NPP's investment in one turn: one NPP
 * invests at most once per turn (the accrual turn stamp guards it), so NPP +
 * turn names the attempt. A same-key retry (crash recovery, same-turn
 * double-fire) reuses it and reconciles; the next cycle gets a new key.
 */
export function buildNppInvestKey(nppId: ObjectId, turn: number): string {
  return `npp-invest:${nppId.toHexString()}:turn:${turn}`;
}

/**
 * Deterministic fingerprint for one NPP investment attempt. Covers the NPP,
 * the turn, the damped budget, the pinned invested total, the archetype, the
 * canary flag, and every subscription (fund, pinned NAV, units, cost, and the
 * existing/new position flag) in write order, so a key reused for a different
 * investment fails closed instead of replaying the wrong outcome. Audit-only
 * text (fund slug, timestamps) is not covered: a rename is the same money.
 */
export function buildNppInvestFingerprint(input: {
  nppId: ObjectId;
  turn: number;
  budget: number;
  investedAnchor: number;
  archetype: NPRiskArchetype;
  canarySkipped: boolean;
  subscriptions: NppInvestSubscription[];
}): string {
  const subPart = input.subscriptions
    .map(
      (s) =>
        `${s.fundId.toHexString()}:${s.quotedNav}:${s.units}:${s.costAnchor}:${
          s.existingPosition ? "existing" : "new"
        }`
    )
    .join("|");
  return (
    `npp-invest:${input.nppId.toHexString()}:turn:${input.turn}` +
    `:budget:${input.budget}:invested:${input.investedAnchor}` +
    `:arch:${input.archetype}:canary:${input.canarySkipped ? 1 : 0}:subs:[${subPart}]`
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type NppInvestReceipt = MoneyFlowReceipt & { nppInvestPlan?: unknown };

interface NppInvestStoredSubscription {
  fundIdHex: string;
  fundSlug: string;
  quotedNav: number;
  units: number;
  costAnchor: number;
  existingPosition: boolean;
}

interface NppInvestStoredPlan {
  version: 1;
  nppIdHex: string;
  turn: number;
  budget: number;
  investedAnchor: number;
  archetype: NPRiskArchetype;
  canarySkipped: boolean;
  subscriptions: NppInvestStoredSubscription[];
  nowIso: string;
  outcome?: NppInvestOutcome;
}

interface NormalizedNppInvestPlan {
  nppId: ObjectId;
  turn: number;
  budget: number;
  investedAnchor: number;
  archetype: NPRiskArchetype;
  canarySkipped: boolean;
  subscriptions: {
    fundId: ObjectId;
    fundSlug: string;
    quotedNav: number;
    units: number;
    costAnchor: number;
    existingPosition: boolean;
  }[];
  now: Date;
  outcome?: NppInvestOutcome;
}

function toStoredSubscription(
  s: NormalizedNppInvestPlan["subscriptions"][number]
): NppInvestStoredSubscription {
  return {
    fundIdHex: s.fundId.toHexString(),
    fundSlug: s.fundSlug,
    quotedNav: s.quotedNav,
    units: s.units,
    costAnchor: s.costAnchor,
    existingPosition: s.existingPosition,
  };
}

function toStoredPlan(input: NppInvestSpendInput, now: Date): NppInvestStoredPlan {
  return {
    version: 1,
    nppIdHex: input.nppId.toHexString(),
    turn: input.turn,
    budget: input.budget,
    investedAnchor: input.investedAnchor,
    archetype: input.archetype,
    canarySkipped: input.canarySkipped,
    subscriptions: input.subscriptions.map((s) => ({
      fundIdHex: s.fundId.toHexString(),
      fundSlug: s.fundSlug,
      quotedNav: s.quotedNav,
      units: s.units,
      costAnchor: s.costAnchor,
      existingPosition: s.existingPosition,
    })),
    nowIso: now.toISOString(),
  };
}

function toStoredPlanLike(plan: NormalizedNppInvestPlan): NppInvestStoredPlan {
  return {
    version: 1,
    nppIdHex: plan.nppId.toHexString(),
    turn: plan.turn,
    budget: plan.budget,
    investedAnchor: plan.investedAnchor,
    archetype: plan.archetype,
    canarySkipped: plan.canarySkipped,
    subscriptions: plan.subscriptions.map(toStoredSubscription),
    nowIso: plan.now.toISOString(),
    ...(plan.outcome ? { outcome: { ...plan.outcome } } : {}),
  };
}

function isStoredPlan(value: unknown): value is NppInvestStoredPlan {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.nppIdHex !== "string") return false;
  if (!Number.isInteger(v.turn)) return false;
  if (typeof v.budget !== "number" || typeof v.investedAnchor !== "number") return false;
  if (
    v.archetype !== "conservative" &&
    v.archetype !== "moderate" &&
    v.archetype !== "aggressive"
  ) {
    return false;
  }
  if (typeof v.canarySkipped !== "boolean") return false;
  if (!Array.isArray(v.subscriptions)) return false;
  if (typeof v.nowIso !== "string") return false;
  return (v.subscriptions as unknown[]).every((s) => {
    if (!s || typeof s !== "object") return false;
    const sub = s as Record<string, unknown>;
    return (
      typeof sub.fundIdHex === "string" &&
      typeof sub.fundSlug === "string" &&
      typeof sub.quotedNav === "number" &&
      typeof sub.units === "number" &&
      typeof sub.costAnchor === "number" &&
      typeof sub.existingPosition === "boolean"
    );
  });
}

function planFromInput(input: NppInvestSpendInput, now: Date): NormalizedNppInvestPlan {
  return {
    nppId: input.nppId,
    turn: input.turn,
    budget: input.budget,
    investedAnchor: input.investedAnchor,
    archetype: input.archetype,
    canarySkipped: input.canarySkipped,
    subscriptions: input.subscriptions.map((s) => ({ ...s })),
    now,
  };
}

function planFromStored(stored: NppInvestStoredPlan): NormalizedNppInvestPlan {
  return {
    nppId: new ObjectId(stored.nppIdHex),
    turn: stored.turn,
    budget: stored.budget,
    investedAnchor: stored.investedAnchor,
    archetype: stored.archetype,
    canarySkipped: stored.canarySkipped,
    subscriptions: stored.subscriptions.map((s) => ({
      fundId: new ObjectId(s.fundIdHex),
      fundSlug: s.fundSlug,
      quotedNav: s.quotedNav,
      units: s.units,
      costAnchor: s.costAnchor,
      existingPosition: s.existingPosition,
    })),
    now: new Date(stored.nowIso),
    ...(stored.outcome && isNppInvestOutcome(stored.outcome)
      ? { outcome: { ...stored.outcome } }
      : {}),
  };
}

function planOutcome(plan: NormalizedNppInvestPlan): NppInvestOutcome {
  if (plan.outcome) return { ...plan.outcome };
  // A completed receipt always carries the stored outcome; this fallback only
  // runs when the process crashed between settling `completed` and writing
  // the outcome row. Every number is pinned in the plan, so no live read is
  // needed and the report is exactly the attempted investment.
  return {
    budget: plan.budget,
    investedAnchor: plan.investedAnchor,
    subscriptions: plan.subscriptions.length,
  };
}

interface NppPositionAccount extends MoneyFlowAccount {
  fundId?: ObjectId;
  holderKind?: string;
  nppId?: ObjectId;
  units?: number;
  avgNavAnchor?: number;
}

/**
 * Position image after buying units: the exact weighted-average formula the
 * legacy aggregation-pipeline update used (prior average, or the pinned NAV
 * when the row carries none, blended with the purchase).
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
 * this purchase. When the remainder is gone (a concurrent drain took the rest)
 * the caller deletes the row instead of writing a zero-unit image.
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
 * One NPP position write as a revertible keyed step (issue #1672): for a
 * position the caller saw at plan time, the image is computed from a live
 * read inside the apply and written in one guarded update, so a crash between
 * the read and the write retries from the same live state and converges, and
 * a same-key replay finds its key recorded and skips. The revert removes
 * exactly this purchase from the live image (deleting when nothing remains),
 * so a concurrent sale that landed in between keeps its effect. For a new
 * position the deterministic insert converges on its key-derived `_id`, and
 * the revert deletes exactly that row.
 */
function makeNppPositionStep(
  db: Db,
  key: string,
  plan: NormalizedNppInvestPlan,
  sub: NormalizedNppInvestPlan["subscriptions"][number]
): MoneyFlowStep {
  const stepName = `position:${sub.fundId.toHexString()}`;
  const subkey = deriveMoneyFlowKey(key, "position", sub.fundId.toHexString());
  const positions = db.collection<NppPositionAccount>(FUND_POSITION_COLLECTION);
  const positionFilter = {
    fundId: sub.fundId,
    holderKind: "npp",
    nppId: plan.nppId,
  } as Filter<NppPositionAccount>;

  if (!sub.existingPosition) {
    const docId = keyedInsertId(
      key,
      `${POSITION_INSERT_DOMAIN_PREFIX}:${sub.fundId.toHexString()}`
    );
    return {
      name: stepName,
      apply: async (stepOpts) =>
        insertKeyedDoc(
          positions as unknown as Collection<IndexFundPosition>,
          {
            _id: docId,
            fundId: sub.fundId,
            holderKind: "npp",
            nppId: plan.nppId,
            units: sub.units,
            avgNavAnchor: sub.quotedNav,
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
  ): Promise<NppPositionAccount | null> => {
    const live = await positions.findOne(positionFilter, {
      projection: { units: 1, avgNavAnchor: 1 },
      ...(sessionOpts.session ? { session: sessionOpts.session } : {}),
    });
    return live ?? null;
  };
  return {
    name: stepName,
    apply: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const live = await readPosition(opts);
      // The row the caller saw is gone: fail closed and compensate the prefix
      // instead of stranding fund units with no position (the legacy bulk
      // update silently no-matched here).
      if (live === null) return "missing";
      const image = positionAfterPurchase(
        live.units ?? 0,
        live.avgNavAnchor,
        sub.units,
        sub.quotedNav
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
        sub.units,
        sub.quotedNav
      );
      if (image === null) {
        const res = await (positions as unknown as Collection<IndexFundPosition>).deleteOne(
          { fundId: sub.fundId, holderKind: "npp", nppId: plan.nppId } as Filter<IndexFundPosition>,
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
 * Build the ordered keyed steps for one NPP investment. Exported for focused
 * compensation tests: a test can sabotage one step and assert the applied
 * prefix reverses exactly. Production always runs these through
 * `applyNppInvestSpend` (claim + stored plan + settlement).
 */
export function buildNppInvestSteps(
  db: Db,
  key: string,
  input: NppInvestSpendInput,
  now: Date
): MoneyFlowStep[] {
  const plan = planFromInput(input, now);
  const npps = db.collection<MoneyFlowAccount>("npps");
  const funds = db.collection<MoneyFlowAccount>("indexFunds");
  const txs = db.collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION);

  // The legacy accrue and debit were two bulk passes over the same NPP rows
  // (accrue with the turn-stamp guard, debit with the $gte guard). They run
  // here as two legs with DISTINCT subkeys: two same-document legs under one
  // key would collide, the first leg's key record tripping the second leg's
  // `$ne: key` guard and silently skipping the debit.
  const steps: MoneyFlowStep[] = [
    makeLegStep(deriveMoneyFlowKey(key, "accrue"), {
      name: "accrue",
      collection: npps,
      docId: plan.nppId,
      field: "nppInvestmentCashAnchor",
      delta: plan.budget,
      extraFilter: {
        $or: [
          { lastIndexFundInvestmentTurn: { $ne: plan.turn } },
          { lastIndexFundInvestmentTurn: { $exists: false } },
        ],
      } as Filter<MoneyFlowAccount>,
      set: { lastIndexFundInvestmentTurn: plan.turn, updatedAt: plan.now },
    }),
  ];
  if (plan.investedAnchor > 0) {
    steps.push(
      makeLegStep(deriveMoneyFlowKey(key, "debit"), {
        name: "debit",
        collection: npps,
        docId: plan.nppId,
        field: "nppInvestmentCashAnchor",
        delta: -plan.investedAnchor,
        minBalance: plan.investedAnchor,
        set: { updatedAt: plan.now },
      })
    );
  }

  // One fund credit per pinned subscription, in plan order (the legacy
  // per-fund aggregate split per NPP: same totals, keyed per attempt). The
  // two legacy $incs on one fund document collapse into one leg: a second
  // same-document leg under this key would collide on the key guard.
  for (const sub of plan.subscriptions) {
    steps.push(
      makeLegStep(deriveMoneyFlowKey(key, "fund", sub.fundId.toHexString()), {
        name: `fund:${sub.fundId.toHexString()}`,
        collection: funds,
        docId: sub.fundId,
        field: "unitSupply",
        delta: sub.units,
        extraIncs: { cashAnchor: sub.costAnchor },
        set: { updatedAt: plan.now },
      })
    );
  }

  for (const sub of plan.subscriptions) {
    steps.push(makeNppPositionStep(db, key, plan, sub));
  }

  // Terminal audit rows: nothing runs after them, so they carry no inverse. A
  // survived insert error compensates the prefix instead of stranding invested
  // cash with no row. The `_id`s derive from the flow key per fund, so a
  // crash between an insert and the receipt completion converges instead of
  // duplicating the row. Content matches the legacy rows exactly (kind,
  // holder, units, NAV, amount, note), only the `_id` generation changed.
  for (const sub of plan.subscriptions) {
    steps.push(
      makeInsertStep(`invest-tx:${sub.fundId.toHexString()}`, txs, {
        _id: keyedInsertId(key, `${SUBSCRIPTION_TX_DOMAIN_PREFIX}:${sub.fundId.toHexString()}`),
        fundId: sub.fundId,
        kind: "subscription",
        holderKind: "npp",
        nppId: plan.nppId,
        units: sub.units,
        navAnchor: sub.quotedNav,
        amountAnchor: sub.costAnchor,
        note: `NPP ${plan.nppId.toHexString()} subscription (${plan.archetype})`,
        createdAt: plan.now,
      } satisfies IndexFundTransaction)
    );
  }

  return steps;
}

function mapInvestError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface per step: the accrual is step zero, so
  // its failure settles `failed` with nothing applied (the old bulk accrue
  // simply did not match a turn-stamped row); a later-step failure
  // compensates the applied prefix (the old code had no such path: a fund or
  // position that vanished mid-pass stranded a partial investment, or minted
  // units against a debit that never matched, so failing closed here is the
  // crash-safe replacement, and the pass skips just that NPP).
  if (stepName === "accrue") return new Error(`${NPP_INVEST_ACCRUE}:${outcome}`);
  if (stepName === "debit") return new Error(`${NPP_INVEST_DEBIT}:${outcome}`);
  if (stepName.startsWith("fund:")) return new Error(`${NPP_INVEST_FUND}:${outcome}`);
  if (stepName.startsWith("position:")) return new Error(`${NPP_INVEST_POSITION}:${outcome}`);
  return new Error(`${NPP_INVEST_TX}:${outcome}`);
}

function validateInput(input: NppInvestSpendInput): void {
  if (!input.nppId) {
    throw new TypeError("NPP invest spend needs nppId");
  }
  if (!Number.isInteger(input.turn)) {
    throw new TypeError("NPP invest spend needs an integer turn");
  }
  if (!Number.isFinite(input.budget) || input.budget <= 0) {
    throw new RangeError("NPP invest budget must be a positive finite amount");
  }
  if (!Number.isFinite(input.investedAnchor) || input.investedAnchor < 0) {
    throw new RangeError("NPP invest investedAnchor must be a finite non-negative amount");
  }
  if (input.investedAnchor > input.budget) {
    // The legacy invested-exceeds-budget canary drops the subscriptions and
    // accrues only; it must arrive as canarySkipped with an empty plan, never
    // as an over-budget debit.
    throw new RangeError("NPP invest investedAnchor must not exceed the budget");
  }
  if (
    input.archetype !== "conservative" &&
    input.archetype !== "moderate" &&
    input.archetype !== "aggressive"
  ) {
    throw new TypeError("NPP invest needs a valid archetype");
  }
  if (!Array.isArray(input.subscriptions)) {
    throw new TypeError("NPP invest needs a subscriptions array");
  }
  if (input.canarySkipped && (input.subscriptions.length > 0 || input.investedAnchor !== 0)) {
    throw new RangeError("NPP invest canarySkipped needs an empty zero-investment plan");
  }
  let costSum = 0;
  for (const sub of input.subscriptions) {
    if (!sub.fundId) {
      throw new TypeError("NPP invest subscription needs fundId");
    }
    if (typeof sub.fundSlug !== "string" || sub.fundSlug.length === 0) {
      throw new TypeError("NPP invest subscription needs fundSlug");
    }
    if (!Number.isFinite(sub.quotedNav) || sub.quotedNav <= 0) {
      throw new RangeError("NPP invest subscription quotedNav must be a positive finite amount");
    }
    if (!Number.isInteger(sub.units) || sub.units <= 0) {
      throw new RangeError("NPP invest subscription units must be a positive integer");
    }
    if (!Number.isFinite(sub.costAnchor) || sub.costAnchor <= 0) {
      throw new RangeError("NPP invest subscription costAnchor must be a positive finite amount");
    }
    if (typeof sub.existingPosition !== "boolean") {
      throw new TypeError("NPP invest subscription needs existingPosition");
    }
    costSum += sub.costAnchor;
  }
  if (costSum !== input.investedAnchor) {
    throw new RangeError("NPP invest subscription costs must sum to investedAnchor");
  }
  if (typeof input.fingerprint !== "string" || input.fingerprint.length === 0) {
    throw new TypeError("NPP invest needs a non-empty fingerprint");
  }
}

/**
 * Invest one NPP's pinned budget (cash accrual + debit + per-fund credits +
 * position writes + audit rows) so the result is exactly-once on every
 * topology (issue #1672).
 *
 * Step order mirrors the historical write order (accrue, debit, fund
 * credits, position writes, audit rows), and a later-step failure compensates
 * its own prefix (accrual refunded, fund units burned back) instead of
 * leaving a strand where the NPP paid but holds nothing, or the fund minted
 * units against a debit that never matched.
 *
 * Fan-out keying: the accrual and the debit carry their own idempotent
 * sub-operation keys derived from the flow key via `deriveMoneyFlowKey`
 * (they touch the same NPP document, so sharing one key would collide), plus
 * one `fund:<id>` suffix per subscription, one `position:<id>` suffix per
 * position write, plus the deterministic audit-row `_id`s, so a crash between
 * any two writes resumes per step: applied steps report `already-applied` and
 * are skipped while the rest still land.
 *
 * The caller (the NPP pass) owns everything ambient: the roster read, the
 * GDP budget, the wealth-saturation damping, the archetype allocation, the
 * fund universe, and the forward-priced NAV. Those arrive here as pinned
 * amounts on the input and are persisted on the receipt plan at claim time,
 * so a same-key retry never recomputes them from post-accrual state or
 * changed prices.
 *
 * Under real transactions the accrual, the debit, the fund credits, the
 * position writes, the audit rows, and the idempotency receipt join the
 * transaction and commit atomically, preserving the old behavior. On a
 * standalone deployment the fallback runs the same writes as keyed idempotent
 * steps: a crash between them leaves an `in_progress` receipt, and retrying
 * with the same key and fingerprint reconciles to exactly one investment. A
 * retry after a terminal failure throws `MoneyFlowTerminalError` (fail
 * closed); a new attempt needs a new key.
 */
export async function applyNppInvestSpend(
  db: Db,
  input: NppInvestSpendInput
): Promise<{ duplicate: boolean; outcome: NppInvestOutcome }> {
  validateInput(input);
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("NPP invest idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<NppInvestReceipt>;
  const now = input.now ?? new Date();

  const persistOutcome = async (
    plan: NormalizedNppInvestPlan,
    opts: { session?: ClientSession }
  ): Promise<NppInvestOutcome> => {
    const outcome = planOutcome(plan);
    await receiptCollection.updateOne(
      { _id: key },
      {
        $set: {
          nppInvestPlan: { ...toStoredPlanLike(plan), outcome },
          updatedAt: new Date(),
        },
      },
      opts.session ? { session: opts.session } : {}
    );
    return outcome;
  };

  const runPlan = async (
    plan: NormalizedNppInvestPlan,
    stepInput: NppInvestSpendInput,
    opts: { session?: ClientSession }
  ): Promise<NppInvestOutcome> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildNppInvestSteps(db, key, stepInput, plan.now),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => mapInvestError(step.name, outcome),
      opts
    );
    return persistOutcome(plan, opts);
  };

  const storedInput = (stored: NppInvestStoredPlan): NppInvestSpendInput => ({
    nppId: new ObjectId(stored.nppIdHex),
    turn: stored.turn,
    budget: stored.budget,
    investedAnchor: stored.investedAnchor,
    archetype: stored.archetype,
    canarySkipped: stored.canarySkipped,
    subscriptions: stored.subscriptions.map((s) => ({
      fundId: new ObjectId(s.fundIdHex),
      fundSlug: s.fundSlug,
      quotedNav: s.quotedNav,
      units: s.units,
      costAnchor: s.costAnchor,
      existingPosition: s.existingPosition,
    })),
    fingerprint: input.fingerprint,
    idempotencyKey: key,
    now: new Date(stored.nowIso),
  });

  const runSpend = async (
    session?: ClientSession
  ): Promise<{ duplicate: boolean; outcome: NppInvestOutcome }> => {
    const opts = session ? { session } : {};
    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same key, different fingerprint: a genuinely different investment
      // reusing the key, not a post-crash remainder. Fail closed. (Crash
      // recovery resumes by key through `resumeNppInvestByKey`, which rebuilds
      // from the stored plan without presenting a live fingerprint at all.)
      throw err;
    }
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.nppInvestPlan;
      if (!isStoredPlan(stored)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return { duplicate: true, outcome: await persistOutcome(planFromStored(stored), opts) };
    }
    if (claim === "in-progress") {
      // Same fingerprint, so the live input names the same investment, but
      // the steps run from the STORED plan when one exists, never the live
      // input: post-crash reads are post-accrual state under possibly changed
      // prices and would accrue or invest twice. No stored plan means the
      // crash landed between the claim insert and the plan write below
      // (nothing applied yet), so the live input under the stored fingerprint
      // is exact.
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.nppInvestPlan;
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
        { $set: { nppInvestPlan: toStoredPlan(input, now), updatedAt: new Date() } },
        opts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${NPP_INVEST_TX}:plan-store`, opts);
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

export interface NppInvestResumeResult {
  /** Stored investment numbers for the resumed attempt. */
  outcome: NppInvestOutcome;
}

/**
 * Key-only crash recovery for one NPP investment (issue #1672): a same-turn
 * re-run of the NPP pass resumes under the stored key, so no receipt strands
 * `in_progress` and no NPP accrues twice.
 *
 * Returns null when there is nothing to resume (no receipt under the key, an
 * already-`completed` receipt, or an `in_progress` receipt with no usable
 * stored plan). Throws `MoneyFlowTerminalError` when the receipt settled
 * `failed`/`compensated`, and `MoneyFlowKeyConflictError` when the stored
 * attempt names a different NPP or turn (fail closed on cross-key reuse).
 */
export async function resumeNppInvestByKey(
  db: Db,
  key: string,
  expectedNppId: ObjectId,
  expectedTurn: number
): Promise<NppInvestResumeResult | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("NPP invest idempotency key must be 1-128 characters");
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<NppInvestReceipt>;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  const stored = existing.nppInvestPlan;
  if (existing.status === "completed") {
    if (
      isStoredPlan(stored) &&
      (stored.nppIdHex !== expectedNppId.toHexString() || stored.turn !== expectedTurn)
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
  // and the pass plans the NPP fresh under the same deterministic key, so
  // there is nothing to resume here.
  if (!isStoredPlan(stored)) return null;
  if (stored.nppIdHex !== expectedNppId.toHexString() || stored.turn !== expectedTurn) {
    throw new MoneyFlowKeyConflictError(key);
  }
  const plan = planFromStored(stored);
  const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
    mapInvestError(step.name, outcome);
  const stepInput: NppInvestSpendInput = {
    nppId: plan.nppId,
    turn: plan.turn,
    budget: plan.budget,
    investedAnchor: plan.investedAnchor,
    archetype: plan.archetype,
    canarySkipped: plan.canarySkipped,
    subscriptions: plan.subscriptions.map((s) => ({ ...s })),
    fingerprint: "",
    idempotencyKey: key,
    now: plan.now,
  };
  let outcome: NppInvestOutcome;
  await runWithOptionalTransaction(
    async (session) => {
      await runMoneyFlowSteps(
        receipts,
        key,
        buildNppInvestSteps(db, key, stepInput, plan.now),
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
        buildNppInvestSteps(db, key, stepInput, plan.now),
        mapError
      );
      outcome = await persistResumeOutcome(receiptCollection, key, plan, {});
    }
  );
  return { outcome: outcome! };
}

async function persistResumeOutcome(
  receiptCollection: Collection<NppInvestReceipt>,
  key: string,
  plan: NormalizedNppInvestPlan,
  opts: { session?: ClientSession }
): Promise<NppInvestOutcome> {
  const outcome = planOutcome(plan);
  await receiptCollection.updateOne(
    { _id: key },
    {
      $set: {
        nppInvestPlan: { ...toStoredPlanLike(plan), outcome },
        updatedAt: new Date(),
      },
    },
    opts.session ? { session: opts.session } : {}
  );
  return outcome;
}

/**
 * Reconcile NPP investments a crashed pass left behind before the fresh
 * roster loads.
 *
 * Two stuck shapes: `in_progress` receipts carrying an NPP-invest plan for
 * this turn (resume under the stored key: applied steps converge, the rest
 * land), and `in_progress` receipts under this turn's key shape with no plan
 * (crashed between the claim insert and the plan write: nothing applied yet,
 * so settle the receipt and let the NPP invest fresh next cycle under a new
 * key; retrying the same key this turn would hit the terminal receipt).
 * Anything else stays quarantined for ops and never breaks the pass.
 *
 * Returns the resumed count and invested total for the pass tally. A resumed
 * NPP carries its turn stamp once the accrual lands, so the fresh loop below
 * skips it and never invests twice.
 */
export async function recoverNppInvestOrphans(
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
    const stored = (receipt as NppInvestReceipt).nppInvestPlan;
    if (!isStoredPlan(stored)) {
      if (!key.startsWith("npp-invest:") || !key.endsWith(`:turn:${turn}`)) continue;
      // Crashed between the claim insert and the plan write: the plan lands
      // before the first step, so nothing applied yet. Settle the receipt;
      // the NPP invests fresh next cycle under a new key.
      await failMoneyFlowReceipt(receipts, key, `${NPP_INVEST_TX}:orphan-no-plan`);
      continue;
    }
    if (stored.turn !== turn) continue;
    try {
      const result = await resumeNppInvestByKey(db, key, new ObjectId(stored.nppIdHex), turn);
      if (result) {
        resumed += 1;
        investedAnchor += result.outcome.investedAnchor;
      }
    } catch (err) {
      console.warn(
        `[indexfund-cron] orphan NPP investment ${key} did not resume: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return { resumed, investedAnchor };
}
