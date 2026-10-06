import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameState, LegislationType } from "@/lib/db/types";
import { calculateFederalLawAnnualCosts } from "@/lib/budget/spending";
import {
  applyCountryDepartmentSettlements,
  applyDepartmentProgramSettlement,
  ensureDepartmentAccount,
} from "@/lib/db/collections/departmentAccounts";
import {
  PUBLIC_HEALTH_CAPACITY_TYPE,
  US_HEALTH_DEPARTMENT_ID,
  US_PUBLIC_HEALTH_PROGRAM_ID,
} from "@/lib/governmentFinance/departments";
import {
  isDepartmentFinanceEnabledFromState,
  isDepartmentProgramSliceEnabledFromState,
} from "@/lib/governmentFinance/featureFlag";
import { buildCountryDepartmentSettlementPlan } from "@/lib/governmentFinance/generalizedSettlementPlan";
import { withLawAdministration } from "@/lib/governmentFinance/lawAdministrationCatalog";
import type { DepartmentCountryId } from "@/lib/governmentFinance/departmentCatalog";
import { RESET_V2_COUNTRIES } from "@/lib/resetVersions/rules";
import { includedAuthorityPerTurn } from "@/lib/governmentFinance/rules/appropriation";
import { settleCapacity } from "@/lib/governmentFinance/rules/capacity";
import { settleProgramAccount } from "@/lib/governmentFinance/rules/implementation";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { resetSystemVersionsForCountry, type ResetVersionState } from "@/lib/resetVersions/rules";

const MAX_COMMIT_ATTEMPTS = 3;
const US_PUBLIC_HEALTH_TYPE = "us_public_health";
const US_PUBLIC_HEALTH_OPTION = "public_health_opt_1";

export interface DepartmentProgramTurnResult {
  enabled: boolean;
  programsSettled: number;
  authorityAccrued: number;
  outlaid: number;
  encumbered: number;
  implementationFactor: number | null;
  reconciliation: "not_run" | "balanced";
  countriesProcessed?: number;
  departmentsSettled?: number;
  skippedPrograms?: number;
}

function emptyResult(enabled: boolean): DepartmentProgramTurnResult {
  return {
    enabled,
    programsSettled: 0,
    authorityAccrued: 0,
    outlaid: 0,
    encumbered: 0,
    implementationFactor: null,
    reconciliation: "not_run",
  };
}

async function loadUsBudget(db: Db): Promise<FederalBudget | null> {
  return db.collection<FederalBudget>("federalBudget").findOne(
    { countryId: "US" },
    {
      projection: {
        _id: 1,
        countryId: 1,
        gdp: 1,
        revenue: 1,
        spending: 1,
        baselineSpendingByCategory: 1,
        baselineStateGrants: 1,
        departmentAccounts: 1,
      },
    }
  );
}

