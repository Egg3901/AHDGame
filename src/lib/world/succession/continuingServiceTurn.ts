/**
 * Continuing issuers receive successor contributions for inherited federation debt.
 * materializeContinuingFederationServiceTurn records debtor-specific arrears and
 * funds the existing treasury without replacing ordinary sovereign bond rules.
 */
import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CountryGameState } from "@/lib/db/types";
import type { Bond } from "@/lib/db/types/bond";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import { CURRENCY_ANCHOR_COUNTRY } from "@/lib/constants/currencies";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { resolveBondCurrency } from "@/lib/bonds/resolveBondCurrency";
import { sovereignBondOutstanding } from "@/lib/bonds/sovereignPrincipal";
import type { MacroCountryState } from "@/lib/world/macro/types";
import { hashSettlementPayload, type FederationSettlementIntentRecord } from "./settlementIntent";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  type FederationSettlementApplicationRecord,
} from "./runtimeEntities";
import {
  FEDERATION_FISCAL_ACCOUNTS_COLLECTION,
  type FederationFiscalAccount,
} from "./materializeFiscalAccounts";
import type { SuccessionAccountingSnapshot } from "./normalizeLiveFinances";
import {
  allocateSuccessionAmount,
  type SuccessionFinancialPlan,
} from "./rules/financialSettlement";
import { planLegacyBondDue } from "./rules/legacyService";
import { planLegacyMacroBudget } from "./rules/legacyMacroBudget";
import {
  continuingContributionRiskLoss,
  planContinuingDebtService,
} from "./rules/continuingService";

export const FEDERATION_CONTINUING_SERVICE_TURNS_COLLECTION = "federationContinuingServiceTurns";
export interface FederationContinuingServiceTurn {
  _id: string;
  applicationId: string;
  sourceCountryId: CountryId;
  turn: number;
  creditorDueMinor: number;
  issuerOwnShareMinor: number;
  successorContributionsMinor: Record<string, number>;
  successorArrearsMinor: Record<string, number>;
  issuerCashAfterContributionsMinor: number;
  createdAt: Date;
}

function safeMinor(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new Error("Continuing service exceeds shared accounting precision");
  return value;
}

