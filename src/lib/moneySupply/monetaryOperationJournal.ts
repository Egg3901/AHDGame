/**
 * Monetary operations exchange bond inventory for market cash or credit the treasury.
 * executeJournaledMonetaryOperation retains the original quote and resumes its delivery;
 * a refused QT asset exchange refunds the original market payment before releasing the command.
 */
import { ObjectId, type Db, type Document } from "mongodb";
import type {
  Bond,
  CentralBank,
  FederalBudget,
  GameConfig,
  MonetaryOperationRecord,
} from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getBankId } from "@/lib/centralBank/helpers";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { bondPoolCurrency } from "@/lib/bonds/marketPool";
import * as Sentry from "@sentry/nextjs";
import { isDeepStrictEqual } from "node:util";
import { prepareAuditRecord } from "@/lib/audit/recordAudit";
import { isAuditLogEnabledFromConfig } from "@/lib/audit/featureFlag";
import { toAuditEnvelope } from "@/lib/banking/rules/auditEvents";
import { getAuditRequestContext } from "@/lib/observability/context";
import { DEFAULT_TURN_LENGTH_MINUTES } from "@/lib/db/types/financialTxLog";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";
import { settleAtomicDocumentTransition } from "@/lib/banking/atomicDocumentSettlement";
import {
  resumeSettlement,
  settleTransition,
  type SettlementResult,
} from "@/lib/banking/settlementJournal";
import {
  oid,
  type BankingTransition,
  type TransitionProjection,
} from "@/lib/banking/rules/boundary";
import { accountId, mintSinkAccount } from "@/lib/ledger/accounts";
import { finalizeLedgerEntry } from "@/lib/ledger/emit";
import { isLedgerShadowEnabledFromConfig } from "@/lib/ledger/featureFlag";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { treasuryAdvanceMoneyDelta } from "./rules/assemble";
import { planOpenMarketOperation, quotedQeMarketPrice } from "./quantitativeEasing";
import type { ExecuteMonetaryOperationInput } from "./operations";
import { releaseMonetaryCommandReservation } from "./commandReservation";

