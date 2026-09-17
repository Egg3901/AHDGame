import * as Sentry from "@sentry/nextjs";
import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { sumStrengthGrants, type TechTreeNode } from "@/lib/constants/techTree";
import type { ActionAuditInput, Corporation, FinancialTxLogEntry } from "@/lib/db/types";
import { emitTxStrict, loadTxThresholds, type TxInput } from "@/lib/financialTxLog/emit";

/**
 * Finance-history ledger rows for sector tech-tree unlocks (ticket #1998).
 *
 * Both unlock entry points debit `liquidCapital` through a guarded,
 * once-only write — the player command's `updateOne` in
 * `commands/techTree/unlockTechNode.ts` and the NPP brain's bulkWrite op in
 * `turn/npp/corpBehaviorConfig.ts`. Neither wrote a matching finance-history
 * row, so a corp could lose most of its cash while every visible entry showed
 * a gain. This module is the shared boundary both paths use:
 *
 * - `buildTechUnlockTxEntry` (pure) builds the exact debit row: negative
 *   `amount` equal to the cash cost, the corp's own currency, the turn, and
 *   the technology's identity in `meta`.
 * - `emitTxStrict` persists it with bounded retries and THROWS on persistent
 *   failure, so a committed debit can never go silently invisible. An
 *   applied-but-unacknowledged insert is adopted (verified field-by-field),
 *   not rolled back.
 * - `buildTechUnlockRefundUpdate` (pure) reverses one committed unlock for
 *   the compensating refund when the ledger insert persistently fails:
 *   rolled-back unlocks then show neither a cash debit nor a ledger row.
 *
 * Ordering rule (both paths): the guarded cash write commits FIRST, the
 * ledger row is emitted only after the write provably applied
 * (`modifiedCount > 0` / post-bulkWrite verification read). A rejected or
 * raced unlock never reaches the emit, so failures create no row.
 *
 * Idempotency: `financialTxLog` carries no unique idempotency index, so the
 * once-only cash write IS the dedupe — a retry of a successful manual unlock
 * hits the `already-owned` guard, and the NPP flush re-checks the committed
 * node set plus existing rows before emitting. The stable
 * `meta.ledgerKey` still lets forensics match a row to its unlock.
 */

/** One intended (decision-time) tech unlock awaiting ledger flush. */
export interface TechUnlockLedgerInput {
  corporationId: ObjectId;
  corporationName: string;
  corporationSequentialId?: number;
  nodeId: string;
  nodeName: string;
  decadeId: string;
  lane: string;
  slot: number;
  /** rdScore price of the node (for forensics; the wallet spend is not cash). */
  rdCost: number;
  /** Exact cash debited from `liquidCapital`, in `currencyCode`. */
  cashCost: number;
  currencyCode: CurrencyCode;
  turn: number;
  createdAt: Date;
  /** `unlockedTechNodeIds` snapshot taken before the cash write applied. */
  alreadyOwned: string[];
  /** One-time strength grants applied alongside the debit (refund reverses). */
  marketingGrant?: number;
  logisticsGrant?: number;
  /** True when this unlock created the decade lane commitment. */
  committing?: boolean;
}

/** Stable cross-reference stamped on the row so forensics can match it back. */
export function techUnlockLedgerKey(corporationId: ObjectId, nodeId: string, turn: number): string {
  return `tech-unlock:${corporationId.toString()}:${nodeId}:t${turn}`;
}

/**
 * Build the finance-history debit row for one committed unlock. Pure — no DB
 * access — so both the player command and the turn flush share it exactly.
 * `anchorAmount` is deliberately omitted: the emit path derives it from the
 * live FX table, the same convention every other corp emitter uses.
 */
