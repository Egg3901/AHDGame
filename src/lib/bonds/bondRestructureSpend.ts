import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db } from "mongodb";
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

export type BondRestructureHolderKind = "character" | "imperial" | "corp";

export interface BondRestructureHolderCredit {
  kind: BondRestructureHolderKind;
  holderId: ObjectId;
  /**
   * Balance field in the holder's own denomination, resolved by the caller
   * (personal currency field or `cashOnHand` for characters/imperials,
   * `liquidCapital` for corporations).
   */
  field: string;
  /** Amount in the holder's own denomination (full-face economics). */
  amount: number;
}

export interface BondRestructureBond {
  bondId: ObjectId;
  /** `marketPrice` before the restructure, restored if a later claim loses a race. */
  priorMarketPrice: number;
}

/**
 * The executor-computed result summary for a restructure attempt. Stored on
 * the resume plan at claim time so a same-key retry that finds no defaulted
 * bonds left (every cure applied, crash before the receipt completed) can
 * finish the stored plan and still report the attempted outcome instead of
 * stranding paid-and-cured bonds behind a "no defaulted bonds" refusal.
 */
export interface BondRestructureOutcome {
  paid: number;
  bondsMatured: number;
  sectorsLiquidated: number;
  proceeds: number;
  residualLiquidCapital: number;
}

/**
 * Runtime shape check for a persisted restructure outcome. The resume path
 * reports the stored outcome as the attempt's result, so a receipt whose
 * outcome is present but malformed is unusable: the caller keeps its public
 * no-default refusal instead of reporting corrupt numbers.
 */
export function isBondRestructureOutcome(value: unknown): value is BondRestructureOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return (
    typeof outcome.paid === "number" &&
    typeof outcome.bondsMatured === "number" &&
    typeof outcome.sectorsLiquidated === "number" &&
    typeof outcome.proceeds === "number" &&
    typeof outcome.residualLiquidCapital === "number"
  );
}

export interface BondRestructureSpendInput {
  /** Corporation being restructured (its liquid capital nets proceeds minus principal). */
  corpId: ObjectId;
  /**
   * Net liquid-capital movement in corp-local denomination
   * (salvage proceeds minus defaulted principal; non-negative by feasibility).
   * Zero omits the leg (legs require non-zero deltas).
   */
  netLiquidCapitalDelta: number;
  /** One credit per holder; may be empty when no holder rows resolve. */
  holders: BondRestructureHolderCredit[];
  /** Defaulted bonds to cure; at least one. */
  bonds: BondRestructureBond[];
  cureTurn: number;
  now: Date;
  /** Executor-computed result summary, persisted on the resume plan. */
  outcome?: BondRestructureOutcome;
  /**
   * Caller-chosen fingerprint of the intended restructure (see
   * `buildBondRestructureFingerprint`). A retry presenting the same key with
   * a different fingerprint is rejected instead of returning the stored
   * outcome for the wrong restructure.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route, or a deterministic turn key). Same key + same restructure
   * replays the stored outcome instead of paying again. Omit to mint one: the
   * attempt is still crash-safe within the attempt, but a client retry mints
   * a new key and is treated as a new attempt (still guarded by the
   * per-holder legs and per-bond cure claims, so it fails closed instead of
   * double-paying).
   */
  idempotencyKey?: string;
}

/** Corp liquid-capital leg failed: the corp row vanished mid-flight. */
export const BOND_RESTRUCTURE_FUNDS = "BOND_RESTRUCTURE_FUNDS";
/** A holder credit failed: the holder row vanished mid-flight. */
export const BOND_RESTRUCTURE_HOLDER = "BOND_RESTRUCTURE_HOLDER";
/** A bond cure claim failed: the bond raced (matured/cured elsewhere). */
export const BOND_RESTRUCTURE_MATURE = "BOND_RESTRUCTURE_MATURE";

const HOLDER_COLLECTION: Record<BondRestructureHolderKind, string> = {
  character: "characters",
  imperial: "imperialCharacters",
  corp: "corporations",
};

function mapRestructureError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a vanished holder is the 500
  // inconsistent-holder error, a lost cure race the 400 bond-state refusal, a
  // vanished corp the 500 inconsistent error. Anything after money moved
  // compensates its own prefix instead of stranding a half-landed
  // restructure.
  if (stepName === "corp-lc") return new Error(`${BOND_RESTRUCTURE_FUNDS}:${outcome}`);
  if (stepName.startsWith("holder-credit-"))
    return new Error(`${BOND_RESTRUCTURE_HOLDER}:${outcome}`);
  return new Error(`${BOND_RESTRUCTURE_MATURE}:${outcome}`);
}

/**
 * Deterministic fingerprint for a restructure attempt. Covers the transfer
 * itself (corp, net movement, bond set, per-holder allocation, cure turn), so
 * a key reused for a different restructure fails closed with
 * `MoneyFlowKeyConflictError` instead of replaying the wrong outcome.
 */
