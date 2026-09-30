import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { CURRENCY_ANCHOR_COUNTRY, type CurrencyCode } from "@/lib/constants/currencies";
import type { Bond } from "@/lib/db/types/bond";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CountryGameState } from "@/lib/db/types";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { MacroCountryState } from "@/lib/world/macro/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { resolveBondCurrency } from "@/lib/bonds/resolveBondCurrency";
import { sovereignBondOutstanding } from "@/lib/bonds/sovereignPrincipal";
import {
  allocateSuccessionAmount,
  type SuccessionFinancialPlan,
} from "./rules/financialSettlement";
import { planLegacyBondDue, planLegacyDebtService } from "./rules/legacyService";
import { planLegacyMacroBudget } from "./rules/legacyMacroBudget";
import { hashSettlementPayload, type FederationSettlementIntentRecord } from "./settlementIntent";
import {
  FEDERATION_FISCAL_ACCOUNTS_COLLECTION,
  type FederationFiscalAccount,
} from "./materializeFiscalAccounts";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  type FederationSettlementApplicationRecord,
} from "./runtimeEntities";

export const FEDERATION_LEGACY_SERVICE_TURNS_COLLECTION = "federationLegacyServiceTurns";

export interface FederationLegacyServiceTurn {
  _id: string;
  applicationId: string;
  sourceCountryId: CountryId;
  turn: number;
  creditorDueMinor: number;
  successorContributionsMinor: Record<string, number>;
  successorArrearsMinor: Record<string, number>;
  /** Unfunded contractual payment is bridged by the legacy administration. */
  newBridgeAdvanceMinor: number;
  bridgeOutstandingMinor: number;
  administrationCashAfterMinor: number;
  createdAt: Date;
}

