/** Original reserve-pool quotes and outcomes survive delivery and audit interruption. */
import { ObjectId, type Db, type Document } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import * as Sentry from "@sentry/nextjs";
import type { CentralBank, GameConfig } from "@/lib/db/types";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";
import { DEFAULT_TURN_LENGTH_MINUTES } from "@/lib/db/types/financialTxLog";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { getAuditRequestContext } from "@/lib/observability/context";
import { prepareAuditRecord } from "@/lib/audit/recordAudit";
import { isAuditLogEnabledFromConfig } from "@/lib/audit/featureFlag";
import { toAuditEnvelope } from "@/lib/banking/rules/auditEvents";
import type { BankingTransition } from "@/lib/banking/rules/boundary";
import { settleAtomicDocumentTransition } from "@/lib/banking/atomicDocumentSettlement";
import {
  RESERVE_POOL_TRANSFER_COOLDOWN_TURNS,
  RESERVE_POOL_TRANSFER_MAX_FRACTION,
  resolveReservePoolTransferAmount,
  turnsUntilReservePoolTransferReady,
  type ReservePoolTransferDirection,
} from "./reservePoolTransfer";

const COLLECTION = "reservePoolTransferCommands";
export class ReservePoolTransferRejected extends Error {}
export interface ReservePoolTransferInput {
  operationId: string;
  countryId: CountryId;
  direction: ReservePoolTransferDirection;
  amount: number;
  turn: number;
  isAdmin: boolean;
  userId?: string;
  characterId?: string;
}
type ReservePoolBank = CentralBank & {
  settledKeys?: string[];
  locBookRevision?: number;
  pendingLocBookMutationId?: string;
};
interface TransferResult {
  success: true;
  direction: ReservePoolTransferDirection;
  amount: number;
  forexRevenueDelta: number;
  reserveBalanceDelta: number;
  maxToLending: number;
  maxToForex: number;
  nextTransferTurn: number;
}
interface Receipt extends Document {
  _id: string;
  command: ReservePoolTransferInput;
  bankId: string;
  status: "planning" | "applied" | "rejected";
  result: TransferResult;
  transition: BankingTransition;
  guard: Record<string, unknown>;
  generation: readonly string[] | null;
  audit?: ActionAuditRecord;
  auditDelivered?: boolean;
  recoveryPending: boolean;
  error?: string;
}
async function outstandingLoans(db: Db, currency: string): Promise<number> {
  const rows = await db
    .collection("characters")
    .aggregate<{ totalBalance: number; totalArrears: number }>([
      {
        $match: {
          $or: [
            { [`lineOfCredit.balances.${currency}`]: { $gt: 0 } },
            { [`lineOfCredit.arrears.${currency}`]: { $gt: 0 } },
          ],
        },
      },
      {
        $group: {
          _id: null,
          totalBalance: { $sum: { $ifNull: [`$lineOfCredit.balances.${currency}`, 0] } },
          totalArrears: { $sum: { $ifNull: [`$lineOfCredit.arrears.${currency}`, 0] } },
        },
      },
    ])
    .toArray();
  return (rows[0]?.totalBalance ?? 0) + (rows[0]?.totalArrears ?? 0);
}
function exactField(bank: ReservePoolBank, field: keyof ReservePoolBank): unknown {
  return Object.hasOwn(bank, field) ? { $eq: bank[field], $exists: true } : { $exists: false };
}
async function prepare(
  db: Db,
  bank: ReservePoolBank,
  command: ReservePoolTransferInput
): Promise<Receipt> {
  if (bank.pendingLocBookMutationId)
    throw new ReservePoolTransferRejected("A loan settlement is in progress. Retry shortly.");
  if (
    bank.locBookRevision !== undefined &&
    (!Number.isSafeInteger(bank.locBookRevision) || bank.locBookRevision < 0)
  )
    throw new ReservePoolTransferRejected("Invalid loan-book revision");
  const currency = COUNTRY_CURRENCY_MAP[command.countryId];
  if (!currency) throw new ReservePoolTransferRejected("Country has no forex currency");
  const remaining = turnsUntilReservePoolTransferReady({
    currentTurn: command.turn,
    lastTransferTurn: bank.lastReservePoolTransferTurn,
    isAdmin: command.isAdmin,
  });
  if (remaining > 0)
    throw new ReservePoolTransferRejected(
      `Reserve pool transfers are limited to once every ${RESERVE_POOL_TRANSFER_COOLDOWN_TURNS} turns (once per day). ${remaining} turn(s) remaining.`
    );
  const { amount, limits } = resolveReservePoolTransferAmount({
    direction: command.direction,
    amount: command.amount,
    forexRevenue: bank.forexRevenue ?? 0,
    lendingReserves: bank.reserveBalance ?? 0,
    totalDeposits: bank.nationalSavingsBalance ?? 0,
    totalLoansOutstanding: await outstandingLoans(db, currency),
  });
  if (amount <= 0)
    throw new ReservePoolTransferRejected(
      command.direction === "toLending"
        ? `Nothing available to move into lending (max ${Math.floor(RESERVE_POOL_TRANSFER_MAX_FRACTION * 100)}% of forex spread revenue).`
        : "Nothing available to move into forex reserves without reducing capacity below outstanding loans."
    );
  if (amount < command.amount)
    throw new ReservePoolTransferRejected(
      command.direction === "toLending"
        ? `Amount exceeds the ${Math.floor(RESERVE_POOL_TRANSFER_MAX_FRACTION * 100)}% forex-revenue cap (max ${limits.maxToLending}).`
        : `Amount exceeds the safe lending→forex cap (max ${limits.maxToForex}; outstanding loans must stay covered).`
    );
  const now = new Date(),
    key = `reserve-pool:${command.operationId}`;
  const forexDelta = command.direction === "toLending" ? -amount : amount;
  const identity = { _id: bank._id };
  const from = command.direction === "toLending" ? "forexRevenue" : "reserveBalance";
  const to = command.direction === "toLending" ? "reserveBalance" : "forexRevenue";
  const receipt: Receipt = {
    _id: command.operationId,
    command,
    bankId: bank._id,
    status: "planning",
    recoveryPending: true,
    result: {
      success: true,
      direction: command.direction,
      amount,
      forexRevenueDelta: forexDelta,
      reserveBalanceDelta: -forexDelta,
      maxToLending: limits.maxToLending,
      maxToForex: limits.maxToForex,
      nextTransferTurn: command.turn + RESERVE_POOL_TRANSFER_COOLDOWN_TURNS,
    },
    generation: bank.settledKeys ? [...bank.settledKeys] : null,
    guard: {
      locBookRevision: exactField(bank, "locBookRevision"),
      pendingLocBookMutationId: { $exists: false },
      forexRevenue: exactField(bank, "forexRevenue"),
      reserveBalance: exactField(bank, "reserveBalance"),
      lastReservePoolTransferTurn: exactField(bank, "lastReservePoolTransferTurn"),
    },
    transition: {
      key,
      kind: "reserve_pool_transfer",
      turn: command.turn,
      currency,
      legs: [
        {
          kind: "debit",
          amount,
          collection: "centralBanks",
          filter: identity,
          path: from,
          note: "Source reserve pool debit",
        },
        {
          kind: "credit",
          amount,
          collection: "centralBanks",
          filter: identity,
          path: to,
          note: "Destination reserve pool credit",
        },
      ],
      projections: [
        {
          collection: "centralBanks",
          filter: identity,
          update: {
            $inc: { forexRevenue: forexDelta, reserveBalance: -forexDelta, locBookRevision: 1 },
            $set: { lastReservePoolTransferTurn: command.turn, updatedAt: now },
          },
          note: "Reserve pools and transfer cooldown commit together",
        },
      ],
      event: { kind: "monetary.executed", command: "monetary.reserve_pool_transfer" },
    },
  };
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { auditLog: 1, turnLengthMinutes: 1 } });
  if (isAuditLogEnabledFromConfig(config))
    receipt.audit = prepareAuditRecord(
      {
        ...toAuditEnvelope({
          correlationId: getAuditRequestContext()?.traceId ?? key,
          kind: "monetary.executed",
          command: "monetary.reserve_pool_transfer",
          actorClass: command.isAdmin ? "admin" : "player",
          turn: command.turn,
          outcome: "ok",
          subjectType: "centralBank",
          subjectId: bank._id,
          settlementId: key,
          amount,
          currency,
          meta: { direction: command.direction },
        }),
        currencyCode: currency,
        actor: {
          kind: command.isAdmin ? "admin" : "player",
          ...(command.userId && ObjectId.isValid(command.userId)
            ? { userId: new ObjectId(command.userId) }
            : {}),
          ...(command.characterId && ObjectId.isValid(command.characterId)
            ? { characterId: new ObjectId(command.characterId) }
            : {}),
        },
      },
      {
        turn: command.turn,
        ts: now,
        turnLengthMinutes: config?.turnLengthMinutes ?? DEFAULT_TURN_LENGTH_MINUTES,
      }
    );
  return receipt;
}
async function publishAudit(db: Db, receipt: Receipt): Promise<void> {
  if (!receipt.audit || receipt.auditDelivered) return;
  const record = {
    ...receipt.audit,
    outcome: receipt.status === "rejected" ? ("rejected" as const) : ("ok" as const),
    ...(receipt.error ? { reason: receipt.error } : {}),
  };
  try {
    const audits = db.collection<ActionAuditRecord>("actionAuditLog");
    const inserted = await audits.updateOne(
      { _id: record._id },
      { $setOnInsert: record },
      { upsert: true }
    );
    if (
      inserted.matchedCount === 1 &&
      !isDeepStrictEqual(await audits.findOne({ _id: record._id }), record)
    )
      throw new Error("Reserve transfer audit differs from original command");
    const marked = await db
      .collection<Receipt>(COLLECTION)
      .updateOne(
        { _id: receipt._id, status: receipt.status },
        { $set: { auditDelivered: true, recoveryPending: false } }
      );
    if (marked.matchedCount !== 1)
      throw new Error("Reserve transfer audit delivered without marker");
  } catch (error) {
    Sentry.captureException(error, {
      extra: { phase: "reservePool.audit", operationId: receipt._id },
    });
  }
}
async function finish(db: Db, receipt: Receipt): Promise<TransferResult> {
  if (receipt.status === "planning") {
    const result = await settleAtomicDocumentTransition(db, receipt.transition, {
      identity: { _id: receipt.bankId },
      guard: receipt.guard,
      expectedSettledKeys: receipt.generation,
      cashMode: "central_bank_reserve_pool",
    });
    if (result.status !== "rejected" && (result.error || result.status === "partial"))
      throw new Error(result.error ?? "Reserve transfer remains pending");
    const update = {
      status: result.status === "rejected" ? ("rejected" as const) : ("applied" as const),
      recoveryPending: !!receipt.audit,
      ...(result.status === "rejected"
        ? { error: result.error ?? "Reserve pool quote changed. Try again." }
        : {}),
    };
    await db
      .collection<Receipt>(COLLECTION)
      .updateOne({ _id: receipt._id, status: "planning" }, { $set: update });
    const current = await db.collection<Receipt>(COLLECTION).findOne({ _id: receipt._id });
    if (!current || current.status === "planning")
      throw new Error("Reserve transfer outcome not committed");
    receipt = current;
  }
  await publishAudit(db, receipt);
  if (receipt.status === "rejected")
    throw new ReservePoolTransferRejected(receipt.error ?? "Reserve transfer rejected");
  return receipt.result;
}
export async function executeReservePoolTransfer(
  db: Db,
  bank: ReservePoolBank,
  input: ReservePoolTransferInput
): Promise<TransferResult> {
  const command = { ...input, amount: Math.floor(input.amount) };
  const commands = db.collection<Receipt>(COLLECTION);
  let receipt = await commands.findOne({ _id: command.operationId });
  if (!receipt) {
    const prepared = await prepare(db, bank, command);
    await commands.createIndex(
      { recoveryPending: 1, _id: 1 },
      { name: "reserve_pool_pending_recovery", partialFilterExpression: { recoveryPending: true } }
    );
    try {
      await commands.insertOne(prepared);
      receipt = prepared;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
      receipt = await commands.findOne({ _id: command.operationId });
    }
  }
  if (!receipt) throw new Error("Reserve transfer command missing");
  if (
    receipt.command.countryId !== command.countryId ||
    receipt.command.direction !== command.direction ||
    receipt.command.amount !== command.amount
  )
    throw new ReservePoolTransferRejected(
      "Operation ID already belongs to a different reserve transfer"
    );
  return finish(db, receipt);
}
export async function resumeReservePoolTransfers(db: Db): Promise<void> {
  const pending = await db
    .collection<Receipt>(COLLECTION)
    .find({ recoveryPending: true })
    .sort({ _id: 1 })
    .limit(100)
    .toArray();
  for (const receipt of pending) {
    try {
      await finish(db, receipt);
    } catch (error) {
      if (!(error instanceof ReservePoolTransferRejected))
        Sentry.captureException(error, {
          extra: { phase: "reservePool.recovery", operationId: receipt._id },
        });
    }
  }
}