export function buildTechUnlockTxEntry(input: TechUnlockLedgerInput): TxInput {
  return {
    type: "corp_tech_unlock",
    turn: input.turn,
    createdAt: input.createdAt,
    subjectType: "corporation",
    subjectId: input.corporationId,
    subjectName: input.corporationName,
    ...(input.corporationSequentialId !== undefined
      ? { subjectSequentialId: input.corporationSequentialId }
      : {}),
    amount: -input.cashCost,
    currencyCode: input.currencyCode,
    meta: {
      ledgerKey: techUnlockLedgerKey(input.corporationId, input.nodeId, input.turn),
      nodeId: input.nodeId,
      nodeName: input.nodeName,
      decadeId: input.decadeId,
      lane: input.lane,
      slot: input.slot,
      rdCost: input.rdCost,
    },
  };
}

export interface TechUnlockRefundSpec {
  nodeId: string;
  decadeId: string;
  rdCost: number;
  cashCost: number;
  marketingGrant?: number;
  logisticsGrant?: number;
  committing?: boolean;
}

/**
 * Build the compensating update that fully reverses one committed unlock:
 * cash and rdScore restored, node removed, decade lane commitment undone only
 * when this unlock created it. Pure — the caller supplies the `_id` filter.
 */
export function buildTechUnlockRefundUpdate(spec: TechUnlockRefundSpec): {
  $inc: Record<string, number>;
  $pull: { unlockedTechNodeIds: string };
  $unset?: Record<string, "">;
  $set: { updatedAt: Date };
} {
  const $inc: Record<string, number> = {
    rdScore: spec.rdCost,
    liquidCapital: spec.cashCost,
  };
  if ((spec.marketingGrant ?? 0) > 0) $inc.marketingStrength = -(spec.marketingGrant ?? 0);
  if ((spec.logisticsGrant ?? 0) > 0) $inc.logisticsStrength = -(spec.logisticsGrant ?? 0);
  return {
    $inc,
    $pull: { unlockedTechNodeIds: spec.nodeId },
    ...(spec.committing
      ? {
          $unset: {
            [`techDecadeLane.${spec.decadeId}`]: "",
            [`techDecadeChosenTurn.${spec.decadeId}`]: "",
          } as Record<string, "">,
        }
      : {}),
    $set: { updatedAt: new Date() },
  };
}

/** Refund spec for a node object, deriving the one-time grants from effects. */
export function refundSpecForNode(
  node: TechTreeNode,
  cashCost: number,
  committing: boolean
): TechUnlockRefundSpec {
  const grants = sumStrengthGrants(node.effects);
  return {
    nodeId: node.id,
    decadeId: node.decadeId,
    rdCost: node.cost,
    cashCost,
    marketingGrant: grants.marketingStrength,
    logisticsGrant: grants.logisticsStrength,
    committing,
  };
}

export interface TechUnlockFlushResult {
  attempted: number;
  emitted: number;
  skippedUncommitted: number;
  skippedDuplicate: number;
  refunded: number;
}

/** Build the exceptional turn-audit row without bloating the turn orchestrator. */
export function buildTechUnlockFlushAudit(result: TechUnlockFlushResult): ActionAuditInput | null {
  if (result.refunded === 0 && result.emitted === result.attempted) return null;
  return {
    source: "turn",
    category: "corp",
    action: "corp.tech_unlock_ledger",
    phase: "corporationTurn",
    subject: { type: "corpBatch", name: "npp tech-unlock ledger" },
    outcome: result.refunded > 0 ? "error" : "ok",
    meta: {
      attempted: result.attempted,
      emitted: result.emitted,
      skippedUncommitted: result.skippedUncommitted,
      skippedDuplicate: result.skippedDuplicate,
      refunded: result.refunded,
    },
  };
}

/**
 * Flush NPP tech-unlock ledger rows AFTER the corporation bulkWrite applied.
 *
 * Only unlocks verified against the post-write snapshot produce a row: the
 * node must be absent from the decision-time snapshot and present now, which
 * proves this turn's guarded op committed it (a raced/concurrent manual
 * unlock that won instead is the manual path's row to write). Rows already
 * present for the same (corp, node, turn) — a turn re-run or the manual race
 * above — are skipped, never duplicated.
 *
 * A persistently failing insert triggers the compensating refund so a debited
 * corp never keeps an invisible debit: the unlock is rolled back and counted
 * in `refunded`. Read failures on the verification queries are reported via
 * Sentry and returned as zero-emit; the cash writes they cover stay intact
 * because re-running the turn re-enters this flush idempotently.
 */
