/**
 * NPP capacity builds enter financial history only after their cash write lands.
 * Atomic corporation stamps admit exact build costs; repeat publication reuses
 * transaction ids and cannot charge the ledger twice.
 */
import * as Sentry from "@sentry/nextjs";
import type { Db, ObjectId } from "mongodb";
import { buildCapexTxEntry, type BuildCapexTxInput } from "@/lib/corporations/capexTxLog";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { buildAuditEnvelope, buildTxDocs, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import { recordAuditBulk } from "@/lib/audit/recordAudit";
import { deriveLedgerEntry } from "@/lib/ledger/deriveFromTx";
import { isAnchorBalanced } from "@/lib/ledger/epsilon";
import type { LedgerEntry } from "@/lib/ledger/types";
import type { NppCorpUpdateOp } from "./nppCashWrite";

export interface NppReinvestmentCashWitness {
  corporationId: ObjectId;
  key: string;
  transactions: FinancialTxLogEntry[];
  shadowEnabled: boolean;
}

/** Prepare the original transaction documents without publishing an uncommitted debit. */
export async function prepareNppReinvestmentCashWitnesses(
  db: Db,
  rows: BuildCapexTxInput[],
  cashOperations: NppCorpUpdateOp[],
  shadowEnabled: boolean
): Promise<NppReinvestmentCashWitness[]> {
  if (rows.length === 0) return [];
  try {
    const thresholds = await loadTxThresholds(db);
    const turnLengthMinutes = await loadTurnLengthMinutes(db);
    // Every capex row already carries its accepted native and anchor amounts.
    const docs = buildTxDocs(rows.map(buildCapexTxEntry), thresholds, turnLengthMinutes, new Map());
    const byCorporation = new Map<string, FinancialTxLogEntry[]>();
    for (const doc of docs) {
      const id = doc.subjectId!.toHexString();
      const group = byCorporation.get(id) ?? [];
      group.push(doc);
      byCorporation.set(id, group);
    }
    const pending: NppReinvestmentCashWitness[] = [];
    for (const operation of cashOperations) {
      const transactions = byCorporation.get(operation.filter._id.toHexString());
      if (!transactions) continue;
      const key = transactions[0]._id.toHexString();
      operation.update.$set = {
        ...operation.update.$set,
        nppReinvestmentCashWitnessKey: key,
      };
      pending.push({ corporationId: operation.filter._id, key, transactions, shadowEnabled });
      byCorporation.delete(operation.filter._id.toHexString());
    }
    return pending;
  } catch (error) {
    Sentry.captureException(error, { extra: { phase: "prepareNppReinvestmentCashWitnesses" } });
    return [];
  }
}

/** One projected admission read and idempotent batches, even after ordered cash failures. */
export async function flushNppReinvestmentCashWitnesses(
  db: Db,
  pending: readonly NppReinvestmentCashWitness[]
): Promise<void> {
  if (pending.length === 0) return;
  try {
    const corporations = await db
      .collection<{ _id: ObjectId; nppReinvestmentCashWitnessKey?: string }>("corporations")
      .find(
        {
          _id: { $in: pending.map((row) => row.corporationId) },
          nppReinvestmentCashWitnessKey: { $in: pending.map((row) => row.key) },
        },
        { projection: { _id: 1, nppReinvestmentCashWitnessKey: 1 } }
      )
      .toArray();
    const keys = new Map(
      corporations.map((row) => [row._id.toHexString(), row.nppReinvestmentCashWitnessKey])
    );
    const landed = pending.filter((row) => keys.get(row.corporationId.toHexString()) === row.key);
    const transactions = landed.flatMap((row) => row.transactions);
    if (transactions.length === 0) return;
    const result = await db.collection<FinancialTxLogEntry>("financialTxLog").bulkWrite(
      transactions.map((doc) => ({
        updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true },
      })),
      { ordered: false }
    );
    const entries = landed.flatMap((row) =>
      row.shadowEnabled
        ? row.transactions.flatMap((doc): LedgerEntry[] => {
            const entry = deriveLedgerEntry(doc);
            return entry
              ? [
                  {
                    ...entry,
                    _id: doc._id,
                    balanced: isAnchorBalanced(entry.legs),
                    sourceRef: { collection: "financialTxLog", id: doc._id },
                  },
                ]
              : [];
          })
        : []
    );
    if (entries.length > 0) {
      await db.collection<LedgerEntry>("ledgerEntries").bulkWrite(
        entries.map((entry) => ({
          updateOne: { filter: { _id: entry._id }, update: { $setOnInsert: entry }, upsert: true },
        })),
        { ordered: false }
      );
    }
    // Only newly admitted history rows emit a new audit event on a replay.
    recordAuditBulk(
      Object.keys(result.upsertedIds).map((index) =>
        buildAuditEnvelope(transactions[Number(index)])
      )
    );
  } catch (error) {
    Sentry.captureException(error, { extra: { phase: "flushNppReinvestmentCashWitnesses" } });
  }
}
