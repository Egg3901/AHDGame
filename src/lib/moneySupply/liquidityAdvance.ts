/**
 * Central-bank liquidity advances retain one original command and recipient plan.
 * resumeLiquidityAdvances completes admitted commands after interrupted delivery.
 */
import { type Db, type Document } from "mongodb";
import type { CentralBank, Corporation, GameConfig, MonetaryOperationRecord } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { settleAtomicDocumentTransition } from "@/lib/banking/atomicDocumentSettlement";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";
import {
  buildTxDocs,
  loadAnchorRateMap,
  loadTxThresholds,
  type TxInput,
} from "@/lib/financialTxLog/emit";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { allocateLiquidityAdvance } from "./rules/liquidityAdvance";
import { releaseMonetaryCommandReservation } from "./commandReservation";

const COLLECTION = "bankLiquidityOperations";
export class LiquidityAdvanceRejected extends Error {}
export interface LiquidityAdvanceCommand {
  operationId: string;
  countryId: CountryId;
  turn: number;
  amount: number;
  actorName: string;
  reason?: string;
  bypassCooldown?: boolean;
}
interface Receipt extends Document {
  _id: string;
  command: LiquidityAdvanceCommand;
  currency: string;
  bankId: string;
  createdAt: Date;
  status: "planning" | "admitted" | "applied" | "rejected";
  recipients: { bankId: string; amount: number; transaction: FinancialTxLogEntry }[];
  fallback: boolean;
  result?: MonetaryOperationRecord;
  error?: string;
}
function matches(
  receipt: Receipt,
  input: Pick<LiquidityAdvanceCommand, "countryId" | "amount" | "reason">
): void {
  if (
    receipt.command.countryId !== input.countryId ||
    receipt.command.amount !== input.amount ||
    (receipt.command.reason ?? "") !== (input.reason ?? "")
  )
    throw new LiquidityAdvanceRejected(
      "Operation ID already belongs to different liquidity inputs"
    );
}
export async function existingLiquidityAdvance(
  db: Db,
  input: Pick<LiquidityAdvanceCommand, "operationId" | "countryId" | "amount" | "reason">
): Promise<boolean> {
  const receipt = await db.collection<Receipt>(COLLECTION).findOne({ _id: input.operationId });
  if (!receipt) return false;
  matches(receipt, input);
  return receipt.status !== "rejected";
}
export async function executeLiquidityAdvance(
  db: Db,
  input: LiquidityAdvanceCommand,
  cooldownTurns: number
): Promise<MonetaryOperationRecord> {
  if (
    !/^[a-zA-Z0-9_-]{8,128}$/.test(input.operationId) ||
    !Number.isSafeInteger(input.amount) ||
    input.amount <= 0
  )
    throw new LiquidityAdvanceRejected("Valid operation ID and positive whole amount required");
  if (
    await db
      .collection<{ _id: string }>("monetaryOperationCommands")
      .findOne({ _id: input.operationId }, { projection: { _id: 1 } })
  )
    throw new LiquidityAdvanceRejected("Operation ID already belongs to another monetary command");
  const receipts = db.collection<Receipt>(COLLECTION);
  let receipt = await receipts.findOne({ _id: input.operationId });
  if (!receipt) {
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { privateBankingEnabled: 1 } });
    const quotation = await db
      .collection<{ _id: string; currencyCode?: CurrencyCode }>("exchangeRates")
      .findOne({ _id: input.countryId }, { projection: { currencyCode: 1 } });
    const currency = quotation?.currencyCode ?? COUNTRY_CURRENCY_MAP[input.countryId];
    const banks = (await isPrivateBankingEnabled(config))
      ? await db
          .collection<Corporation>("corporations")
          .find(
            { "bankCharter.status": "active", "bankCharter.currency": currency },
            { projection: { _id: 1, name: 1, "bankCharter.totalDeposits": 1 } }
          )
          .toArray()
      : [];
    const shares = allocateLiquidityAdvance(
      input.amount,
      banks.map((bank) => bank.bankCharter?.totalDeposits ?? 0)
    );
    const createdAt = new Date();
    const recipients = banks.flatMap((bank, index) =>
      shares[index] > 0 ? [{ bank, amount: shares[index] }] : []
    );
    const txInputs: TxInput[] = recipients.map(({ bank, amount }) => ({
      type: "bank_cb_advance",
      turn: input.turn,
      createdAt,
      subjectType: "corporation",
      subjectId: bank._id,
      subjectName: bank.name ?? "Bank",
      amount,
      currencyCode: currency as CurrencyCode,
      counterpartyType: "government",
      counterpartyName: `${input.countryId} central bank`,
      meta: {
        kind: "liquidity_injection",
        bankVaultMovement: true,
        operationId: input.operationId,
      },
    }));
    const [thresholds, turnLength, rates] = await Promise.all([
      loadTxThresholds(db),
      loadTurnLengthMinutes(db),
      loadAnchorRateMap(db, txInputs),
    ]);
    const transactions = buildTxDocs(txInputs, thresholds, turnLength, rates);
    // Native receipts remain valid without FX. Never attach an invented anchor.
    const rate = rates.get(currency);
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
      for (const tx of transactions) {
        delete tx.anchorAmount;
        tx.meta = { ...tx.meta, anchorValuation: "unavailable" };
      }
    }
    receipt = {
      _id: input.operationId,
      command: input,
      currency,
      bankId: getBankId(input.countryId),
      createdAt,
      status: "planning",
      recipients: recipients.map(({ bank, amount }, index) => ({
        bankId: bank._id.toString(),
        amount,
        transaction: transactions[index],
      })),
      fallback: banks.length === 0 || shares.every((share) => share <= 0),
    };
    try {
      await receipts.insertOne(receipt);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
      receipt = await receipts.findOne({ _id: input.operationId });
      if (!receipt) throw new Error("Liquidity command disappeared after claim");
    }
  }
  matches(receipt, input);
  return finishLiquidityAdvance(db, receipt, cooldownTurns);
}

