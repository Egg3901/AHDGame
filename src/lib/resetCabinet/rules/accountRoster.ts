/**
 * Cabinet account completeness. Each institution has a durable world-bound
 * account, including offices without law claims. Missing accounts start at zero;
 * existing balances, authority and obligations are never reconstructed.
 */
import type { DepartmentDefinition } from "@/lib/governmentFinance/departmentCatalog";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";

export function missingCabinetAccounts(input: {
  definitions: readonly DepartmentDefinition[];
  accounts: readonly ResetDepartmentAccountSnapshot[];
  worldId: string;
  countryId: ResetCountry;
  sourceTurn: number;
  currentTurn: number;
}): ResetDepartmentAccountSnapshot[] {
  const { definitions, accounts, worldId, countryId, sourceTurn, currentTurn } = input;
  if (
    !worldId ||
    !Number.isSafeInteger(sourceTurn) ||
    sourceTurn < 1 ||
    !Number.isSafeInteger(currentTurn) ||
    currentTurn < sourceTurn
  ) {
    throw new Error("Invalid Cabinet account roster identity");
  }
  const existing = new Set(
    accounts
      .filter((account) => account.worldId === worldId && account.countryId === countryId)
      .map((account) => account._id)
  );
  // Reserve zero-value records for future institutions too. Era gates still
  // control their offices; no future appropriation or program is created.
  return definitions
    .filter(
      (definition) =>
        definition.countryId === countryId &&
        definition.accountPolicyId &&
        !existing.has(`${countryId}:${definition.id}`)
    )
    .map((definition) => {
      const controllingSeatId = definition.controllingPositionIds[0];
      if (!controllingSeatId) throw new Error(`Department has no controller: ${definition.id}`);
      return {
        _id: `${countryId}:${definition.id}`,
        worldId,
        countryId,
        departmentId: definition.id,
        controllingSeatId,
        openingAgencyNames: [definition.canonicalName],
        sourceTurn,
        accruedThroughTurn: currentTurn,
        lastAuthorityPaid: 0,
        unpaidAuthority: 0,
        grossAnnualClaim: 0,
        grantReservation: 0,
        annualAuthority: 0,
        balance: 0,
        encumbered: 0,
        arrears: 0,
        externallySettled:
          definition.accountPolicyId === "defense" || definition.accountPolicyId === "intelligence",
        familyGrossAnnualDemand: {},
        familyGrantReservation: {},
        familyAnnualDemand: {},
        programAllocationPercents: {},
        lastProgramDelivery: {},
      };
    });
}
