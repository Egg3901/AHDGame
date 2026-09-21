import type { Db } from "mongodb";
import type {
  DepartmentAccount,
  DepartmentProgramState,
  FederalBudget,
} from "@/lib/db/types/budget";
import type {
  DepartmentAccountSettlement,
  DepartmentProgramClaimSettlement,
  ProgramAccountSettlement,
} from "@/lib/governmentFinance/rules/types";
import {
  createEmptyDepartmentAccount,
  createEmptyUsHealthDepartmentAccount,
} from "@/lib/governmentFinance/departments";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

function budgets(db: Db) {
  return db.collection<FederalBudget>("federalBudget");
}

export async function ensureDepartmentAccount(
  db: Db,
  countryId: string,
  departmentId: string
): Promise<DepartmentAccount | null> {
  const budget = await budgets(db).findOne(
    { countryId },
    {
      projection: {
        countryId: 1,
        [`departmentAccounts.${departmentId}`]: 1,
      },
    }
  );
  if (!budget) return null;
  const stored = budget.departmentAccounts?.[departmentId];
  if (stored) return stored;
  const definition = DEPARTMENT_DEFINITIONS.find(
    (candidate) => candidate.countryId === countryId && candidate.id === departmentId
  );
  if (!definition?.accountPolicyId) return null;
  const initial =
    countryId === COUNTRY_CONFIGS.US.id && departmentId === "us_health_department"
      ? createEmptyUsHealthDepartmentAccount()
      : createEmptyDepartmentAccount(definition);
  await budgets(db).updateOne(
    { countryId, [`departmentAccounts.${departmentId}`]: { $exists: false } },
    { $set: { [`departmentAccounts.${departmentId}`]: initial } }
  );
  return initial;
}

function programStateFrom(settlement: ProgramAccountSettlement): DepartmentProgramState {
  return {
    programId: settlement.programId,
    legislationTypeId: settlement.legislationTypeId,
    policyOptionId: settlement.policyOptionId,
    status: settlement.status,
    annualDemand: settlement.programDemand * TURNS_PER_YEAR,
    periodDemand: settlement.programDemand,
    authorityThisTurn: settlement.authorityAccrued,
    obligated: settlement.obligated,
    outlaid: settlement.outlaid,
    arrears: settlement.arrears,
    fundingRatio: settlement.implementation.fundingRatio,
    capacityRatio: settlement.implementation.capacityRatio,
    coverageRatio: settlement.implementation.coverageRatio,
    rampFactor: settlement.implementation.rampFactor,
    implementationFactor: settlement.implementation.implementationFactor,
    bindingConstraint: settlement.implementation.bindingConstraint,
    lastSettledTurn: settlement.turn,
    ...(settlement.repealTurn !== undefined ? { repealTurn: settlement.repealTurn } : {}),
  };
}

export async function applyDepartmentProgramSettlement(
  db: Db,
  countryId: string,
  departmentId: string,
  opening: DepartmentAccount,
  settlement: ProgramAccountSettlement
): Promise<boolean> {
  if (settlement.replayed) return false;
  const base = `departmentAccounts.${departmentId}`;
  const result = await budgets(db).updateOne(
    {
      countryId,
      [`${base}.accruedThroughTurn`]: { $lt: settlement.turn },
      [`${base}.balance`]: opening.balance,
      [`${base}.encumbered`]: opening.encumbered,
    },
    {
      $set: {
        [`${base}.balance`]: settlement.closingBalance,
        [`${base}.encumbered`]: settlement.closingEncumbered,
        [`${base}.accruedThroughTurn`]: settlement.turn,
        [`${base}.programs.${settlement.programId}`]: programStateFrom(settlement),
      },
    }
  );
  return result.modifiedCount > 0;
}

