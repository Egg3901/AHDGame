/**
 * Crash-resumable bond-sale intents for standalone Mongo.
 *
 * The sell route claims a sale by decrementing `holders.$.units` (crediting
 * `publicFloat`), then debits the bond market pool and pays the seller. Under
 * `runWithOptionalTransaction` that sequence is non-atomic on standalone
 * Mongo, and the old `catch`-time `rollbackClaim` never ran on process death:
 * a crash after the claim destroyed the holder's units without payment, and a
 * retry failed with "Insufficient bond holdings" against the already-claimed
 * holding.
 *
 * This module mirrors the banking `moneyMove` contract rather than reusing it
 * directly: a bond sale moves securities (holder units) plus FX-converted cash
 * across three documents, which does not fit single-path net-zero money legs.
 * The properties that matter are kept:
 *
 * 1. **The intent is recorded BEFORE anything moves.** The insert is the
 *    claim; a retry finds the pending intent instead of starting a second sale.
 * 2. **Every value write carries a stamp.** The holder claim stamps the sale
 *    id on the holder element in the same write, and the pool debit and seller
 *    payout stamp per-leg keys (`<intentId>#pool`, `<intentId>#payout`) with a
 *    `$ne` guard, exactly like `legStamp` in moneyMove. A leg that already
 *    landed does not match, so resume never pays or debits twice.
 * 3. **Resume converges to exactly one of two terminal states.** `applied`
 *    (every leg verified landed) or `reverted` (the claim restored, the pool
 *    refunded only when its stamp proves the debit landed). A half-applied
 *    intent is a visible repair-queue row via {@link listUnfinishedBondSales}.
 *
 * The state machine itself is seller-agnostic: the route injects
 * {@link BondSaleSettlementOps} built from the intent's stored terms, so a
 * resume replays the ORIGINAL proceeds, never a freshly computed quote.
 */

import { ObjectId, type Db, type Document, type Filter } from "mongodb";
import { SETTLED_KEYS_CAP, SETTLED_KEYS_FIELD } from "@/lib/banking/moneyMove";
import type { CurrencyCode } from "@/lib/constants/currencies";

/** Collection holding the durable sale intents. Also the repair queue. */
export const BOND_SALE_INTENT_COLLECTION = "bondSaleIntents";

export type BondSaleHolderKey = "corporationId" | "imperialCharacterId" | "characterId";

export type BondSaleIntentStatus = "claimed" | "applied" | "reverted" | "rejected";

export type BondSaleLeg = "pool" | "payout";

