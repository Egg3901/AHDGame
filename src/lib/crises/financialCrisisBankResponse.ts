import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CrisisActionContext } from "./optionActions";
import type { Db } from "mongodb";
import type { CrisisDecisionOption } from "@/lib/db/types/crisis";
import { badRequest } from "@/lib/api/errors";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { settleTransition } from "@/lib/banking/settlementJournal";
import {
  financialInterventionAmount,
  financialRescueTransition,
} from "@/lib/livingConflict/rules/financialRescue";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { loadBankingPolicy } from "@/lib/banking/policy";

export type FinancialCrisisBankResponse = "recapitalize" | "guarantee" | "resolve";

interface FinancialCrisisBankAction {
  _id: string;
  crisisId: ObjectId;
  interactionId: ObjectId;
  countryId: string;
  response: FinancialCrisisBankResponse;
  amount: number;
  bankIds: ObjectId[];
  bankEpochs: { bankId: ObjectId; charteredTurn: number; currency: string }[];
  turn: number;
  createdAt: Date;
}

interface PendingFinancialGuarantee {
  _id: string;
  countryId: string;
  currency: string;
  bankIds: ObjectId[];
  bankEpochs: { bankId: ObjectId; charteredTurn: number; currency: string }[];
  openedTurn: number;
  treasuryId: FederalBudget["_id"];
  treasuryCurrencyCodePresent: boolean;
  treasuryCurrencyCode?: string | null;
  treasuryCashLedgerEnabled: boolean;
  amount: number;
  status: "pending" | "active";
  expiresTurn: number;
}

/** Weakest active domestic banks first; stable ordering makes retries deterministic. */
export function rankBanksForFinancialIntervention(
  banks: Pick<Corporation, "_id" | "bankCharter">[]
): Pick<Corporation, "_id" | "bankCharter">[] {
  return [...banks]
    .filter(
      (bank) =>
        bank.bankCharter?.status === "active" &&
        Number.isInteger(bank.bankCharter.charteredTurn) &&
        typeof bank.bankCharter.currency === "string"
    )
    .sort(
      (a, b) =>
        (a.bankCharter?.confidence ?? 0.5) - (b.bankCharter?.confidence ?? 0.5) ||
        a._id.toString().localeCompare(b._id.toString())
    );
}

/** Reject unavailable interventions before the public response is claimed. */
export async function prepareFinancialCrisisBankResponse(
  db: Db,
  countryId: string,
  option: CrisisDecisionOption,
  treasuryCashLedgerEnabled?: boolean
): Promise<void> {
  if (option.action?.kind !== "financialCrisisResponse") return;
  if (!["recapitalize", "guarantee", "resolve"].includes(option.action.response)) return;
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: countryId as FederalBudget["countryId"] });
  const currency = resolveCountryCurrencyCode(budget);
  const cashLedgerEnabled =
    option.action.response === "resolve"
      ? false
      : (treasuryCashLedgerEnabled ?? (await loadBankingPolicy(db)).treasuryCashLedger);
  const eligible = await db.collection<Corporation>("corporations").findOne(
    {
      countryId: countryId as Corporation["countryId"],
      "bankCharter.status": "active",
      "bankCharter.currency": currency,
    },
    { projection: { _id: 1 } }
  );
  if (!currency || !eligible)
    throw badRequest("No active domestic bank uses the treasury currency.");
  if (option.action.response === "resolve") return;
  const amount = financialInterventionAmount(
    budget?.gdpSmoothed || budget?.gdp || 0,
    option.treasuryCostPctGdp ?? 0
  );
  const availableCash = cashLedgerEnabled
    ? (budget?.treasuryCashLocal ?? 0)
    : (budget?.treasuryBalance ?? 0);
  if (!(amount > 0) || availableCash < amount) {
    throw badRequest(
      "The rescue needs funded treasury cash. Raise funding through the sovereign bond market first."
    );
  }
}

