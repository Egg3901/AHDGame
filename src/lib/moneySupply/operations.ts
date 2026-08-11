import { ObjectId, type Db } from "mongodb";
import type {
  Bond,
  CentralBank,
  FederalBudget,
  GameConfig,
  MonetaryOperationRecord,
  MonetaryOperationType,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { deriveFiscalState } from "@/lib/budget/treasuryBalance";
import { accountId } from "@/lib/ledger/accounts";
import { emitLedgerEntries } from "@/lib/ledger/emit";
import { isLedgerShadowEnabledFromConfig } from "@/lib/ledger/featureFlag";
import { planOpenMarketOperation } from "./quantitativeEasing";

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

  record = {
    type: input.type,
    turn: input.turn,
    amount,
    moneySupplyDelta: 0,
    reserveDelta: amount,
    actorName: input.actorName,
    reason: input.reason,
    createdAt: now,
  };
  await persistBankOperation(db, bankId, record, { reserveBalance: amount });
  return record;
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
