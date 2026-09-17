import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyIdempotentLeg,
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  failMoneyFlowReceipt,
  insertKeyedDoc,
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
import type { BondMarketPool } from "@/lib/db/types";
import type {
  CorporateShareholderPayoutRow,
  PublicFloatPayoutRow,
  ShareholderPayoutRow,
} from "@/lib/bonds/corporateBondDefault";

export type BondDissolutionHolderKind = "character" | "imperial" | "corp" | "centralBank";

export interface BondDissolutionHolderCredit {
  kind: BondDissolutionHolderKind;
  /** Characters/imperials/corps carry ObjectIds; central-bank docs are keyed by id string. */
  holderId: ObjectId | string;
  /**
   * Balance field in the holder's own denomination, resolved by the caller
   * (personal currency field or `cashOnHand` for characters/imperials,
   * `liquidCapital` for corporations, `reserveBalance` for central banks).
   */
  field: string;
  /** Amount in the holder's own denomination (pro-rata economics). */
  amount: number;
}

export interface BondDissolutionFundCredit {
  fundId: ObjectId;
  /** Anchor-denominated; index funds hold cash in ₳ (cashAnchor), paid as-is. */
  amountAnchor: number;
  /** Dissolving corporation, dropped from the fund's holdings in the same write. */
  dissolvedCorpId: ObjectId;
}

export interface BondDissolutionPoolCredit {
  /** Pool currency (the pool doc `_id`). */
  currency: string;
  /** Recovery share in pool-local denomination. */
  amountLocal: number;
}

/**
 * The executor-computed result summary for a dissolution attempt. Stored on
 * the resume plan at claim time so a same-key retry that finds the corp
 * already deleted (every credit applied, crash inside the terminal cleanup)
 * can still report the attempted outcome instead of stranding paid holders
 * behind a "corporation not found" refusal. The row shapes are exactly the
 * route/executor result contract, so the resume path rebuilds it verbatim.
 */
export interface BondDissolutionOutcome {
  corpIdHex: string;
  corpName: string;
  bondRecoveryPool: number;
  shareholderPool: number;
  shareholderPayouts: ShareholderPayoutRow[];
  corporateShareholderPayouts: CorporateShareholderPayoutRow[];
  publicFloatPayout: PublicFloatPayoutRow | null;
  totalPayoutToPeople: number;
}

function isPayoutRowList(value: unknown): value is ShareholderPayoutRow[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      typeof (row as { characterId?: unknown }).characterId === "string" &&
      typeof (row as { payout?: unknown }).payout === "number"
  );
}

function isCorporatePayoutRowList(value: unknown): value is CorporateShareholderPayoutRow[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      typeof (row as { corporationId?: unknown }).corporationId === "string" &&
      typeof (row as { payout?: unknown }).payout === "number"
  );
}

/**
 * Runtime shape check for a persisted dissolution outcome. The resume path
 * reports the stored outcome as the attempt's result, so a receipt whose
 * outcome is present but malformed is unusable: the caller keeps its public
 * refusal instead of reporting corrupt numbers.
 */
export function isBondDissolutionOutcome(value: unknown): value is BondDissolutionOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  if (typeof outcome.corpIdHex !== "string" || typeof outcome.corpName !== "string") return false;
  if (typeof outcome.bondRecoveryPool !== "number") return false;
  if (typeof outcome.shareholderPool !== "number") return false;
  if (!isPayoutRowList(outcome.shareholderPayouts)) return false;
  if (!isCorporatePayoutRowList(outcome.corporateShareholderPayouts)) return false;
  if (outcome.publicFloatPayout !== null) {
    const float = outcome.publicFloatPayout as Record<string, unknown>;
    if (
      !float ||
      typeof float !== "object" ||
      typeof float.shares !== "number" ||
      typeof float.payout !== "number"
    ) {
      return false;
    }
  }
  return typeof outcome.totalPayoutToPeople === "number";
}