export async function applyFinancialCrisisBankResponse(
  ctx: CrisisActionContext,
  response: FinancialCrisisBankResponse
): Promise<void> {
  const actionId = [ctx.crisis._id, ctx.interaction._id, ctx.countryId, response].join(":");
  const prior = await ctx.db
    .collection<FinancialCrisisBankAction>("financialCrisisBankActions")
    .findOne({ _id: actionId });
  if (prior) return;
  // A durable quote owns all legs and projections. Recover it before considering
  // a new quote from balances or charter statuses the first attempt changed.
  const pending = await ctx.db
    .collection<{ _id: string }>("bankMoneyMoves")
    .findOne({ _id: actionId });
  if (pending)
    throw new Error("Rescue settlement is pending recovery; funding will not be duplicated");
  const guaranteeCollection = ctx.db.collection<PendingFinancialGuarantee>("bankGuarantees");
  // The unfunded shell is written before settlement so a process crash cannot
  // cause a retry to quote a different bank cohort, source balance or amount.
  let pendingGuarantee =
    response === "guarantee"
      ? await guaranteeCollection.findOne({ _id: actionId, status: "pending" })
      : null;
  const treasuryCashLedgerEnabled = pendingGuarantee
    ? pendingGuarantee.treasuryCashLedgerEnabled
    : response === "resolve"
      ? false
      : (ctx.treasuryCashLedgerEnabled ?? (await loadBankingPolicy(ctx.db)).treasuryCashLedger);
  let budget: FederalBudget | null;
  let currency: string | undefined;
  let banks: Pick<Corporation, "_id" | "bankCharter">[];
  let amount: number;
  if (pendingGuarantee) {
    const frozen = pendingGuarantee;
    budget = (await ctx.db
      .collection<{
        _id: string;
        countryId: string;
        currencyCode?: string | null;
      }>("federalBudget")
      .findOne({
        _id: frozen.treasuryId,
        countryId: frozen.countryId,
        currencyCode: frozen.treasuryCurrencyCodePresent
          ? { $exists: true, $eq: frozen.treasuryCurrencyCode }
          : { $exists: false },
      })) as FederalBudget | null;
    currency = frozen.currency;
    if (!budget || ctx.countryId !== frozen.countryId)
      throw new Error("Original guarantee funding treasury changed before settlement");
    banks = await ctx.db
      .collection<Corporation>("corporations")
      .find(
        {
          $or: frozen.bankEpochs.map((bank) => ({
            _id: bank.bankId,
            countryId: frozen.countryId as Corporation["countryId"],
            "bankCharter.status": "active",
            "bankCharter.charteredTurn": bank.charteredTurn,
            "bankCharter.currency": bank.currency,
          })),
        },
        { projection: { bankCharter: 1 } }
      )
      .toArray();
    amount = frozen.amount;
    if (banks.length !== frozen.bankEpochs.length)
      throw new Error("Original guarantee bank charter epoch changed before settlement");
  } else {
    await prepareFinancialCrisisBankResponse(
      ctx.db,
      ctx.countryId,
      ctx.option,
      treasuryCashLedgerEnabled
    );
    budget = await ctx.db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: ctx.countryId as FederalBudget["countryId"] });
    currency = resolveCountryCurrencyCode(budget);
    if (!budget || !currency) throw new Error("Treasury currency is unavailable");
    banks = rankBanksForFinancialIntervention(
      await ctx.db
        .collection<Corporation>("corporations")
        .find(
          {
            countryId: ctx.countryId as Corporation["countryId"],
            "bankCharter.status": "active",
            "bankCharter.currency": currency,
          },
          { projection: { bankCharter: 1 } }
        )
        .toArray()
    ).slice(0, 3);
    amount =
      response === "resolve"
        ? 0
        : financialInterventionAmount(
            budget.gdpSmoothed || budget.gdp || 0,
            ctx.option.treasuryCostPctGdp ?? 0
          );
  }
  if (response === "guarantee" && !pendingGuarantee) {
    // Zero cash is safe to initialize outside settlement; activation happens
    // only after the journal has delivered every funded leg.
    await guaranteeCollection.updateOne(
      { _id: actionId },
      {
        $setOnInsert: {
          crisisActionId: actionId,
          countryId: ctx.countryId,
          currency,
          bankIds: banks.map((bank) => bank._id),
          bankEpochs: banks.map((bank) => ({
            bankId: bank._id,
            charteredTurn: bank.bankCharter!.charteredTurn,
            currency: bank.bankCharter!.currency,
          })),
          openedTurn: ctx.currentTurn,
          treasuryId: budget._id,
          treasuryCurrencyCodePresent: Object.hasOwn(budget, "currencyCode"),
          ...(Object.hasOwn(budget, "currencyCode")
            ? { treasuryCurrencyCode: budget.currencyCode }
            : {}),
          treasuryCashLedgerEnabled,
          amount,
          guaranteeLimit: amount,
          escrowBalance: 0,
          status: "pending",
          expiresTurn: ctx.currentTurn + TURNS_PER_YEAR,
        },
      },
      { upsert: true }
    );
    // A concurrent request may have won the shell upsert with a different
    // source snapshot. Never fund our local quote unless it matches the
    // durable winner exactly.
    pendingGuarantee = await guaranteeCollection.findOne({ _id: actionId, status: "pending" });
    if (
      !pendingGuarantee ||
      pendingGuarantee.amount !== amount ||
      pendingGuarantee.currency !== currency ||
      pendingGuarantee.countryId !== ctx.countryId ||
      String(pendingGuarantee.treasuryId) !== String(budget._id) ||
      pendingGuarantee.treasuryCurrencyCodePresent !== Object.hasOwn(budget, "currencyCode") ||
      (pendingGuarantee.treasuryCurrencyCodePresent &&
        pendingGuarantee.treasuryCurrencyCode !== budget.currencyCode) ||
      pendingGuarantee.treasuryCashLedgerEnabled !== treasuryCashLedgerEnabled ||
      pendingGuarantee.openedTurn !== ctx.currentTurn ||
      pendingGuarantee.expiresTurn !== ctx.currentTurn + TURNS_PER_YEAR ||
      pendingGuarantee.bankEpochs.length !== banks.length ||
      pendingGuarantee.bankEpochs.some((epoch, index) => {
        const bank = banks[index];
        return (
          !bank ||
          !epoch.bankId.equals(bank._id) ||
          epoch.charteredTurn !== bank.bankCharter!.charteredTurn ||
          epoch.currency !== bank.bankCharter!.currency
        );
      })
    )
      throw new Error("A concurrent request froze a different guarantee funding snapshot");
  }
  const turn = pendingGuarantee?.openedTurn ?? ctx.currentTurn;
  const transition = financialRescueTransition({
    key: actionId,
    countryId: ctx.countryId,
    treasuryId: budget._id,
    currency: currency!,
    turn,
    amount,
    response,
    banks: banks.map((bank) => ({
      id: bank._id.toHexString(),
      charteredTurn: bank.bankCharter!.charteredTurn,
      currency: bank.bankCharter!.currency,
      confidence: bank.bankCharter?.confidence ?? 0.5,
    })),
    treasuryCurrencyCodePresent: Object.hasOwn(budget, "currencyCode"),
    ...(Object.hasOwn(budget, "currencyCode") ? { treasuryCurrencyCode: budget.currencyCode } : {}),
    treasuryCashLedgerEnabled,
  });
  if (response === "guarantee") {
    const frozen = pendingGuarantee!;
    const guaranteeFilter = {
      _id: actionId,
      status: "pending",
      amount: frozen.amount,
      currency: frozen.currency,
      openedTurn: frozen.openedTurn,
      bankEpochs: frozen.bankEpochs,
    };
    for (const leg of transition.legs)
      if (leg.collection === "bankGuarantees") leg.filter = guaranteeFilter;
    for (const projection of transition.projections)
      if (projection.collection === "bankGuarantees") projection.filter = guaranteeFilter;
  }
  transition.projections.push({
    collection: "financialCrisisBankActions",
    insert: {
      _id: actionId,
      crisisId: { $oid: ctx.crisis._id.toHexString() },
      interactionId: { $oid: ctx.interaction._id.toHexString() },
      countryId: ctx.countryId,
      response,
      amount,
      bankIds: banks.map((bank) => ({ $oid: bank._id.toHexString() })),
      bankEpochs: banks.map((bank) => ({
        bankId: { $oid: bank._id.toHexString() },
        charteredTurn: bank.bankCharter!.charteredTurn,
        currency: bank.bankCharter!.currency,
      })),
      turn,
    },
    note: "Publish the completed funded intervention",
  });
  const result = await settleTransition(ctx.db, transition);
  if (result.error || result.status === "partial" || result.status === "rejected")
    throw new Error(result.error ?? "Rescue settlement is incomplete");
}
