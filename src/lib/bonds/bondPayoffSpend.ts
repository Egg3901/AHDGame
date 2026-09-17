import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db, Filter } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  failMoneyFlowReceipt,
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
import type { Bond } from "@/lib/db/types";

export type BondPayoffHolderKind = "character" | "imperial" | "corp" | "fund" | "npp";

export interface BondPayoffHolderCredit {
  kind: BondPayoffHolderKind;
  holderId: ObjectId;
  /**
   * Balance field in the holder's own denomination, resolved by the caller
   * (personal currency field or `cashOnHand` for characters/imperials,
   * `liquidCapital` for corporations, `cashAnchor` for index funds,
   * `nppInvestmentCashAnchor` for NPPs).
   */
  field: string;
  /** Amount in the holder's own denomination (face-value economics). */
  amount: number;
}

export type BondPayoffCureMethod = "parent_payoff" | "cash";

export interface BondPayoffBond {
  bondId: ObjectId;
  /** `marketPrice` before the payoff, restored if a later bond's claim loses a race. */
  priorMarketPrice: number;
  /** `defaulted` before the payoff, restored if a later bond's claim loses a race. */
  priorDefaulted: boolean;
}

/**
 * The caller-computed result summary for a payoff attempt. Stored on the
 * resume plan at claim time so a same-key retry that finds no live bonds
 * left (every maturity claim applied, crash before the receipt completed)
 * can finish the stored plan and still report the attempted outcome instead
 * of stranding paid-and-matured bonds behind a "no bonds" refusal.
 */
export interface BondPayoffOutcome {
  /** Defaulted principal repaid, in anchor (the routes' `paid` response). */
  paid: number;
  /** Number of bonds matured. */
  bondsMatured: number;
}

/**
 * Runtime shape check for a persisted payoff outcome. The resume path
 * reports the stored outcome as the attempt's result, so a receipt whose
 * outcome is present but malformed is unusable: the caller keeps its public
 * no-bonds result instead of reporting corrupt numbers.
 */
export function isBondPayoffOutcome(value: unknown): value is BondPayoffOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return typeof outcome.paid === "number" && typeof outcome.bondsMatured === "number";
}

export interface BondPayoffSpendInput {
  /** Corporation whose liquid capital (plus escrow for cash cures) pays. */
  payerCorpId: ObjectId;
  /** Corporation whose bonds mature. */
  issuerCorpId: ObjectId;
  /** Debit from the payer's `liquidCapital`, in corp-local denomination. */
  debitLiquidCapital: number;
  /** Debit from the payer's `shareEscrowBalance`, in corp-local denomination. */
  debitEscrow?: number;
  /** One credit per holder; may be empty when the float covers everything. */
  holders: BondPayoffHolderCredit[];
  /** Bonds to mature; at least one. */
  bonds: BondPayoffBond[];
  cureMethod: BondPayoffCureMethod;
  /** Cash cures claim only still-defaulted bonds; parent payoffs claim any live bond. */
  onlyDefaulted: boolean;
  curedAtTurn: number;
  now: Date;
  /** Caller-computed result summary, persisted on the resume plan. */
  outcome?: BondPayoffOutcome;
  /**
   * Caller-chosen fingerprint of the intended payoff (see
   * `buildBondPayoffFingerprint`). A retry presenting the same key with a
   * different fingerprint is rejected instead of returning the stored outcome
   * for the wrong payoff.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same payoff replays the stored outcome instead of
   * paying again. Omit to mint one: the attempt is still crash-safe within
   * the attempt, but a client retry mints a new key and is treated as a new
   * attempt (still guarded by the atomic debit and the per-bond claims).
   */
  idempotencyKey?: string;
}

/** Payer debit failed: funds raced below the cost, or the payer row went. */
export const BOND_PAYOFF_FUNDS = "BOND_PAYOFF_FUNDS";
/** A holder credit failed: the holder row vanished mid-flight. */
export const BOND_PAYOFF_HOLDER = "BOND_PAYOFF_HOLDER";
/** A bond maturity claim failed: the bond raced (matured/claimed elsewhere). */
export const BOND_PAYOFF_MATURE = "BOND_PAYOFF_MATURE";

const HOLDER_COLLECTION: Record<BondPayoffHolderKind, string> = {
  character: "characters",
  imperial: "imperialCharacters",
  corp: "corporations",
  fund: "indexFunds",
  npp: "npps",
};