const COLLECTION = "monetaryOperationCommands";
export class MonetaryOperationRejected extends Error {}
type Command = ExecuteMonetaryOperationInput & {
  operationId: string;
  type: "qe" | "qt" | "treasury_advance";
};
interface Receipt extends Document {
  _id: string;
  command: Command;
  bankId: string;
  currency: CurrencyCode;
  status: "planning" | "admitted" | "refunding" | "applied" | "rejected";
  error?: string;
  recoveryPending: boolean;
  audit?: ActionAuditRecord;
  auditDelivered?: boolean;
  result: MonetaryOperationRecord;
  createdAt: Date;
  cash: BankingTransition;
  asset?: BankingTransition;
  assetGuard?: Record<string, unknown>;
  assetGeneration?: readonly string[] | null;
  refund?: BankingTransition;
  witnesses: TransitionProjection[];
}
function sameCommand(receipt: Receipt, input: ExecuteMonetaryOperationInput): void {
  const saved = receipt.command;
  if (
    saved.type !== input.type ||
    saved.countryId !== input.countryId ||
    (saved.reason ?? "") !== (input.reason ?? "") ||
    (saved.type === "treasury_advance"
      ? Math.floor(saved.amount ?? 0) !== Math.floor(input.amount ?? 0)
      : saved.bondId !== input.bondId || saved.units !== input.units)
  )
    throw new MonetaryOperationRejected(
      "Operation ID already belongs to different monetary inputs"
    );
}
export async function existingMonetaryOperation(
  db: Db,
  input: ExecuteMonetaryOperationInput
): Promise<boolean> {
  if (!input.operationId) return false;
  const receipt = await db.collection<Receipt>(COLLECTION).findOne({ _id: input.operationId });
  if (!receipt) return false;
  sameCommand(receipt, input);
  if (receipt.status === "rejected") {
    await releaseMonetaryCommandReservation(db, receipt.bankId, `monetary:${receipt._id}`);
    await publishAudit(db, receipt);
    throw new MonetaryOperationRejected(receipt.error ?? "Monetary operation was rejected");
  }
  return true;
}
function transition(command: Command, currency: CurrencyCode, stage: string): BankingTransition {
  return {
    key: `monetary:${command.operationId}:${stage}`,
    kind: `monetary_${command.type}_${stage}`,
    turn: command.turn,
    currency,
    legs: [],
    projections: [],
    event: { kind: "monetary.executed", command: `monetary.${command.type}` },
  };
}
async function prepare(db: Db, command: Command): Promise<Receipt> {
  const now = new Date();
  const receipt: Receipt = {
    _id: command.operationId,
    command,
    bankId: getBankId(command.countryId),
    currency: COUNTRY_CURRENCY_MAP[command.countryId],
    createdAt: now,
    status: "planning",
    recoveryPending: true,
    cash: transition(command, COUNTRY_CURRENCY_MAP[command.countryId], "cash"),
    witnesses: [],
    result: {
      type: command.type,
      turn: command.turn,
      amount: 0,
      moneySupplyDelta: 0,
      reserveDelta: 0,
      actorName: command.actorName,
      reason: command.reason,
      createdAt: now,
    },
  };
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne(
      { _id: "default" },
      { projection: { ledgerShadow: 1, auditLog: 1, turnLengthMinutes: 1 } }
    );
  if (isAuditLogEnabledFromConfig(config)) {
    const context = getAuditRequestContext();
    const actorClass = command.actorClass ?? context?.actor?.kind ?? "system";
    const envelope = toAuditEnvelope({
      kind: "monetary.executed",
      command: `monetary.${command.type}`,
      correlationId: context?.traceId ?? `monetary:${command.operationId}`,
      actorClass,
      turn: command.turn,
      subjectType: "centralBank",
      subjectId: receipt.bankId,
      settlementId: `monetary:${command.operationId}:complete`,
      outcome: "ok",
    });
    receipt.audit = prepareAuditRecord(
      {
        ...envelope,
        currencyCode: receipt.currency,
        // Preserve opaque actor IDs from the original request, with an explicit caller class.
        actor: context?.actor
          ? {
              kind: actorClass,
              ...(context.actor.userId && ObjectId.isValid(context.actor.userId)
                ? { userId: new ObjectId(context.actor.userId) }
                : {}),
              ...(context.actor.characterId && ObjectId.isValid(context.actor.characterId)
                ? { characterId: new ObjectId(context.actor.characterId) }
                : {}),
              ...(context.actor.role ? { role: context.actor.role } : {}),
            }
          : { kind: actorClass },
      },
      {
        turn: command.turn,
        ts: now,
        turnLengthMinutes: config?.turnLengthMinutes ?? DEFAULT_TURN_LENGTH_MINUTES,
      }
    );
  }
  if (command.type === "treasury_advance") {
    const amount = Math.max(0, Math.floor(command.amount ?? 0));
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new MonetaryOperationRejected("Amount must be positive");
    const budgetId = getNationalBudgetId(command.countryId);
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: budgetId } as { _id: "federal" });
    if (!budget) throw new MonetaryOperationRejected("Federal budget not found");
    receipt.currency = resolveCountryCurrencyCode(budget) ?? receipt.currency;
    receipt.cash.currency = receipt.currency;
    receipt.result.amount = amount;
    receipt.result.moneySupplyDelta = treasuryAdvanceMoneyDelta(
      budget.treasuryBalance ?? 0,
      amount
    );
    receipt.cash.legs = [
      { kind: "mint", amount, note: "central bank treasury advance" },
      {
        kind: "credit",
        amount,
        collection: "federalBudget",
        filter: { _id: budgetId },
        path: "treasuryBalance",
        note: "native treasury credit",
      },
    ];
    receipt.cash.projections = [
      {
        collection: "federalBudget",
        filter: { _id: budgetId },
        update: { $set: { updatedAt: now } },
        note: "treasury cash publication",
      },
    ];
    if (isLedgerShadowEnabledFromConfig(config)) {
      const [rate, state] = await Promise.all([
        db
          .collection<{ currencyCode: string; rate: number }>("exchangeRates")
          .findOne({ currencyCode: receipt.currency }, { projection: { rate: 1 } }),
        db
          .collection<{ _id: string; preset?: string }>("gameState")
          .findOne({ _id: "current" }, { projection: { preset: 1 } }),
      ]);
      const valuation = treasuryAnchorValuation({
        countryId: command.countryId,
        currencyCode: receipt.currency,
        preset: state?.preset ?? DEFAULT_SEED_PRESET,
        observedRate: rate?.rate,
      });
      const entry = finalizeLedgerEntry({
        turn: command.turn,
        createdAt: now,
        txType: "monetary_treasury_advance",
        legs: [
          {
            account: accountId("government", command.countryId, receipt.currency),
            amount,
            currencyCode: receipt.currency,
            anchorAmount: amount / valuation.anchorRate,
            role: "primary",
          },
          {
            account: accountId("mint", "treasury_advance", receipt.currency),
            amount: -amount,
            currencyCode: receipt.currency,
            anchorAmount: -amount / valuation.anchorRate,
            role: "contra",
          },
        ],
        emitSite: "moneySupply/monetaryOperationJournal.ts:treasury_advance",
      });
      receipt.witnesses.push({
        collection: "ledgerEntries",
        insert: { ...entry, ...valuation },
        note: "original balanced treasury valuation",
      });
    }
    return receipt;
  }
  if (!command.bondId || !ObjectId.isValid(command.bondId))
    throw new MonetaryOperationRejected("Valid bond required");
  const bond = await db.collection<Bond & { settledKeys?: string[] }>("bonds").findOne({
    _id: new ObjectId(command.bondId),
    issuerType: "sovereign",
    countryId: command.countryId,
    matured: false,
    defaulted: false,
  });
  if (!bond) throw new MonetaryOperationRejected("Eligible sovereign bond not found");
  const plan = planOpenMarketOperation({
    operation: command.type,
    requestedUnits: command.units ?? 0,
    publicFloat: bond.publicFloat,
    centralBankHoldings: bond.centralBankHoldings ?? 0,
    totalIssued: bond.totalIssued,
    marketPrice: bond.marketPrice,
  });
  if (
    !Number.isSafeInteger(plan.units) ||
    plan.units <= 0 ||
    !Number.isFinite(plan.consideration) ||
    plan.consideration <= 0
  )
    throw new MonetaryOperationRejected("No bond units available for this operation");
  receipt.currency = bondPoolCurrency(bond);
  receipt.cash.currency = receipt.currency;
  receipt.result = {
    ...receipt.result,
    amount: plan.consideration,
    moneySupplyDelta: plan.moneySupplyDelta,
    units: plan.units,
    bondId: command.bondId,
  };
  const identity = { _id: oid(command.bondId) };
  receipt.asset = transition(command, receipt.currency, "asset");
  receipt.asset.projections = [
    {
      collection: "bonds",
      filter: identity,
      update: {
        $set: {
          publicFloat: plan.publicFloat,
          centralBankHoldings: plan.centralBankHoldings,
          qeSupportRatio: plan.qeSupportRatio,
          marketPrice: quotedQeMarketPrice(
            bond.marketPrice,
            bond.qeSupportRatio ?? 0,
            plan.qeSupportRatio
          ),
          updatedAt: now,
        },
      },
      note: "exchange float and central-bank units at the original quote",
    },
  ];
  receipt.assetGeneration = bond.settledKeys ? [...bond.settledKeys] : null;
  receipt.assetGuard = {
    matured: false,
    defaulted: false,
    publicFloat: bond.publicFloat,
    centralBankHoldings: Object.hasOwn(bond, "centralBankHoldings")
      ? { $eq: bond.centralBankHoldings, $exists: true }
      : { $exists: false },
    marketPrice: bond.marketPrice,
  };
  const pool = { _id: receipt.currency };
  if (command.type === "qe") {
    receipt.cash.legs = [
      { kind: "mint", amount: plan.consideration, note: "QE market cash creation" },
      {
        kind: "credit",
        amount: plan.consideration,
        collection: "bondMarketPools",
        filter: pool,
        path: "cashLocal",
        note: "float seller receives cash",
      },
    ];
    receipt.cash.projections = [
      {
        collection: "bondMarketPools",
        filter: pool,
        update: { $inc: { "lifetime.qeIn": plan.consideration }, $set: { updatedAt: now } },
        note: "QE market flow",
      },
    ];
  } else {
    receipt.cash.legs = [
      {
        kind: "debit",
        amount: plan.consideration,
        collection: "bondMarketPools",
        filter: pool,
        path: "cashLocal",
        note: "market funds the central-bank sale",
      },
      { kind: "burn", amount: plan.consideration, note: "QT withdraws funded market cash" },
    ];
    receipt.cash.projections = [
      {
        collection: "bondMarketPools",
        filter: pool,
        update: {
          $inc: { cashLocal: -plan.consideration, "lifetime.qtOut": plan.consideration },
          $set: { updatedAt: now },
        },
        note: "funded QT cash and flow",
      },
    ];
    receipt.refund = transition(command, receipt.currency, "refund");
    receipt.refund.legs = [
      { kind: "mint", amount: plan.consideration, note: "reverse refused QT cash withdrawal" },
      {
        kind: "credit",
        amount: plan.consideration,
        collection: "bondMarketPools",
        filter: pool,
        path: "cashLocal",
        note: "return original QT funding",
      },
    ];
    receipt.refund.projections = [
      {
        collection: "bondMarketPools",
        filter: pool,
        update: { $inc: { "lifetime.qtOut": -plan.consideration }, $set: { updatedAt: now } },
        note: "reverse refused QT flow",
      },
    ];
  }
  if (isLedgerShadowEnabledFromConfig(config)) {
    // Published only with a completed receipt; a refused or refunded operation moved nothing.
    const quote = await db
      .collection<{ currencyCode: string; rate: number }>("exchangeRates")
      .findOne({ currencyCode: receipt.currency }, { projection: { rate: 1 } });
    const amount = command.type === "qe" ? plan.consideration : -plan.consideration;
    // Same valuation and missing-rate fallback as the snapshot's bond_pool account.
    const anchorAmount = amount / (quote?.rate && quote.rate > 0 ? quote.rate : 1);
    const reason = command.type === "qe" ? "central_bank_qe" : "central_bank_qt";
    receipt.witnesses.push({
      collection: "ledgerEntries",
      insert: {
        ...finalizeLedgerEntry({
          turn: command.turn,
          createdAt: now,
          txType: command.type === "qe" ? "monetary_qe" : "monetary_qt",
          legs: [
            {
              account: accountId("bond_pool", receipt.currency, receipt.currency),
              amount,
              currencyCode: receipt.currency,
              anchorAmount,
              role: "primary",
            },
            {
              account: mintSinkAccount(anchorAmount, reason, receipt.currency),
              amount: -amount,
              currencyCode: receipt.currency,
              anchorAmount: -anchorAmount,
              role: "contra",
            },
          ],
          emitSite: `moneySupply/monetaryOperationJournal.ts:${command.type}`,
        }),
      },
      note: "pool cash the central bank created or withdrew",
    });
  }
  return receipt;
}
function requireComplete(result: SettlementResult): void {
  if (result.error || result.status === "partial" || result.status === "rejected")
    throw new Error(result.error ?? "Monetary settlement remains unfinished");
}
/** Original leg stamps permit concurrent retries; recovery never computes a new quote. */
async function ordinary(db: Db, plan: BankingTransition): Promise<SettlementResult> {
  let result = await settleTransition(db, plan);
  if (result.status !== "rejected" && (result.error || result.status === "partial"))
    result = await resumeSettlement(db, plan.key);
  requireComplete(result);
  return result;
}
async function terminal(db: Db, receipt: Receipt, error?: string): Promise<void> {
  const completion = transition(receipt.command, receipt.currency, error ? "reject" : "complete");
  completion.projections = [
    ...(!error ? receipt.witnesses : []),
    {
      collection: "centralBanks",
      filter: { _id: receipt.bankId },
      update: error
        ? { $unset: { pendingLiquidityOperationId: "" } }
        : {
            $inc: {
              netMoneyCreatedLifetime:
                receipt.command.type === "treasury_advance"
                  ? receipt.result.amount
                  : receipt.result.moneySupplyDelta,
            },
            $set: { lastMonetaryOperationTurn: receipt.command.turn, updatedAt: receipt.createdAt },
            $unset: { pendingLiquidityOperationId: "" },
            $push: { monetaryOperations: { $each: [receipt.result], $slice: -100 } },
          },
      note: "monetary command accounting and reservation release",
    },
    {
      collection: COLLECTION,
      filter: { _id: receipt._id },
      update: {
        $set: {
          status: error ? "rejected" : "applied",
          recoveryPending: !!receipt.audit && !receipt.auditDelivered,
          ...(error ? { error } : {}),
        },
      },
      note: "durable monetary result",
    },
  ];
  await ordinary(db, completion);
  await publishAudit(db, { ...receipt, status: error ? "rejected" : "applied", error });
}
/** Audit delivery never changes a financial result; the fixed row is retained for recovery. */
async function publishAudit(db: Db, receipt: Receipt): Promise<void> {
  if (!receipt.audit || receipt.auditDelivered) return;
  const record: ActionAuditRecord = {
    ...receipt.audit,
    outcome: receipt.status === "rejected" ? "rejected" : "ok",
    ...(receipt.status === "rejected"
      ? { reason: receipt.error }
      : { amount: receipt.result.amount }),
    currencyCode: receipt.currency,
    meta: {
      ...receipt.audit.meta,
      settlementId: `monetary:${receipt._id}:${receipt.status === "rejected" ? "reject" : "complete"}`,
    },
  };
  try {
    const audit = db.collection<ActionAuditRecord>("actionAuditLog");
    const inserted = await audit.updateOne(
      { _id: record._id },
      { $setOnInsert: record },
      { upsert: true }
    );
    if (
      inserted.matchedCount === 1 &&
      !isDeepStrictEqual(await audit.findOne({ _id: record._id }), record)
    )
      throw new Error("Monetary audit row differs from the original command");
    const marked = await db
      .collection<Receipt>(COLLECTION)
      .updateOne(
        { _id: receipt._id, status: receipt.status },
        { $set: { auditDelivered: true, recoveryPending: false } }
      );
    if (marked.matchedCount !== 1)
      throw new Error("Monetary audit delivered without completion marker");
  } catch (error) {
    Sentry.captureException(error, {
      extra: { phase: "monetary.auditDelivery", operationId: receipt._id },
    });
  }
}
async function finish(
  db: Db,
  receipt: Receipt,
  cooldown: number
): Promise<MonetaryOperationRecord> {
  if (receipt.status === "applied") {
    await releaseMonetaryCommandReservation(db, receipt.bankId, `monetary:${receipt._id}`);
    await publishAudit(db, receipt);
    return receipt.result;
  }
  if (receipt.status === "rejected") {
    await releaseMonetaryCommandReservation(db, receipt.bankId, `monetary:${receipt._id}`);
    await publishAudit(db, receipt);
    throw new MonetaryOperationRejected(receipt.error ?? "Monetary operation was rejected");
  }
  const receipts = db.collection<Receipt>(COLLECTION);
  const banks = db.collection<
    Omit<CentralBank, "lastMonetaryOperationTurn"> & {
      lastMonetaryOperationTurn?: number | null;
      pendingLiquidityOperationId?: string;
    }
  >("centralBanks");
  if (receipt.status === "planning") {
    const already = await banks.findOne(
      { _id: receipt.bankId, pendingLiquidityOperationId: `monetary:${receipt._id}` },
      { projection: { _id: 1 } }
    );
    if (!already) {
      const claim = await banks.updateOne(
        {
          _id: receipt.bankId,
          pendingLiquidityOperationId: { $exists: false },
          ...(!receipt.command.bypassCooldown
            ? {
                $or: [
                  { lastMonetaryOperationTurn: { $exists: false } },
                  { lastMonetaryOperationTurn: null },
                  { lastMonetaryOperationTurn: { $lte: receipt.command.turn - cooldown } },
                ],
              }
            : {}),
        },
        { $set: { pendingLiquidityOperationId: `monetary:${receipt._id}` } }
      );
      if (claim.matchedCount !== 1) {
        const current = await receipts.findOne({ _id: receipt._id });
        if (current && current.status !== "planning") return finish(db, current, cooldown);
        const ours = await banks.findOne(
          { _id: receipt.bankId, pendingLiquidityOperationId: `monetary:${receipt._id}` },
          { projection: { _id: 1 } }
        );
        if (!ours) {
          const error = "Monetary operation is on cooldown or another command is pending";
          await receipts.updateOne(
            { _id: receipt._id, status: "planning" },
            { $set: { status: "rejected", error, recoveryPending: !!receipt.audit } }
          );
          const resolved = await receipts.findOne({ _id: receipt._id });
          if (!resolved || resolved.status === "planning")
            throw new Error("Monetary admission did not resolve");
          return finish(db, resolved, cooldown);
        }
      }
    }
    await receipts.updateOne(
      { _id: receipt._id, status: "planning" },
      { $set: { status: "admitted" } }
    );
  }
  // Re-read after admission: another retry may already have committed a refund or result.
  const current = await receipts.findOne({ _id: receipt._id });
  if (!current) throw new Error("Monetary command disappeared");
  if (current.status === "applied" || current.status === "rejected")
    return finish(db, current, cooldown);
  receipt = current;
  if (receipt.status !== "refunding") {
    if (receipt.command.type === "qt") {
      const payment = await settleAtomicDocumentTransition(db, receipt.cash, {
        identity: { _id: receipt.currency },
      });
      if (payment.status === "rejected") {
        await terminal(db, receipt, "The bond market cannot absorb a sale of this size right now");
        throw new MonetaryOperationRejected(
          "The bond market cannot absorb a sale of this size right now"
        );
      }
      requireComplete(payment);
    }
    if (receipt.asset) {
      const assets = await settleAtomicDocumentTransition(db, receipt.asset, {
        identity: { _id: oid(receipt.command.bondId!) },
        guard: receipt.assetGuard,
        nonCashMode: "central_bank_bond_exchange",
        expectedSettledKeys: receipt.assetGeneration,
      });
      if (assets.status === "rejected") {
        if (!receipt.refund) {
          await terminal(db, receipt, "Bond inventory changed before the monetary exchange");
          throw new MonetaryOperationRejected(
            "Bond inventory changed before the monetary exchange"
          );
        }
        await receipts.updateOne(
          { _id: receipt._id, status: "admitted" },
          {
            $set: {
              status: "refunding",
              error: "Bond inventory changed before the monetary exchange",
            },
          }
        );
        receipt.status = "refunding";
      } else requireComplete(assets);
    }
  }
  if (receipt.status === "refunding") {
    if (!receipt.refund) throw new Error("Monetary refund has no original plan");
    await ordinary(db, receipt.refund);
    await terminal(db, receipt, "Bond inventory changed before the monetary exchange");
    throw new MonetaryOperationRejected("Bond inventory changed before the monetary exchange");
  }
  if (receipt.command.type === "qe") {
    await db
      .collection<{ _id: string }>("bondMarketPools")
      .updateOne(
        { _id: receipt.currency },
        { $setOnInsert: { cashLocal: 0, targetCashLocal: 0, createdAt: receipt.createdAt } },
        { upsert: true }
      );
  }
  if (receipt.command.type !== "qt") await ordinary(db, receipt.cash);
  await terminal(db, receipt);
  return receipt.result;
}
export async function executeJournaledMonetaryOperation(
  db: Db,
  command: Command,
  cooldown: number
): Promise<MonetaryOperationRecord> {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(command.operationId))
    throw new MonetaryOperationRejected("Valid operation ID required");
  if (
    await db
      .collection<{ _id: string }>("bankLiquidityOperations")
      .findOne({ _id: command.operationId }, { projection: { _id: 1 } })
  )
    throw new MonetaryOperationRejected("Operation ID already belongs to a liquidity command");
  const receipts = db.collection<Receipt>(COLLECTION);
  let receipt = await receipts.findOne({ _id: command.operationId });
  if (!receipt) {
    await receipts.createIndex(
      { recoveryPending: 1, _id: 1 },
      {
        name: "monetary_commands_pending_recovery",
        partialFilterExpression: { recoveryPending: true },
      }
    );
    const prepared = await prepare(db, command);
    try {
      await receipts.insertOne(prepared);
      receipt = prepared;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
      receipt = await receipts.findOne({ _id: command.operationId });
      if (!receipt) throw new Error("Monetary command disappeared after claim");
    }
  }
  sameCommand(receipt, command);
  return finish(db, receipt, cooldown);
}
export async function resumeMonetaryOperations(db: Db, cooldown: number): Promise<void> {
  const pending = await db
    .collection<Receipt>(COLLECTION)
    .find({ recoveryPending: true })
    .sort({ _id: 1 })
    .limit(100)
    .toArray();
  for (const receipt of pending) {
    try {
      await finish(db, receipt, cooldown);
    } catch (error) {
      const current = await db
        .collection<Receipt>(COLLECTION)
        .findOne({ _id: receipt._id }, { projection: { status: 1 } });
      if (current?.status !== "rejected") throw error;
    }
  }
}
