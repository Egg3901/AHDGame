/**
 * Append-only emitter for `TreasuryTransaction` rows. Call after the treasury
 * `$inc` succeeds so the audit log reflects committed state.
 */

import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  GameState,
  TreasuryHolderType,
  TreasuryTransaction,
  TreasuryTransactionCategory,
  TreasuryTransactionDirection,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { recordAudit, recordAuditBulk } from "@/lib/audit/recordAudit";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";

export interface EmitTreasuryTransactionArgs {
  db: Db;
  countryId: CountryId;
  partyId: string;
  holderType: TreasuryHolderType;
  /** See `TreasuryTransaction.holderId` for encoding rules. */
  holderId: string;
  category: TreasuryTransactionCategory;
  direction: TreasuryTransactionDirection;
  /** Always positive. The helper will Math.abs defensively. */
  amount: number;
  memo: string;
  counterparty?: TreasuryTransaction["counterparty"];
  initiatedBy?: TreasuryTransaction["initiatedBy"];
  /** Game turn. Resolved from gameState if omitted; pass it when you have it. */
  turn?: number;
  /** Created-at stamp. Defaults to `new Date()`. Only override in tests. */
  now?: Date;
}

export type BulkTreasuryTransactionArgs = Omit<EmitTreasuryTransactionArgs, "db">;

async function resolveFallbackTurn(
  db: Db,
  entries: BulkTreasuryTransactionArgs[]
): Promise<number> {
  if (entries.every((entry) => entry.turn != null)) return 0;
  return (
    (
      await db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } })
    )?.currentTurn ?? 0
  );
}

function buildTreasuryTransactionDoc(
  args: BulkTreasuryTransactionArgs,
  fallbackTurn: number,
  fallbackNow: Date
): TreasuryTransaction | null {
  const amount = Math.abs(args.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return null;
  }

  const currencyCode = (COUNTRY_CURRENCY_MAP[args.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
    "USD") as CurrencyCode;
  return {
    _id: new ObjectId(),
    holderType: args.holderType,
    holderId: args.holderId,
    countryId: args.countryId,
    partyId: args.partyId,
    category: args.category,
    direction: args.direction,
    amount,
    currencyCode,
    memo: args.memo,
    counterparty: args.counterparty,
    initiatedBy: args.initiatedBy,
    turn: args.turn ?? fallbackTurn,
    createdAt: args.now ?? fallbackNow,
  };
}

// Central seam for party/caucus/state-party money movement (donate, tax,
// transfer, spend, gotv, ps-investment, …) — this single helper is called
// from ~13 sites, so one audit envelope per transaction covers all of them
// (§P4 breadth). Money amount detail already lives on the `TreasuryTransaction`
// row itself (no separate financialTxLog entry for party treasury), so the
// audit envelope quick-fields (`amount`/`currencyCode`) carry it directly.
function toAuditEntry(doc: TreasuryTransaction): ActionAuditInput {
  return {
    source: "api",
    action: `party.treasury.${doc.category}`,
    category: "party",
    turn: doc.turn,
    ts: doc.createdAt,
    subject: { type: doc.holderType, id: doc.holderId },
    counterparty: doc.counterparty
      ? { type: doc.counterparty.type, id: doc.counterparty.id, name: doc.counterparty.label }
      : undefined,
    amount: doc.direction === "debit" ? -doc.amount : doc.amount,
    currencyCode: doc.currencyCode,
    outcome: "ok",
    meta: { direction: doc.direction, memo: doc.memo, countryId: doc.countryId },
  };
}

export async function emitTreasuryTransaction(
  args: EmitTreasuryTransactionArgs
): Promise<TreasuryTransaction> {
  const fallbackTurn = await resolveFallbackTurn(args.db, [args]);
  const doc = buildTreasuryTransactionDoc(args, fallbackTurn, args.now ?? new Date());
  if (!doc) {
    return null as unknown as TreasuryTransaction;
  }

  await args.db.collection<TreasuryTransaction>("treasuryTransactions").insertOne(doc);
  recordAudit(toAuditEntry(doc));
  return doc;
}

export async function emitTreasuryTransactionsBulk(
  db: Db,
  entries: BulkTreasuryTransactionArgs[]
): Promise<TreasuryTransaction[]> {
  if (entries.length === 0) return [];

  const fallbackTurn = await resolveFallbackTurn(db, entries);
  const fallbackNow = new Date();
  const docs = entries.flatMap((entry) => {
    const doc = buildTreasuryTransactionDoc(entry, fallbackTurn, fallbackNow);
    return doc ? [doc] : [];
  });
  if (docs.length === 0) return [];

  await db.collection<TreasuryTransaction>("treasuryTransactions").insertMany(docs);
  recordAuditBulk(docs.map(toAuditEntry));
  return docs;
}