export interface BondDissolutionSpendInput {
  /** Dissolving corporation (identity scope for the fingerprint and resume). */
  corpId: ObjectId;
  /** One credit per paid holder; at least one credit across holders/funds/pools. */
  holders: BondDissolutionHolderCredit[];
  /** Index-fund shareholder credits; may be empty. */
  funds: BondDissolutionFundCredit[];
  /** Per-bond market-pool recovery credits; may be empty. */
  poolCredits: BondDissolutionPoolCredit[];
  now: Date;
  /** Executor-computed result summary, persisted on the resume plan. */
  outcome?: BondDissolutionOutcome;
  /**
   * Caller-chosen fingerprint of the intended dissolution (see
   * `buildBondDissolutionFingerprint`). A retry presenting the same key with
   * a different fingerprint is rejected instead of returning the stored
   * outcome for the wrong dissolution.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route, or a deterministic per-corp key for turn/deletion callers).
   * Same key + same dissolution replays the stored outcome instead of paying
   * again. Omit to mint one: the attempt is still crash-safe within the
   * attempt, but a retry mints a new key and is treated as a new attempt.
   */
  idempotencyKey?: string;
}

/** A holder/fund/central-bank credit failed: the holder row vanished mid-flight. */
export const BOND_DISSOLUTION_HOLDER = "BOND_DISSOLUTION_HOLDER";
/** A market-pool recovery credit failed. */
export const BOND_DISSOLUTION_POOL = "BOND_DISSOLUTION_POOL";

const HOLDER_COLLECTION: Record<BondDissolutionHolderKind, string> = {
  character: "characters",
  imperial: "imperialCharacters",
  corp: "corporations",
  centralBank: "centralBanks",
};

function holderIdToString(id: ObjectId | string): string {
  return typeof id === "string" ? id : id.toHexString();
}

function mapDissolutionError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a vanished holder is the 500
  // inconsistent-holder error. Anything after money moved compensates its
  // own prefix instead of stranding a half-landed dissolution.
  if (stepName.startsWith("pool-credit-")) return new Error(`${BOND_DISSOLUTION_POOL}:${outcome}`);
  return new Error(`${BOND_DISSOLUTION_HOLDER}:${outcome}`);
}

/**
 * Deterministic fingerprint for a dissolution payout attempt. Covers the
 * transfer itself (dissolving corp, bond set, per-holder allocation, fund
 * and pool credits), so a key reused for a different dissolution fails
 * closed with `MoneyFlowKeyConflictError` instead of replaying the wrong
 * outcome.
 */
export function buildBondDissolutionFingerprint(input: {
  corpId: ObjectId;
  bonds: ObjectId[];
  holders: Array<{ kind: BondDissolutionHolderKind; holderId: ObjectId | string; amount: number }>;
  funds: Array<{ fundId: ObjectId; amount: number }>;
  pools: Array<{ currency: string; amount: number }>;
}): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const bondPart = [...input.bonds]
    .map((b) => b.toHexString())
    .sort()
    .join(",");
  const holderPart = [...input.holders]
    .map((h) => `${h.kind}:${holderIdToString(h.holderId)}:${cents(h.amount)}`)
    .sort()
    .join(",");
  const fundPart = [...input.funds]
    .map((f) => `${f.fundId.toHexString()}:${cents(f.amount)}`)
    .sort()
    .join(",");
  const poolPart = [...input.pools]
    .map((p) => `${p.currency}:${cents(p.amount)}`)
    .sort()
    .join(",");
  return `bond-dissolution:${input.corpId.toHexString()}:${bondPart}:${holderPart}:${fundPart}:${poolPart}`;
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any money moves. A same-key retry after a crash rebuilds its
 * steps from THIS plan, never from the caller's live input: the executor
 * derives every call from live state, so post-crash input is a remainder
 * (deleted bonds drop out, holder maps shrink, the corp itself may be gone).
 * Running the remainder would compensate at remainder amounts if the resume
 * itself failed, stranding the applied-minus-remainder difference on the
 * holders. Resuming the stored plan keeps every credit at exactly the
 * attempted amounts.
 */