export async function processDepartmentProgramSettlement(
  db: Db,
  turn: number,
  gameState: Pick<
    GameState,
    "departmentProgramSliceEnabled" | "departmentFinanceEnabled" | "manuallyEnabledSeats"
  > &
    ResetVersionState
): Promise<DepartmentProgramTurnResult> {
  if (isDepartmentFinanceEnabledFromState(gameState)) {
    return processGeneralizedDepartmentSettlement(db, turn, gameState);
  }
  if (!isDepartmentProgramSliceEnabledFromState(gameState)) return emptyResult(false);

  if (resetSystemVersionsForCountry(gameState, RESET_V2_READY, "US").cabinet === "v2") {
    return emptyResult(false);
  }
  let budget = await loadUsBudget(db);
  if (!budget) return emptyResult(true);
  let account = budget.departmentAccounts?.[US_HEALTH_DEPARTMENT_ID];
  if (!account) {
    account = (await ensureDepartmentAccount(db, "US", US_HEALTH_DEPARTMENT_ID)) ?? undefined;
    budget = await loadUsBudget(db);
  }
  if (!account || !budget) return emptyResult(true);

  const [costs, legislationType] = await Promise.all([
    calculateFederalLawAnnualCosts(db, budget),
    db
      .collection<LegislationType>("legislationTypes")
      .findOne(
        { _id: US_PUBLIC_HEALTH_TYPE },
        { projection: { _id: 1, administration: 1, policyOptions: 1 } }
      ),
  ]);
  const optionIndex =
    legislationType?.policyOptions?.findIndex(
      (candidate) => candidate.id === US_PUBLIC_HEALTH_OPTION
    ) ?? -1;
  const option = optionIndex >= 0 ? legislationType?.policyOptions?.[optionIndex] : undefined;
  if (
    legislationType?.administration?.primaryDepartmentId !== US_HEALTH_DEPARTMENT_ID ||
    option?.implementation?.programId !== US_PUBLIC_HEALTH_PROGRAM_ID
  ) {
    throw new Error("public-health department slice metadata is missing or inconsistent");
  }

  const active = costs.items.find(
    ({ law }) =>
      law.legislationTypeId === US_PUBLIC_HEALTH_TYPE && law.policyOptionIndex === optionIndex
  );
  let previous = account.programs[US_PUBLIC_HEALTH_PROGRAM_ID];
  if (!active && !previous) return emptyResult(true);

  const annualDemand = Math.max(0, Math.round(active?.amount ?? previous?.annualDemand ?? 0));
  const periodDemand = includedAuthorityPerTurn(annualDemand, turn);
  const authority = active ? periodDemand : 0;
  const repealTurn = !active ? (previous?.repealTurn ?? turn) : undefined;

  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      budget = await loadUsBudget(db);
      account = budget?.departmentAccounts?.[US_HEALTH_DEPARTMENT_ID];
      if (!account) return emptyResult(true);
      previous = account.programs[US_PUBLIC_HEALTH_PROGRAM_ID];
    }
    const capacityPool = account.capacityPools[PUBLIC_HEALTH_CAPACITY_TYPE];
    if (!capacityPool) throw new Error("public-health capacity pool is missing");
    const capacityInput = {
      capacityType: PUBLIC_HEALTH_CAPACITY_TYPE,
      maintenanceDemand: capacityPool.maintenanceDemand,
      programDemand: 100,
      sourceBreakdown: capacityPool.sourceBreakdown,
    };
    const capacity = settleCapacity(capacityInput);
    const free = Math.max(0, account.balance - account.encumbered);
    const rampFactor = previous ? 1 : 0.5;
    const requestedOutlay = active
      ? Math.round(Math.min(periodDemand, free + authority) * capacity.ratio * rampFactor)
      : 0;
    const settlement = settleProgramAccount({
      programId: US_PUBLIC_HEALTH_PROGRAM_ID,
      legislationTypeId: US_PUBLIC_HEALTH_TYPE,
      policyOptionId: US_PUBLIC_HEALTH_OPTION,
      status: previous?.status ?? "authorized",
      priority: option.implementation.obligationPriority,
      openingBalance: account.balance,
      openingEncumbered: account.encumbered,
      accruedThroughTurn: account.accruedThroughTurn,
      turn,
      authority,
      programDemand: periodDemand,
      requestedOutlay,
      requestedEncumbrance: 0,
      capacity: capacityInput,
      coverageRatio: 1,
      rampFactor,
      ...(repealTurn !== undefined ? { repealTurn } : {}),
    });

    if (settlement.replayed) return emptyResult(true);
    const committed = await applyDepartmentProgramSettlement(
      db,
      "US",
      US_HEALTH_DEPARTMENT_ID,
      account,
      settlement
    );
    if (!committed) continue;
    return {
      enabled: true,
      programsSettled: 1,
      authorityAccrued: settlement.authorityAccrued,
      outlaid: settlement.outlaid,
      encumbered: settlement.closingEncumbered,
      implementationFactor: settlement.implementation.implementationFactor,
      reconciliation: "balanced",
    };
  }

  throw new Error("department settlement could not commit after concurrent budget changes");
}

const GENERALIZED_COUNTRIES: DepartmentCountryId[] = [...RESET_V2_COUNTRIES];
const GENERALIZED_BUDGET_PROJECTION = {
  _id: 1,
  countryId: 1,
  gdp: 1,
  revenue: 1,
  spending: 1,
  baselineSpendingByCategory: 1,
  baselineStateGrants: 1,
  departmentAccounts: 1,
} as const;

async function loadGeneralizedBudgets(db: Db): Promise<FederalBudget[]> {
  return db
    .collection<FederalBudget>("federalBudget")
    .find(
      { countryId: { $in: GENERALIZED_COUNTRIES } },
      { projection: GENERALIZED_BUDGET_PROJECTION }
    )
    .toArray();
}

async function loadGeneralizedBudget(
  db: Db,
  countryId: DepartmentCountryId
): Promise<FederalBudget | null> {
  return db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId }, { projection: GENERALIZED_BUDGET_PROJECTION });
}

