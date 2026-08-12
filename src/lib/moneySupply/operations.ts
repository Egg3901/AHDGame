import { ObjectId, type Db } from "mongodb";
import type {
  Bond,
  CentralBank,
  Corporation,
  FederalBudget,
  GameConfig,
  MonetaryOperationRecord,
  MonetaryOperationType,
} from "@/lib/db/types";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { deriveFiscalState } from "@/lib/budget/treasuryBalance";
import { accountId } from "@/lib/ledger/accounts";
import { emitLedgerEntries } from "@/lib/ledger/emit";
import { isLedgerShadowEnabledFromConfig } from "@/lib/ledger/featureFlag";
import { planOpenMarketOperation } from "./quantitativeEasing";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";

export const MONETARY_OPERATION_COOLDOWN_TURNS = 6;
export const DIRECT_ADVANCE_GDP_CAP = 0.01;
export const LIQUIDITY_INJECTION_GDP_CAP = 0.03;

export interface ExecuteMonetaryOperationInput {
  countryId: CountryId;
  type: MonetaryOperationType;
  turn: number;
  actorName: string;
  reason?: string;
  amount?: number;
  bondId?: string;
  units?: number;
}

export async function executeMonetaryOperation(
  db: Db,
  input: ExecuteMonetaryOperationInput
): Promise<MonetaryOperationRecord> {
  const bankId = getBankId(input.countryId);
  const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
  if (!bank) throw new Error("Central bank not found");
  const now = new Date();
  let record: MonetaryOperationRecord;

  if (input.type === "qe" || input.type === "qt") {
    if (!input.bondId || !ObjectId.isValid(input.bondId)) throw new Error("Valid bond required");
    const bond = await db.collection<Bond>("bonds").findOne({
      _id: new ObjectId(input.bondId),
      issuerType: "sovereign",
      countryId: input.countryId,
      matured: false,
      defaulted: false,
    });
    if (!bond) throw new Error("Eligible sovereign bond not found");
    const plan = planOpenMarketOperation({
      operation: input.type,
      requestedUnits: input.units ?? 0,
      publicFloat: bond.publicFloat,
      centralBankHoldings: bond.centralBankHoldings ?? 0,
      totalIssued: bond.totalIssued,
      marketPrice: bond.marketPrice,
    });
    if (plan.units <= 0) throw new Error("No bond units available for this operation");
    if (input.type === "qt" && plan.consideration > (bank.externalBroadMoney ?? 0))
      throw new Error("QT would retire more external deposits than remain");
    const supportDelta = plan.qeSupportRatio - (bond.qeSupportRatio ?? 0);
    const marketPrice = Math.min(2, Math.max(0.05, bond.marketPrice * (1 + supportDelta * 0.5)));
    await db.collection<Bond>("bonds").updateOne(
      { _id: bond._id },
      {
        $set: {
          publicFloat: plan.publicFloat,
          centralBankHoldings: plan.centralBankHoldings,
          qeSupportRatio: plan.qeSupportRatio,
          marketPrice,
          updatedAt: now,
        },
      }
    );
    record = {
      type: input.type,
      turn: input.turn,
      amount: plan.consideration,
      moneySupplyDelta: plan.moneySupplyDelta,
      reserveDelta: 0,
      bondId: bond._id.toString(),
      units: plan.units,
      actorName: input.actorName,
      reason: input.reason,
      createdAt: now,
    };
    await persistBankOperation(db, bankId, record, {
      externalBroadMoney: plan.moneySupplyDelta,
      netMoneyCreatedLifetime: plan.moneySupplyDelta,
    });
    return record;
  }

  const amount = Math.max(0, Math.floor(input.amount ?? 0));
  if (amount <= 0) throw new Error("Amount must be positive");
  if (input.type === "treasury_advance") {
    const budgetId = getNationalBudgetId(input.countryId);
    const budgets = db.collection<FederalBudget>("federalBudget");
    const budget = await budgets.findOne({ _id: budgetId } as { _id: "federal" });
    if (!budget) throw new Error("Federal budget not found");
    const before = budget.treasuryBalance ?? -(budget.debt?.principal ?? 0);
    const after = before + amount;
    const derived = deriveFiscalState({
      treasuryBalance: after,
      gdp: budget.gdp ?? 0,
      gdpSmoothed: budget.gdpSmoothed,
      ceiling: budget.debt?.ceiling ?? 0,
      investorConfidence: budget.investorConfidence,
      imfBailoutActive: budget.imfSovereignBailoutActive,
      sovereignRiskAnchor: budget.sovereignRiskAnchor,
    });
    const updated = await budgets.updateOne(
      { _id: budgetId, treasuryBalance: budget.treasuryBalance } as {
        _id: "federal";
        treasuryBalance: number;
      },
      {
        $set: {
          treasuryBalance: after,
          "debt.principal": derived.principal,
          "debt.interestRate": derived.interestRate,
          debtToGdpRatio: derived.debtToGdpRatio,
          creditRating: derived.creditRating,
          updatedAt: now,
        },
      }
    );
    if (updated.modifiedCount !== 1)
      throw new Error("Federal budget changed concurrently; retry the monetary operation");
    record = {
      type: input.type,
      turn: input.turn,
      amount,
      moneySupplyDelta: amount,
      reserveDelta: 0,
      actorName: input.actorName,
      reason: input.reason,
      createdAt: now,
    };
    await persistBankOperation(db, bankId, record, { netMoneyCreatedLifetime: amount });
    await emitTreasuryAdvanceLedgerEntry(db, input, amount, now);
    return record;
  }

  // Liquidity injection: the control is labelled "lend more to banks", so it now
  // lends to banks. Previously it only incremented the central bank's own
  // `reserveBalance` with `moneySupplyDelta: 0`, which was a no-op for private
  // credit — the chair could pull it all day and no bank could lend a penny more.
  const advance = await advanceToPrivateBanks(db, input.countryId, amount, now, input.turn);
  if (advance.banksCredited > 0) {
    record = {
      type: input.type,
      turn: input.turn,
      amount: advance.distributed,
      moneySupplyDelta: advance.distributed,
      reserveDelta: 0,
      actorName: input.actorName,
      reason: input.reason,
      createdAt: now,
      banksCredited: advance.banksCredited,
    };
    await persistBankOperation(db, bankId, record, {
      netMoneyCreatedLifetime: advance.distributed,
    });
    return record;
  }

  // No chartered bank can take the money (private banking off, or none seated in
  // this currency). Fall back to the historical behaviour — the cash buffers the
  // bank's own reserve pool — rather than failing the operation outright.
  record = {
    type: input.type,
    turn: input.turn,
    amount,
    moneySupplyDelta: 0,
    reserveDelta: amount,
    actorName: input.actorName,
    reason: input.reason,
    createdAt: now,
    banksCredited: 0,
  };
  await persistBankOperation(db, bankId, record, { reserveBalance: amount });
  return record;
}