function mapPayoffError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost payer-funds race is the 400
  // insufficient/race refusal, a lost maturity race the 400 bond-state
  // refusal, a vanished holder the 500 inconsistent-holder error. Anything
  // after money moved compensates its own prefix instead of stranding a
  // half-landed payoff.
  if (stepName === "payer-debit") return new Error(`${BOND_PAYOFF_FUNDS}:${outcome}`);
  if (stepName.startsWith("holder-credit-")) return new Error(`${BOND_PAYOFF_HOLDER}:${outcome}`);
  return new Error(`${BOND_PAYOFF_MATURE}:${outcome}`);
}

/**
 * Deterministic fingerprint for a payoff attempt. Covers the transfer itself
 * (method, payer, issuer, debit split, bond set, per-holder allocation), so a
 * key reused for a different payoff fails closed with
 * `MoneyFlowKeyConflictError` instead of replaying the wrong outcome.
 */
export function buildBondPayoffFingerprint(input: {
  cureMethod: BondPayoffCureMethod;
  payerCorpId: ObjectId;
  issuerCorpId: ObjectId;
  debitLiquidCapital: number;
  debitEscrow?: number;
  bonds: ObjectId[];
  holders: Array<{ kind: BondPayoffHolderKind; holderId: ObjectId; amount: number }>;
}): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const bondPart = [...input.bonds]
    .map((b) => b.toHexString())
    .sort()
    .join(",");
  const holderPart = [...input.holders]
    .map((h) => `${h.kind}:${h.holderId.toHexString()}:${cents(h.amount)}`)
    .sort()
    .join(",");
  return `bond-payoff:${input.cureMethod}:${input.payerCorpId.toHexString()}:${input.issuerCorpId.toHexString()}:${cents(input.debitLiquidCapital)}:${cents(input.debitEscrow ?? 0)}:${bondPart}:${holderPart}`;
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any money moves. A same-key retry after a crash rebuilds its
 * steps from THIS plan, never from the caller's live input: the routes derive
 * every call from live state, so post-crash input is a remainder (matured
 * bonds drop out of the query, the debit covers only the remainder). Running
 * the remainder would compensate at remainder amounts if the resume itself
 * failed, stranding the applied-minus-remainder difference on the payer.
 * Resuming the stored plan keeps debit, credits, maturity claims, and every
 * compensation inverse at exactly the attempted amounts.
 */
export interface BondPayoffStoredPlan {
  version: 1;
  cureMethod: BondPayoffCureMethod;
  payerCorpIdHex: string;
  issuerCorpIdHex: string;
  debitLiquidCapital: number;
  debitEscrow: number;
  onlyDefaulted: boolean;
  curedAtTurn: number;
  nowIso: string;
  holders: Array<{
    kind: BondPayoffHolderKind;
    holderIdHex: string;
    field: string;
    amount: number;
  }>;
  bonds: Array<{ bondIdHex: string; priorMarketPrice: number; priorDefaulted: boolean }>;
  outcome?: BondPayoffOutcome;
}

function toStoredPlan(input: BondPayoffSpendInput): BondPayoffStoredPlan {
  return {
    version: 1,
    cureMethod: input.cureMethod,
    payerCorpIdHex: input.payerCorpId.toHexString(),
    issuerCorpIdHex: input.issuerCorpId.toHexString(),
    debitLiquidCapital: input.debitLiquidCapital,
    debitEscrow: input.debitEscrow ?? 0,
    onlyDefaulted: input.onlyDefaulted,
    curedAtTurn: input.curedAtTurn,
    nowIso: input.now.toISOString(),
    holders: input.holders.map((h) => ({
      kind: h.kind,
      holderIdHex: h.holderId.toHexString(),
      field: h.field,
      amount: h.amount,
    })),
    bonds: input.bonds.map((b) => ({
      bondIdHex: b.bondId.toHexString(),
      priorMarketPrice: b.priorMarketPrice,
      priorDefaulted: b.priorDefaulted,
    })),
    ...(input.outcome !== undefined ? { outcome: { ...input.outcome } } : {}),
  };
}

