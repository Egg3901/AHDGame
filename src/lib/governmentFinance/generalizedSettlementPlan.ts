/**
 * National department settlement plan. Active laws become programs owned by
 * durable departments, sharing the department's typed operating capacity.
 */
import type { DepartmentAccount, EnactedLaw } from "@/lib/db/types/budget";
import type { LegislationType } from "@/lib/db/types/legislation";
import { includedAuthorityPerTurn } from "./rules/appropriation";
import { settleCapacity } from "./rules/capacity";
import { settleDepartmentAccount } from "./rules/departmentSettlement";
import type { DepartmentAccountSettlement, DepartmentProgramClaimInput } from "./rules/types";
import { getDepartmentAccountPolicy } from "./accountPolicies";
import {
  resolvePortfolioDepartment,
  type DepartmentCountryId,
  type PortfolioId,
} from "./departmentCatalog";
import { createEmptyDepartmentAccount, createEmptyUsHealthDepartmentAccount } from "./departments";

export interface ActiveLawCostInput {
  law: EnactedLaw;
  amount: number;
}

export interface CountryDepartmentSettlementPlanInput {
  countryId: DepartmentCountryId;
  turn: number;
  year: number | null;
  enabledSeats?: ReadonlySet<string>;
  accounts: Record<string, DepartmentAccount>;
  activeLawCosts: ActiveLawCostInput[];
  legislationTypes: LegislationType[];
}

export interface CountryDepartmentSettlementPlan {
  openings: Record<string, DepartmentAccount>;
  createdDepartmentIds: string[];
  settlements: DepartmentAccountSettlement[];
  skippedPrograms: Array<{ legislationTypeId: string; reason: string }>;
}

interface ProgramDraft {
  departmentId: string;
  law: EnactedLaw;
  type: LegislationType;
  option: NonNullable<LegislationType["policyOptions"]>[number];
  annualDemand: number;
  periodDemand: number;
  capacityType?: string;
  capacityDemand: number;
  jurisdictionMode: NonNullable<EnactedLaw["jurisdictionMode"]>;
}

function optionFor(type: LegislationType, law: EnactedLaw) {
  const index = law.policyOptionIndex ?? -1;
  return index >= 0 ? type.policyOptions?.[index] : undefined;
}

function rampFactor(profileId: string | undefined, hasPrevious: boolean): number {
  if (hasPrevious) return 1;
  return profileId === "capital_build" ? 0.25 : 0.5;
}

