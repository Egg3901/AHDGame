/** Display only the v2 institution's own account and 1991 source claims. */
import type { DepartmentDefinition } from "@/lib/governmentFinance/departmentCatalog";
import type { DepartmentFinanceReadModel } from "@/lib/governmentFinance/readModel";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { resetLawFamilyById } from "@/lib/resetLegislation/catalog";

export function buildResetDepartmentFinanceReadModel(input: {
  definition: DepartmentDefinition;
  departmentName: string;
  account?: ResetDepartmentAccountSnapshot;
}): DepartmentFinanceReadModel {
  const { definition, departmentName, account } = input;
  if (!account) {
    return {
      enabled: true,
      allocationMode: "demand",
      departmentId: definition.id,
      departmentName,
      kind: definition.kind,
      accountPolicyId: definition.accountPolicyId,
      explanation: "This world has no verified v2 account for the department.",
      programs: [],
    };
  }
  const programs = account.externallySettled
    ? []
    : Object.entries(account.familyAnnualDemand)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([familyId, annualDemand]) => {
          const family = resetLawFamilyById(familyId);
          const delivery = account.lastProgramDelivery?.[familyId];
          return {
            enabled: true,
            departmentName,
            programId: familyId,
            programName: family?.title ?? familyId,
            explanation:
              "Existing 1991 service claim. The Cabinet request can shift delivery priority, but does not change enacted law or add treasury authority.",
            status: "operating" as const,
            annualDemand,
            allocationPercent: account.programAllocationPercents[familyId] ?? 100,
            ...(delivery
              ? { outlaid: delivery.outlaid, lastSettledTurn: account.accruedThroughTurn }
              : {}),
          };
        });
  return {
    enabled: true,
    allocationMode: "demand",
    departmentId: definition.id,
    departmentName,
    kind: definition.kind,
    accountPolicyId: definition.accountPolicyId,
    explanation: account.externallySettled
      ? "This institution keeps its established specialized treasury controls. Its opening claim is shown here for reconciliation, not paid twice."
      : "This is the department's share of existing national spending, net of regional grants. A Cabinet member may request more or less for each service; actual delivery cannot exceed paid funds and capacity.",
    annualAuthority: account.annualAuthority,
    balance: account.balance,
    availableBalance: Math.max(0, account.balance - account.encumbered),
    encumbered: account.encumbered,
    arrears: account.arrears,
    unpaidAuthority: account.externallySettled ? undefined : (account.unpaidAuthority ?? 0),
    lastAuthorityPaid: account.externallySettled ? undefined : account.lastAuthorityPaid,
    lastAllocationChangedTurn: account.lastAllocationChangedTurn,
    programs,
  };
}
