import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Bond, Corporation } from "@/lib/db/types";
import { MAX_BOND_DEFAULT_REFINANCES } from "@/lib/constants/bonds";

/** Refinance count claim failed: the cap raced, or the corp row went. */
export const BOND_REFINANCE_COUNT = "BOND_REFINANCE_COUNT";
/** A bond cure claim failed: the bond raced (matured/cured elsewhere). */
export const BOND_REFINANCE_MATURE = "BOND_REFINANCE_MATURE";
/** The replacement-bond insert failed after cures applied. */
export const BOND_REFINANCE_ISSUE = "BOND_REFINANCE_ISSUE";

export interface BondRefinanceBond {
  bondId: ObjectId;
  /** `marketPrice` before the refinance, restored if the insert loses a race. */
  priorMarketPrice: number;
}

/**
 * The executor-computed result summary for a refinance attempt. Stored on the
 * resume plan at claim time so a same-key retry that finds no defaulted bonds
 * left (every cure applied, crash before the replacement insert) can finish
 * the stored plan and still report the attempted outcome instead of stranding
 * cured-without-replacement bonds behind a "no defaulted bonds" refusal.
 */
export interface BondRefinanceOutcome {
  faceValueAnchor: number;
  couponRate: number;
  maturityTurn: number;
  bondsMatured: number;
  retiredBondIds: string[];
}

/**
 * Runtime shape check for a persisted refinance outcome. The resume path
 * reports the stored outcome as the attempt's result, so a receipt whose
 * outcome is present but malformed is unusable: the caller keeps its public
 * no-default result instead of reporting corrupt numbers.
 */
export function isBondRefinanceOutcome(value: unknown): value is BondRefinanceOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return (
    typeof outcome.faceValueAnchor === "number" &&
    typeof outcome.couponRate === "number" &&
    typeof outcome.maturityTurn === "number" &&
    typeof outcome.bondsMatured === "number" &&
    Array.isArray(outcome.retiredBondIds) &&
    outcome.retiredBondIds.every((id) => typeof id === "string")
  );
}

export interface BondRefinanceSpendInput {
  /** Corporation whose defaulted bonds are refinanced (and counted). */
  corpId: ObjectId;
  /** Defaulted bonds to cure; at least one. */
  bonds: BondRefinanceBond[];
  /** The replacement bond document (without `_id`; derived deterministically). */
  newBond: Omit<Bond, "_id">;
  cureTurn: number;
  now: Date;
  /** Executor-computed result summary, persisted on the resume plan. */
  outcome?: BondRefinanceOutcome;
  /**
   * Caller-chosen fingerprint of the intended refinance (see
   * `buildBondRefinanceFingerprint`). A retry presenting the same key with a
   * different fingerprint is rejected instead of returning the stored outcome
   * for the wrong refinance.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route, or a deterministic turn key). Same key + same refinance replays
   * the stored outcome instead of issuing again. Omit to mint one: the attempt
   * is still crash-safe within the attempt, but a client retry mints a new key
   * and is treated as a new attempt (still guarded by the count claim and the
   * per-bond cure claims, so it fails closed instead of double-issuing).
   */
  idempotencyKey?: string;
}

function mapRefinanceError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost count race is the 400 cap
  // refusal, a lost cure race the 400 bond-state refusal, a failed insert the
  // 500 issuance error. Anything after cures applied compensates its own
  // prefix instead of stranding cured bonds with no replacement.
  if (stepName === "refinance-count") return new Error(`${BOND_REFINANCE_COUNT}:${outcome}`);
  if (stepName === "refinance-issue") return new Error(`${BOND_REFINANCE_ISSUE}:${outcome}`);
  return new Error(`${BOND_REFINANCE_MATURE}:${outcome}`);
}

/**
 * Deterministic fingerprint for a refinance attempt. Covers the transfer
 * itself (corp, retired bond set, replacement terms), so a key reused for a
 * different refinance fails closed with `MoneyFlowKeyConflictError` instead
 * of replaying the wrong outcome.
 */