export async function materializeContinuingFederationServiceTurn(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  turn: number;
  now: Date;
  bondSnapshot?: readonly Bond[];
}): Promise<FederationContinuingServiceTurn> {
  const { db, session, applicationId, turn, now } = input;
  if (
    !session.inTransaction() ||
    !applicationId ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Continuing service needs a transaction, application, turn and time");
  const receipts = db.collection<FederationContinuingServiceTurn>(
    FEDERATION_CONTINUING_SERVICE_TURNS_COLLECTION
  );
  const receiptId = `${applicationId}:${turn}`;
  const existing = await receipts.findOne({ _id: receiptId }, { session });
  if (existing) return existing;
  const application = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .findOne({ _id: applicationId, status: "applied", presetId: "1991-default" }, { session });
  if (!application || application.appliedOnTurn > turn)
    throw new Error("Continuing service needs an applied federation settlement");
  const sourceCountryId = application.sourceEntityId as CountryId;
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: sourceCountryId }, { session, projection: { dissolvedTurn: 1 } });
  const intent = await db
    .collection<FederationSettlementIntentRecord>("federationSettlementIntents")
    .findOne({ _id: applicationId }, { session });
  if (
    !country ||
    country.dissolvedTurn != null ||
    !intent ||
    intent.sourceEntityId !== application.sourceEntityId ||
    intent.settlementId !== application.settlementId ||
    intent.revision !== application.revision ||
    intent.presetId !== application.presetId ||
    hashSettlementPayload(intent.payload) !== intent.payloadHash
  )
    throw new Error("Continuing service lacks an unchanged approved sovereign settlement");
  const activation = intent.payload.activation as
    { finances?: SuccessionFinancialPlan } | undefined;
  const approvedPlan = intent.payload.plan as
    { accounting?: SuccessionAccountingSnapshot } | undefined;
  const finances = activation?.finances;
  const originalPrincipal = approvedPlan?.accounting?.creditorPrincipalByBondMinor;
  if (
    !finances ||
    finances.servicingEntityKind !== "continuing-state" ||
    finances.servicingIssuerId !== sourceCountryId ||
    finances.settlementId !== application.settlementId ||
    !originalPrincipal ||
    Object.values(originalPrincipal).some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    throw new Error("Continuing service lacks approved inherited creditor contracts");
  const accounts = await db
    .collection<FederationFiscalAccount>(FEDERATION_FISCAL_ACCOUNTS_COLLECTION)
    .find({ applicationId }, { session })
    .toArray();
  const issuer = accounts.filter((account) => account.kind === "continuing-state");
  const successors = accounts.filter((account) => account.kind === "background-successor");
  const ids = successors.map((account) => account.entityId).sort();
  if (
    issuer.length !== 1 ||
    issuer[0].entityId !== sourceCountryId ||
    successors.length + 1 !== accounts.length ||
    !ids.length ||
    new Set(ids).size !== ids.length ||
    Object.keys(finances.debtWeights).sort().join(",") !==
      [sourceCountryId, ...ids].sort().join(",")
  )
    throw new Error("Continuing successor duties disagree with approved terms");
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find(
      { $or: [{ _id: sourceCountryId }, { countryId: sourceCountryId }] },
      { session, projection: { treasuryBalance: 1, currencyCode: 1 } }
    )
    .toArray();
  if (budgets.length !== 1) throw new Error("Continuing issuer needs one treasury");
  const allBonds =
    input.bondSnapshot ??
    (await db
      .collection<Bond>("bonds")
      .find({ issuerType: "sovereign", countryId: sourceCountryId, matured: false }, { session })
      .toArray());
  const bonds = allBonds.filter(
    (bond) =>
      bond.issuerType === "sovereign" &&
      bond.countryId === sourceCountryId &&
      !bond.matured &&
      Object.hasOwn(originalPrincipal, bond._id.toString())
  );
  const currencyCodes = [
    ...new Set(
      [...bonds.map(resolveBondCurrency), budgets[0].currencyCode].filter((code) => !!code)
    ),
  ];
  if (currencyCodes.some((code) => !Object.hasOwn(CURRENCY_ANCHOR_COUNTRY, code!)))
    throw new Error("Continuing service has an unsupported issuer currency");
  const exchangeRows = await db
    .collection<ExchangeRate>("exchangeRates")
    .find({ currencyCode: { $in: currencyCodes } }, { session })
    .toArray();
  const rates: Record<string, number> = {};
  for (const row of exchangeRows) {
    if (rates[row.currencyCode] !== undefined || !Number.isFinite(row.rate) || row.rate <= 0)
      throw new Error("Continuing service has duplicate or invalid exchange rates");
    rates[row.currencyCode] = row.rate;
  }
  if (currencyCodes.some((code) => rates[code!] === undefined))
    throw new Error("Continuing service lacks a prevailing exchange rate");
  const issuerRate = budgets[0].currencyCode ? rates[budgets[0].currencyCode] : 1;
  const startingCash = safeMinor(Math.round((budgets[0].treasuryBalance / issuerRate) * 100));
  const due = planLegacyBondDue({
    bonds,
    issuerId: sourceCountryId,
    turn,
    ratesLocalPerAnchor: rates,
  });
  const macros = await db
    .collection<MacroCountryState>("macroCountries")
    .find(
      { _id: { $in: ids }, presetId: "1991-default", simulationTier: "background-macro" },
      { session }
    )
    .toArray();
  if (
    macros.length !== ids.length ||
    macros.some((macro) => macro.dataQuality.provenance !== "succession-derived")
  )
    throw new Error("Continuing service successor economy is missing");
  const macroById = new Map(macros.map((macro) => [macro.entityId, macro]));
  const slices = Object.fromEntries(
    ids.map((id) => [id, planLegacyMacroBudget(macroById.get(id)!)])
  );
  const previous = (
    await receipts
      .find({ applicationId }, { session, projection: { turn: 1, successorArrearsMinor: 1 } })
      .sort({ turn: -1 })
      .limit(1)
      .toArray()
  )[0];
  if (previous && previous.turn >= turn)
    throw new Error("Continuing service cannot precede its latest committed turn");
  const plan = planContinuingDebtService({
    finances,
    dueMinor: due.totalMinor,
    availableMinorBySuccessor: Object.fromEntries(
      ids.map((id) => [id, Math.max(0, slices[id].cashAfterProtectedSpendingMinor)])
    ),
    priorArrearsMinor:
      previous?.successorArrearsMinor ?? Object.fromEntries(ids.map((id) => [id, 0])),
  });
  let principal = 0;
  for (const bond of bonds) {
    if (bond.defaulted || bond.maturityTurn <= turn) continue;
    principal = safeMinor(
      principal +
        Math.round((sovereignBondOutstanding(bond) / rates[resolveBondCurrency(bond)]) * 100)
    );
  }
  const remaining = allocateSuccessionAmount(principal, finances.debtWeights);
  const macroWrites = ids.map((id) => {
    const macro = macroById.get(id)!;
    const call = plan.successorCallsMinor[id];
    const riskLoss = continuingContributionRiskLoss(call, plan.successorArrearsMinor[id]);
    return {
      updateOne: {
        filter: {
          _id: id,
          federationTreasuryMinor: macro.federationTreasuryMinor,
          stability: macro.stability,
        },
        update: {
          $set: {
            federationTreasuryMinor: safeMinor(
              slices[id].cashAfterProtectedSpendingMinor - plan.successorContributionsMinor[id]
            ),
            federationDebtResponsibilityMinor: remaining[id],
            stability: Math.max(0, macro.stability - riskLoss),
            updatedAt: now,
          },
        },
      },
    };
  });
  const macroUpdated = await db
    .collection<MacroCountryState>("macroCountries")
    .bulkWrite(macroWrites, { session });
  if (macroUpdated.matchedCount !== ids.length)
    throw new Error("Continuing successor budget changed during service");
  const accountWrites = accounts.map((account) => ({
    updateOne: {
      filter: { _id: account._id, remainingContributionMinor: account.remainingContributionMinor },
      update: {
        $set: {
          remainingContributionMinor: remaining[account.entityId],
          cumulativeContributionMinor: safeMinor(
            (account.cumulativeContributionMinor ?? 0) +
              (plan.successorContributionsMinor[account.entityId] ?? 0)
          ),
          cumulativeArrearsMinor: safeMinor(
            (account.cumulativeArrearsMinor ?? 0) +
              (plan.successorArrearsMinor[account.entityId] ?? 0)
          ),
        },
      },
    },
  }));
  const accountUpdated = await db
    .collection<FederationFiscalAccount>(FEDERATION_FISCAL_ACCOUNTS_COLLECTION)
    .bulkWrite(accountWrites, { session });
  if (accountUpdated.matchedCount !== accounts.length)
    throw new Error("Continuing successor duty changed during service");
  // The ordinary sovereign budget already expenses coupons and retires maturity
  // principal. Only actual contributions are credited here, never a second payout.
  const endingCash = safeMinor(startingCash + plan.totalContributionsMinor);
  const localCash = budgets[0].treasuryBalance + (plan.totalContributionsMinor / 100) * issuerRate;
  if (!Number.isFinite(localCash)) throw new Error("Continuing cash exceeds local precision");
  const sourceUpdated = await db
    .collection<FederalBudget>("federalBudget")
    .updateOne(
      { _id: budgets[0]._id, treasuryBalance: budgets[0].treasuryBalance },
      { $set: { treasuryBalance: localCash } },
      { session }
    );
  if (sourceUpdated.matchedCount !== 1)
    throw new Error("Continuing issuer cash changed during service");
  const receipt: FederationContinuingServiceTurn = {
    _id: receiptId,
    applicationId,
    sourceCountryId,
    turn,
    creditorDueMinor: due.totalMinor,
    issuerOwnShareMinor: plan.issuerOwnShareMinor,
    successorContributionsMinor: plan.successorContributionsMinor,
    successorArrearsMinor: plan.successorArrearsMinor,
    issuerCashAfterContributionsMinor: endingCash,
    createdAt: now,
  };
  await receipts.insertOne(receipt, { session });
  return receipt;
}

/** Collect before the original issuer's bond payouts, including arrears after maturity. */
export async function processContinuingFederationServiceTurn(
  db: Db,
  turn: number,
  now: Date,
  bondSnapshot?: readonly Bond[]
): Promise<number> {
  const accounts = await db
    .collection<FederationFiscalAccount>(FEDERATION_FISCAL_ACCOUNTS_COLLECTION)
    .find({ kind: "continuing-state" }, { projection: { applicationId: 1 } })
    .toArray();
  for (const account of accounts)
    await runRequiredTransaction(
      (session) =>
        materializeContinuingFederationServiceTurn({
          db,
          session,
          applicationId: account.applicationId,
          turn,
          now,
          bondSnapshot,
        }),
      { client: db.client }
    );
  return accounts.length;
}