export function buildCountryDepartmentSettlementPlan(
  input: CountryDepartmentSettlementPlanInput
): CountryDepartmentSettlementPlan {
  const types = new Map(input.legislationTypes.map((type) => [type._id, type]));
  const openings: Record<string, DepartmentAccount> = { ...input.accounts };
  const createdDepartmentIds: string[] = [];
  const skippedPrograms: CountryDepartmentSettlementPlan["skippedPrograms"] = [];
  const drafts: ProgramDraft[] = [];

  for (const { law, amount } of input.activeLawCosts) {
    const type = types.get(law.legislationTypeId);
    const option = type && optionFor(type, law);
    const implementation = option?.implementation;
    if (!type?.administration || !option || !implementation) {
      skippedPrograms.push({
        legislationTypeId: law.legislationTypeId,
        reason: "missing administration or program metadata",
      });
      continue;
    }
    const jurisdictionMode = law.jurisdictionMode ?? type.administration.defaultJurisdictionMode;
    if (jurisdictionMode === "regional_discretion") continue;
    const department = resolvePortfolioDepartment(
      input.countryId,
      type.administration.primaryPortfolioId as PortfolioId,
      input.year,
      input.enabledSeats
    );
    if (!department?.accountPolicyId) {
      skippedPrograms.push({
        legislationTypeId: law.legislationTypeId,
        reason: "portfolio has no active spending department",
      });
      continue;
    }
    if (department.accountPolicyId === "defense" || department.accountPolicyId === "intelligence") {
      skippedPrograms.push({
        legislationTypeId: law.legislationTypeId,
        reason: "specialized defense or intelligence account remains authoritative",
      });
      continue;
    }
    if (!openings[department.id]) {
      openings[department.id] =
        input.countryId === "US" && department.id === "us_health_department"
          ? createEmptyUsHealthDepartmentAccount()
          : createEmptyDepartmentAccount(department);
      createdDepartmentIds.push(department.id);
    }
    const annualDemand = Math.max(0, Math.round(amount));
    const periodDemand = includedAuthorityPerTurn(annualDemand);
    const capacityEntries = Object.entries(
      implementation.capacityDemand ??
        (implementation.capacityType ? { [implementation.capacityType]: 100 } : {})
    );
    const [capacityType, demand = 1] = capacityEntries[0] ?? [];
    drafts.push({
      departmentId: department.id,
      law,
      type,
      option,
      annualDemand,
      periodDemand,
      ...(capacityType ? { capacityType } : {}),
      capacityDemand: demand,
      jurisdictionMode,
    });
  }

  const draftsByDepartment = new Map<string, ProgramDraft[]>();
  for (const draft of drafts) {
    const rows = draftsByDepartment.get(draft.departmentId) ?? [];
    rows.push(draft);
    draftsByDepartment.set(draft.departmentId, rows);
  }

  const settlements: DepartmentAccountSettlement[] = [];
  for (const [departmentId, account] of Object.entries(openings)) {
    const active = draftsByDepartment.get(departmentId) ?? [];
    const allocationIsComplete =
      active.length > 0 &&
      active.every(
        (draft) =>
          account.programAllocationPercents?.[draft.option.implementation!.programId] !== undefined
      );
    const activeProgramIds = new Set(active.map((draft) => draft.option.implementation!.programId));
    const totalDemandByCapacity = new Map<string, number>();
    for (const draft of active) {
      if (!draft.capacityType) continue;
      totalDemandByCapacity.set(
        draft.capacityType,
        (totalDemandByCapacity.get(draft.capacityType) ?? 0) + draft.capacityDemand
      );
    }

    const programs: DepartmentProgramClaimInput[] = active.map((draft) => {
      const implementation = draft.option.implementation!;
      const previous = account.programs[implementation.programId];
      const ramp = rampFactor(implementation.rampProfileId, previous !== undefined);
      const pool = draft.capacityType ? account.capacityPools[draft.capacityType] : undefined;
      const capacity = pool
        ? {
            capacityType: pool.capacityType,
            maintenanceDemand: pool.maintenanceDemand,
            programDemand: totalDemandByCapacity.get(pool.capacityType) ?? draft.capacityDemand,
            sourceBreakdown: pool.sourceBreakdown,
          }
        : {
            capacityType: draft.capacityType ?? "legal_administration",
            maintenanceDemand: 0,
            programDemand: draft.capacityType ? draft.capacityDemand : 1,
            sourceBreakdown: draft.capacityType
              ? { workforce: 0, facilities: 0, systems: 0, efficiency: 0 }
              : { workforce: 1, facilities: 0, systems: 0, efficiency: 0 },
          };
      const capacityRatio = settleCapacity(capacity).ratio;
      const requestedOutlay = Math.round(draft.periodDemand * capacityRatio * ramp);
      const requestedEncumbrance =
        implementation.appropriationClass === "capital"
          ? Math.max(0, draft.periodDemand - requestedOutlay)
          : 0;
      return {
        programId: implementation.programId,
        legislationTypeId: draft.type._id,
        policyOptionId: draft.option.id,
        status: previous?.status ?? "authorized",
        priority: implementation.obligationPriority,
        annualDemand: draft.annualDemand,
        periodDemand: draft.periodDemand,
        requestedOutlay,
        requestedEncumbrance,
        openingEncumbered: previous?.encumbered ?? 0,
        capacity,
        coverageRatio: 1,
        rampFactor: ramp,
        createsArrearsOnShortfall: implementation.fundingSemantics === "standing_mandatory",
        jurisdictionMode: draft.jurisdictionMode,
        implementationMode: draft.type.administration!.implementationMode,
        ...(allocationIsComplete
          ? {
              allocationWeight: account.programAllocationPercents![implementation.programId],
            }
          : {}),
      };
    });

    for (const previous of Object.values(account.programs)) {
      if (activeProgramIds.has(previous.programId) || previous.status === "closed") continue;
      programs.push({
        programId: previous.programId,
        legislationTypeId: previous.legislationTypeId,
        policyOptionId: previous.policyOptionId,
        status: previous.status,
        priority: 2,
        annualDemand: 0,
        periodDemand: 0,
        requestedOutlay: 0,
        requestedEncumbrance: 0,
        openingEncumbered: previous.encumbered ?? 0,
        capacity: {
          capacityType: "wind_down",
          maintenanceDemand: 0,
          programDemand: 0,
          sourceBreakdown: { workforce: 0, facilities: 0, systems: 0, efficiency: 0 },
        },
        coverageRatio: 0,
        rampFactor: 0,
        createsArrearsOnShortfall: false,
        repealTurn: previous.repealTurn ?? input.turn,
      });
    }

    if (programs.length === 0) continue;
    const authority = active.reduce((sum, draft) => {
      const semantics = draft.option.implementation!.fundingSemantics;
      return semantics === "authorization_only" ? sum : sum + draft.periodDemand;
    }, 0);
    const policy = getDepartmentAccountPolicy(account.accountPolicyId ?? "civil_operating");
    settlements.push(
      settleDepartmentAccount({
        departmentId,
        turn: input.turn,
        accruedThroughTurn: account.accruedThroughTurn,
        openingBalance: account.balance,
        openingEncumbered: account.encumbered,
        openingArrears: account.arrears ?? 0,
        authority,
        policy,
        programs,
      })
    );
  }

  return { openings, createdDepartmentIds, settlements, skippedPrograms };
}