export function buildBondRefinanceFingerprint(input: {
  corpId: ObjectId;
  bonds: ObjectId[];
  totalUnits: number;
  couponRate: number;
  maturityTurns: number;
  currencyCode: string | undefined;
  holders: Array<{ holderId: ObjectId; units: number }>;
}): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const bondPart = [...input.bonds]
    .map((b) => b.toHexString())
    .sort()
    .join(",");
  const holderPart = [...input.holders]
    .map((h) => `${h.holderId.toHexString()}:${h.units}`)
    .sort()
    .join(",");
  return `bond-refinance:${input.corpId.toHexString()}:${bondPart}:${input.totalUnits}:${cents(input.couponRate)}:${input.maturityTurns}:${input.currencyCode ?? "?"}:${holderPart}`;
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any write. A same-key retry after a crash rebuilds its steps
 * from THIS plan, never from the caller's live input: the executors derive
 * every call from live state, so post-crash input is a remainder (cured bonds
 * drop out, the replacement terms recompute on a smaller set). Running the
 * remainder would compensate at remainder amounts if the resume itself
 * failed; resuming the stored plan keeps count claim, cure claims, and the
 * replacement insert at exactly the attempted values.
 */
export interface BondRefinanceStoredPlan {
  version: 1;
  corpIdHex: string;
  cureTurn: number;
  nowIso: string;
  bonds: Array<{ bondIdHex: string; priorMarketPrice: number }>;
  newBond: Record<string, unknown>;
  outcome?: BondRefinanceOutcome;
}

function newBondToStored(bond: Omit<Bond, "_id">): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(bond, (_key, value: unknown) =>
      value instanceof ObjectId ? { $oid: value.toHexString() } : value
    )
  ) as Record<string, unknown>;
}

function newBondFromStored(stored: Record<string, unknown>): Omit<Bond, "_id"> {
  return JSON.parse(JSON.stringify(stored), (_key, value: unknown) => {
    if (value !== null && typeof value === "object" && "$oid" in value) {
      return new ObjectId((value as { $oid: string }).$oid);
    }
    return value;
  }) as Omit<Bond, "_id">;
}

function toStoredPlan(input: BondRefinanceSpendInput): BondRefinanceStoredPlan {
  return {
    version: 1,
    corpIdHex: input.corpId.toHexString(),
    cureTurn: input.cureTurn,
    nowIso: input.now.toISOString(),
    bonds: input.bonds.map((b) => ({
      bondIdHex: b.bondId.toHexString(),
      priorMarketPrice: b.priorMarketPrice,
    })),
    newBond: newBondToStored(input.newBond),
    ...(input.outcome !== undefined
      ? { outcome: { ...input.outcome, retiredBondIds: [...input.outcome.retiredBondIds] } }
      : {}),
  };
}

function isStoredPlan(value: unknown): value is BondRefinanceStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.corpIdHex === "string" &&
    Array.isArray(plan.bonds) &&
    plan.newBond !== null &&
    typeof plan.newBond === "object"
  );
}

/**
 * A live retry input is a plausible remainder of the stored attempt when it
 * names the same corporation and covers only bonds the stored plan already
 * covers. Anything else under the same key is a genuinely different
 * refinance and stays a key conflict (fail closed).
 */
