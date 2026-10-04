/** Original treasury/reserve exchanges and their recoverable cash, history and audit delivery. */
import { ObjectId, type Db, type Document } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import * as Sentry from "@sentry/nextjs";
import type { FederalBudget, GameConfig } from "@/lib/db/types";
import type { TreasuryTransferRecord } from "@/lib/db/types/centralBank";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";
import type { CountryId } from "@/lib/constants/countries";
import { TREASURY_TRANSFER_HISTORY_MAX, type CurrencyCode } from "@/lib/constants/currencies";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { DEFAULT_TURN_LENGTH_MINUTES } from "@/lib/db/types/financialTxLog";
import { effectiveBorrowingLimit } from "./borrowingLimit";
import { validateTreasuryReserveTransfer } from "./rules/treasuryReserveTransfer";
import { treasuryAnchorValuation } from "./rules/treasuryAccrual";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { getBankId } from "@/lib/centralBank/helpers";
import {
  claimMoneyMove,
  MONEY_MOVE_COLLECTION,
  SETTLED_KEYS_CAP,
  legStamp,
} from "@/lib/banking/moneyMove";
import { recoverProjections, type SettlementResult } from "@/lib/banking/settlementJournal";
import type { TransitionProjection } from "@/lib/banking/rules/boundary";
import { prepareAuditRecord } from "@/lib/audit/recordAudit";
import { isAuditLogEnabledFromConfig } from "@/lib/audit/featureFlag";
import { toAuditEnvelope } from "@/lib/banking/rules/auditEvents";
import { getAuditRequestContext } from "@/lib/observability/context";
import { isLedgerShadowEnabledFromConfig } from "@/lib/ledger/featureFlag";
import { finalizeLedgerEntry } from "@/lib/ledger/emit";
import { resolveLedgerTurn } from "@/lib/ledger/ledgerTurn";
import { accountId } from "@/lib/ledger/accounts";
import { buildTxDocs, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";

export class TreasuryReserveTransferRejected extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}
interface Command {
  operationId: string;
  countryId: CountryId;
  amount: number;
  justification?: string;
  turn: number;
  isAdmin: boolean;
  actorId: ObjectId;
  actorName: string;
}
interface Plan {
  command: Command;
  bankId: string;
  budgetId: string;
  currency: CurrencyCode;
  debtFloor?: number;
  state: "planning" | "admitted" | "rejected";
  record: TreasuryTransferRecord;
  audit?: ActionAuditRecord;
  auditDelivered?: boolean;
  error?: string;
  sourceRevision?: number;
  treasuryCashLedgerEnabled?: boolean;
  destinationRevision?: number;
}
interface Receipt extends Document {
  _id: string;
  status: string;
  treasuryReserveTransfer: Plan;
  legs: { applied: boolean }[];
  projectionsCompletedAt?: Date;
}
interface BalanceDocument {
  _id: string;
  settledKeys?: string[];
  treasuryBalance?: number;
  treasuryCashLocal?: number;
  treasuryReserveRevision?: number;
  treasuryReserveRejectedKey?: string;
  reserveBalance?: number;
  pendingTreasuryReserveKey?: string;
  treasuryTransferHistory?: TreasuryTransferRecord[];
  treasuryTransferInProgressAt?: Date;
}
const commandKey = (id: string) => `treasury-reserve:${id}`;
function assertSame(saved: Command, input: Command): void {
  if (
    saved.countryId !== input.countryId ||
    saved.amount !== input.amount ||
    (saved.justification ?? "") !== (input.justification ?? "") ||
    !saved.actorId.equals(input.actorId)
  )
    throw new TreasuryReserveTransferRejected(
      "Operation ID already belongs to different transfer inputs"
    );
}
async function prepare(db: Db, command: Command): Promise<void> {
  const budgetId = command.countryId === "US" ? "federal" : command.countryId;
  const [budget, gameConfig] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { treasuryCashLedgerEnabled: 1 } }),
  ]);
  if (!budget) throw new TreasuryReserveTransferRejected("Federal budget not found", 404);
  const bankId = getBankId(command.countryId);
  const bank = await db
    .collection<BalanceDocument>("centralBanks")
    .findOne({ _id: bankId }, { projection: { reserveBalance: 1 } });
  if (!bank) throw new TreasuryReserveTransferRejected("Central bank not found", 404);
  if (bank.reserveBalance !== undefined && !Number.isFinite(bank.reserveBalance))
    throw new TreasuryReserveTransferRejected("Central bank reserves require reconciliation");
  const ceiling = effectiveBorrowingLimit({
    countryId: command.countryId,
    gdp: budget.gdpSmoothed ?? budget.gdp,
    storedCeiling: budget.debt?.ceiling ?? 0,
  });
  const error = validateTreasuryReserveTransfer({
    amount: command.amount,
    annualRevenue: budget.revenue?.total ?? 0,
    annualSpending: budget.spending?.total ?? 0,
    debtCeiling: ceiling,
  });
  if (error) throw new TreasuryReserveTransferRejected(error);
  const treasuryCashLedgerEnabled = gameConfig?.treasuryCashLedgerEnabled === true;
  const availableTreasuryCash = treasuryCashLedgerEnabled
    ? budget.treasuryCashLocal
    : budget.treasuryBalance;
  if (!Number.isFinite(availableTreasuryCash))
    throw new TreasuryReserveTransferRejected(
      "Treasury cash is unavailable; reconciliation is required"
    );
  if (treasuryCashLedgerEnabled && availableTreasuryCash! < command.amount)
    throw new TreasuryReserveTransferRejected(
      "Funded Treasury cash cannot cover this reserve transfer"
    );
  const currency = resolveCountryCurrencyCode(budget);
  if (!currency) throw new TreasuryReserveTransferRejected("Treasury currency is unavailable");
  const now = new Date();
  const plan: Plan = {
    command,
    bankId,
    budgetId,
    currency,
    state: "planning",
    treasuryCashLedgerEnabled,
    ...(typeof ceiling === "number" ? { debtFloor: command.amount - ceiling } : {}),
    record: {
      turn: command.turn,
      transferredBy: command.actorId,
      transferredByName: command.actorName,
      amount: command.amount,
      ...(command.justification ? { justification: command.justification } : {}),
      createdAt: now,
    },
  };
  const projections: TransitionProjection[] = [];
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne(
      { _id: "default" },
      { projection: { ledgerShadow: 1, auditLog: 1, turnLengthMinutes: 1 } }
    );
  const [rate, state, thresholds, cadence] = await Promise.all([
    db
      .collection<{ currencyCode: string; rate: number }>("exchangeRates")
      .findOne({ currencyCode: currency }, { projection: { rate: 1 } }),
    db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } }),
    loadTxThresholds(db),
    loadTurnLengthMinutes(db),
  ]);
  let valuation: ReturnType<typeof treasuryAnchorValuation> | undefined;
  try {
    valuation = treasuryAnchorValuation({
      countryId: command.countryId,
      currencyCode: currency,
      preset: state?.preset ?? DEFAULT_SEED_PRESET,
      observedRate: rate?.rate,
    });
  } catch (error) {
    if (isLedgerShadowEnabledFromConfig(config)) throw error;
  }
  const [cashReceipt] = buildTxDocs(
    [
      {
        type: "gov_budget_transfer",
        turn: command.turn,
        createdAt: now,
        subjectType: "government",
        countryId: command.countryId,
        subjectName: `${command.countryId} Treasury`,
        amount: -command.amount,
        currencyCode: currency,
        ...(valuation ? { anchorAmount: -command.amount / valuation.anchorRate } : {}),
        counterpartyType: "system",
        counterpartyName: "Central bank reserves",
        meta: {
          settlementKey: commandKey(command.operationId),
          purpose: "treasury_reserve_transfer",
          ...(valuation ?? { anchorValuation: "unavailable" }),
        },
      },
    ],
    thresholds,
    cadence,
    new Map()
  );
  if (!valuation) delete cashReceipt.anchorAmount;
  projections.push({
    collection: "financialTxLog",
    insert: { ...cashReceipt },
    note: "Original treasury cash transaction",
  });
  if (isLedgerShadowEnabledFromConfig(config) && valuation) {
    // Planned once and replayed from the receipt, so the turn is fixed here: the
    // one whose closing snapshot holds this cash, not the route's clock (#3022).
    const entry = finalizeLedgerEntry({
      turn: (await resolveLedgerTurn(db)) ?? command.turn,
      createdAt: now,
      txType: "gov_budget_transfer",
      emitSite: "budget/treasuryReserveTransfer.ts",
      legs: [
        {
          account: accountId("government", command.countryId, currency),
          amount: -command.amount,
          currencyCode: currency,
          anchorAmount: -command.amount / valuation.anchorRate,
          role: "primary",
        },
        {
          account: `central_bank_reserve:${bankId}:${currency}`,
          amount: command.amount,
          currencyCode: currency,
          anchorAmount: command.amount / valuation.anchorRate,
          role: "contra",
        },
      ],
    });
    projections.push({
      collection: "ledgerEntries",
      insert: { ...entry, ...valuation },
      note: "Original conserved treasury/reserve cash witness",
    });
    if (gameConfig?.treasuryCashLedgerEnabled === true) {
      const cashEntry = finalizeLedgerEntry({
        turn: entry.turn,
        createdAt: now,
        txType: "gov_budget_transfer",
        emitSite: "budget/treasuryReserveTransfer.ts:fundedCash",
        legs: [
          {
            account: accountId("government_cash", command.countryId, currency),
            amount: -command.amount,
            currencyCode: currency,
            anchorAmount: -command.amount / valuation.anchorRate,
            role: "primary",
          },
          {
            account: `central_bank_reserve:${bankId}:${currency}`,
            amount: command.amount,
            currencyCode: currency,
            anchorAmount: command.amount / valuation.anchorRate,
            role: "contra",
          },
        ],
      });
      projections.push({
        collection: "ledgerEntries",
        insert: cashEntry,
        note: "Funded Treasury cash debit witness",
      });
    }
  }
  if (isAuditLogEnabledFromConfig(config)) {
    const context = getAuditRequestContext();
    plan.audit = prepareAuditRecord(
      {
        ...toAuditEnvelope({
          kind: "monetary.executed",
          command: "treasury.reserve_transfer",
          correlationId: context?.traceId ?? commandKey(command.operationId),
          actorClass: command.isAdmin ? "admin" : "player",
          turn: command.turn,
          subjectType: "centralBank",
          subjectId: bankId,
          settlementId: commandKey(command.operationId),
          outcome: "ok",
          amount: command.amount,
          currency,
        }),
        currencyCode: currency,
        actor: { kind: command.isAdmin ? "admin" : "player", characterId: command.actorId },
        seq: context?.nextSeq(),
      },
      {
        turn: command.turn,
        ts: now,
        turnLengthMinutes: config?.turnLengthMinutes ?? DEFAULT_TURN_LENGTH_MINUTES,
      }
    );
  }
  const claim = await claimMoneyMove(db, {
    key: commandKey(command.operationId),
    kind: "treasury_reserve_transfer",
    turn: command.turn,
    legs: [
      {
        kind: "debit",
        amount: command.amount,
        collection: "federalBudget",
        filter: plan.treasuryCashLedgerEnabled
          ? { _id: budgetId, treasuryCashLocal: { $gte: command.amount } }
          : { _id: budgetId },
        path: plan.treasuryCashLedgerEnabled ? "treasuryCashLocal" : "treasuryBalance",
        note: "Signed native treasury position",
      },
      {
        kind: "credit",
        amount: command.amount,
        collection: "centralBanks",
        filter: { _id: bankId },
        path: "reserveBalance",
        note: "Native central-bank reserves",
      },
    ],
    ...(plan.treasuryCashLedgerEnabled
      ? {
          projections: [
            {
              collection: "federalBudget",
              filter: { _id: budgetId },
              update: { $inc: { treasuryBalance: -command.amount } },
              note: "Keep signed fiscal position aligned with the funded reserve transfer",
            },
          ],
        }
      : {}),
    record: {
      currency,
      treasuryReserveTransfer: plan,
      treasuryReserveRecoveryPending: true,
      projections: projections.map((projection) => ({
        projection,
        collection: projection.collection,
        note: projection.note,
        claimedAt: null,
        appliedAt: null,
        applied: false,
      })),
    },
  });
  if (claim.status === "rejected") throw new TreasuryReserveTransferRejected(claim.error);
}
async function release(db: Db, key: string, bankId: string): Promise<void> {
  await db
    .collection<BalanceDocument>("centralBanks")
    .updateOne(
      { _id: bankId, pendingTreasuryReserveKey: key },
      { $unset: { pendingTreasuryReserveKey: "" } }
    );
}
async function publishAudit(db: Db, receipt: Receipt): Promise<void> {
  const plan = receipt.treasuryReserveTransfer;
  if (!plan.audit || plan.auditDelivered) {
    await db
      .collection<Receipt>(MONEY_MOVE_COLLECTION)
      .updateOne({ _id: receipt._id }, { $set: { treasuryReserveRecoveryPending: false } });
    return;
  }
  try {
    const audit = {
      ...plan.audit,
      ...(plan.state === "rejected" ? { outcome: "rejected" as const, reason: plan.error } : {}),
    };
    const result = await db
      .collection<ActionAuditRecord>("actionAuditLog")
      .updateOne({ _id: audit._id }, { $setOnInsert: audit }, { upsert: true });
    if (
      result.matchedCount === 1 &&
      !isDeepStrictEqual(
        await db.collection<ActionAuditRecord>("actionAuditLog").findOne({ _id: audit._id }),
        audit
      )
    )
      throw new Error("Treasury transfer audit differs from original receipt");
    await db.collection<Receipt>(MONEY_MOVE_COLLECTION).updateOne(
      { _id: receipt._id },
      {
        $set: {
          "treasuryReserveTransfer.auditDelivered": true,
          treasuryReserveRecoveryPending: false,
        },
      }
    );
  } catch (error) {
    Sentry.captureException(error, {
      extra: { phase: "treasuryReserveTransfer.audit", key: receipt._id },
    });
  }
}
export async function executeTreasuryReserveTransfer(
  db: Db,
  command: Command
): Promise<TreasuryTransferRecord> {
  const key = commandKey(command.operationId),
    journal = db.collection<Receipt>(MONEY_MOVE_COLLECTION);
  let receipt = await journal.findOne({ _id: key });
  if (!receipt) {
    await prepare(db, command);
    receipt = await journal.findOne({ _id: key });
  }
  if (!receipt) throw new Error("Treasury transfer claim missing");
  assertSame(receipt.treasuryReserveTransfer.command, command);
  const result = await resumeTreasuryReserveTransfer(db, key);
  if (result.status === "rejected")
    throw new TreasuryReserveTransferRejected(result.error ?? "Treasury transfer rejected");
  if (result.error || result.status === "partial")
    throw new Error(result.error ?? "Treasury transfer remains pending");
  return receipt.treasuryReserveTransfer.record;
}
export async function resumeTreasuryReserveTransfer(
  db: Db,
  key: string
): Promise<SettlementResult> {
  const journal = db.collection<Receipt>(MONEY_MOVE_COLLECTION);
  let receipt = await journal.findOne({ _id: key });
  if (!receipt?.treasuryReserveTransfer) throw new Error("Treasury transfer receipt missing");
  let plan = receipt.treasuryReserveTransfer;
  const result = (status: SettlementResult["status"], error?: string): SettlementResult => ({
    status,
    key,
    appliedLegs: receipt!.legs.flatMap((x, i) => (x.applied ? [i] : [])),
    appliedProjections: [],
    newlyAppliedProjections: [],
    ...(error ? { error } : {}),
  });
  if (plan.state === "rejected") {
    await release(db, key, plan.bankId);
    await publishAudit(db, receipt);
    return result("rejected", plan.error);
  }
  if (receipt.projectionsCompletedAt) {
    await release(db, key, plan.bankId);
    await publishAudit(db, receipt);
    return result("replayed");
  }
  const banks = db.collection<BalanceDocument>("centralBanks");
  if (plan.state === "planning") {
    const claimed = await banks.updateOne(
      {
        _id: plan.bankId,
        treasuryTransferInProgressAt: { $exists: false },
        pendingTreasuryReserveKey: { $exists: false },
        ...(!plan.command.isAdmin
          ? {
              $expr: {
                $ne: [
                  { $ifNull: [{ $arrayElemAt: ["$treasuryTransferHistory.turn", -1] }, null] },
                  plan.command.turn,
                ],
              },
            }
          : {}),
      },
      { $set: { pendingTreasuryReserveKey: key } }
    );
    if (
      claimed.matchedCount !== 1 &&
      !(await banks.findOne(
        { _id: plan.bankId, pendingTreasuryReserveKey: key },
        { projection: { _id: 1 } }
      ))
    ) {
      await journal.updateOne(
        { _id: key, "treasuryReserveTransfer.state": "planning" },
        {
          $set: {
            status: "rejected",
            "treasuryReserveTransfer.state": "rejected",
            "treasuryReserveTransfer.error":
              "Only one treasury transfer per turn is permitted, or another transfer is pending.",
          },
        }
      );
    } else {
      await journal.updateOne(
        { _id: key, "treasuryReserveTransfer.state": "planning" },
        { $set: { "treasuryReserveTransfer.state": "admitted" } }
      );
    }
    receipt = await journal.findOne({ _id: key });
    if (!receipt) throw new Error("Treasury transfer disappeared");
    plan = receipt.treasuryReserveTransfer;
    if (plan.state === "rejected") return resumeTreasuryReserveTransfer(db, key);
    if (plan.state !== "admitted") throw new Error("Treasury transfer admission incomplete");
  }
  const budgets = db.collection<BalanceDocument>("federalBudget");
  // Freeze delivery generations only after this command owns the reservation.
  // They survive the bounded shared receipt array and prevent an old suspended
  // attempt from applying again after later transfers have evicted its stamp.
  if (plan.sourceRevision === undefined) {
    const [source, destination] = await Promise.all([
      budgets.findOne({ _id: plan.budgetId }, { projection: { treasuryReserveRevision: 1 } }),
      banks.findOne(
        { _id: plan.bankId, pendingTreasuryReserveKey: key },
        { projection: { treasuryReserveRevision: 1 } }
      ),
    ]);
    if (!source || !destination)
      return result("partial", "Treasury transfer reservation or source is unavailable");
    await journal.updateOne(
      { _id: key, "treasuryReserveTransfer.sourceRevision": { $exists: false } },
      {
        $set: {
          "treasuryReserveTransfer.sourceRevision": source.treasuryReserveRevision ?? 0,
          "treasuryReserveTransfer.destinationRevision": destination.treasuryReserveRevision ?? 0,
        },
      }
    );
    receipt = await journal.findOne({ _id: key });
    if (!receipt) throw new Error("Treasury transfer disappeared");
    plan = receipt.treasuryReserveTransfer;
  }
  const revisionGuard = (revision: number) =>
    revision === 0
      ? { $or: [{ treasuryReserveRevision: { $exists: false } }, { treasuryReserveRevision: 0 }] }
      : { treasuryReserveRevision: revision };
  async function wasDelivered(
    collection: typeof budgets,
    id: string,
    revision: number,
    index: number,
    stamp: string
  ): Promise<boolean> {
    const [target, owner, latest] = await Promise.all([
      collection.findOne(
        { _id: id },
        {
          projection: { treasuryReserveRevision: 1, treasuryReserveRejectedKey: 1, settledKeys: 1 },
        }
      ),
      banks.findOne(
        { _id: plan.bankId, pendingTreasuryReserveKey: key },
        { projection: { _id: 1 } }
      ),
      journal.findOne({ _id: key }, { projection: { legs: 1 } }),
    ]);
    return (
      target?.treasuryReserveRejectedKey !== key &&
      (latest?.legs[index]?.applied === true ||
        target?.settledKeys?.includes(stamp) === true ||
        (!!owner && target?.treasuryReserveRevision === revision + 1))
    );
  }
  const debitStamp = legStamp(key, 0),
    creditStamp = legStamp(key, 1);
  if (!receipt.legs[0]?.applied) {
    const debit = await budgets.updateOne(
      {
        _id: plan.budgetId,
        settledKeys: { $ne: debitStamp },
        ...revisionGuard(plan.sourceRevision!),
        ...(plan.treasuryCashLedgerEnabled
          ? { treasuryCashLocal: { $gte: plan.command.amount } }
          : { treasuryBalance: { $gte: -Number.MAX_VALUE, $lte: Number.MAX_VALUE } }),
        ...(plan.debtFloor !== undefined
          ? {
              $expr: {
                $gte: [
                  {
                    $subtract: [
                      { $ifNull: ["$revenue.total", 0] },
                      { $ifNull: ["$spending.total", 0] },
                    ],
                  },
                  plan.debtFloor,
                ],
              },
            }
          : {}),
      },
      {
        $inc: {
          ...(plan.treasuryCashLedgerEnabled
            ? {
                treasuryCashLocal: -plan.command.amount,
                treasuryBalance: -plan.command.amount,
              }
            : { treasuryBalance: -plan.command.amount }),
          treasuryReserveRevision: 1,
        },
        $set: { updatedAt: new Date() },
        $push: { settledKeys: { $each: [debitStamp], $slice: -SETTLED_KEYS_CAP } },
      }
    );
    if (
      debit.matchedCount !== 1 &&
      !(await wasDelivered(budgets, plan.budgetId, plan.sourceRevision!, 0, debitStamp))
    ) {
      if (plan.debtFloor !== undefined) {
        // A known refusal must compete with cash delivery on the same source
        // generation. Advancing it without a cash write makes rejection durable
        // even if its acknowledgement is lost or another retry is suspended.
        await budgets.updateOne(
          {
            _id: plan.budgetId,
            settledKeys: { $ne: debitStamp },
            ...revisionGuard(plan.sourceRevision!),
            $expr: {
              $lt: [
                {
                  $subtract: [
                    { $ifNull: ["$revenue.total", 0] },
                    { $ifNull: ["$spending.total", 0] },
                  ],
                },
                plan.debtFloor,
              ],
            },
          },
          {
            $inc: { treasuryReserveRevision: 1 },
            $set: { treasuryReserveRejectedKey: key },
          }
        );
        if (await budgets.findOne({ _id: plan.budgetId, treasuryReserveRejectedKey: key })) {
          const error = "Transfer would breach the federal debt ceiling.";
          await journal.updateOne(
            { _id: key, "treasuryReserveTransfer.state": "admitted" },
            {
              $set: {
                status: "rejected",
                "treasuryReserveTransfer.state": "rejected",
                "treasuryReserveTransfer.error": error,
              },
            }
          );
          return resumeTreasuryReserveTransfer(db, key);
        }
      }
      if (!(await wasDelivered(budgets, plan.budgetId, plan.sourceRevision!, 0, debitStamp)))
        return result("partial", "Original treasury transfer cannot currently debit its source");
    }
    await journal.updateOne({ _id: key }, { $set: { "legs.0.applied": true } });
    receipt.legs[0].applied = true;
  }
  if (!receipt.legs[1]?.applied) {
    const credit = await banks.updateOne(
      {
        _id: plan.bankId,
        settledKeys: { $ne: creditStamp },
        ...revisionGuard(plan.destinationRevision!),
        pendingTreasuryReserveKey: key,
      },
      {
        $inc: { reserveBalance: plan.command.amount, treasuryReserveRevision: 1 },
        $set: { updatedAt: new Date() },
        $push: {
          settledKeys: { $each: [creditStamp], $slice: -SETTLED_KEYS_CAP },
          treasuryTransferHistory: { $each: [plan.record], $slice: -TREASURY_TRANSFER_HISTORY_MAX },
        },
      }
    );
    if (
      credit.matchedCount !== 1 &&
      !(await wasDelivered(banks, plan.bankId, plan.destinationRevision!, 1, creditStamp))
    )
      return result(
        "partial",
        "Original treasury transfer cannot currently credit its destination"
      );
    await journal.updateOne({ _id: key }, { $set: { "legs.1.applied": true } });
    receipt.legs[1].applied = true;
  }
  const projected = await recoverProjections(db, key);
  if (projected.error || projected.status === "partial")
    return { ...projected, appliedLegs: [0, 1] };
  // Empty projection sets also need the completion marker used by command replay.
  await journal.updateOne(
    { _id: key },
    {
      $set: { status: "applied", projectionsCompletedAt: new Date(), completedAt: new Date() },
      $unset: { error: "" },
    }
  );
  await release(db, key, plan.bankId);
  await publishAudit(db, receipt);
  return { ...projected, appliedLegs: [0, 1] };
}

const indexed = new WeakSet<Db>();
export async function resumeTreasuryReserveTransfers(db: Db): Promise<void> {
  if (!indexed.has(db)) {
    await db.collection(MONEY_MOVE_COLLECTION).createIndex(
      { treasuryReserveRecoveryPending: 1, _id: 1 },
      {
        name: "treasury_reserve_pending",
        partialFilterExpression: { treasuryReserveRecoveryPending: true },
      }
    );
    indexed.add(db);
  }
  const pending = await db
    .collection<Receipt>(MONEY_MOVE_COLLECTION)
    .find({ treasuryReserveRecoveryPending: true })
    .project<{ _id: string }>({ _id: 1 })
    .sort({ _id: 1 })
    .limit(100)
    .toArray();
  for (const row of pending) {
    const result = await resumeTreasuryReserveTransfer(db, row._id);
    if (result.status === "partial")
      throw new Error(result.error ?? "Treasury transfer recovery incomplete");
  }
}