export interface BondDissolutionStoredPlan {
  version: 1;
  corpIdHex: string;
  nowIso: string;
  holders: Array<{
    kind: BondDissolutionHolderKind;
    holderId: string;
    holderIdIsObjectId: boolean;
    field: string;
    amount: number;
  }>;
  funds: Array<{ fundIdHex: string; amountAnchor: number; dissolvedCorpIdHex: string }>;
  pools: Array<{ currency: string; amountLocal: number }>;
  outcome?: BondDissolutionOutcome;
}

function toStoredPlan(input: BondDissolutionSpendInput): BondDissolutionStoredPlan {
  return {
    version: 1,
    corpIdHex: input.corpId.toHexString(),
    nowIso: input.now.toISOString(),
    holders: input.holders.map((h) => ({
      kind: h.kind,
      holderId: holderIdToString(h.holderId),
      holderIdIsObjectId: h.holderId instanceof ObjectId,
      field: h.field,
      amount: h.amount,
    })),
    funds: input.funds.map((f) => ({
      fundIdHex: f.fundId.toHexString(),
      amountAnchor: f.amountAnchor,
      dissolvedCorpIdHex: f.dissolvedCorpId.toHexString(),
    })),
    pools: input.poolCredits.map((p) => ({ currency: p.currency, amountLocal: p.amountLocal })),
    ...(input.outcome !== undefined ? { outcome: { ...input.outcome } } : {}),
  };
}

function isStoredPlan(value: unknown): value is BondDissolutionStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.corpIdHex === "string" &&
    Array.isArray(plan.holders) &&
    Array.isArray(plan.funds) &&
    Array.isArray(plan.pools)
  );
}

/**
 * A live retry input is a plausible remainder of the stored attempt when it
 * names the same dissolving corporation and covers only holders, funds, and
 * pool credits the stored plan already covers. Anything else under the same
 * key is a genuinely different dissolution and stays a key conflict (fail
 * closed). Pool credits compare as currency:amount pairs because one bond
 * contributes one credit and post-crash input drops settled bonds.
 */
function isRemainderOfPlan(
  input: BondDissolutionSpendInput,
  plan: BondDissolutionStoredPlan
): boolean {
  if (input.corpId.toHexString() !== plan.corpIdHex) return false;
  const storedHolders = new Set(plan.holders.map((h) => `${h.kind}:${h.holderId}`));
  if (
    !input.holders.every((h) => storedHolders.has(`${h.kind}:${holderIdToString(h.holderId)}`))
  ) {
    return false;
  }
  const storedFunds = new Set(plan.funds.map((f) => f.fundIdHex));
  if (!input.funds.every((f) => storedFunds.has(f.fundId.toHexString()))) return false;
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const storedPools = new Set(plan.pools.map((p) => `${p.currency}:${cents(p.amountLocal)}`));
  if (!input.poolCredits.every((p) => storedPools.has(`${p.currency}:${cents(p.amountLocal)}`))) {
    return false;
  }
  return true;
}

interface NormalizedDissolutionPlan {
  corpId: ObjectId;
  holders: Array<{
    kind: BondDissolutionHolderKind;
    holderId: ObjectId | string;
    field: string;
    amount: number;
  }>;
  funds: Array<{ fundId: ObjectId; amountAnchor: number; dissolvedCorpId: ObjectId }>;
  pools: Array<{ currency: string; amountLocal: number }>;
  now: Date;
  outcome?: BondDissolutionOutcome;
}