function isRemainderOfPlan(input: BondRefinanceSpendInput, plan: BondRefinanceStoredPlan): boolean {
  if (input.corpId.toHexString() !== plan.corpIdHex) return false;
  const storedBonds = new Set(plan.bonds.map((b) => b.bondIdHex));
  if (!input.bonds.every((b) => storedBonds.has(b.bondId.toHexString()))) return false;
  return true;
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type BondRefinanceReceipt = MoneyFlowReceipt & { bondRefinancePlan?: unknown };

interface NormalizedRefinancePlan {
  corpId: ObjectId;
  bonds: Array<{ bondId: ObjectId; priorMarketPrice: number }>;
  newBond: Omit<Bond, "_id">;
  cureTurn: number;
  now: Date;
  outcome?: BondRefinanceOutcome;
}

function planFromInput(live: BondRefinanceSpendInput): NormalizedRefinancePlan {
  return {
    corpId: live.corpId,
    bonds: live.bonds.map((b) => ({ bondId: b.bondId, priorMarketPrice: b.priorMarketPrice })),
    newBond: live.newBond,
    cureTurn: live.cureTurn,
    now: live.now,
    outcome: live.outcome,
  };
}

function planFromStored(stored: BondRefinanceStoredPlan): NormalizedRefinancePlan {
  return {
    corpId: new ObjectId(stored.corpIdHex),
    bonds: stored.bonds.map((b) => ({
      bondId: new ObjectId(b.bondIdHex),
      priorMarketPrice: b.priorMarketPrice,
    })),
    newBond: newBondFromStored(stored.newBond),
    cureTurn: stored.cureTurn,
    now: new Date(stored.nowIso),
    outcome: stored.outcome ? { ...stored.outcome, retiredBondIds: [...stored.outcome.retiredBondIds] } : undefined,
  };
}

function buildRefinanceSteps(db: Db, key: string, plan: NormalizedRefinancePlan): MoneyFlowStep[] {
  const bonds = db.collection<Bond>("bonds");
  const corporations = db.collection<Corporation>("corporations");
  // Lifetime cap as a guard inside the atomic claim: a lost race reports
  // `guard-rejected` (mapped to the historical cap refusal) instead of
  // over-counting. Corps that predate the counter carry no field, so the
  // guard admits a missing field explicitly.
  const countStep: MoneyFlowStep = {
    name: "refinance-count",
    apply: (stepOpts) =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(key, "refinance-count"),
        {
          collection: corporations,
          filter: {
            _id: plan.corpId,
            $or: [
              { bondDefaultRefinanceCount: { $lt: MAX_BOND_DEFAULT_REFINANCES } },
              { bondDefaultRefinanceCount: { $exists: false } },
            ],
          },
          update: {
            $inc: { bondDefaultRefinanceCount: 1 },
            $set: { updatedAt: plan.now },
          },
        },
        stepOpts ?? {}
      ),
    revert: (stepOpts) =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(key, "compensate", "refinance-count"),
        {
          collection: corporations,
          filter: { _id: plan.corpId },
          update: {
            $inc: { bondDefaultRefinanceCount: -1 },
            $set: { updatedAt: plan.now },
          },
        },
        stepOpts ?? {}
      ),
  };

  const cureSteps: MoneyFlowStep[] = plan.bonds.map((bond) => {
    const hex = bond.bondId.toHexString();
    const subKey = deriveMoneyFlowKey(key, "cure", hex);
    return {
      name: `cure-${hex}`,
      apply: (stepOpts) =>
        applyKeyedUpdate(
          subKey,
          {
            collection: bonds,
            filter: {
              _id: bond.bondId,
              corporationId: plan.corpId,
              matured: false,
              defaulted: true,
            },
            update: {
              $set: {
                matured: true,
                marketPrice: 1,
                defaulted: false,
                defaultCure: { cureMethod: "refinance" as const, curedAtTurn: plan.cureTurn },
                updatedAt: plan.now,
              },
            },
          },
          stepOpts ?? {}
        ),
      // Only reached when a LATER step loses a race: restore the captured
      // flags so compensation leaves no half-cured set. `defaultedAtTurn`
      // is preserved by the apply (never overwritten), so the revert only
      // restores the flipped flags and drops the cure stamp. The filter is
      // the bare `_id` so a revert is never guard-blocked.
      revert: (stepOpts) =>
        applyKeyedUpdate(
          deriveMoneyFlowKey(subKey, "compensate", "cure"),
          {
            collection: bonds,
            filter: { _id: bond.bondId },
            update: {
              $set: {
                matured: false,
                marketPrice: bond.priorMarketPrice,
                defaulted: true,
                updatedAt: plan.now,
              },
              $unset: { defaultCure: "" },
            },
          },
          stepOpts ?? {}
        ),
    };
  });

  // Terminal: nothing runs after it, so it needs no inverse. The `_id`
  // derives deterministically from the flow key, so a retried flow
  // converges to `already-applied` instead of issuing a second bond.
  const issueStep = makeInsertStep("refinance-issue", bonds, {
    ...plan.newBond,
    _id: keyedInsertId(key, "bond-refinance"),
  });

  return [countStep, ...cureSteps, issueStep];
}