/**
 * Lend `amount` of newly created central-bank money to the chartered banks of
 * this country's currency, pro rata by deposits (equal split when no bank holds
 * any). The cash lands in each bank's liquid capital and is booked as CB advance
 * debt on the charter, so it repays through the existing margin-repay path and
 * is never free money.
 *
 * Returns what was actually distributed; a zero `banksCredited` means the caller
 * should fall back rather than pretend the money moved.
 */
async function advanceToPrivateBanks(
  db: Db,
  countryId: CountryId,
  amount: number,
  now: Date,
  turn: number
): Promise<{ distributed: number; banksCredited: number }> {
  if (!(await isPrivateBankingEnabled())) return { distributed: 0, banksCredited: 0 };

  const currency = COUNTRY_CURRENCY_MAP[countryId];
  const banks = await db
    .collection<Corporation>("corporations")
    .find(
      { "bankCharter.status": "active", "bankCharter.currency": currency },
      { projection: { _id: 1, name: 1, bankCharter: 1 } }
    )
    .toArray();
  if (banks.length === 0) return { distributed: 0, banksCredited: 0 };

  const weights = banks.map((b) => Math.max(0, b.bankCharter?.totalDeposits ?? 0));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const shares = banks.map((_, i) =>
    totalWeight > 0
      ? Math.floor((amount * weights[i]) / totalWeight)
      : Math.floor(amount / banks.length)
  );

  const ops = banks
    .map((bank, i) => ({ bank, share: shares[i] }))
    .filter(({ share }) => share > 0)
    .map(({ bank, share }) => ({
      updateOne: {
        filter: { _id: bank._id, "bankCharter.status": "active" },
        update: {
          $inc: { liquidCapital: share, "bankCharter.cbMarginDebt": share },
          $set: { updatedAt: now },
        },
      },
    }));
  if (ops.length === 0) return { distributed: 0, banksCredited: 0 };

  await db.collection<Corporation>("corporations").bulkWrite(ops);

  // Newly created central-bank money landing in a private bank's cash. Mirrors
  // the discount-window draw: a `government` counterparty is not derivable from
  // a tx row (there is no countryId for the OTHER side), so the row resolves to
  // a mint contra, which is exactly right for money the central bank just made.
  const nameById = new Map(banks.map((b) => [b._id.toString(), b.name ?? "Bank"]));
  const thresholds = await loadTxThresholds(db);
  await emitTxBulk(
    db,
    ops.map((op) => ({
      type: "bank_cb_advance" as const,
      turn,
      createdAt: now,
      subjectType: "corporation" as const,
      subjectId: op.updateOne.filter._id,
      subjectName: nameById.get(op.updateOne.filter._id.toString()) ?? "Bank",
      amount: op.updateOne.update.$inc.liquidCapital,
      currencyCode: currency as CurrencyCode,
      counterpartyType: "government" as const,
      counterpartyName: `${countryId} central bank`,
      meta: { kind: "liquidity_injection" },
    })),
    thresholds
  );

  return {
    distributed: ops.reduce((sum, op) => sum + (op.updateOne.update.$inc.liquidCapital ?? 0), 0),
    banksCredited: ops.length,
  };
}

