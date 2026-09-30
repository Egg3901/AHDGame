import { createHash } from "node:crypto";
import { ObjectId, type Db, type Document } from "mongodb";
import type { GameConfig, IndexFundTransaction } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { buildTxDocs, loadTxThresholds, type TxInput } from "@/lib/financialTxLog/emit";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import { deriveLedgerEntries } from "@/lib/ledger/deriveFromTx";
import { finalizeLedgerEntry } from "@/lib/ledger/emit";
import { prepareAuditRecord } from "@/lib/audit/recordAudit";

/** Original native amounts are frozen with completion, never recalculated from current FX. */
export interface FundCommandAudit {
  fundId: ObjectId;
  fundName: string;
  fundSlug: string;
  fundTicker: string;
  currencyCode: CurrencyCode;
  holderId: ObjectId;
  holderName: string;
  turn: number;
  entries: Array<{ transactionId: ObjectId; amountNative: number; balanceAfter?: number }>;
}

interface AuditPlan {
  rows: Array<{ collection: string; document: Document & { _id: ObjectId } }>;
}
interface Receipt extends Document {
  _id: string;
  state: string;
  audit?: FundCommandAudit;
  auditPlan?: AuditPlan;
  auditCompletedAt?: Date;
}

function derivedId(id: ObjectId, kind: string): ObjectId {
  return new ObjectId(createHash("sha256").update(`fund:${id}:${kind}`).digest("hex").slice(0, 24));
}

/** Completed orders replay only their audit outbox, never their financial operation. */
export async function resumeFundCommandAudit(db: Db, key: string): Promise<void> {
  const commands = db.collection<Receipt>("indexFundCommands");
  let receipt = await commands.findOne({ _id: key });
  if (receipt?.state !== "completed" || !receipt.audit || receipt.auditCompletedAt) return;
  if (!receipt.auditPlan) {
    const audit = receipt.audit;
    const [thresholds, turnLength, config] = await Promise.all([
      loadTxThresholds(db),
      loadTurnLengthMinutes(db),
      db.collection<GameConfig>("gameConfig").findOne({ _id: "default" }),
    ]);
    const inputs: TxInput[] = [];
    for (const entry of audit.entries) {
      const transaction = await db
        .collection<IndexFundTransaction>("indexFundTransactions")
        .findOne({
          _id: entry.transactionId,
          fundId: audit.fundId,
          characterId: audit.holderId,
          holderKind: "character",
          kind: { $in: ["subscription", "redemption"] },
        });
      if (!transaction) throw new Error("Fund command audit witness is missing");
      const sign = transaction.kind === "subscription" ? -1 : 1;
      if (!Number.isFinite(entry.amountNative) || Math.sign(entry.amountNative) !== sign)
        throw new Error("Fund command audit amount disagrees with its transaction");
      inputs.push({
        type: sign < 0 ? "index_fund_subscribe" : "index_fund_redeem",
        turn: audit.turn,
        createdAt: transaction.createdAt,
        subjectType: "character",
        subjectId: audit.holderId,
        subjectName: audit.holderName,
        amount: entry.amountNative,
        anchorAmount: sign * transaction.amountAnchor,
        balanceAfter: entry.balanceAfter,
        currencyCode: audit.currencyCode,
        counterpartyType: "system",
        counterpartyName: audit.fundName,
        meta: {
          fundId: audit.fundId.toHexString(),
          fundName: audit.fundName,
          fundSlug: audit.fundSlug,
          fundTicker: audit.fundTicker,
          fundCurrency: audit.currencyCode,
          units: transaction.units,
          navAnchor: transaction.navAnchor,
          source: "player",
          commandId: key,
          fundTransactionId: transaction._id.toHexString(),
        },
      });
    }
    const rows: AuditPlan["rows"] = [];
    const docs = buildTxDocs(inputs, thresholds, turnLength, new Map());
    for (const [index, doc] of docs.entries()) {
      // One canonical fund transaction has exactly one corresponding financial row.
      doc._id = audit.entries[index].transactionId;
      rows.push({ collection: "financialTxLog", document: doc });
      if (config?.ledgerShadow === true) {
        for (const [leg, input] of deriveLedgerEntries([doc]).entries()) {
          rows.push({
            collection: "ledgerEntries",
            document: {
              ...finalizeLedgerEntry(input),
              _id: derivedId(doc._id, `ledger:${leg}`),
            },
          });
        }
      }
      if (config?.auditLog !== false) {
        rows.push({
          collection: "actionAuditLog",
          document: {
            ...prepareAuditRecord(
              {
                source: "system",
                action: doc.type === "index_fund_subscribe" ? "fund.buy" : "fund.sell",
                category: "money",
                subject: { type: "character", id: audit.holderId, name: audit.holderName },
                amount: doc.amount,
                currencyCode: doc.currencyCode,
                anchorAmount: doc.anchorAmount,
                meta: doc.meta,
                refs: { financialTxLogId: doc._id },
                outcome: "ok",
              },
              { turn: audit.turn, ts: doc.createdAt, turnLengthMinutes: turnLength }
            ),
            _id: derivedId(doc._id, "audit"),
          },
        });
      }
    }
    // Freeze flags, retention timestamps and every derived document before delivery.
    await commands.updateOne(
      { _id: key, state: "completed", auditPlan: { $exists: false } },
      {
        $set: { auditPlan: { rows } },
      }
    );
    receipt = await commands.findOne({ _id: key });
  }
  if (!receipt?.auditPlan) throw new Error("Fund command audit plan is unavailable");
  for (const row of receipt.auditPlan.rows) {
    await db.collection(row.collection).updateOne(
      { _id: row.document._id },
      {
        $setOnInsert: row.document,
      },
      { upsert: true }
    );
  }
  await commands.updateOne(
    { _id: key, state: "completed" },
    { $set: { auditCompletedAt: new Date() } }
  );
}