/**
 * Refinance a corporation's defaulted bonds by issuing a single replacement
 * bond so the result is exactly-once on every topology (issue #1672). This is
 * a debt-for-debt swap: no cash changes hands, so there are no balance legs —
 * the flow is a guarded refinance-count claim, one revertible cure claim per
 * retired bond, and the terminal deterministic replacement-bond insert.
 *
 * Step order is claim-first for a reason: a concurrent second attempt (the CEO
 * refinance route holds no settlement lock) loses the cure-claim race BEFORE
 * it can insert, so it compensates only its count claim and fails closed
 * instead of double-issuing. Crash between cure and insert resumes the stored
 * plan under the same key: the deterministic insert id converges to
 * `already-applied` instead of duplicating the bond.
 *
 * The financial-tx audit row stays OUTSIDE the keyed flow as a post-commit
 * best effort in the caller (`emitTx` never throws): it records no balance,
 * so skipping it on failure is harmless. Same pattern as the bond
 * buy/sell/buyback/payoff routes.
 *
 * Under real transactions the count claim, the cure claims, the insert, and
 * the idempotency receipt join the transaction and commit atomically,
 * preserving the old behavior. On a standalone deployment the fallback runs
 * the same writes as keyed idempotent steps: a crash between any two writes
 * leaves an `in_progress` receipt, and retrying with the same key and
 * fingerprint reconciles to exactly one refinance. A retry after a terminal
 * failure throws `MoneyFlowTerminalError` (fail closed); a new attempt needs
 * a new key.
 */