export interface BondSaleIntent {
  _id: ObjectId;
  bondId: ObjectId;
  holderKey: BondSaleHolderKey;
  holderId: ObjectId;
  /** Collection the seller payout lands in. */
  sellerCollection: "corporations" | "characters" | "imperialCharacters";
  units: number;
  /** Pool debit amount in the bond's own currency, rounded to cents. */
  proceedsLocal: number;
  poolCurrency: CurrencyCode;
  /** Exact seller credit applied with the payout write. */
  payoutInc: Record<string, number>;
  status: BondSaleIntentStatus;
  claimApplied: boolean;
  poolDebited: boolean;
  payoutApplied: boolean;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

export interface CreateBondSaleIntentInput {
  bondId: ObjectId;
  holderKey: BondSaleHolderKey;
  holderId: ObjectId;
  sellerCollection: BondSaleIntent["sellerCollection"];
  units: number;
  proceedsLocal: number;
  poolCurrency: CurrencyCode;
  payoutInc: Record<string, number>;
}

/** Stable per-leg operation identity, mirroring moneyMove's legStamp. */
export function bondSaleLegStamp(intentId: ObjectId, leg: BondSaleLeg | "claim"): string {
  return `${intentId.toHexString()}#${leg}`;
}

/**
 * Record the intent BEFORE any value moves. The returned document's `_id` is
 * the stable operation identity the claim, pool, and payout stamps derive from.
 */
export async function createBondSaleIntent(
  db: Db,
  input: CreateBondSaleIntentInput
): Promise<BondSaleIntent> {
  const now = new Date();
  const intent: BondSaleIntent = {
    _id: new ObjectId(),
    ...input,
    status: "claimed",
    claimApplied: false,
    poolDebited: false,
    payoutApplied: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<BondSaleIntent>(BOND_SALE_INTENT_COLLECTION).insertOne(intent);
  return intent;
}

/** Every intent for this holder on this bond that never reached a terminal state. */
export async function loadPendingBondSaleIntents(
  db: Db,
  bondId: ObjectId,
  holderKey: BondSaleHolderKey,
  holderId: ObjectId
): Promise<BondSaleIntent[]> {
  return db
    .collection<BondSaleIntent>(BOND_SALE_INTENT_COLLECTION)
    .find({ bondId, holderKey, holderId, status: "claimed" })
    .toArray();
}

async function markBondSaleIntent(
  db: Db,
  intentId: ObjectId,
  update: Partial<
    Pick<BondSaleIntent, "status" | "claimApplied" | "poolDebited" | "payoutApplied" | "error">
  >
): Promise<void> {
  await db
    .collection<BondSaleIntent>(BOND_SALE_INTENT_COLLECTION)
    .updateOne({ _id: intentId }, { $set: { ...update, updatedAt: new Date() } });
}

/**
 * Best-effort terminal marking. A failed marking write must never mask the
 * sale error it follows, so callers on failure paths swallow (with a report)
 * rather than throw.
 */
export async function markBondSaleIntentBestEffort(
  db: Db,
  intentId: ObjectId,
  update: Partial<
    Pick<BondSaleIntent, "status" | "claimApplied" | "poolDebited" | "payoutApplied" | "error">
  >,
  report: (error: unknown) => void
): Promise<void> {
  try {
    await markBondSaleIntent(db, intentId, update);
  } catch (error) {
    report(error);
  }
}

export type BondSaleResumeOutcome = "applied" | "reverted";

/**
 * The guarded writes one resume step needs. All amounts come from the stored
 * intent, never from a fresh quote, so resume replays the original terms.
 */
export interface BondSaleSettlementOps {
  /**
   * Whether the holder element still carries this intent's claim stamp. A
   * landed claim always carries it (same write), so absent means the claim
   * never landed and no later leg can have either.
   */
  claimLanded(): Promise<boolean>;
  /**
   * Guarded pool debit. `already` when the pool stamp proves an earlier
   * attempt landed; `refused` when the pool cannot cover the amount.
   */
  debitPool(stamp: string): Promise<"applied" | "already" | "refused">;
  /**
   * Guarded seller payout. `already` when the payout stamp proves an earlier
   * attempt landed; `missing` when the seller document is gone.
   */
  paySeller(stamp: string): Promise<"applied" | "already" | "missing">;
  /** Guarded claim restore: a no-op unless the claim stamp is still present. */
  restoreClaim(): Promise<void>;
  /** Pool refund, applied only when the pool stamp proves the debit landed. */
  refundPool(): Promise<void>;
}

/**
 * Drive one intent to a terminal state from any crash point. Every leg is
 * guarded by its stamp, so legs that landed before the crash verify as landed
 * without moving anything twice. Returns `applied` when the seller was paid
 * exactly once, `reverted` when the claim was safely restored.
 */
export async function advanceBondSaleIntent(
  db: Db,
  intent: BondSaleIntent,
  ops: BondSaleSettlementOps,
  options: { claimConfirmed?: boolean } = {}
): Promise<BondSaleResumeOutcome> {
  if (intent.status === "applied") return "applied";
  if (intent.status === "reverted" || intent.status === "rejected") return "reverted";

  if (!options.claimConfirmed && !(await ops.claimLanded())) {
    // The claim may have been restored before a crash while the pool refund
    // was still outstanding. Refund is stamp-guarded, so it is also safe when
    // the claim write never landed and no pool debit exists.
    await ops.refundPool();
    await markBondSaleIntent(db, intent._id, {
      status: "rejected",
      error: "claim write never landed",
    });
    return "reverted";
  }
  if (!intent.claimApplied) {
    await markBondSaleIntent(db, intent._id, { claimApplied: true });
  }

  const poolStamp = bondSaleLegStamp(intent._id, "pool");
  const poolResult = intent.poolDebited ? "already" : await ops.debitPool(poolStamp);
  if (poolResult === "refused") {
    await ops.restoreClaim();
    await markBondSaleIntent(db, intent._id, {
      status: "reverted",
      poolDebited: false,
      error: "pool could not cover the sale on resume; claim restored",
    });
    return "reverted";
  }
  if (!intent.poolDebited) {
    await markBondSaleIntent(db, intent._id, { poolDebited: true });
  }

  const payoutStamp = bondSaleLegStamp(intent._id, "payout");
  const payoutResult = intent.payoutApplied ? "already" : await ops.paySeller(payoutStamp);
  if (payoutResult === "missing") {
    await ops.restoreClaim();
    await ops.refundPool();
    await markBondSaleIntent(db, intent._id, {
      status: "reverted",
      payoutApplied: false,
      error: "seller missing on resume; claim restored and pool refunded",
    });
    return "reverted";
  }
  await markBondSaleIntent(db, intent._id, {
    status: "applied",
    poolDebited: true,
    payoutApplied: true,
  });
  return "applied";
}

export interface BondSaleRepairRow {
  intentId: string;
  bondId: string;
  holderKey: BondSaleHolderKey;
  holderId: string;
  units: number;
  proceedsLocal: number;
  claimApplied: boolean;
  poolDebited: boolean;
  payoutApplied: boolean;
  error?: string;
}

/**
 * Everything that started and did not finish. Read-only on purpose, mirroring
 * `listUnfinishedMoneyMoves`: a half-applied sale is a visible hole, not a
 * silent one.
 */
export async function listUnfinishedBondSales(
  db: Db,
  options: { limit?: number } = {}
): Promise<BondSaleRepairRow[]> {
  const rows = await db
    .collection<BondSaleIntent>(BOND_SALE_INTENT_COLLECTION)
    .find({ status: "claimed" })
    .sort({ createdAt: 1 })
    .limit(Math.max(1, options.limit ?? 100))
    .toArray();
  return rows.map((row) => ({
    intentId: row._id.toHexString(),
    bondId: row.bondId.toHexString(),
    holderKey: row.holderKey,
    holderId: row.holderId.toHexString(),
    units: row.units,
    proceedsLocal: row.proceedsLocal,
    claimApplied: row.claimApplied,
    poolDebited: row.poolDebited,
    payoutApplied: row.payoutApplied,
    error: row.error,
  }));
}

/** Read helper for a guarded stamp check on an arbitrary balance document. */
export async function documentHasStamp(
  db: Db,
  collection: string,
  filter: Record<string, unknown>,
  stamp: string
): Promise<boolean> {
  const landed = await db
    .collection(collection)
    .findOne({ ...filter, [SETTLED_KEYS_FIELD]: stamp } as Filter<Document>, {
      projection: { _id: 1 },
    });
  return landed !== null;
}

/** The `$push` fragment that stamps a guarded write, mirroring moneyMove legs. */
export function settledKeyPush(stamp: string): Record<string, unknown> {
  return { [SETTLED_KEYS_FIELD]: { $each: [stamp], $slice: -SETTLED_KEYS_CAP } };
}
