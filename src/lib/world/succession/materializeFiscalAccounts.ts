import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { MacroCountryState } from "@/lib/world/macro/types";
import type { SuccessionAccountingSnapshot } from "./normalizeLiveFinances";
import type { SuccessionFiscalShare } from "./rules/fiscalShares";

export const FEDERATION_FISCAL_ACCOUNTS_COLLECTION = "federationFiscalAccounts";

export interface FederationFiscalAccount extends SuccessionFiscalShare {
  _id: string;
  applicationId: string;
  /** Signed opening cash in the game's shared accounting minor units. */
  openingCashMinor: number;
  /** Outstanding contribution principal remains internal, not a new bond. */
  remainingContributionMinor: number;
  cumulativeContributionMinor?: number;
  cumulativeArrearsMinor?: number;
}

function sum(values: readonly number[]): bigint {
  return values.reduce((total, value) => total + BigInt(value), BigInt(0));
}

/** Move the exact approved treasury partition and record contribution duties.
 * Existing bonds, creditor identities and denominations remain untouched. This
 * runs only inside the same transaction as sovereignty and the applied receipt. */
export async function materializeFederationFiscalAccounts(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  sourceCountryId: CountryId;
  accounting: SuccessionAccountingSnapshot;
  shares: readonly SuccessionFiscalShare[];
}): Promise<FederationFiscalAccount[]> {
  const { db, session, applicationId, sourceCountryId, accounting, shares } = input;
  const participants = shares.filter((share) => share.kind !== "legacy-administration");
  const issuer = shares.find((share) => share.entityId === sourceCountryId);
  const continuing = shares.find((share) => share.kind === "continuing-state");
  if (
    !applicationId ||
    shares.length < 2 ||
    new Set(shares.map((share) => share.entityId)).size !== shares.length ||
    participants.length < 2 ||
    (continuing
      ? continuing.entityId !== sourceCountryId ||
        shares.some((share) => share.kind === "legacy-administration")
      : shares.filter((share) => share.kind === "legacy-administration").length !== 1) ||
    !shares.some((share) => share.entityId === sourceCountryId) ||
    !issuer ||
    issuer.kind !== (continuing ? "continuing-state" : "legacy-administration") ||
    issuer.servicingCreditorPrincipalMinor !== accounting.creditorDebtMinor ||
    shares.some(
      (share) => share.entityId !== sourceCountryId && share.servicingCreditorPrincipalMinor !== 0
    ) ||
    sum(participants.map((share) => share.financialAssetEntitlementMinor)) !==
      BigInt(accounting.financialAssetsMinor) ||
    sum(participants.map((share) => share.cashDeficitResponsibilityMinor)) !==
      BigInt(accounting.cashDeficitMinor) ||
    sum(participants.map((share) => share.creditorContributionMinor)) !==
      BigInt(accounting.creditorDebtMinor) ||
    shares.some((share) =>
      [
        share.financialAssetEntitlementMinor,
        share.cashDeficitResponsibilityMinor,
        share.creditorContributionMinor,
        share.servicingCreditorPrincipalMinor,
        share.facilityClaimLiabilityMinor,
      ].some((value) => !Number.isSafeInteger(value) || value < 0)
    )
  )
    throw new Error("Federation fiscal accounts disagree with the approved balance sheet");
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({ $or: [{ _id: sourceCountryId }, { countryId: sourceCountryId }] }, { session })
    .toArray();
  if (budgets.length !== 1) throw new Error("Federation fiscal source needs one budget");
  const budget = budgets[0];
  const rate = budget.currencyCode ? accounting.ratesLocalPerAnchor[budget.currencyCode] : 1;
  if (
    !Number.isFinite(rate) ||
    rate <= 0 ||
    Math.round((budget.treasuryBalance / rate) * 100) !== accounting.signedCashMinor
  )
    throw new Error("Federation fiscal source cash changed before settlement");
  const accounts: FederationFiscalAccount[] = shares.map((share) => ({
    ...share,
    _id: `${applicationId}:${share.entityId}`,
    applicationId,
    openingCashMinor: share.financialAssetEntitlementMinor - share.cashDeficitResponsibilityMinor,
    remainingContributionMinor: share.creditorContributionMinor,
    cumulativeContributionMinor: 0,
    cumulativeArrearsMinor: 0,
  }));
  for (const account of accounts) {
    if (account.kind !== "background-successor") continue;
    const updated = await db.collection<MacroCountryState>("macroCountries").updateOne(
      {
        _id: account.entityId,
        presetId: "1991-default",
        simulationTier: "background-macro",
        "dataQuality.provenance": "succession-derived",
      },
      {
        $set: {
          federationTreasuryMinor: account.openingCashMinor,
          federationDebtResponsibilityMinor: account.remainingContributionMinor,
        },
      },
      { session }
    );
    if (updated.matchedCount !== 1)
      throw new Error("Federation successor treasury is missing or changed");
  }
  const sourceCashMinor = continuing
    ? continuing.financialAssetEntitlementMinor - continuing.cashDeficitResponsibilityMinor
    : 0;
  const sourceCashLocal = (sourceCashMinor / 100) * rate;
  if (!Number.isFinite(sourceCashLocal))
    throw new Error("Federation source treasury exceeds local-currency precision");
  const sourceUpdate = await db
    .collection<FederalBudget>("federalBudget")
    .updateOne(
      { _id: budget._id, treasuryBalance: budget.treasuryBalance },
      { $set: { treasuryBalance: sourceCashLocal } },
      { session }
    );
  if (sourceUpdate.matchedCount !== 1)
    throw new Error("Federation source treasury changed during settlement");
  await db
    .collection<FederationFiscalAccount>(FEDERATION_FISCAL_ACCOUNTS_COLLECTION)
    .insertMany(accounts, { session });
  return accounts;
}