export async function applyBondRefinanceSpend(
  db: Db,
  input: BondRefinanceSpendInput
): Promise<{ duplicate: boolean; bondId: string }> {
  if (!input.corpId) {
    throw new TypeError("Bond refinance spend needs corpId");
  }
  if (!Array.isArray(input.bonds) || input.bonds.length === 0) {
    throw new TypeError("Bond refinance spend needs at least one bond");
  }
  if (!input.newBond || typeof input.newBond !== "object") {
    throw new TypeError("Bond refinance spend needs a newBond document");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond refinance idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);

  /** Receipt rows carry the resume plan under this field (never in the shared type). */
  type BondRefinanceReceipt = MoneyFlowReceipt & { bondRefinancePlan?: unknown };
  const receiptCollection = receipts as unknown as Collection<BondRefinanceReceipt>;

  const bondIdHex = keyedInsertId(key, "bond-refinance").toHexString();

  const runPlan = async (
    plan: NormalizedRefinancePlan,
    opts: { session?: ClientSession }
  ): Promise<void> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildRefinanceSteps(db, key, plan),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) =>
        mapRefinanceError(step.name, outcome),
      opts
    );
  };

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same key, different fingerprint. When the stored attempt is still in
      // flight this is the post-crash retry the callers always send (they
      // rebuild every call from live state, so cured bonds drop out and the
      // fingerprint shrinks): resume the STORED plan under the same key
      // instead of stranding the receipt or demanding a new key. When the
      // live input is not a remainder of the stored attempt, or the stored
      // attempt already settled, the conflict stands (fail closed).
      const existing = await receiptCollection.findOne({ _id: key }, session ? { session } : {});
      if (!existing || existing.status !== "in_progress") throw err;
      const stored = existing.bondRefinancePlan;
      if (!isStoredPlan(stored)) {
        // Crashed between the claim insert and the plan write below: nothing
        // applied yet (the plan lands before the first step), so reconciling
        // the live input under the stored fingerprint is exact.
        const retry = await claimMoneyFlowReceipt(receipts, key, existing.fingerprint, opts);
        if (retry === "duplicate") return { duplicate: true as boolean, bondId: bondIdHex };
        await runPlan(planFromInput(input), opts);
        return { duplicate: true as boolean, bondId: bondIdHex };
      }
      if (!isRemainderOfPlan(input, stored)) throw err;
      await runPlan(planFromStored(stored), opts);
      return { duplicate: true as boolean, bondId: bondIdHex };
    }
    if (claim === "duplicate") return { duplicate: true as boolean, bondId: bondIdHex };
    if (claim === "in-progress") {
      // Same fingerprint, so the live input names the same refinance:
      // reconcile it through the keyed steps (already-applied steps skip).
      await runPlan(planFromInput(input), opts);
      return { duplicate: true as boolean, bondId: bondIdHex };
    }
    // Persist the resume plan before the first step: a crash from here on
    // resumes this exact plan under the same key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { bondRefinancePlan: toStoredPlan(input), updatedAt: new Date() } },
        session ? { session } : {}
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${BOND_REFINANCE_COUNT}:plan-store`, opts);
      throw planError;
    }

    await runPlan(planFromInput(input), opts);
    return { duplicate: false as boolean, bondId: bondIdHex };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

export interface BondRefinanceResumeResult {
  /** Deterministic replacement-bond id derived from the flow key. */
  bondId: string;
  /** Executor-computed result summary persisted on the stored plan. */
  outcome: BondRefinanceOutcome;
}

/**
 * Key-only crash recovery for the empty-remainder retry (issue #1672): the
 * executor rebuilds every call from live state, so after a crash between the
 * final cure and the replacement insert the live defaulted set reads empty
 * and there is no spend input to present — `applyBondRefinanceSpend` itself
 * requires at least one bond. The executor consults this path instead of
 * returning "no defaulted bonds" and stranding cured-without-replacement
 * bonds behind an `in_progress` receipt.
 *
 * Returns null when there is nothing to resume (no receipt under the key, an
 * already-`completed` receipt, or an `in_progress` receipt with no usable
 * stored plan): the caller keeps its public no-default result. Throws
 * `MoneyFlowTerminalError` when the receipt settled `failed`/`compensated`,
 * and `MoneyFlowKeyConflictError` when the stored attempt names a different
 * corporation (fail closed on cross-corp key reuse).
 */
export async function resumeBondRefinanceByKey(
  db: Db,
  key: string,
  expectedCorpId: ObjectId
): Promise<BondRefinanceResumeResult | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond refinance idempotency key must be 1-128 characters");
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<BondRefinanceReceipt>;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  if (existing.status === "completed") {
    const stored = existing.bondRefinancePlan;
    if (isStoredPlan(stored) && stored.corpIdHex !== expectedCorpId.toHexString()) {
      throw new MoneyFlowKeyConflictError(key);
    }
    return null;
  }
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "in_progress") return null;
  const stored = existing.bondRefinancePlan;
  // Crashed between the claim insert and the plan write: nothing applied yet,
  // and the live set is empty because the bonds were cured elsewhere — the
  // public no-default result is the truthful answer. A malformed outcome is
  // equally unusable: report nothing rather than corrupt numbers.
  if (!isStoredPlan(stored) || !isBondRefinanceOutcome(stored.outcome)) return null;
  if (stored.corpIdHex !== expectedCorpId.toHexString()) {
    throw new MoneyFlowKeyConflictError(key);
  }
  const plan = planFromStored(stored);
  const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
    mapRefinanceError(step.name, outcome);
  await runWithOptionalTransaction(
    async (session) =>
      runMoneyFlowSteps(receipts, key, buildRefinanceSteps(db, key, plan), mapError, { session }),
    async () => runMoneyFlowSteps(receipts, key, buildRefinanceSteps(db, key, plan), mapError)
  );
  // `stored.outcome` is narrowed valid by the guard above; report a copy
  // of it (never `plan.outcome`, which stays optional, and never an alias
  // of the receipt document).
  return {
    bondId: keyedInsertId(key, "bond-refinance").toHexString(),
    outcome: {
      ...stored.outcome,
      retiredBondIds: [...stored.outcome.retiredBondIds],
    },
  };
}