async function processGeneralizedDepartmentSettlement(
  db: Db,
  turn: number,
  gameState: Pick<GameState, "departmentFinanceEnabled" | "manuallyEnabledSeats"> &
    ResetVersionState
): Promise<DepartmentProgramTurnResult> {
  const budgets = (await loadGeneralizedBudgets(db)).filter(
    (budget) =>
      resetSystemVersionsForCountry(gameState, RESET_V2_READY, String(budget.countryId)).cabinet !==
      "v2"
  );
  if (budgets.length === 0) return emptyResult(true);
  const costResults = await Promise.all(
    budgets.map(async (budget) => ({
      budget,
      costs: await calculateFederalLawAnnualCosts(db, budget),
    }))
  );
  const legislationTypeIds = [
    ...new Set(
      costResults.flatMap(({ costs }) => costs.activeLaws.map((law) => law.legislationTypeId))
    ),
  ];
  const storedTypes =
    legislationTypeIds.length === 0
      ? []
      : await db
          .collection<LegislationType>("legislationTypes")
          .find(
            { _id: { $in: legislationTypeIds } },
            {
              projection: {
                _id: 1,
                countryScope: 1,
                policyDomain: 1,
                subCategory: 1,
                allowedScope: 1,
                nationalOnly: 1,
                budgetCategory: 1,
                isGrant: 1,
                effectTarget: 1,
                effectTargets: 1,
                effectTargetsWeighted: 1,
                administration: 1,
                policyOptions: 1,
              },
            }
          )
          .toArray();
  const types = withLawAdministration(storedTypes);
  const enabledSeats = new Set(gameState.manuallyEnabledSeats ?? []);
  let countriesProcessed = 0;
  let departmentsSettled = 0;
  let programsSettled = 0;
  let authorityAccrued = 0;
  let outlaid = 0;
  let encumbered = 0;
  let skippedPrograms = 0;

  for (const { budget: initialBudget, costs } of costResults) {
    const countryId = initialBudget.countryId as DepartmentCountryId;
    if (!GENERALIZED_COUNTRIES.includes(countryId)) continue;
    let budget = initialBudget;
    let finalPlan: ReturnType<typeof buildCountryDepartmentSettlementPlan> | null = null;
    let currentTurnSettlements:
      ReturnType<typeof buildCountryDepartmentSettlementPlan>["settlements"] | null = null;
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const annualCostByLawId = new Map(
        costs.items.map(({ law, amount }) => [law._id.toString(), amount])
      );
      const plan = buildCountryDepartmentSettlementPlan({
        countryId,
        turn,
        year: costs.eraYear,
        enabledSeats,
        accounts: budget.departmentAccounts ?? {},
        // Zero-cost options can still require administrative capacity and
        // produce delivered outcomes. Keep every active law in the plan while
        // leaving the sovereign spending calculation's zero-cost filtering
        // unchanged.
        activeLawCosts: costs.activeLaws.map((law) => ({
          law,
          amount: annualCostByLawId.get(law._id.toString()) ?? 0,
        })),
        legislationTypes: types,
      });
      finalPlan = plan;
      const pending = plan.settlements.filter((settlement) => !settlement.replayed);
      if (pending.length === 0) {
        currentTurnSettlements = [];
        break;
      }
      const committed = await applyCountryDepartmentSettlements(
        db,
        countryId,
        plan.openings,
        new Set(plan.createdDepartmentIds),
        pending
      );
      if (committed) {
        currentTurnSettlements = pending;
        break;
      }
      const reloaded = await loadGeneralizedBudget(db, countryId);
      if (!reloaded) break;
      budget = reloaded;
    }
    if (!finalPlan || currentTurnSettlements === null) {
      throw new Error(
        `department settlement could not commit after concurrent budget changes for ${countryId}`
      );
    }
    skippedPrograms += finalPlan.skippedPrograms.length;
    if (currentTurnSettlements.length === 0) continue;
    countriesProcessed += 1;
    departmentsSettled += currentTurnSettlements.length;
    programsSettled += currentTurnSettlements.reduce(
      (sum, settlement) => sum + settlement.programs.length,
      0
    );
    authorityAccrued += currentTurnSettlements.reduce(
      (sum, settlement) => sum + settlement.authorityAccrued,
      0
    );
    outlaid += currentTurnSettlements.reduce((sum, settlement) => sum + settlement.totalOutlays, 0);
    encumbered += currentTurnSettlements.reduce(
      (sum, settlement) => sum + settlement.closingEncumbered,
      0
    );
  }

  return {
    enabled: true,
    programsSettled,
    authorityAccrued,
    outlaid,
    encumbered,
    implementationFactor: null,
    reconciliation: departmentsSettled > 0 ? "balanced" : "not_run",
    countriesProcessed,
    departmentsSettled,
    skippedPrograms,
  };
}