export function buildBondRestructureFingerprint(input: {
  corpId: ObjectId;
  netLiquidCapitalDelta: number;
  bonds: ObjectId[];
  holders: Array<{ kind: BondRestructureHolderKind; holderId: ObjectId; amount: number }>;
  cureTurn: number;
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
  return `bond-restructure:${input.corpId.toHexString()}:${cents(input.netLiquidCapitalDelta)}:${bondPart}:${holderPart}:${input.cureTurn}`;
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any money moves. A same-key retry after a crash rebuilds its
 * steps from THIS plan, never from the caller's live input: the executors
 * derive every call from live state, so post-crash input is a remainder
 * (cured bonds drop out, holder maps shrink). Running the remainder would
 * compensate at remainder amounts if the resume itself failed, stranding the
 * applied-minus-remainder difference on the corp. Resuming the stored plan
 * keeps the liquid-capital leg, credits, and cure claims at exactly the
 * attempted amounts.
 */
export interface BondRestructureStoredPlan {
  version: 1;
  corpIdHex: string;
  netLiquidCapitalDelta: number;
  cureTurn: number;
  nowIso: string;
  holders: Array<{
    kind: BondRestructureHolderKind;
    holderIdHex: string;
    field: string;
    amount: number;
  }>;
  bonds: Array<{ bondIdHex: string; priorMarketPrice: number }>;
  outcome?: BondRestructureOutcome;
}

function toStoredPlan(input: BondRestructureSpendInput): BondRestructureStoredPlan {
  return {
    version: 1,
    corpIdHex: input.corpId.toHexString(),
    netLiquidCapitalDelta: input.netLiquidCapitalDelta,
    cureTurn: input.cureTurn,
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
    })),
    ...(input.outcome !== undefined ? { outcome: { ...input.outcome } } : {}),
  };
}

function isStoredPlan(value: unknown): value is BondRestructureStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.corpIdHex === "string" &&
    Array.isArray(plan.holders) &&
    Array.isArray(plan.bonds)
  );
}

/**
 * A live retry input is a plausible remainder of the stored attempt when it
 * names the same corporation and cure turn and covers only bonds and holders
 * the stored plan already covers. Anything else under the same key is a
 * genuinely different restructure and stays a key conflict (fail closed).
 */
function isRemainderOfPlan(
  input: BondRestructureSpendInput,
  plan: BondRestructureStoredPlan
): boolean {
  if (input.corpId.toHexString() !== plan.corpIdHex) return false;
  if (input.cureTurn !== plan.cureTurn) return false;
  const storedBonds = new Set(plan.bonds.map((b) => b.bondIdHex));
  if (!input.bonds.every((b) => storedBonds.has(b.bondId.toHexString()))) return false;
  const storedHolders = new Set(plan.holders.map((h) => `${h.kind}:${h.holderIdHex}`));
  if (!input.holders.every((h) => storedHolders.has(`${h.kind}:${h.holderId.toHexString()}`))) {
    return false;
  }
  return true;
}

/**
 * Bond-default RESTRUCTURING money flow: net the salvage proceeds against the
 * defaulted principal on the corp's liquid capital and pay defaulted
 * bondholders in full, so the result is exactly-once on every topology (issue
 * #1672). The sector liquidation itself is NOT part of this flow: it runs in
 * the caller before the flow as an idempotent pre-step
 * (`restoreSectorsToUnowned` carries per-sector restore tokens, so a retried
 * liquidation converges instead of double-crediting the market pool).
 * Sequencing liquidation first also keeps imputed proceeds honest — the
 * proceeds credit inside this flow never outlives the actual sale.
 *
 * Step order mirrors the historical write order: the corp liquid-capital net
 * lands first, the holder credits second, the per-bond cure claims last, and
 * a later failure compensates its own prefix (credits reversed, corp leg
 * refunded, applied cure flags restored from snapshot) instead of leaving a
 * strand where holders were paid but bonds never cured, or the corp paid but
 * holders got nothing.
 *
 * Fan-out keying: every step carries its own idempotent sub-operation key
 * derived from the flow key (`${key}:corp-lc`,
 * `${key}:holder:<kind>:<holderId>`, `${key}:cure:<bondId>`). Two legs on one
 * document under one key collide, because the first leg's key record trips
 * the second leg's `$ne: key` guard and the second balance change is silently
 * skipped — so the corp's own bond holdings (a corp paid as holder while its
 * liquid capital also nets) must never share the corp-leg key.
 *
 * The financial-tx audit rows stay OUTSIDE the keyed flow as a post-commit
 * best effort in the caller (`emitTxBulk` never throws): they record no
 * balance, so skipping them on failure is harmless, while making them a
 * terminal step would settle `UNCOMPENSATED` on money that already moved.
 * Same pattern as the bond buy/sell/buyback/payoff routes.
 *
 * Under real transactions the corp leg, the credits, the cure claims, and
 * the idempotency receipt join the transaction and commit atomically,
 * preserving the old behavior. On a standalone deployment the fallback runs
 * the same writes as keyed idempotent steps: a crash between any two writes
 * leaves an `in_progress` receipt, and retrying with the same key and
 * fingerprint reconciles to exactly one restructure. A retry after a terminal
 * failure throws `MoneyFlowTerminalError` (fail closed); a new attempt needs
 * a new key. A retry after a crash that already cured some bonds presents a
 * smaller live bond set (the callers rebuild every call from live state), so
 * its fingerprint no longer matches the receipt. That retry still resumes
 * under the SAME key: the claim adopts the stored fingerprint, checks the
 * live input is a remainder of the persisted plan, and reconciles the STORED
 * plan to completion (per-step sub-keys skip what already applied). A
 * same-key retry that is not a remainder is a genuinely different
 * restructure and stays a `MoneyFlowKeyConflictError`. No new client key is
 * ever needed after a crash, and no receipt strands `in_progress`.
 */
