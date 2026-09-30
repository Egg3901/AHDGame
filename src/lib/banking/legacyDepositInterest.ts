/**
 * Legacy bank savings interest credits each saver from a fixed payment plan.
 * Bank cash, saver balances and transaction records carry receipts, so an
 * interrupted batch resumes without changing its original allocations.
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ObjectId, type Db, type Document } from "mongodb";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { deriveLedgerEntries } from "@/lib/ledger/deriveFromTx";
import { finalizeLedgerEntry } from "@/lib/ledger/emit";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { buildTxDocs, loadAnchorRateMap, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import type { TxInput } from "@/lib/financialTxLog/emit";
import {
  claimMoneyMove,
  MONEY_MOVE_COLLECTION,
  SETTLED_KEYS_CAP,
  SETTLED_KEYS_FIELD,
  legStamp,
} from "./moneyMove";
import type { SettlementResult } from "./settlementJournal";

interface Credit {
  characterId: ObjectId;
  amount: number;
  name: string;
}
interface Plan {
  bankId: ObjectId;
  bankGuard: Document;
  currency: CurrencyCode;
  credits: Credit[];
  paid: number;
  npcInterestPaid: number;
  shortfall: number;
  receipts: Document[];
  ledgerReceipts: Document[];
}
interface InterestRecord extends Document {
  _id: string;
  status: string;
  legacyInterestBatch?: Plan;
}
interface InterestBalanceDocument {
  _id: ObjectId;
  settledKeys?: string[];
}
export interface LegacyInterestResult {
  paid: number;
  npcInterestPaid: number;
  shortfall: number;
  newlyDebited: number;
  newlyCredited: Map<string, number>;
}

export async function settleLegacyDepositInterest(
  db: Db,
  input: {
    key: string;
    bankId: ObjectId;
    bankName: string;
    currency: CurrencyCode;
    charteredTurn: number;
    turn: number;
    credits: Credit[];
    npcInterestPaid: number;
    ratePercent: number;
    shortfall?: number;
  }
): Promise<LegacyInterestResult> {
  const journal = db.collection<InterestRecord>(MONEY_MOVE_COLLECTION);
  let original = await journal.findOne({ _id: input.key });
  if (!original && input.credits.length) {
    const paid = input.credits.reduce((sum, credit) => sum + credit.amount, 0);
    if (
      !Number.isFinite(paid) ||
      input.credits.some((credit) => !Number.isFinite(credit.amount) || credit.amount <= 0)
    )
      throw new Error("Invalid legacy deposit interest allocations");
    if (
      new Set(input.credits.map((credit) => credit.characterId.toHexString())).size !==
      input.credits.length
    )
      throw new Error("Duplicate legacy deposit interest recipient");
    const now = new Date();
    const entries: TxInput[] = input.credits.map((credit) => ({
      type: "bank_deposit_interest",
      turn: input.turn,
      createdAt: now,
      subjectType: "character",
      subjectId: credit.characterId,
      subjectName: credit.name,
      amount: credit.amount,
      currencyCode: input.currency,
      counterpartyType: "corporation",
      counterpartyId: input.bankId,
      counterpartyName: input.bankName,
      meta: { ratePercent: input.ratePercent, settlementKey: input.key },
    }));
    const [thresholds, cadence, rates, config] = await Promise.all([
      loadTxThresholds(db),
      loadTurnLengthMinutes(db),
      loadAnchorRateMap(db, entries),
      db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { ledgerShadow: 1 } }),
    ]);
    const receipts = buildTxDocs(entries, thresholds, cadence, rates).map((entry, i) => {
      entry._id = new ObjectId(
        createHash("sha256").update(`${input.key}:tx:${i}`).digest("hex").slice(0, 24)
      );
      const rate = rates.get(input.currency);
      if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
        delete entry.anchorAmount;
        entry.meta = { ...entry.meta, anchorValuation: "unavailable" };
      }
      return { ...entry };
    });
    const ledgerReceipts =
      config?.ledgerShadow === true
        ? deriveLedgerEntries(receipts, "banking/legacyDepositInterest:journal").map(
            (entry, i) => ({
              ...finalizeLedgerEntry(entry),
              _id: new ObjectId(
                createHash("sha256").update(`${input.key}:ledger:${i}`).digest("hex").slice(0, 24)
              ),
            })
          )
        : [];
    const bankGuard = {
      _id: input.bankId,
      "bankCharter.status": "active",
      "bankCharter.currency": input.currency,
      "bankCharter.charteredTurn": input.charteredTurn,
    };
    const plan: Plan = {
      bankId: input.bankId,
      bankGuard,
      currency: input.currency,
      credits: input.credits,
      paid,
      npcInterestPaid: input.npcInterestPaid,
      shortfall: input.shortfall ?? 0,
      receipts,
      ledgerReceipts,
    };
    const claim = await claimMoneyMove(db, {
      key: input.key,
      kind: "deposit_interest",
      turn: input.turn,
      legs: [
        {
          kind: "debit",
          amount: paid,
          collection: "corporations",
          filter: bankGuard,
          path: "bankCharter.cashReserves",
          note: "Legacy savings interest leaves bank cash",
        },
        ...input.credits.map((credit) => ({
          kind: "credit" as const,
          amount: credit.amount,
          collection: "characters",
          filter: { _id: credit.characterId },
          path: `currencyBalances.savings.${input.currency}`,
          note: "Original saver interest allocation",
        })),
      ],
      record: { legacyInterestBatch: plan },
    });
    if (claim.status === "rejected") throw new Error(claim.error);
    original = await journal.findOne({ _id: input.key });
    if (!original) throw new Error("Claimed legacy interest journal is unavailable");
  }
  if (!original)
    return {
      paid: 0,
      shortfall: input.shortfall ?? 0,
      npcInterestPaid: input.npcInterestPaid,
      newlyDebited: 0,
      newlyCredited: new Map(),
    };
  if (!original.legacyInterestBatch)
    throw new Error("Legacy deposit interest has no durable allocations; manual recovery required");
  return deliverLegacyDepositInterest(db, original);
}

async function deliverLegacyDepositInterest(
  db: Db,
  record: InterestRecord
): Promise<LegacyInterestResult> {
  const plan = record.legacyInterestBatch!;
  const result: LegacyInterestResult = {
    paid: plan.paid,
    shortfall: plan.shortfall,
    npcInterestPaid: plan.npcInterestPaid,
    newlyDebited: 0,
    newlyCredited: new Map(),
  };
  if (record.status === "applied") return result;
  const recipients = await db
    .collection<InterestBalanceDocument>("characters")
    .find(
      { _id: { $in: plan.credits.map((credit) => credit.characterId) } },
      { projection: { [SETTLED_KEYS_FIELD]: 1 } }
    )
    .toArray();
  const before = new Map(recipients.map((row) => [String(row._id), row]));
  if (before.size !== plan.credits.length)
    throw new Error("Legacy interest recipient missing; original allocation retained for recovery");
  const bankStamp = legStamp(record._id, 0);
  const bank = db.collection<InterestBalanceDocument>("corporations");
  const debited = await bank.updateOne(
    {
      ...plan.bankGuard,
      "bankCharter.cashReserves": { $gte: plan.paid },
      [SETTLED_KEYS_FIELD]: { $ne: bankStamp },
    },
    {
      $inc: { "bankCharter.cashReserves": -plan.paid },
      $push: { [SETTLED_KEYS_FIELD]: { $each: [bankStamp], $slice: -SETTLED_KEYS_CAP } },
      $set: { updatedAt: new Date() },
    }
  );
  if (debited.matchedCount === 1) result.newlyDebited = plan.paid;
  else if (
    !(await bank.findOne(
      { _id: plan.bankId, [SETTLED_KEYS_FIELD]: bankStamp },
      { projection: { _id: 1 } }
    ))
  )
    throw new Error("Bank could not fund the original legacy interest allocation");

  await db.collection<InterestBalanceDocument>("characters").bulkWrite(
    plan.credits.map((credit, i) => ({
      updateOne: {
        filter: {
          _id: credit.characterId,
          [SETTLED_KEYS_FIELD]: { $ne: legStamp(record._id, i + 1) },
        },
        update: {
          $inc: {
            [`currencyBalances.savings.${plan.currency}`]: credit.amount,
            [`currencyBalances.interestEarned.${plan.currency}`]: credit.amount,
          },
          $push: {
            [SETTLED_KEYS_FIELD]: {
              $each: [legStamp(record._id, i + 1)],
              $slice: -SETTLED_KEYS_CAP,
            },
          },
          $set: { updatedAt: new Date() },
        },
      },
    })),
    { ordered: false }
  );
  const after = await db
    .collection<InterestBalanceDocument>("characters")
    .find(
      { _id: { $in: plan.credits.map((credit) => credit.characterId) } },
      { projection: { [SETTLED_KEYS_FIELD]: 1 } }
    )
    .toArray();
  const delivered = new Map(after.map((row) => [String(row._id), row]));
  for (const [i, credit] of plan.credits.entries()) {
    const stamp = legStamp(record._id, i + 1),
      id = credit.characterId.toHexString();
    if (!(delivered.get(id)?.[SETTLED_KEYS_FIELD] ?? []).includes(stamp))
      throw new Error(
        "Legacy interest batch incomplete; original allocations retained for recovery"
      );
    if (!(before.get(id)?.[SETTLED_KEYS_FIELD] ?? []).includes(stamp))
      result.newlyCredited.set(id, credit.amount);
  }
  await persistReceipts(db, "financialTxLog", plan.receipts);
  await persistReceipts(db, "ledgerEntries", plan.ledgerReceipts);
  await db.collection<InterestRecord>(MONEY_MOVE_COLLECTION).updateOne(
    { _id: record._id },
    {
      $set: {
        status: "applied",
        completedAt: new Date(),
        ...Object.fromEntries(
          [0, ...plan.credits.map((_, i) => i + 1)].map((i) => [`legs.${i}.applied`, true])
        ),
      },
    }
  );
  return result;
}

async function persistReceipts(db: Db, collection: string, receipts: Document[]): Promise<void> {
  if (!receipts.length) return;
  await db.collection(collection).bulkWrite(
    receipts.map((receipt) => ({
      updateOne: {
        filter: { _id: receipt._id },
        update: { $setOnInsert: receipt },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  const persisted = await db
    .collection(collection)
    .find({ _id: { $in: receipts.map((receipt) => receipt._id) } })
    .toArray();
  const byId = new Map(persisted.map((receipt) => [String(receipt._id), receipt]));
  if (receipts.some((receipt) => !isDeepStrictEqual(receipt, byId.get(String(receipt._id)))))
    throw new Error(`Legacy interest ${collection} receipt conflicts with original plan`);
}

/** The journal worker uses this path, never a per-leg reinterpretation of the batch. */
export async function resumeLegacyDepositInterest(db: Db, key: string): Promise<SettlementResult> {
  const record = await db.collection<InterestRecord>(MONEY_MOVE_COLLECTION).findOne({ _id: key });
  const empty: SettlementResult = {
    key,
    status: "partial",
    appliedLegs: [],
    appliedProjections: [],
    newlyAppliedProjections: [],
  };
  if (!record?.legacyInterestBatch) return { ...empty, error: "No durable legacy interest batch" };
  try {
    await deliverLegacyDepositInterest(db, record);
    return {
      ...empty,
      status: record.status === "applied" ? "replayed" : "applied",
      appliedLegs: [0, ...record.legacyInterestBatch.credits.map((_, i) => i + 1)],
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
  }
}