async function finishLiquidityAdvance(
  db: Db,
  receipt: Receipt,
  cooldownTurns: number
): Promise<MonetaryOperationRecord> {
  const receipts = db.collection<Receipt>(COLLECTION);
  if (receipt.status === "applied" && receipt.result) {
    await releaseMonetaryCommandReservation(db, receipt.bankId, receipt._id);
    return receipt.result;
  }
  if (receipt.status === "rejected") {
    await releaseMonetaryCommandReservation(db, receipt.bankId, receipt._id);
    throw new LiquidityAdvanceRejected(receipt.error ?? "Liquidity command was rejected");
  }
  const { command, bankId, currency } = receipt;
  const banks = db.collection<
    Omit<CentralBank, "lastMonetaryOperationTurn"> & {
      lastMonetaryOperationTurn?: number | null;
      pendingLiquidityOperationId?: string;
    }
  >("centralBanks");
  if (receipt.status === "planning") {
    const already = await banks.findOne(
      { _id: bankId, pendingLiquidityOperationId: receipt._id },
      { projection: { _id: 1 } }
    );
    if (!already) {
      const claimed = await banks.updateOne(
        {
          _id: bankId,
          pendingLiquidityOperationId: { $exists: false },
          ...(!command.bypassCooldown
            ? {
                $or: [
                  { lastMonetaryOperationTurn: { $exists: false } },
                  { lastMonetaryOperationTurn: null },
                  { lastMonetaryOperationTurn: { $lte: command.turn - cooldownTurns } },
                ],
              }
            : {}),
        },
        { $set: { pendingLiquidityOperationId: receipt._id } }
      );
      if (claimed.matchedCount !== 1) {
        const concurrent = await banks.findOne(
          { _id: bankId, pendingLiquidityOperationId: receipt._id },
          { projection: { _id: 1 } }
        );
        if (!concurrent) {
          const latest = await receipts.findOne({ _id: receipt._id });
          if (latest && latest.status !== "planning")
            return finishLiquidityAdvance(db, latest, cooldownTurns);
          const error = "Monetary operation is on cooldown or another liquidity command is pending";
          await receipts.updateOne(
            { _id: receipt._id, status: "planning" },
            { $set: { status: "rejected", error } }
          );
          const resolved = await receipts.findOne({ _id: receipt._id });
          if (!resolved || resolved.status === "planning")
            throw new Error("Liquidity admission did not resolve");
          return finishLiquidityAdvance(db, resolved, cooldownTurns);
        }
      }
    }
    await receipts.updateOne(
      { _id: receipt._id, status: "planning" },
      { $set: { status: "admitted" } }
    );
  }
  // Admission and rejection race on the original receipt. Only its persisted winner may deliver.
  const current = await receipts.findOne({ _id: receipt._id });
  if (!current) throw new Error("Liquidity command disappeared");
  if (current.status === "applied" || current.status === "rejected")
    return finishLiquidityAdvance(db, current, cooldownTurns);
  if (current.status !== "admitted") throw new Error("Liquidity command was not admitted");
  receipt = current;
  let distributed = 0,
    banksCredited = 0;
  for (const recipient of receipt.recipients) {
    const identity = { _id: oid(recipient.bankId) };
    const transition: BankingTransition = {
      key: `liquidity:${receipt._id}:bank:${recipient.bankId}`,
      kind: "cb_liquidity_advance",
      turn: command.turn,
      currency,
      legs: [
        { kind: "mint", amount: recipient.amount, note: "central bank creates an advance" },
        {
          kind: "credit",
          amount: recipient.amount,
          collection: "corporations",
          filter: identity,
          path: "bankCharter.cashReserves",
          note: "bank receives advance cash",
        },
      ],
      projections: [
        {
          collection: "corporations",
          filter: identity,
          update: {
            $inc: {
              "bankCharter.cashReserves": recipient.amount,
              "bankCharter.cbMarginDebt": recipient.amount,
            },
          },
          note: "advance cash and matching debt",
        },
        {
          collection: "financialTxLog",
          insert: { ...recipient.transaction },
          note: "immutable advance receipt",
        },
      ],
      event: {
        kind: "loan.disbursed",
        command: "monetary.liquidityInjection",
        amount: recipient.amount,
      },
    };
    const settled = await settleAtomicDocumentTransition(db, transition, {
      identity,
      guard: { "bankCharter.status": "active", "bankCharter.currency": currency },
    });
    if (settled.status === "partial") throw new Error("Liquidity delivery remains unfinished");
    if (settled.status === "rejected") continue;
    if (settled.error) throw new Error(settled.error);
    distributed += recipient.amount;
    banksCredited += 1;
  }
  if (receipt.fallback) {
    const identity = { _id: bankId };
    const settled = await settleAtomicDocumentTransition(
      db,
      {
        key: `liquidity:${receipt._id}:reserve`,
        kind: "cb_liquidity_reserve",
        turn: command.turn,
        currency,
        legs: [
          { kind: "mint", amount: command.amount, note: "central bank reserve injection" },
          {
            kind: "credit",
            amount: command.amount,
            collection: "centralBanks",
            filter: identity,
            path: "reserveBalance",
            note: "central-bank reserve fallback",
          },
        ],
        projections: [
          {
            collection: "centralBanks",
            filter: identity,
            update: { $inc: { reserveBalance: command.amount } },
            note: "reserve fallback cash",
          },
        ],
        event: {
          kind: "loan.disbursed",
          command: "monetary.liquidityInjection",
          amount: command.amount,
        },
      },
      { identity, guard: { pendingLiquidityOperationId: receipt._id } }
    );
    if (settled.status === "rejected" || settled.status === "partial" || settled.error)
      throw new Error(settled.error ?? "Reserve fallback unfinished");
  }
  const result: MonetaryOperationRecord = {
    type: "liquidity_injection",
    turn: command.turn,
    amount: receipt.fallback ? command.amount : distributed,
    moneySupplyDelta: 0,
    reserveDelta: receipt.fallback ? command.amount : 0,
    actorName: command.actorName,
    reason: command.reason,
    createdAt: receipt.createdAt,
    banksCredited,
  };
  const completed = await settleTransition(db, {
    key: `liquidity:${receipt._id}:complete`,
    kind: "cb_liquidity_completion",
    turn: command.turn,
    currency,
    legs: [],
    projections: [
      {
        collection: "centralBanks",
        filter: { _id: bankId },
        update: {
          $inc: { netMoneyCreatedLifetime: receipt.fallback ? 0 : distributed },
          $set: { lastMonetaryOperationTurn: command.turn, updatedAt: receipt.createdAt },
          $unset: { pendingLiquidityOperationId: "" },
          $push: { monetaryOperations: { $each: [result], $slice: -100 } },
        },
        note: "actual delivered advances, operation history and cooldown",
      },
      {
        collection: COLLECTION,
        filter: { _id: receipt._id },
        update: { $set: { status: "applied", result } },
        note: "liquidity command completed",
      },
    ],
    event: {
      kind: "loan.disbursed",
      command: "monetary.liquidityInjection",
      amount: result.amount,
    },
  });
  if (completed.status === "partial" || completed.status === "rejected" || completed.error)
    throw new Error(completed.error ?? "Liquidity completion unfinished");
  if (completed.newlyAppliedProjections.includes(1))
    emitBankingAuditEvent(
      {
        kind: "loan.disbursed",
        command: "monetary.liquidityInjection",
        turn: command.turn,
        currency,
        bankId,
        settlementId: `liquidity:${receipt._id}:complete`,
        outcome: "ok",
        amount: result.amount,
      },
      db
    );
  return result;
}

/** Recover durable pending commands before new banking flows inspect their cash. */
export async function resumeLiquidityAdvances(db: Db, cooldownTurns: number): Promise<void> {
  const pending = await db
    .collection<Receipt>(COLLECTION)
    .find({ status: { $in: ["planning", "admitted"] } })
    .limit(100)
    .toArray();
  for (const receipt of pending) {
    try {
      await finishLiquidityAdvance(db, receipt, cooldownTurns);
    } catch (error) {
      const current = await db
        .collection<Receipt>(COLLECTION)
        .findOne({ _id: receipt._id }, { projection: { status: 1 } });
      if (current?.status !== "rejected") throw error;
    }
  }
}