function planFromInput(live: BondDissolutionSpendInput): NormalizedDissolutionPlan {
  return {
    corpId: live.corpId,
    holders: live.holders.map((h) => ({
      kind: h.kind,
      holderId: h.holderId,
      field: h.field,
      amount: h.amount,
    })),
    funds: live.funds.map((f) => ({
      fundId: f.fundId,
      amountAnchor: f.amountAnchor,
      dissolvedCorpId: f.dissolvedCorpId,
    })),
    pools: live.poolCredits.map((p) => ({ currency: p.currency, amountLocal: p.amountLocal })),
    now: live.now,
    outcome: live.outcome,
  };
}

function planFromStored(stored: BondDissolutionStoredPlan): NormalizedDissolutionPlan {
  return {
    corpId: new ObjectId(stored.corpIdHex),
    holders: stored.holders.map((h) => ({
      kind: h.kind,
      holderId: h.holderIdIsObjectId ? new ObjectId(h.holderId) : h.holderId,
      field: h.field,
      amount: h.amount,
    })),
    funds: stored.funds.map((f) => ({
      fundId: new ObjectId(f.fundIdHex),
      amountAnchor: f.amountAnchor,
      dissolvedCorpId: new ObjectId(f.dissolvedCorpIdHex),
    })),
    pools: stored.pools.map((p) => ({ currency: p.currency, amountLocal: p.amountLocal })),
    now: new Date(stored.nowIso),
    outcome: stored.outcome ? { ...stored.outcome } : undefined,
  };
}

/**
 * One market-pool recovery credit as a step. The pool doc normally exists
 * (the legacy `creditBondPool` upserts, so a currency that never traded has
 * no row): the keyed leg covers the live row, and a missing row falls back
 * to a deterministic insert carrying the same amounts plus the step's key
 * record, so a retry converges to `already-applied` through the leg instead
 * of duplicating the row. Legacy economics preserved exactly: `cashLocal`
 * plus the `lifetime.recoveriesIn` line.
 */
function makePoolCreditStep(
  db: Db,
  flowKey: string,
  pool: { currency: string; amountLocal: number },
  index: number,
  now: Date
): MoneyFlowStep {
  const subKey = `${flowKey}:pool:${pool.currency}:${index}`;
  const name = `pool-credit-${pool.currency}-${index}`;
  const pools = db.collection<BondMarketPool>("bondMarketPools");
  const leg = {
    name,
    collection: pools as unknown as Collection<MoneyFlowAccount>,
    docId: pool.currency,
    field: "cashLocal",
    delta: pool.amountLocal,
    extraIncs: { "lifetime.recoveriesIn": pool.amountLocal },
    set: { updatedAt: now },
  };
  return {
    name,
    apply: async (options) => {
      const outcome = await applyIdempotentLeg(subKey, leg, options ?? {});
      if (outcome !== "missing") return outcome;
      return insertKeyedDoc<BondMarketPool>(
        pools,
        {
          _id: pool.currency as BondMarketPool["_id"],
          cashLocal: pool.amountLocal,
          targetCashLocal: 0,
          lifetime: { recoveriesIn: pool.amountLocal },
          appliedMoneyFlowKeys: [subKey],
          createdAt: now,
          updatedAt: now,
        } as BondMarketPool,
        options ?? {}
      );
    },
    revert: (options) =>
      applyIdempotentLeg(
        `${subKey}:compensate:${name}`,
        {
          ...leg,
          delta: -leg.delta,
          extraIncs: { "lifetime.recoveriesIn": -pool.amountLocal },
        },
        options ?? {}
      ),
  };
}

/**
 * One index-fund shareholder credit as a step. The cash move and the stale
 * holding drop land in ONE keyed update, so a crash between them is
 * impossible; a retry converges to `already-applied` instead of paying the
 * fund twice. The revert restores the cash only: the holding entry on the
 * fund is derived state (the payout basis lives on the dissolving corp's cap
 * table, which the flow never mutates), so a compensated-then-retried
 * attempt recomputes the same fund slice and pays it exactly once overall.
 */
