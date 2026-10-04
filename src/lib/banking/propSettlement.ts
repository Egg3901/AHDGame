/** Prop cash and positions settle together against the observed charter and revision. */
import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import { buildTxDocs, loadTxThresholds, loadAnchorRateMap } from "@/lib/financialTxLog/emit";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import type { TxInput } from "@/lib/financialTxLog/emit";
import type { BankCharter, PropPosition } from "@/lib/db/types/bank";
import { settleAtomicDocumentTransition } from "./atomicDocumentSettlement";
import { propSettlementTransition } from "./rules/propSettlement";
import { oid } from "./rules/boundary";
import { emitBankingAuditEvent } from "./auditEvents";
import type { PropForexFeeReceipt, PropForexVolume } from "./rules/propForexFees";
import { settlePendingPropForexFee } from "./propForexFees";
import { logWarning } from "@/lib/utils/errorLog";

export async function settlePropBookChange(
  db: Db,
  input: {
    bankId: ObjectId;
    bankName?: string;
    meta?: Record<string, string | number>;
    charter: BankCharter;
    revision?: number;
    operation: string;
    turn: number;
    cashDelta: number;
    nextBook: PropPosition[];
    nextMark: number;
    forexFee?: PropForexFeeReceipt;
    forexVolume?: PropForexVolume[];
  }
): Promise<{ ok: boolean; replayed: boolean; key: string }> {
  const revision = input.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error("Invalid prop-book revision");
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        operation: input.operation,
        cashDelta: input.cashDelta,
        nextBook: input.nextBook,
        nextMark: input.nextMark,
        forexFee: input.forexFee,
        forexVolume: input.forexVolume,
      })
    )
    .digest("hex")
    .slice(0, 24);
  const key = `bank.prop:${input.bankId.toHexString()}:${revision}:${digest}`;
  const identity = { _id: oid(input.bankId.toHexString()) };
  const guard = {
    bankCharter: input.charter,
    bankPropBookRevision: input.revision === undefined ? { $exists: false } : input.revision,
    ...(input.forexFee ? { bankPropForexFee: { $exists: false } } : {}),
  };
  const transition = propSettlementTransition({
    ...input,
    bankId: input.bankId.toHexString(),
    key,
    currency: input.charter.currency,
    nextRevision: revision + 1,
    now: new Date(),
    ...(input.forexFee ? { forexFee: { ...input.forexFee, key: `${key}:forex-fee` } } : {}),
  });
  if (input.cashDelta === 0) {
    // An unpriced/zero-value book cleanup moves no money. Preserve its existing
    // semantics while refusing to overwrite any intervening charter change.
    const result = await db
      .collection("corporations")
      .updateOne({ _id: input.bankId, ...guard }, transition.projections[0].update!);
    return { ok: result.matchedCount === 1, replayed: false, key };
  }
  const entry: TxInput = {
    type: input.cashDelta < 0 ? "bank_prop_trade_buy" : "bank_prop_trade_sell",
    turn: input.turn,
    createdAt: new Date(),
    subjectType: "corporation",
    subjectId: input.bankId,
    subjectName: input.bankName ?? input.bankId.toHexString(),
    amount: input.cashDelta,
    currencyCode: input.charter.currency,
    counterpartyType: "system",
    counterpartyName: "Prop book",
    meta: {
      ...input.meta,
      bankVaultMovement: true,
      settlementKey: key,
      ...(input.forexFee ? { forexFee: input.forexFee.feeLocal } : {}),
    },
  };
  const [thresholds, cadence, rates] = await Promise.all([
    loadTxThresholds(db),
    loadTurnLengthMinutes(db),
    loadAnchorRateMap(db, [entry]),
  ]);
  const [document] = buildTxDocs([entry], thresholds, cadence, rates);
  const observedRate = rates.get(input.charter.currency);
  if (observedRate === undefined || !Number.isFinite(observedRate) || observedRate <= 0) {
    delete document.anchorAmount;
    document.meta = { ...document.meta, anchorValuation: "unavailable" };
  }

  document._id = new ObjectId(createHash("sha256").update(`${key}:tx`).digest("hex").slice(0, 24));
  transition.projections.push({
    collection: "financialTxLog",
    insert: { ...document },
    note: "Original prop transaction receipt",
  });
  const result = await settleAtomicDocumentTransition(db, transition, { identity, guard });
  const ok = !result.error && (result.status === "applied" || result.status === "replayed");
  // A funded trade is final even if a downstream fee leg needs recovery.
  // Its escrow remains outside the replaceable charter and blocks another trade.
  if (ok && input.forexFee?.feeLocal) {
    try {
      await settlePendingPropForexFee(db, input.bankId);
    } catch (error) {
      logWarning("Funded forex fee awaits recovery", {
        component: "BankPropTrading",
        metadata: { settlementKey: key, error: String(error) },
      });
    }
  }
  emitBankingAuditEvent(
    {
      ...transition.event,
      turn: input.turn,
      outcome: ok ? "ok" : "rejected",
      currency: input.charter.currency,
      bankId: input.bankId.toHexString(),
      settlementId: key,
      ...(result.error ? { reason: result.error } : {}),
    },
    db
  );
  return { ok, replayed: result.status === "replayed", key };
}