interface NormalizedRestructurePlan {
  corpId: ObjectId;
  netLiquidCapitalDelta: number;
  holders: Array<{
    kind: BondRestructureHolderKind;
    holderId: ObjectId;
    field: string;
    amount: number;
  }>;
  bonds: Array<{ bondId: ObjectId; priorMarketPrice: number }>;
  cureTurn: number;
  now: Date;
  outcome?: BondRestructureOutcome;
}

function planFromInput(live: BondRestructureSpendInput): NormalizedRestructurePlan {
  return {
    corpId: live.corpId,
    netLiquidCapitalDelta: live.netLiquidCapitalDelta,
    holders: live.holders.map((h) => ({
      kind: h.kind,
      holderId: h.holderId,
      field: h.field,
      amount: h.amount,
    })),
    bonds: live.bonds.map((b) => ({
      bondId: b.bondId,
      priorMarketPrice: b.priorMarketPrice,
    })),
    cureTurn: live.cureTurn,
    now: live.now,
    outcome: live.outcome,
  };
}

function planFromStored(stored: BondRestructureStoredPlan): NormalizedRestructurePlan {
  return {
    corpId: new ObjectId(stored.corpIdHex),
    netLiquidCapitalDelta: stored.netLiquidCapitalDelta,
    holders: stored.holders.map((h) => ({
      kind: h.kind,
      holderId: new ObjectId(h.holderIdHex),
      field: h.field,
      amount: h.amount,
    })),
    bonds: stored.bonds.map((b) => ({
      bondId: new ObjectId(b.bondIdHex),
      priorMarketPrice: b.priorMarketPrice,
    })),
    cureTurn: stored.cureTurn,
    now: new Date(stored.nowIso),
    outcome: stored.outcome ? { ...stored.outcome } : undefined,
  };
}