async function emitTreasuryAdvanceLedgerEntry(
  db: Db,
  input: ExecuteMonetaryOperationInput,
  amount: number,
  createdAt: Date
): Promise<void> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { ledgerShadow: 1 } });
  if (!isLedgerShadowEnabledFromConfig(config)) return;
  const currency = (COUNTRY_CURRENCY_MAP[input.countryId] ?? "USD") as CurrencyCode;
  const exchangeRate = await db
    .collection<{ currencyCode: CurrencyCode; rate: number }>("exchangeRates")
    .findOne({ currencyCode: currency }, { projection: { rate: 1 } });
  const anchorAmount =
    exchangeRate?.rate && exchangeRate.rate > 0 ? amount / exchangeRate.rate : amount;
  await emitLedgerEntries(db, [
    {
      turn: input.turn,
      createdAt,
      txType: "monetary_treasury_advance",
      legs: [
        {
          account: accountId("government", input.countryId, currency),
          amount,
          currencyCode: currency,
          anchorAmount,
          role: "primary",
        },
        {
          account: accountId("mint", "treasury_advance", currency),
          amount: -amount,
          currencyCode: currency,
          anchorAmount: -anchorAmount,
          role: "contra",
        },
      ],
      emitSite: "moneySupply/operations.ts:treasury_advance",
    },
  ]);
}

async function persistBankOperation(
  db: Db,
  bankId: string,
  record: MonetaryOperationRecord,
  increments: Record<string, number>
): Promise<void> {
  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bankId },
    {
      $inc: increments,
      $set: { lastMonetaryOperationTurn: record.turn, updatedAt: record.createdAt },
      $push: { monetaryOperations: { $each: [record], $slice: -100 } },
    }
  );
}