export async function flushNppTechUnlockLedger(
  db: Db,
  intended: TechUnlockLedgerInput[]
): Promise<TechUnlockFlushResult> {
  const result: TechUnlockFlushResult = {
    attempted: intended.length,
    emitted: 0,
    skippedUncommitted: 0,
    skippedDuplicate: 0,
    refunded: 0,
  };
  if (intended.length === 0) return result;

  try {
    const corpIds = [...new Set(intended.map((e) => e.corporationId.toString()))].map(
      (id) => intended.find((e) => e.corporationId.toString() === id)!.corporationId
    );
    const posts = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds } }, { projection: { unlockedTechNodeIds: 1 } })
      .toArray();
    const postOwnedByCorp = new Map(
      posts.map((c) => [c._id.toString(), new Set(c.unlockedTechNodeIds ?? [])])
    );

    const committed = intended.filter(
      (e) =>
        !e.alreadyOwned.includes(e.nodeId) &&
        (postOwnedByCorp.get(e.corporationId.toString())?.has(e.nodeId) ?? false)
    );
    result.skippedUncommitted = intended.length - committed.length;
    if (committed.length === 0) return result;

    const turns = [...new Set(committed.map((e) => e.turn))];
    const existing = await db
      .collection<FinancialTxLogEntry>("financialTxLog")
      .find(
        {
          type: "corp_tech_unlock",
          turn: { $in: turns },
          subjectId: { $in: committed.map((e) => e.corporationId) },
        },
        { projection: { subjectId: 1, turn: 1, meta: 1 } }
      )
      .toArray();
    const existingKeys = new Set(
      existing.map((row) =>
        typeof row.meta?.ledgerKey === "string"
          ? row.meta.ledgerKey
          : techUnlockLedgerKey(row.subjectId!, (row.meta?.nodeId as string) ?? "", row.turn)
      )
    );

    const thresholds = await loadTxThresholds(db);
    for (const entry of committed) {
      if (existingKeys.has(techUnlockLedgerKey(entry.corporationId, entry.nodeId, entry.turn))) {
        result.skippedDuplicate += 1;
        continue;
      }
      try {
        await emitTxStrict(db, buildTechUnlockTxEntry(entry), { thresholds });
        result.emitted += 1;
      } catch (err) {
        Sentry.captureException(err, {
          extra: {
            phase: "flushNppTechUnlockLedger",
            corpId: entry.corporationId.toString(),
            nodeId: entry.nodeId,
            turn: entry.turn,
          },
        });
        await refundUnrecordedUnlock(db, entry);
        result.refunded += 1;
      }
    }
    return result;
  } catch (err) {
    Sentry.captureException(err, { extra: { phase: "flushNppTechUnlockLedger.read" } });
    return result;
  }
}

/**
 * Compensating refund for an unlock whose cash debit committed but whose
 * ledger row could not be persisted: restores cash + rdScore, removes the
 * node, and undoes the lane commitment only when the intent record implies
 * this unlock created it. Best-effort — failures are Sentry-visible so the
 * row can be backfilled by hand; the turn itself still completes.
 */
async function refundUnrecordedUnlock(db: Db, entry: TechUnlockLedgerInput): Promise<void> {
  try {
    await db.collection<Corporation>("corporations").updateOne(
      { _id: entry.corporationId },
      buildTechUnlockRefundUpdate({
        nodeId: entry.nodeId,
        decadeId: entry.decadeId,
        rdCost: entry.rdCost,
        cashCost: entry.cashCost,
        marketingGrant: entry.marketingGrant,
        logisticsGrant: entry.logisticsGrant,
        committing: entry.committing,
      })
    );
  } catch (err) {
    Sentry.captureException(err, {
      extra: {
        phase: "refundUnrecordedUnlock",
        corpId: entry.corporationId.toString(),
        nodeId: entry.nodeId,
      },
    });
  }
}