function buildRestructureSteps(db: Db, key: string, plan: NormalizedRestructurePlan): MoneyFlowStep[] {
  const bonds = db.collection<Bond>("bonds");
  // The net is proceeds-minus-principal (non-negative by feasibility): a
  // pure credit, so no debit guard. A zero net omits the leg entirely.
  const lcSteps: MoneyFlowStep[] =
    plan.netLiquidCapitalDelta > 0
      ? [
          makeLegStep(`${key}:corp-lc`, {
            name: "corp-lc",
            collection: db.collection<MoneyFlowAccount>("corporations"),
            docId: plan.corpId,
            field: "liquidCapital",
            delta: plan.netLiquidCapitalDelta,
            set: { updatedAt: plan.now },
          }),
        ]
      : [];

  // Zero-amount credits (face rounding) are skipped: legs require non-zero
  // deltas, and a zero credit moves no money.
  const holderSteps: MoneyFlowStep[] = plan.holders
    .filter((holder) => holder.amount !== 0)
    .map((holder) => {
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

  const cureSteps: MoneyFlowStep[] = plan.bonds.map((bond) => {
    const hex = bond.bondId.toHexString();
    const subKey = `${key}:cure:${hex}`;
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
                defaultCure: { cureMethod: "restructure" as const, curedAtTurn: plan.cureTurn },
                updatedAt: plan.now,
              },
            },
          },
          stepOpts ?? {}
        ),
      // Only reached when a LATER bond's claim loses a race: restore the
      // captured flags so compensation leaves no half-cured set. The
      // filter is the bare `_id` so a revert is never guard-blocked.
      revert: (stepOpts) =>
        applyKeyedUpdate(
          `${subKey}:compensate:cure`,
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

  return [...lcSteps, ...holderSteps, ...cureSteps];
}

export async function applyBondRestructureSpend(
  db: Db,
  input: BondRestructureSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.corpId) {
    throw new TypeError("Bond restructure spend needs corpId");
  }
  if (!Array.isArray(input.bonds) || input.bonds.length === 0) {
    throw new TypeError("Bond restructure spend needs at least one bond");
  }
  if (!Array.isArray(input.holders)) {
    throw new TypeError("Bond restructure spend needs a holders array");
  }
  const net = input.netLiquidCapitalDelta;
  if (!Number.isFinite(net) || net < 0) {
    throw new RangeError("Bond restructure net liquid-capital delta must be a finite non-negative amount");
  }
  for (const holder of input.holders) {
    if (!holder.holderId) {
      throw new TypeError("Bond restructure holder credit needs a holderId");
    }
    if (typeof holder.field !== "string" || holder.field.length === 0) {
      throw new TypeError("Bond restructure holder credit needs a balance field");
    }
    if (!Number.isFinite(holder.amount)) {
      throw new RangeError("Bond restructure holder amounts must be finite");
    }
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond restructure idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);

  /** Receipt rows carry the resume plan under this field (never in the shared type). */
  type BondRestructureReceipt = MoneyFlowReceipt & { bondRestructurePlan?: unknown };
  const receiptCollection = receipts as unknown as Collection<BondRestructureReceipt>;

  const runPlan = async (
    plan: NormalizedRestructurePlan,
    opts: { session?: ClientSession }
  ): Promise<void> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildRestructureSteps(db, key, plan),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) =>
        mapRestructureError(step.name, outcome),
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
      const stored = existing.bondRestructurePlan;
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
      // Same fingerprint, so the live input names the same restructure:
      // reconcile it through the keyed steps (already-applied legs skip).
      await runPlan(planFromInput(input), opts);
      return { duplicate: true as boolean };
    }
    // Persist the resume plan before the first step: a crash from here on
    // resumes this exact plan under the same key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { bondRestructurePlan: toStoredPlan(input), updatedAt: new Date() } },
        session ? { session } : {}
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${BOND_RESTRUCTURE_FUNDS}:plan-store`, opts);
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

export interface BondRestructureResumeResult {
  /** Executor-computed result summary persisted on the stored plan. */
  outcome: BondRestructureOutcome;
}

/**
 * Key-only crash recovery for the empty-remainder retry (issue #1672): the
 * executor rebuilds every call from live state, so after a crash late in the
 * flow the live defaulted set reads empty and there is no spend input to
 * present — `applyBondRestructureSpend` itself requires at least one bond.
 * The executor consults this path instead of throwing "no defaulted bonds"
 * and stranding paid-and-cured bonds behind an `in_progress` receipt.
 *
 * Returns null when there is nothing to resume (no receipt under the key, an
 * already-`completed` receipt, or an `in_progress` receipt with no usable
 * stored plan): the caller keeps its public no-default refusal. Throws
 * `MoneyFlowTerminalError` when the receipt settled `failed`/`compensated`,
 * and `MoneyFlowKeyConflictError` when the stored attempt names a different
 * corporation (fail closed on cross-corp key reuse).
 */
export async function resumeBondRestructureByKey(
  db: Db,
  key: string,
  expectedCorpId: ObjectId
): Promise<BondRestructureResumeResult | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond restructure idempotency key must be 1-128 characters");
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<BondRestructureReceipt>;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  if (existing.status === "completed") {
    const stored = existing.bondRestructurePlan;
    if (isStoredPlan(stored) && stored.corpIdHex !== expectedCorpId.toHexString()) {
      throw new MoneyFlowKeyConflictError(key);
    }
    return null;
  }
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "in_progress") return null;
  const stored = existing.bondRestructurePlan;
  // Crashed between the claim insert and the plan write: nothing applied yet,
  // and the live set is empty because the bonds were cured elsewhere — the
  // public no-default refusal is the truthful answer. A malformed outcome is
  // equally unusable: report nothing rather than corrupt numbers.
  if (!isStoredPlan(stored) || !isBondRestructureOutcome(stored.outcome)) return null;
  if (stored.corpIdHex !== expectedCorpId.toHexString()) {
    throw new MoneyFlowKeyConflictError(key);
  }
  const plan = planFromStored(stored);
  const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
    mapRestructureError(step.name, outcome);
  await runWithOptionalTransaction(
    async (session) =>
      runMoneyFlowSteps(receipts, key, buildRestructureSteps(db, key, plan), mapError, { session }),
    async () => runMoneyFlowSteps(receipts, key, buildRestructureSteps(db, key, plan), mapError)
  );
  // `stored.outcome` is narrowed valid by the guard above; report a copy
  // of it (never `plan.outcome`, which stays optional, and never an alias
  // of the receipt document).
  return { outcome: { ...stored.outcome } };
}