function makeFundCreditStep(
  db: Db,
  flowKey: string,
  fund: { fundId: ObjectId; amountAnchor: number; dissolvedCorpId: ObjectId },
  now: Date
): MoneyFlowStep {
  const hex = fund.fundId.toHexString();
  const subKey = `${flowKey}:fund:${hex}`;
  const funds = db.collection<MoneyFlowAccount>("indexFunds");
  return {
    name: `fund-credit-${hex}`,
    apply: (options) =>
      applyKeyedUpdate(
        subKey,
        {
          collection: funds,
          filter: { _id: fund.fundId },
          update: {
            $inc: { cashAnchor: fund.amountAnchor },
            $pull: { holdings: { corporationId: fund.dissolvedCorpId } },
            $set: { updatedAt: now },
          },
        },
        options ?? {}
      ),
    revert: (options) =>
      applyKeyedUpdate(
        `${subKey}:compensate:fund`,
        {
          collection: funds,
          filter: { _id: fund.fundId },
          update: {
            $inc: { cashAnchor: -fund.amountAnchor },
            $set: { updatedAt: now },
          },
        },
        options ?? {}
      ),
  };
}

function buildDissolutionSteps(
  db: Db,
  key: string,
  plan: NormalizedDissolutionPlan
): MoneyFlowStep[] {
  // Step order mirrors the historical write order: the per-bond pool
  // recovery credits ran inside the bond loop (before any holder payout),
  // then the character / imperial / corp-creditor / corp-equity /
  // central-bank bulkWrite batches in that order, then the index-fund
  // shareholder rows. A later failure compensates its own prefix instead of
  // leaving a strand where bondholders were paid but shareholders got
  // nothing.
  const poolSteps = plan.pools.map((pool, index) =>
    makePoolCreditStep(db, key, pool, index, plan.now)
  );
  const holderSteps = plan.holders.map((holder) => {
    const hex = holderIdToString(holder.holderId);
    return makeLegStep(`${key}:holder:${holder.kind}:${hex}`, {
      name: `holder-credit-${holder.kind}-${hex}`,
      collection: db.collection<MoneyFlowAccount>(HOLDER_COLLECTION[holder.kind]),
      docId: holder.holderId,
      field: holder.field,
      delta: holder.amount,
      set: { updatedAt: plan.now },
    });
  });
  const fundSteps = plan.funds.map((fund) => makeFundCreditStep(db, key, fund, plan.now));
  return [...poolSteps, ...holderSteps, ...fundSteps];
}

/**
 * Bond-default DISSOLUTION payout waterfall as exactly-once money flow: the
 * per-bond market-pool recovery shares plus one resumable credit per
 * character / imperial / corp-creditor / corp-equity / central-bank /
 * index-fund payee, so the result is exactly-once on every topology (issue
 * #1672).
 *
 * The caller-owned pre-phase (creditor-bond liquidation into liquidCapital,
 * in-kind cross-equity distribution, settlement snapshot) runs BEFORE this
 * flow and stays outside it: the liquidation pull and the in-kind move are
 * convergent claims (a retry finds the holder/entry already gone and skips),
 * while the pool-debit/LC-credit pair prices live pool depth and needs
 * reserve support beyond keyed single-document writes. The financial-tx
 * audit rows likewise stay OUTSIDE as a post-commit best effort in the
 * caller (`emitTxBulk` never throws): they record no balance. The terminal
 * ownership cleanup (bond/history deletes, sector restore, share release,
 * corp delete) also stays with the caller as a naturally idempotent pass.
 *
 * Under real transactions the credits and the idempotency receipt join the
 * transaction and commit atomically, preserving the old behavior. On a
 * standalone deployment the fallback runs the same writes as keyed
 * idempotent steps: a crash between any two writes leaves an `in_progress`
 * receipt, and retrying with the same key and fingerprint reconciles to
 * exactly one payout set. A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key. A
 * retry after a crash that already deleted some bonds presents a smaller
 * live credit set (the executor rebuilds every call from live state), so its
 * fingerprint no longer matches the receipt. That retry still resumes under
 * the SAME key: the claim adopts the stored fingerprint, checks the live
 * input is a remainder of the persisted plan, and reconciles the STORED plan
 * to completion (per-step sub-keys skip what already applied). A same-key
 * retry that is not a remainder is a genuinely different dissolution and
 * stays a `MoneyFlowKeyConflictError`. No new client key is ever needed
 * after a crash, and no receipt strands `in_progress`.
 */
