import type { Db } from "mongodb";
import type { CrisisDecisionOption } from "@/lib/db/types/crisis";
import type { FederalBudget, Character } from "@/lib/db/types";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import { getOfficeTypeConfig, type CountryId } from "@/lib/constants/countries";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getBankId } from "@/lib/centralBank/helpers";
import { badRequest } from "@/lib/api/errors";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { settleTransition } from "@/lib/banking/settlementJournal";
import type { BankingTransition } from "@/lib/banking/rules/boundary";
import { financialInterventionAmount } from "@/lib/livingConflict/rules/financialRescue";
import { financialAusteritySpending } from "@/lib/livingConflict/rules/financialFiscal";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { buildInitialLegislativePhases } from "@/lib/sovereignDefault/legislative/buildPhases";
import type { CrisisActionContext } from "./optionActions";

export type FinancialFiscalResponse =
  "stimulus" | "austerity" | "restructure" | "sovereign_support";

export async function prepareFinancialFiscalResponse(
  db: Db,
  countryId: string,
  option: CrisisDecisionOption,
  treasuryCashLedgerEnabled?: boolean
): Promise<void> {
  if (option.action?.kind !== "financialCrisisResponse") return;
  const response = option.action.response;
  if (
    response !== "stimulus" &&
    response !== "austerity" &&
    response !== "restructure" &&
    response !== "sovereign_support"
  )
    return;
  if (response === "restructure") {
    const decision = await db
      .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
      .findOne({ countryCode: countryId, state: "open" });
    if (!decision)
      throw badRequest(
        "Restructuring requires an open sovereign funding crisis and parliamentary ratification."
      );
    return;
  }
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: countryId as CountryId });
  if (!budget?.spending || !budget.revenue) throw badRequest("The national budget is unavailable.");
  if (response === "stimulus" || response === "sovereign_support") {
    const amount = financialInterventionAmount(
      budget.gdpSmoothed || budget.gdp,
      option.treasuryCostPctGdp ?? 0
    );
    const currency = resolveCountryCurrencyCode(budget);
    if (
      response === "sovereign_support" &&
      !(await sovereignSupportRecipient(db, countryId, currency))
    )
      throw badRequest("No stressed sovereign shares the treasury currency.");
    const centralBank = await db
      .collection("centralBanks")
      .findOne({ _id: getBankId(countryId as CountryId) as never });
    const availableCash = treasuryCashLedgerEnabled
      ? (budget.treasuryCashLocal ?? 0)
      : budget.treasuryBalance;
    if (!(amount > 0) || availableCash < amount || !centralBank || !currency)
      throw badRequest(
        "Stimulus requires funded treasury cash and an operating monetary authority."
      );
  }
}

