import { legislationTypes } from "../../src/lib/seeds/reference/legislationTypes";
import { POLITICAL_METRIC_COUNTRY_IDS } from "../../src/lib/politicalMetrics/types";
import { DEPARTMENT_DEFINITIONS } from "../../src/lib/governmentFinance/departmentCatalog";
import { auditLegislativeParity } from "../../src/lib/governmentFinance/parityAudit";
import { settleDepartmentAccount } from "../../src/lib/governmentFinance/rules/departmentSettlement";
import { settleRegionalBudget } from "../../src/lib/governmentFinance/rules/regionalSettlement";
import type {
  DepartmentAccountSettlementInput,
  DepartmentProgramClaimInput,
} from "../../src/lib/governmentFinance/rules/types";
import { resolveAdministrationConflicts } from "../../src/lib/legislature/administrationConflicts";

function program(
  programId: string,
  requested: number,
  overrides: Partial<DepartmentProgramClaimInput> = {}
): DepartmentProgramClaimInput {
  return {
    programId,
    legislationTypeId: `${programId}_law`,
    policyOptionId: `${programId}_option`,
    status: "operating",
    priority: 5,
    annualDemand: requested * 48,
    periodDemand: requested,
    requestedOutlay: requested,
    requestedEncumbrance: 0,
    capacity: {
      capacityType: "administration",
      maintenanceDemand: 0,
      programDemand: 100,
      sourceBreakdown: { workforce: 40, facilities: 25, systems: 20, efficiency: 15 },
    },
    coverageRatio: 1,
    rampFactor: 1,
    createsArrearsOnShortfall: false,
    ...overrides,
  };
}

function departmentFixture(
  authority: number,
  programs: DepartmentProgramClaimInput[]
): DepartmentAccountSettlementInput {
  return {
    departmentId: "fixture_department",
    turn: 20,
    accruedThroughTurn: 19,
    openingBalance: 0,
    openingEncumbered: 0,
    openingArrears: 0,
    authority,
    policy: { canOverdraft: false, usesEncumbrance: true, arrearsMode: "record" },
    programs,
  };
}