export async function applyBondDissolutionSpend(
  db: Db,
  input: BondDissolutionSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.corpId) {
    throw new TypeError("Bond dissolution spend needs corpId");
  }
  if (!Array.isArray(input.holders)) {
    throw new TypeError("Bond dissolution spend needs a holders array");
  }
  if (!Array.isArray(input.funds)) {
    throw new TypeError("Bond dissolution spend needs a funds array");
  }
  if (!Array.isArray(input.poolCredits)) {
    throw new TypeError("Bond dissolution spend needs a poolCredits array");
  }
  if (input.holders.length + input.funds.length + input.poolCredits.length === 0) {
    throw new TypeError("Bond dissolution spend needs at least one credit");
  }
  for (const holder of input.holders) {
    if (!holder.holderId) {
      throw new TypeError("Bond dissolution holder credit needs a holderId");
    }
    if (typeof holder.field !== "string" || holder.field.length === 0) {
      throw new TypeError("Bond dissolution holder credit needs a balance field");
    }
    if (!Number.isFinite(holder.amount) || holder.amount === 0) {
      throw new RangeError("Bond dissolution holder amounts must be finite and non-zero");
    }
  }
  for (const fund of input.funds) {
    if (!fund.fundId) {
      throw new TypeError("Bond dissolution fund credit needs a fundId");
    }
    if (!Number.isFinite(fund.amountAnchor) || fund.amountAnchor === 0) {
      throw new RangeError("Bond dissolution fund amounts must be finite and non-zero");
    }
    if (!fund.dissolvedCorpId) {
      throw new TypeError("Bond dissolution fund credit needs a dissolvedCorpId");
    }
  }
  for (const pool of input.poolCredits) {
    if (typeof pool.currency !== "string" || pool.currency.length === 0) {
      throw new TypeError("Bond dissolution pool credit needs a currency");
    }
    if (!Number.isFinite(pool.amountLocal) || pool.amountLocal === 0) {
      throw new RangeError("Bond dissolution pool amounts must be finite and non-zero");
    }
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond dissolution idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);

  /** Receipt rows carry the resume plan under this field (never in the shared type). */
  type BondDissolutionReceipt = MoneyFlowReceipt & { bondDissolutionPlan?: unknown };
  const receiptCollection = receipts as unknown as Collection<BondDissolutionReceipt>;

  const runPlan = async (
    plan: NormalizedDissolutionPlan,
    opts: { session?: ClientSession }
  ): Promise<void> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildDissolutionSteps(db, key, plan),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) =>
        mapDissolutionError(step.name, outcome),
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
      // flight this is the post-crash retry the executor always sends (it
      // rebuilds every call from live state, so deleted bonds drop out and
      // the fingerprint shrinks): resume the STORED plan under the same key
      // instead of stranding the receipt or demanding a new key. When the
      // live input is not a remainder of the stored attempt, or the stored
      // attempt already settled, the conflict stands (fail closed).
      const existing = await receiptCollection.findOne({ _id: key }, session ? { session } : {});
      if (!existing || existing.status !== "in_progress") throw err;
      const stored = existing.bondDissolutionPlan;
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
      // Same fingerprint, so the live input names the same payout set:
      // reconcile it through the keyed steps (already-applied legs skip).
      await runPlan(planFromInput(input), opts);
      return { duplicate: true as boolean };
    }
    // Persist the resume plan before the first step: a crash from here on
    // resumes this exact plan under the same key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { bondDissolutionPlan: toStoredPlan(input), updatedAt: new Date() } },
        session ? { session } : {}
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${BOND_DISSOLUTION_HOLDER}:plan-store`, opts);
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

export interface BondDissolutionResumeResult {
  /** Executor-computed result summary persisted on the stored plan. */
  outcome: BondDissolutionOutcome;
}

/**
 * Key-only crash recovery for the empty-remainder retry (issue #1672): the
 * executor rebuilds every call from live state, so after a crash late in the
 * flow the live bond set reads empty (and the corp itself may already be
 * deleted) and there is no spend input to present. The caller consults this
 * path instead of refusing and stranding paid holders behind an
 * `in_progress` receipt.
 *
 * A `completed` receipt also returns its stored outcome here (unlike the
 * refinance/restructure resume helpers): dissolution deletes the corp after
 * the receipt completes, so a completed receipt with a surviving corp means
 * the terminal cleanup never finished and the caller must re-run it.
 *
 * Returns null when there is nothing to resume (no receipt under the key, or
 * an `in_progress` receipt with no usable stored plan/outcome): the caller
 * keeps its public refusal. Throws `MoneyFlowTerminalError` when the receipt
 * settled `failed`/`compensated`, and `MoneyFlowKeyConflictError` when the
 * stored attempt names a different corporation (fail closed on cross-corp
 * key reuse).
 */
export async function resumeBondDissolutionByKey(
  db: Db,
  key: string,
  expectedCorpId: ObjectId
): Promise<BondDissolutionResumeResult | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond dissolution idempotency key must be 1-128 characters");
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<
    MoneyFlowReceipt & { bondDissolutionPlan?: unknown }
  >;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "in_progress" && existing.status !== "completed") return null;
  const stored = existing.bondDissolutionPlan;
  // Crashed between the claim insert and the plan write: nothing applied yet
  // — the public refusal is the truthful answer. A malformed outcome is
  // equally unusable: report nothing rather than corrupt numbers.
  if (!isStoredPlan(stored) || !isBondDissolutionOutcome(stored.outcome)) return null;
  if (stored.corpIdHex !== expectedCorpId.toHexString()) {
    throw new MoneyFlowKeyConflictError(key);
  }
  if (existing.status === "in_progress") {
    const plan = planFromStored(stored);
    const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
      mapDissolutionError(step.name, outcome);
    await runWithOptionalTransaction(
      async (session) =>
        runMoneyFlowSteps(receipts, key, buildDissolutionSteps(db, key, plan), mapError, {
          session,
        }),
      async () => runMoneyFlowSteps(receipts, key, buildDissolutionSteps(db, key, plan), mapError)
    );
  }
  // `stored.outcome` is narrowed valid by the guard above; report a copy
  // (never an alias of the receipt document).
  return { outcome: { ...stored.outcome } };
}

/**
 * Route-level replay for a finished dissolution whose corporation is already
 * gone: the corp lookup fails before the executor runs, so the route answers
 * from the completed receipt instead of 404ing a client retry. Returns the
 * stored outcome, or null when there is no completed receipt under the key
 * (the caller keeps its 404). Terminal receipts throw
 * `MoneyFlowTerminalError`, cross-corp key reuse throws
 * `MoneyFlowKeyConflictError`.
 */
export async function getBondDissolutionCompletedOutcome(
  db: Db,
  key: string,
  expectedCorpIdHex: string
): Promise<BondDissolutionOutcome | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond dissolution idempotency key must be 1-128 characters");
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<
    MoneyFlowReceipt & { bondDissolutionPlan?: unknown }
  >;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "completed") return null;
  const stored = existing.bondDissolutionPlan;
  if (!isStoredPlan(stored) || !isBondDissolutionOutcome(stored.outcome)) return null;
  if (stored.corpIdHex !== expectedCorpIdHex) {
    throw new MoneyFlowKeyConflictError(key);
  }
  return { ...stored.outcome };
}