function generalizedProgramStateFrom(
  settlement: DepartmentProgramClaimSettlement,
  existing: DepartmentProgramState | undefined,
  turn: number
): DepartmentProgramState {
  return {
    programId: settlement.programId,
    legislationTypeId: settlement.legislationTypeId,
    policyOptionId: settlement.policyOptionId,
    status: settlement.status,
    annualDemand: settlement.annualDemand,
    periodDemand: settlement.requested,
    authorityThisTurn: settlement.allocated,
    obligated: settlement.outlaid + settlement.closingEncumbered,
    encumbered: settlement.closingEncumbered,
    outlaid: settlement.outlaid,
    cumulativeOutlays: (existing?.cumulativeOutlays ?? 0) + settlement.outlaid,
    arrears: settlement.newArrears,
    fundingRatio: settlement.implementation.fundingRatio,
    capacityRatio: settlement.implementation.capacityRatio,
    coverageRatio: settlement.implementation.coverageRatio,
    rampFactor: settlement.implementation.rampFactor,
    implementationFactor: settlement.implementation.implementationFactor,
    bindingConstraint: settlement.implementation.bindingConstraint,
    ...(settlement.jurisdictionMode ? { jurisdictionMode: settlement.jurisdictionMode } : {}),
    ...(settlement.implementationMode ? { implementationMode: settlement.implementationMode } : {}),
    lastSettledTurn: turn,
    ...(settlement.repealTurn !== undefined ? { repealTurn: settlement.repealTurn } : {}),
  };
}

export async function applyDepartmentAccountSettlement(
  db: Db,
  countryId: string,
  opening: DepartmentAccount,
  settlement: DepartmentAccountSettlement
): Promise<boolean> {
  if (settlement.replayed) return false;
  const base = `departmentAccounts.${opening.departmentId}`;
  const updates: Record<string, number | DepartmentProgramState> = {
    [`${base}.balance`]: settlement.closingBalance,
    [`${base}.encumbered`]: settlement.closingEncumbered,
    [`${base}.arrears`]: settlement.closingArrears,
    [`${base}.accruedThroughTurn`]: settlement.turn,
  };
  for (const program of settlement.programs) {
    updates[`${base}.programs.${program.programId}`] = generalizedProgramStateFrom(
      program,
      opening.programs[program.programId],
      settlement.turn
    );
  }
  const result = await budgets(db).updateOne(
    {
      countryId,
      [`${base}.accruedThroughTurn`]: { $lt: settlement.turn },
      [`${base}.balance`]: opening.balance,
      [`${base}.encumbered`]: opening.encumbered,
      [`${base}.arrears`]: opening.arrears ?? 0,
    },
    { $set: updates }
  );
  return result.modifiedCount > 0;
}

function accountAfterSettlement(
  opening: DepartmentAccount,
  settlement: DepartmentAccountSettlement
): DepartmentAccount {
  const programs = { ...opening.programs };
  for (const program of settlement.programs) {
    programs[program.programId] = generalizedProgramStateFrom(
      program,
      opening.programs[program.programId],
      settlement.turn
    );
  }
  return {
    ...opening,
    balance: settlement.closingBalance,
    encumbered: settlement.closingEncumbered,
    arrears: settlement.closingArrears,
    accruedThroughTurn: settlement.turn,
    programs,
  };
}

export async function applyCountryDepartmentSettlements(
  db: Db,
  countryId: string,
  openings: Record<string, DepartmentAccount>,
  createdDepartmentIds: ReadonlySet<string>,
  settlements: DepartmentAccountSettlement[]
): Promise<boolean> {
  const filter: Record<string, unknown> = { countryId };
  const updates: Record<string, DepartmentAccount> = {};
  for (const settlement of settlements) {
    if (settlement.replayed) continue;
    const opening = openings[settlement.departmentId];
    if (!opening) throw new Error(`missing opening account: ${settlement.departmentId}`);
    const base = `departmentAccounts.${settlement.departmentId}`;
    if (createdDepartmentIds.has(settlement.departmentId)) {
      filter[base] = { $exists: false };
    } else {
      filter[`${base}.accruedThroughTurn`] = { $lt: settlement.turn };
      filter[`${base}.balance`] = opening.balance;
      filter[`${base}.encumbered`] = opening.encumbered;
    }
    updates[base] = accountAfterSettlement(opening, settlement);
  }
  if (Object.keys(updates).length === 0) return false;
  const result = await budgets(db).updateOne(filter, { $set: updates });
  return result.modifiedCount > 0;
}
