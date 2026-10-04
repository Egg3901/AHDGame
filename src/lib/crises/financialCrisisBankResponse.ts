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
  turn: number;
  createdAt: Date;
}

/** Weakest active domestic banks first; stable ordering makes retries deterministic. */
export function rankBanksForFinancialIntervention(
  banks: Pick<Corporation, "_id" | "bankCharter">[]
): Pick<Corporation, "_id" | "bankCharter">[] {
  return [...banks]
    .filter((bank) => bank.bankCharter?.status === "active")
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
  const treasuryCashLedgerEnabled =
    response === "resolve"
      ? false
      : (ctx.treasuryCashLedgerEnabled ?? (await loadBankingPolicy(ctx.db)).treasuryCashLedger);
  await prepareFinancialCrisisBankResponse(
    ctx.db,
    ctx.countryId,
    ctx.option,
    treasuryCashLedgerEnabled
  );
  const budget = await ctx.db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: ctx.countryId as FederalBudget["countryId"] });
  const currency = resolveCountryCurrencyCode(budget);
  if (!budget || !currency) throw new Error("Treasury currency is unavailable");
  const banks = rankBanksForFinancialIntervention(
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
  const amount =
    response === "resolve"
      ? 0
      : financialInterventionAmount(
          budget?.gdpSmoothed || budget?.gdp || 0,
          ctx.option.treasuryCostPctGdp ?? 0
        );
  if (response === "guarantee") {
    // Zero cash is safe to initialize outside settlement; activation happens
    // only after the journal has delivered every funded leg.
    await ctx.db.collection<{ _id: string }>("bankGuarantees").updateOne(
      { _id: actionId },
      {
        $setOnInsert: {
          crisisActionId: actionId,
          countryId: ctx.countryId,
          currency,
          bankIds: banks.map((bank) => bank._id),
          guaranteeLimit: amount,
          escrowBalance: 0,
          status: "pending",
          openedTurn: ctx.currentTurn,
          expiresTurn: ctx.currentTurn + TURNS_PER_YEAR,
        },
      },
      { upsert: true }
    );
  }
  const transition = financialRescueTransition({
    key: actionId,
    countryId: ctx.countryId,
    treasuryId: budget._id,
    currency,
    turn: ctx.currentTurn,
    amount,
    response,
    banks: banks.map((bank) => ({
      id: bank._id.toHexString(),
      confidence: bank.bankCharter?.confidence ?? 0.5,
    })),
    treasuryCashLedgerEnabled,
  });
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
      turn: ctx.currentTurn,
    },
    note: "Publish the completed funded intervention",
  });
  const result = await settleTransition(ctx.db, transition);
  if (result.error || result.status === "partial" || result.status === "rejected")
    throw new Error(result.error ?? "Rescue settlement is incomplete");
}