export async function applyFinancialFiscalResponse(
  ctx: CrisisActionContext,
  response: FinancialFiscalResponse
): Promise<void> {
  const key = [ctx.crisis._id, ctx.interaction._id, ctx.countryId, response].join(":");
  if (
    await ctx.db.collection<{ _id: string }>("financialCrisisFiscalActions").findOne({ _id: key })
  )
    return;
  if (await ctx.db.collection<{ _id: string }>("bankMoneyMoves").findOne({ _id: key }))
    throw new Error("Fiscal intervention is pending settlement recovery");
  const treasuryCashLedgerEnabled =
    response === "stimulus" || response === "sovereign_support"
      ? (ctx.treasuryCashLedgerEnabled ?? (await loadBankingPolicy(ctx.db)).treasuryCashLedger)
      : false;
  if (response === "restructure") {
    // The global responder proposes; the existing lower/upper chamber pipeline
    // alone can authorize an actual haircut and creditor cascade.
    const actor = await ctx.db
      .collection<Character>("characters")
      .findOne({ _id: ctx.characterId });
    const office = actor?.currentOffice?.type;
    const config = office ? getOfficeTypeConfig(ctx.countryId as CountryId, office) : undefined;
    if (actor?.countryId !== ctx.countryId || !config?.isExecutive || config.isSubNational)
      throw badRequest("Only the national executive can propose sovereign restructuring.");
    const decisions = ctx.db.collection<SovereignCrisisDecision>("sovereignCrisisDecisions");
    const now = Date.now();
    const phases = buildInitialLegislativePhases(ctx.countryId as CountryId, now, ctx.currentTurn);
    const existing = await decisions.findOne({ financialCrisisActionId: key });
    if (!existing) {
      const result = await decisions.updateOne(
        { countryCode: ctx.countryId, state: "open" },
        {
          $set: {
            financialCrisisActionId: key,
            state: "executiveProposed",
            executiveChoice: "restructure",
            executiveProposedAtRealtimeMs: now,
            legislativePhases: phases,
            currentChamberIndex: 0,
            proposingCharacterId: ctx.characterId,
          },
        }
      );
      if (result.modifiedCount !== 1)
        throw badRequest("No open sovereign funding decision remains.");
    }
    await ctx.db
      .collection<FederalBudget>("federalBudget")
      .updateOne(
        { countryId: ctx.countryId as CountryId, sovereignCrisisState: "crisisPending" },
        { $set: { sovereignCrisisState: "crisisResolving" } }
      );
    await ctx.db.collection<{ _id: string }>("financialCrisisFiscalActions").insertOne({
      _id: key,
      response,
      countryId: ctx.countryId,
      turn: ctx.currentTurn,
      status: "awaitingLegislativeRatification",
    } as never);
    return;
  }
  await prepareFinancialFiscalResponse(
    ctx.db,
    ctx.countryId,
    ctx.option,
    treasuryCashLedgerEnabled
  );
  const budget = await ctx.db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: ctx.countryId as CountryId });
  if (!budget) throw new Error("National budget disappeared");
  const currency = resolveCountryCurrencyCode(budget)!;
  if (!currency) throw new Error("National budget currency disappeared");
  const centralBankId = getBankId(ctx.countryId as CountryId);
  const centralBank =
    response === "stimulus" || response === "sovereign_support"
      ? await ctx.db
          .collection<{ _id: string; monetaryAuthorityId?: string }>("centralBanks")
          .findOne({
            _id: centralBankId,
          })
      : null;
  if ((response === "stimulus" || response === "sovereign_support") && !centralBank)
    throw new Error("Monetary authority disappeared");
  const supportRecipient =
    response === "sovereign_support"
      ? await sovereignSupportRecipient(ctx.db, ctx.countryId, currency)
      : null;
  if (response === "sovereign_support" && !supportRecipient)
    throw badRequest("The eligible sovereign recipient is no longer available.");
  const amount =
    response === "stimulus" || response === "sovereign_support"
      ? financialInterventionAmount(
          budget.gdpSmoothed || budget.gdp,
          ctx.option.treasuryCostPctGdp ?? 0
        )
      : 0;
  const treasuryCurrencyFilter = exactOptionalField(
    Object.hasOwn(budget, "currencyCode"),
    budget.currencyCode
  );
  const supportCurrencyFilter = supportRecipient
    ? exactOptionalField(
        Object.hasOwn(supportRecipient, "currencyCode"),
        supportRecipient.currencyCode
      )
    : undefined;
  const centralBankFilter = centralBank
    ? {
        _id: centralBank._id,
        monetaryAuthorityId: exactOptionalField(
          Object.hasOwn(centralBank, "monetaryAuthorityId"),
          centralBank.monetaryAuthorityId
        ),
      }
    : undefined;
  const transition: BankingTransition = {
    key,
    kind: `financial_crisis_${response}`,
    turn: ctx.currentTurn,
    currency,
    legs: [],
    projections: [],
    event: { kind: "account.deposited", command: `financial_crisis.${response}`, amount },
  };
  if (response === "stimulus" || response === "sovereign_support")
    transition.legs = [
      {
        kind: "debit",
        amount,
        collection: "federalBudget",
        filter: treasuryCashLedgerEnabled
          ? {
              _id: budget._id,
              countryId: ctx.countryId,
              currencyCode: treasuryCurrencyFilter,
              treasuryCashLocal: { $gte: amount },
            }
          : { _id: budget._id, countryId: ctx.countryId, currencyCode: treasuryCurrencyFilter },
        path: treasuryCashLedgerEnabled ? "treasuryCashLocal" : "treasuryBalance",
        note: "Fund the household fiscal transfer",
      },
      {
        kind: "credit",
        amount,
        collection: "centralBanks",
        filter: centralBankFilter!,
        path: "externalBroadMoney",
        note: "Deliver stimulus to the modeled household money stock",
      },
    ];
  else {
    const spending = financialAusteritySpending(budget.spending, budget.revenue.total);
    transition.projections.push({
      collection: "federalBudget",
      filter: { _id: budget._id, countryId: ctx.countryId, currencyCode: treasuryCurrencyFilter },
      update: {
        $set: {
          spending,
          surplus: budget.revenue.total - spending.total,
          financialCrisisAusterityUntilTurn: ctx.currentTurn + TURNS_PER_YEAR,
          financialCrisisAusterityBaseSpending:
            budget.financialCrisisAusterityBaseSpending ?? budget.spending,
        },
      },
      note: "Implement the temporary primary spending cap through ordinary fiscal accrual",
    });
  }
  if (response === "sovereign_support") {
    const recipient = supportRecipient!;
    transition.legs[1] = {
      kind: "credit",
      amount,
      collection: "federalBudget",
      filter: {
        _id: recipient._id,
        countryId: recipient.countryId,
        currencyCode: supportCurrencyFilter,
      },
      path: treasuryCashLedgerEnabled ? "treasuryCashLocal" : "treasuryBalance",
      note: "Deliver the same-currency sovereign rescue grant",
    };
    transition.projections.push({
      collection: "federalBudget",
      filter: {
        _id: recipient._id,
        countryId: recipient.countryId,
        currencyCode: supportCurrencyFilter,
      },
      update: { $inc: { financialCrisisGrantsReceived: amount } },
      note: "Record the grant separately from bond-owned principal",
    });
  }
  if (treasuryCashLedgerEnabled && amount > 0) {
    transition.projections.push({
      collection: "federalBudget",
      filter: { _id: budget._id, countryId: ctx.countryId, currencyCode: treasuryCurrencyFilter },
      update: { $inc: { treasuryBalance: -amount } },
      note: "Keep donor signed fiscal position aligned with the funded cash transfer",
    });
    if (response === "sovereign_support") {
      const recipient = supportRecipient!;
      transition.projections.push({
        collection: "federalBudget",
        filter: {
          _id: recipient._id,
          countryId: recipient.countryId,
          currencyCode: supportCurrencyFilter,
        },
        update: { $inc: { treasuryBalance: amount } },
        note: "Keep recipient signed fiscal position aligned with funded Treasury cash",
      });
    }
  }
  transition.projections.push({
    collection: "financialCrisisFiscalActions",
    insert: { _id: key, response, amount, countryId: ctx.countryId, turn: ctx.currentTurn },
    note: "Record the settled fiscal choice",
  });
  const result = await settleTransition(ctx.db, transition);
  if (result.error || result.status === "partial" || result.status === "rejected")
    throw new Error(result.error ?? "Fiscal intervention is incomplete");
}

async function sovereignSupportRecipient(db: Db, donor: string, currency: string | undefined) {
  if (!currency) return null;
  return db.collection<FederalBudget>("federalBudget").findOne(
    {
      countryId: { $ne: donor as CountryId },
      currencyCode: currency as FederalBudget["currencyCode"],
      sovereignCrisisState: { $in: ["crisisPending", "crisisResolving"] },
    },
    { sort: { treasuryBalance: 1, countryId: 1 } }
  );
}

function exactOptionalField<T>(present: boolean, value: T | undefined | null) {
  return present ? { $exists: true, $eq: value } : { $exists: false };
}