function isStoredPlan(value: unknown): value is BondPayoffStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.payerCorpIdHex === "string" &&
    typeof plan.issuerCorpIdHex === "string" &&
    typeof plan.cureMethod === "string" &&
    Array.isArray(plan.holders) &&
    Array.isArray(plan.bonds)
  );
}

/**
 * A live retry input is a plausible remainder of the stored attempt when it
 * names the same operation (method, payer, issuer) and covers only bonds and
 * holders the stored plan already covers. Anything else under the same key is
 * a genuinely different payoff and stays a key conflict (fail closed).
 */
function isRemainderOfPlan(input: BondPayoffSpendInput, plan: BondPayoffStoredPlan): boolean {
  if (input.cureMethod !== plan.cureMethod) return false;
  if (input.payerCorpId.toHexString() !== plan.payerCorpIdHex) return false;
  if (input.issuerCorpId.toHexString() !== plan.issuerCorpIdHex) return false;
  const storedBonds = new Set(plan.bonds.map((b) => b.bondIdHex));
  if (!input.bonds.every((b) => storedBonds.has(b.bondId.toHexString()))) return false;
  const storedHolders = new Set(plan.holders.map((h) => `${h.kind}:${h.holderIdHex}`));
  if (!input.holders.every((h) => storedHolders.has(`${h.kind}:${h.holderId.toHexString()}`))) {
    return false;
  }
  return true;
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type BondPayoffReceipt = MoneyFlowReceipt & { bondPayoffPlan?: unknown };

interface NormalizedPayoffPlan {
  payerCorpId: ObjectId;
  issuerCorpId: ObjectId;
  debitLiquidCapital: number;
  debitEscrow: number;
  holders: Array<{
    kind: BondPayoffHolderKind;
    holderId: ObjectId;
    field: string;
    amount: number;
  }>;
  bonds: Array<{ bondId: ObjectId; priorMarketPrice: number; priorDefaulted: boolean }>;
  cureMethod: BondPayoffCureMethod;
  onlyDefaulted: boolean;
  curedAtTurn: number;
  now: Date;
  outcome?: BondPayoffOutcome;
}

function planFromInput(live: BondPayoffSpendInput): NormalizedPayoffPlan {
  return {
    payerCorpId: live.payerCorpId,
    issuerCorpId: live.issuerCorpId,
    debitLiquidCapital: live.debitLiquidCapital,
    debitEscrow: live.debitEscrow ?? 0,
    holders: live.holders.map((h) => ({
      kind: h.kind,
      holderId: h.holderId,
      field: h.field,
      amount: h.amount,
    })),
    bonds: live.bonds.map((b) => ({
      bondId: b.bondId,
      priorMarketPrice: b.priorMarketPrice,
      priorDefaulted: b.priorDefaulted,
    })),
    cureMethod: live.cureMethod,
    onlyDefaulted: live.onlyDefaulted,
    curedAtTurn: live.curedAtTurn,
    now: live.now,
    outcome: live.outcome ? { ...live.outcome } : undefined,
  };
}

function planFromStored(stored: BondPayoffStoredPlan): NormalizedPayoffPlan {
  return {
    payerCorpId: new ObjectId(stored.payerCorpIdHex),
    issuerCorpId: new ObjectId(stored.issuerCorpIdHex),
    debitLiquidCapital: stored.debitLiquidCapital,
    debitEscrow: stored.debitEscrow,
    holders: stored.holders.map((h) => ({
      kind: h.kind,
      holderId: new ObjectId(h.holderIdHex),
      field: h.field,
      amount: h.amount,
    })),
    bonds: stored.bonds.map((b) => ({
      bondId: new ObjectId(b.bondIdHex),
      priorMarketPrice: b.priorMarketPrice,
      priorDefaulted: b.priorDefaulted,
    })),
    cureMethod: stored.cureMethod,
    onlyDefaulted: stored.onlyDefaulted,
    curedAtTurn: stored.curedAtTurn,
    now: new Date(stored.nowIso),
    outcome: stored.outcome ? { ...stored.outcome } : undefined,
  };
}

function buildPayoffSteps(db: Db, key: string, plan: NormalizedPayoffPlan): MoneyFlowStep[] {
  const bonds = db.collection<Bond>("bonds");
  // The escrow slice rides the same atomic payer write as the liquid slice
  // (one leg: two legs on one document under colliding keys would skip the
  // second). When the liquid slice is zero the escrow field becomes the
  // primary guarded field, so the guard always covers the drawn balance.
  const liquid = plan.debitLiquidCapital;
  const escrow = plan.debitEscrow;
  const escrowOnly = escrow > 0 && !(liquid > 0);
  const debitStep = makeLegStep(`${key}:payer-debit`, {
    name: "payer-debit",
    collection: db.collection<MoneyFlowAccount>("corporations"),
    docId: plan.payerCorpId,
    field: escrowOnly ? "shareEscrowBalance" : "liquidCapital",
    delta: escrowOnly ? -escrow : -liquid,
    minBalance: escrowOnly ? escrow : liquid,
    ...(escrowOnly
      ? {}
      : escrow > 0
        ? {
            extraIncs: { shareEscrowBalance: -escrow },
            extraFilter: {
              shareEscrowBalance: { $gte: escrow },
            } as Filter<MoneyFlowAccount>,
          }
        : {}),
    set: { updatedAt: plan.now },
  });

  const holderSteps: MoneyFlowStep[] = plan.holders.map((holder) => {
    const hex = holder.holderId.toHexString();
    return makeLegStep(`${key}:holder:${holder.kind}:${hex}`, {
      name: `holder-credit-${holder.kind}-${hex}`,
      collection: db.collection<MoneyFlowAccount>(HOLDER_COLLECTION[holder.kind]),
      docId: holder.holderId,
      field: holder.field,
      delta: holder.amount,
      set: { updatedAt: plan.now },
    });
  });

  const matureSteps: MoneyFlowStep[] = plan.bonds.map((bond) => {
    const hex = bond.bondId.toHexString();
    const subKey = `${key}:mature:${hex}`;
    return {
      name: `mature-${hex}`,
      apply: (stepOpts) =>
        applyKeyedUpdate(
          subKey,
          {
            collection: bonds,
            filter: {
              _id: bond.bondId,
              corporationId: plan.issuerCorpId,
              matured: false,
              ...(plan.onlyDefaulted ? { defaulted: true } : {}),
            },
            update: {
              $set: {
                matured: true,
                marketPrice: 1,
                defaulted: false,
                defaultCure: {
                  cureMethod: plan.cureMethod,
                  curedAtTurn: plan.curedAtTurn,
                },
                updatedAt: plan.now,
              },
            },
          },
          stepOpts ?? {}
        ),
      // Only reached when a LATER bond's claim loses a race: restore the
      // captured flags so compensation leaves no half-matured set. The
      // filter is the bare `_id` so a revert is never guard-blocked.
      revert: (stepOpts) =>
        applyKeyedUpdate(
          `${subKey}:compensate:mature`,
          {
            collection: bonds,
            filter: { _id: bond.bondId },
            update: {
              $set: {
                matured: false,
                marketPrice: bond.priorMarketPrice,
                defaulted: bond.priorDefaulted,
                updatedAt: plan.now,
              },
              $unset: { defaultCure: "" },
            },
          },
          stepOpts ?? {}
        ),
    };
  });

  return [debitStep, ...holderSteps, ...matureSteps];
}

/**
 * Pay a corporation's outstanding bonds at face to every holder so the result
 * is exactly-once on every topology (issue #1672). Shared by the parent-bond
 * payoff route (a parent corp pays a subsidiary's bonds) and the default-cash
 * route (an issuer cures its own defaulted bonds from liquid + escrow).
 *
 * Step order mirrors the historical write order: the guarded payer debit
 * lands first, the holder credits second, the per-bond maturity claims last,
 * and a later failure compensates its own prefix (credits reversed, payer
 * refunded, applied maturity flags restored from snapshot) instead of
 * leaving a strand where holders were paid but bonds never matured, or the
 * payer paid but holders got nothing.
 *
 * Fan-out keying: every step carries its own idempotent sub-operation key
 * derived from the flow key (`${key}:payer-debit`,
 * `${key}:holder:<kind>:<holderId>`, `${key}:mature:<bondId>`). Two reasons
 * this is per-step rather than one shared key. First, the payer can itself
 * be a bond holder (a parent paying off bonds it partly holds): two legs on
 * one document under one key collide, because the first leg's key record
 * trips the second leg's `$ne: key` guard and the second balance change is
 * silently skipped. Second, a crash between holder credits must resume
 * per-holder: already-paid holders report `already-applied` and are skipped
 * while the rest still land, instead of re-running one coarse bulk credit.
 *
 * The financial-tx audit rows stay OUTSIDE the keyed flow as a post-commit
 * best effort in the caller (`emitTxBulk` never throws): they record no
 * balance, so skipping them on failure is harmless, while making them a
 * terminal step would settle `UNCOMPENSATED` on money that already moved.
 * Same pattern as the bond buy/sell/buyback routes.
 *
 * Under real transactions the debit, the credits, the maturity claims, and
 * the idempotency receipt join the transaction and commit atomically,
 * preserving the old behavior. On a standalone deployment the fallback runs
 * the same writes as keyed idempotent steps: a crash between any two writes
 * leaves an `in_progress` receipt, and retrying with the same key and
 * fingerprint reconciles to exactly one payoff. A retry after a terminal
 * failure throws `MoneyFlowTerminalError` (fail closed); a new attempt needs
 * a new key. A retry after a crash that already matured some bonds presents
 * a smaller live bond set (the routes rebuild every call from live state),
 * so its fingerprint no longer matches the receipt. That retry still resumes
 * under the SAME key: the claim adopts the stored fingerprint, checks the
 * live input is a remainder of the persisted plan, and reconciles the STORED
 * plan to completion (per-step sub-keys skip what already applied). A
 * same-key retry that is not a remainder is a genuinely different payoff and
 * stays a `MoneyFlowKeyConflictError`. No new client key is ever needed
 * after a crash, and no receipt strands `in_progress`.
 */
export async function applyBondPayoffSpend(
  db: Db,
  input: BondPayoffSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.payerCorpId || !input.issuerCorpId) {
    throw new TypeError("Bond payoff spend needs payerCorpId and issuerCorpId");
  }
  if (!Array.isArray(input.bonds) || input.bonds.length === 0) {
    throw new TypeError("Bond payoff spend needs at least one bond");
  }
  if (!Array.isArray(input.holders)) {
    throw new TypeError("Bond payoff spend needs a holders array");
  }
  const debitLiquid = input.debitLiquidCapital;
  const debitEscrow = input.debitEscrow ?? 0;
  if (!Number.isFinite(debitLiquid) || debitLiquid < 0) {
    throw new RangeError("Bond payoff liquid debit must be a finite non-negative amount");
  }
  if (!Number.isFinite(debitEscrow) || debitEscrow < 0) {
    throw new RangeError("Bond payoff escrow debit must be a finite non-negative amount");
  }
  for (const holder of input.holders) {
    if (!holder.holderId) {
      throw new TypeError("Bond payoff holder credit needs a holderId");
    }
    if (typeof holder.field !== "string" || holder.field.length === 0) {
      throw new TypeError("Bond payoff holder credit needs a balance field");
    }
    if (!Number.isFinite(holder.amount)) {
      throw new RangeError("Bond payoff holder amounts must be finite");
    }
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond payoff idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<BondPayoffReceipt>;

  const buildSteps = (plan: NormalizedPayoffPlan): MoneyFlowStep[] =>
    buildPayoffSteps(db, key, plan);

  const runPlan = async (
    plan: NormalizedPayoffPlan,
    opts: { session?: ClientSession }
  ): Promise<void> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildSteps(plan),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => mapPayoffError(step.name, outcome),
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
      // flight this is the post-crash retry the routes always send (they
      // rebuild every call from live state, so matured bonds drop out and the
      // fingerprint shrinks): resume the STORED plan under the same key
      // instead of stranding the receipt or demanding a new key. When the
      // live input is not a remainder of the stored attempt, or the stored
      // attempt already settled, the conflict stands (fail closed).
      const existing = await receiptCollection.findOne({ _id: key }, session ? { session } : {});
      if (!existing || existing.status !== "in_progress") throw err;
      const stored = existing.bondPayoffPlan;
      if (!isStoredPlan(stored)) {
        // Crashed between the claim insert and the plan write below: nothing
        // applied yet (the plan lands before the first step), so reconciling
        // the live input under the stored fingerprint is exact.
        const retry = await claimMoneyFlowReceipt(receipts, key, existing.fingerprint, opts);
        if (retry === "duplicate") return { duplicate: true as boolean };
        await runPlan(planFromInput(input), opts);
        return { duplicate: true as boolean };
      }
      if (!isRemainderOfPlan(input, stored)) throw err;
      await runPlan(planFromStored(stored), opts);
      return { duplicate: true as boolean };
    }
    if (claim === "duplicate") return { duplicate: true as boolean };
    if (claim === "in-progress") {
      // Same fingerprint, so the live input names the same payoff: reconcile
      // it through the keyed steps (already-applied legs skip).
      await runPlan(planFromInput(input), opts);
      return { duplicate: true as boolean };
    }
    // A fresh claim owns the attempt, so a validation failure settles the
    // receipt `failed` (nothing applied yet, so the status is truthful).
    if (!(debitLiquid + debitEscrow > 0)) {
      await failMoneyFlowReceipt(receipts, key, `${BOND_PAYOFF_FUNDS}:zero-cost`, opts);
      throw new Error(`${BOND_PAYOFF_FUNDS}:zero-cost`);
    }
    // Persist the resume plan before the first step: a crash from here on
    // resumes this exact plan under the same key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { bondPayoffPlan: toStoredPlan(input), updatedAt: new Date() } },
        session ? { session } : {}
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${BOND_PAYOFF_FUNDS}:plan-store`, opts);
      throw planError;
    }

    await runPlan(planFromInput(input), opts);
    return { duplicate: false as boolean };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

export interface BondPayoffResumeResult {
  /** Caller-computed result summary persisted on the stored plan. */
  outcome: BondPayoffOutcome;
}

/**
 * Key-only crash recovery for the empty-remainder retry (issue #1672): the
 * routes rebuild every call from live state, so after a crash between the
 * final maturity claim and the receipt completion the live bond set reads
 * empty and there is no spend input to present — `applyBondPayoffSpend`
 * itself requires at least one bond. The caller consults this path instead
 * of returning "no bonds" and stranding paid-and-matured bonds behind an
 * `in_progress` receipt.
 *
 * Returns null when there is nothing to resume (no receipt under the key, an
 * already-`completed` receipt, or an `in_progress` receipt with no usable
 * stored plan): the caller keeps its public no-bonds result. Throws
 * `MoneyFlowTerminalError` when the receipt settled `failed`/`compensated`,
 * and `MoneyFlowKeyConflictError` when the stored attempt names a different
 * payer or issuer (fail closed on cross-corp key reuse).
 */
export async function resumeBondPayoffByKey(
  db: Db,
  key: string,
  expectedPayerCorpId: ObjectId,
  expectedIssuerCorpId: ObjectId
): Promise<BondPayoffResumeResult | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond payoff idempotency key must be 1-128 characters");
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<BondPayoffReceipt>;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  if (existing.status === "completed") {
    const stored = existing.bondPayoffPlan;
    if (
      isStoredPlan(stored) &&
      (stored.payerCorpIdHex !== expectedPayerCorpId.toHexString() ||
        stored.issuerCorpIdHex !== expectedIssuerCorpId.toHexString())
    ) {
      throw new MoneyFlowKeyConflictError(key);
    }
    return null;
  }
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "in_progress") return null;
  const stored = existing.bondPayoffPlan;
  // Crashed between the claim insert and the plan write: nothing applied yet,
  // and the live set is empty because the bonds matured elsewhere — the
  // public no-bonds result is the truthful answer. A malformed outcome is
  // equally unusable: report nothing rather than corrupt numbers.
  if (!isStoredPlan(stored) || !isBondPayoffOutcome(stored.outcome)) return null;
  if (
    stored.payerCorpIdHex !== expectedPayerCorpId.toHexString() ||
    stored.issuerCorpIdHex !== expectedIssuerCorpId.toHexString()
  ) {
    throw new MoneyFlowKeyConflictError(key);
  }
  const plan = planFromStored(stored);
  const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
    mapPayoffError(step.name, outcome);
  await runWithOptionalTransaction(
    async (session) =>
      runMoneyFlowSteps(receipts, key, buildPayoffSteps(db, key, plan), mapError, { session }),
    async () => runMoneyFlowSteps(receipts, key, buildPayoffSteps(db, key, plan), mapError)
  );
  // `stored.outcome` is narrowed valid by the guard above; report a copy of
  // it (never `plan.outcome`, which stays optional, and never an alias of
  // the receipt document).
  return { outcome: { ...stored.outcome } };
}