function safeMinor(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} exceeds shared accounting precision`);
  return value;
}

function financesFromIntent(intent: FederationSettlementIntentRecord): SuccessionFinancialPlan {
  if (hashSettlementPayload(intent.payload) !== intent.payloadHash)
    throw new Error("Legacy service intent payload changed");
  const activation = intent.payload.activation as Record<string, unknown> | undefined;
  const finances = activation?.finances as SuccessionFinancialPlan | undefined;
  if (
    !finances ||
    finances.settlementId !== intent.settlementId ||
    finances.servicingIssuerId !== intent.sourceEntityId ||
    finances.servicingEntityKind !== "legacy-administration" ||
    !finances.debtWeights ||
    Object.keys(finances.debtWeights).length < 2
  )
    throw new Error("Legacy service lacks approved finance terms");
  return finances;
}

/** Commit one turn's successor budgets, original-issuer funding and receipt
 * together. The live bond turn subsequently pays the unchanged creditor
 * contracts; any gap is an explicit administration overdraft and risk cost. */
export async function materializeLegacyFederationServiceTurn(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  turn: number;
  now: Date;
  /** The immutable holder inventory used by the bond turn for this payout. */
  bondSnapshot?: readonly Bond[];
}): Promise<FederationLegacyServiceTurn> {
  const { db, session, applicationId, turn, now } = input;
  if (
    !session.inTransaction() ||
    !applicationId ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Legacy service needs a transaction, application, turn and time");
  const receipts = db.collection<FederationLegacyServiceTurn>(
    FEDERATION_LEGACY_SERVICE_TURNS_COLLECTION
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
    throw new Error("Legacy service needs an applied federation settlement");
  const sourceCountryId = application.sourceEntityId as CountryId;
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: sourceCountryId }, { session });
  const intent = await db
    .collection<FederationSettlementIntentRecord>("federationSettlementIntents")
    .findOne({ _id: applicationId }, { session });
  const accounts = await db
    .collection<FederationFiscalAccount>(FEDERATION_FISCAL_ACCOUNTS_COLLECTION)
    .find({ applicationId }, { session })
    .toArray();
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({ $or: [{ _id: sourceCountryId }, { countryId: sourceCountryId }] }, { session })
    .toArray();
  const bonds = input.bondSnapshot
    ? input.bondSnapshot.filter(
        (bond) =>
          bond.issuerType === "sovereign" && bond.countryId === sourceCountryId && !bond.matured
      )
    : await db
        .collection<Bond>("bonds")
        .find({ issuerType: "sovereign", countryId: sourceCountryId, matured: false }, { session })
        .toArray();
  if (
    !country ||
    country.dissolvedTurn == null ||
    country.dissolvedTurn > turn ||
    !intent ||
    budgets.length !== 1 ||
    accounts.filter((account) => account.kind === "legacy-administration").length !== 1 ||
    accounts.find((account) => account.kind === "legacy-administration")?.entityId !==
      sourceCountryId
  )
    throw new Error("Legacy administration is missing or still sovereign");
  const finances = financesFromIntent(intent);
  const successors = accounts.filter((account) => account.kind === "background-successor");
  const ids = successors.map((account) => account.entityId).sort();
  if (
    ids.length < 2 ||
    new Set(ids).size !== ids.length ||
    Object.keys(finances.debtWeights).sort().join(",") !== ids.join(",")
  )
    throw new Error("Legacy successor duties disagree with approved terms");
  const currencyCodes = [
    ...new Set(
      [...bonds.map(resolveBondCurrency), budgets[0].currencyCode].filter(
        (code): code is NonNullable<(typeof budgets)[0]["currencyCode"]> => !!code
      )
    ),
  ];
  if (currencyCodes.some((code) => !Object.hasOwn(CURRENCY_ANCHOR_COUNTRY, code)))
    throw new Error("Legacy service has an unsupported issuer currency");
  const exchangeRows = await db
    .collection<ExchangeRate>("exchangeRates")
    .find({ currencyCode: { $in: currencyCodes as CurrencyCode[] } }, { session })
    .toArray();
  const rates: Record<string, number> = {};
  for (const row of exchangeRows) {
    if (rates[row.currencyCode] !== undefined || !Number.isFinite(row.rate) || row.rate <= 0)
      throw new Error("Legacy service has duplicate or invalid live exchange rates");
    rates[row.currencyCode] = row.rate;
  }
  if (currencyCodes.some((code) => rates[code] === undefined))
    throw new Error("Legacy service lacks a prevailing exchange rate");
  const issuerRate = budgets[0].currencyCode ? rates[budgets[0].currencyCode] : 1;
  const startingCashMinor = safeMinor(
    Math.round((budgets[0].treasuryBalance / issuerRate) * 100),
    "Legacy cash"
  );
  const due = planLegacyBondDue({
    bonds,
    issuerId: sourceCountryId,
    turn,
    ratesLocalPerAnchor: rates,
  });
  const macroCountries = await db
    .collection<MacroCountryState>("macroCountries")
    .find(
      { _id: { $in: ids }, presetId: "1991-default", simulationTier: "background-macro" },
      { session }
    )
    .toArray();
  if (
    macroCountries.length !== ids.length ||
    macroCountries.some((macro) => macro.dataQuality.provenance !== "succession-derived")
  )
    throw new Error("Legacy service successor economy is missing");
  const macroById = new Map(macroCountries.map((macro) => [macro.entityId, macro]));
  const budgetsById = Object.fromEntries(
    ids.map((id) => [id, planLegacyMacroBudget(macroById.get(id)!)])
  );
  const availableMinorBySuccessor = Object.fromEntries(
    ids.map((id) => [id, Math.max(0, budgetsById[id].cashAfterProtectedSpendingMinor)])
  );
  const plan = planLegacyDebtService({
    finances,
    dueMinor: due.totalMinor,
    administrationCashMinor: Math.max(0, startingCashMinor),
    availableMinorBySuccessor,
  });
  const bridgeCalls = allocateSuccessionAmount(
    Math.max(0, -startingCashMinor),
    finances.debtWeights
  );
  const contributionsBySuccessor: Record<string, number> = {};
  const arrearsBySuccessor: Record<string, number> = {};
  for (const id of ids) {
    const remainingAvailable = Math.max(
      0,
      availableMinorBySuccessor[id] - plan.successorContributionsMinor[id]
    );
    const bridgeRecovery = Math.min(bridgeCalls[id], remainingAvailable);
    contributionsBySuccessor[id] = safeMinor(
      plan.successorContributionsMinor[id] + bridgeRecovery,
      "Successor contribution"
    );
    arrearsBySuccessor[id] = safeMinor(
      plan.successorArrearsMinor[id] + bridgeCalls[id] - bridgeRecovery,
      "Successor arrears"
    );
  }
  const contributions = Object.values(contributionsBySuccessor).reduce(
    (sum, value) => sum + value,
    0
  );
  const endingCashMinor = safeMinor(
    startingCashMinor + contributions - due.totalMinor,
    "Legacy cash"
  );
  const bridgeOutstandingMinor = Math.max(0, -endingCashMinor);
  const newBridgeAdvanceMinor = Math.max(
    0,
    bridgeOutstandingMinor - Math.max(0, -startingCashMinor)
  );
  let remainingPrincipalMinor = 0;
  for (const bond of bonds) {
    if (bond.defaulted || bond.maturityTurn <= turn) continue;
    const value = Math.round(
      (sovereignBondOutstanding(bond) / rates[resolveBondCurrency(bond)]) * 100
    );
    remainingPrincipalMinor = safeMinor(remainingPrincipalMinor + value, "Legacy principal");
  }
  const remainingBySuccessor = allocateSuccessionAmount(
    remainingPrincipalMinor,
    finances.debtWeights
  );
  for (const id of ids) {
    const macro = macroById.get(id)!;
    const contribution = contributionsBySuccessor[id];
    const arrears = arrearsBySuccessor[id];
    const call = plan.successorCallsMinor[id] + bridgeCalls[id];
    const nextCash = safeMinor(
      budgetsById[id].cashAfterProtectedSpendingMinor - contribution,
      "Successor cash"
    );
    const riskLoss = call > 0 ? Math.min(0.02, (arrears / call) * 0.02) : 0;
    const updated = await db.collection<MacroCountryState>("macroCountries").updateOne(
      {
        _id: id,
        federationTreasuryMinor: macro.federationTreasuryMinor,
        stability: macro.stability,
      },
      {
        $set: {
          federationTreasuryMinor: nextCash,
          federationDebtResponsibilityMinor: remainingBySuccessor[id],
          stability: Math.max(0, macro.stability - riskLoss),
          updatedAt: now,
        },
      },
      { session }
    );
    if (updated.matchedCount !== 1)
      throw new Error("Legacy successor budget changed during service");
    const account = successors.find((candidate) => candidate.entityId === id)!;
    const cumulativeContributionMinor = safeMinor(
      (account.cumulativeContributionMinor ?? 0) + contribution,
      "Successor cumulative contributions"
    );
    const cumulativeArrearsMinor = safeMinor(
      (account.cumulativeArrearsMinor ?? 0) + arrears,
      "Successor cumulative arrears"
    );
    const accountUpdated = await db
      .collection<FederationFiscalAccount>(FEDERATION_FISCAL_ACCOUNTS_COLLECTION)
      .updateOne(
        {
          _id: `${applicationId}:${id}`,
          remainingContributionMinor: account.remainingContributionMinor,
        },
        {
          $set: {
            remainingContributionMinor: remainingBySuccessor[id],
            cumulativeContributionMinor,
            cumulativeArrearsMinor,
          },
        },
        { session }
      );
    if (accountUpdated.matchedCount !== 1)
      throw new Error("Legacy successor duty changed during service");
  }
  const localCash = (endingCashMinor / 100) * issuerRate;
  if (!Number.isFinite(localCash)) throw new Error("Legacy cash exceeds local precision");
  const sourceUpdated = await db
    .collection<FederalBudget>("federalBudget")
    .updateOne(
      { _id: budgets[0]._id, treasuryBalance: budgets[0].treasuryBalance },
      { $set: { treasuryBalance: localCash } },
      { session }
    );
  if (sourceUpdated.matchedCount !== 1)
    throw new Error("Legacy administration cash changed during service");
  const receipt: FederationLegacyServiceTurn = {
    _id: receiptId,
    applicationId,
    sourceCountryId,
    turn,
    creditorDueMinor: due.totalMinor,
    successorContributionsMinor: contributionsBySuccessor,
    successorArrearsMinor: arrearsBySuccessor,
    newBridgeAdvanceMinor,
    bridgeOutstandingMinor,
    administrationCashAfterMinor: endingCashMinor,
    createdAt: now,
  };
  await receipts.insertOne(receipt, { session });
  return receipt;
}

/** Run after the macro update and before creditor payouts in the bond turn. */
export async function processLegacyFederationServiceTurn(
  db: Db,
  turn: number,
  now: Date,
  bondSnapshot?: readonly Bond[]
): Promise<number> {
  const applications = await db
    .collection<FederationFiscalAccount>(FEDERATION_FISCAL_ACCOUNTS_COLLECTION)
    .find({ kind: "legacy-administration" }, { projection: { applicationId: 1 } })
    .toArray();
  for (const application of applications) {
    await runRequiredTransaction((session) =>
      materializeLegacyFederationServiceTurn({
        db,
        session,
        applicationId: application.applicationId,
        turn,
        now,
        bondSnapshot,
      })
    );
  }
  return applications.length;
}