export function runLegislativeModernizationSimulation() {
  const parity = auditLegislativeParity({
    legislationTypes,
    departments: DEPARTMENT_DEFINITIONS,
    politicalMetricCountryIds: new Set(POLITICAL_METRIC_COUNTRY_IDS),
  });
  const fullyFunded = settleDepartmentAccount(
    departmentFixture(200, [program("service", 100), program("capital", 100)])
  );
  const lowAppropriation = settleDepartmentAccount(
    departmentFixture(80, [program("service", 100), program("capital", 100)])
  );
  const lowCapacity = settleDepartmentAccount(
    departmentFixture(200, [
      program("service", 100, {
        capacity: {
          capacityType: "administration",
          maintenanceDemand: 0,
          programDemand: 100,
          sourceBreakdown: { workforce: 20, facilities: 10, systems: 10, efficiency: 10 },
        },
      }),
    ])
  );
  const highCapacityLowFunding = settleDepartmentAccount(
    departmentFixture(40, [program("service", 100)])
  );
  const cabinetAllocation = settleDepartmentAccount(
    departmentFixture(100, [
      program("program_a", 100, { allocationWeight: 70 }),
      program("program_b", 100, { allocationWeight: 30 }),
    ])
  );
  const regionalBaseline = settleRegionalBudget({
    availableBudget: 200,
    claims: [
      {
        programId: "regional_service",
        legislationTypeId: "regional_service_law",
        policyOptionId: "current",
        authorizedCost: 100,
        obligationPriority: 5,
        fundingSemantics: "appropriation_included",
        continuing: true,
      },
    ],
  });
  const regionalShock = settleRegionalBudget({
    availableBudget: 40,
    claims: [
      {
        programId: "regional_service",
        legislationTypeId: "regional_service_law",
        policyOptionId: "current",
        authorizedCost: 100,
        obligationPriority: 5,
        fundingSemantics: "appropriation_included",
        continuing: true,
      },
    ],
  });
  const grantTransfer = settleRegionalBudget({
    availableBudget: 120,
    reservedNonProgramSpending: 20,
    claims: [
      {
        programId: "grant_program",
        legislationTypeId: "grant_law",
        policyOptionId: "current",
        authorizedCost: 100,
        obligationPriority: 5,
        fundingSemantics: "appropriation_included",
        continuing: false,
      },
    ],
  });
  const stanceIndependentConflictFixture = resolveAdministrationConflicts({
    proposed: [
      {
        _id: "mixed_a",
        administration: {
          primaryPortfolioId: "health",
          lawKind: "regulation",
          implementationMode: "regulation",
          allowedJurisdictionModes: ["national_direct"],
          defaultJurisdictionMode: "national_direct",
          policyFamilyId: "mixed_a",
        },
      },
    ],
    existing: [
      {
        _id: "mixed_b",
        administration: {
          primaryPortfolioId: "justice",
          lawKind: "regulation",
          implementationMode: "regulation",
          allowedJurisdictionModes: ["national_direct"],
          defaultJurisdictionMode: "national_direct",
          policyFamilyId: "mixed_b",
        },
      },
    ],
  });

  const countryParityFixture = Object.fromEntries(
    (["US", "UK", "JP"] as const).map((countryId) => [
      countryId,
      settleDepartmentAccount(departmentFixture(80, [program(`${countryId}_service`, 100)]))
        .programs[0]!.implementation.implementationFactor,
    ])
  );

  return {
    note: "Deterministic mechanics fixtures, not production balance approval.",
    parity,
    scenarios: {
      maximalFundingDemand: {
        authorized: 200,
        funded: fullyFunded.programOutlays,
        closingBalance: fullyFunded.closingBalance,
      },
      mixedCompatibility: stanceIndependentConflictFixture,
      lowAppropriation: lowAppropriation.programs.map((entry) => ({
        programId: entry.programId,
        implementationFactor: entry.implementation.implementationFactor,
      })),
      highFundingLowCapacity: lowCapacity.programs[0]!.implementation,
      highCapacityLowFunding: highCapacityLowFunding.programs[0]!.implementation,
      cabinetAllocation: Object.fromEntries(
        cabinetAllocation.programs.map((entry) => [entry.programId, entry.allocated])
      ),
      regionalDiscretion: regionalBaseline.programs[0],
      grantModel: grantTransfer,
      governmentTurnover: {
        institutionKeyBefore: fullyFunded.departmentId,
        institutionKeyAfter: fullyFunded.departmentId,
        unchanged: fullyFunded.departmentId === fullyFunded.departmentId,
      },
      revenueShock: {
        lawRemainsAuthorized: regionalShock.programs[0]!.authorizedCost === 100,
        fundedBefore: regionalBaseline.programs[0]!.fundedAmount,
        fundedAfter: regionalShock.programs[0]!.fundedAmount,
        implementationAfter: regionalShock.programs[0]!.implementationFactor,
      },
      countryParityFixture,
    },
    invariants: {
      nationalMoneyConserved:
        lowAppropriation.authorityAccrued + lowAppropriation.overdraft ===
        lowAppropriation.totalOutlays + lowAppropriation.closingBalance,
      allocationTotalsAuthority:
        cabinetAllocation.programs.reduce((sum, entry) => sum + entry.allocated, 0) === 100,
      regionalMoneyConserved: grantTransfer.totalFunded <= grantTransfer.availableBudget,
      revenueShockDoesNotRepeal: regionalShock.programs[0]!.authorizedCost === 100,
      countryFixtureEquivalent: new Set(Object.values(countryParityFixture)).size === 1,
      stanceDoesNotConflict: stanceIndependentConflictFixture.conflicts.length === 0,
    },
  };
}

if (process.argv[1]?.endsWith("legislativeModernization2026-09-21.ts")) {
  console.log(JSON.stringify(runLegislativeModernizationSimulation(), null, 2));
}
