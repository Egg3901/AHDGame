import type { Db } from "mongodb";
import type { DepartmentAccount, EnactedLaw, FederalBudget } from "@/lib/db/types/budget";
import type { StateBudget } from "@/lib/db/types/budget";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { LegislationType } from "@/lib/db/types/legislation";
import { resolvePolicyOptionJurisdiction } from "@/lib/legislature/jurisdiction";
import { withLawAdministration } from "./lawAdministrationCatalog";
import { clampRatio } from "./rules/implementation";
import {
  US_PUBLIC_HEALTH_LEGISLATION_TYPE_ID,
  US_PUBLIC_HEALTH_POLITICAL_LAW_ID,
} from "./deliveryMultiplier";

export interface DepartmentDeliveryMultiplierInput {
  currentTurn: number;
  accounts: Record<string, DepartmentAccount>;
  /** Active administered laws that must fail closed when no current program exists. */
  expectedLawIds?: ReadonlySet<string>;
  /** Laws whose selected responsibility model excludes a national program. */
  nationalDeliveryExcludedLawIds?: ReadonlySet<string>;
}

function deliveryLawId(legislationTypeId: string): string {
  return legislationTypeId === US_PUBLIC_HEALTH_LEGISLATION_TYPE_ID
    ? US_PUBLIC_HEALTH_POLITICAL_LAW_ID
    : legislationTypeId;
}

function deliveryLawIds(legislationTypeId: string): string[] {
  return [...new Set([legislationTypeId, deliveryLawId(legislationTypeId)])];
}

/**
 * Convert current department settlements into the law contribution factors
 * consumed by the political outcome engine. A stale or invalid settlement is
 * deliberately worth zero; the rules shell must settle delivery every turn.
 */
export function resolveDepartmentDeliveryMultipliers(
  input: DepartmentDeliveryMultiplierInput
): Map<string, number> {
  const multipliers = new Map<string, number>(
    [...(input.expectedLawIds ?? [])].map((lawId) => [lawId, 0] as const)
  );
  for (const account of Object.values(input.accounts)) {
    for (const program of Object.values(account.programs)) {
      const multiplier =
        program.lastSettledTurn === input.currentTurn &&
        Number.isFinite(program.implementationFactor)
          ? clampRatio(program.implementationFactor)
          : 0;
      // One enacted option should own one program. Max makes the resolver safe
      // during migrations where an old department account may still coexist.
      for (const lawId of deliveryLawIds(program.legislationTypeId)) {
        multipliers.set(lawId, Math.max(multipliers.get(lawId) ?? 0, multiplier));
      }
    }
  }
  for (const lawId of input.nationalDeliveryExcludedLawIds ?? []) multipliers.set(lawId, 0);
  return multipliers;
}

interface DepartmentDeliveryExpectations {
  expectedByCountry: Map<string, Set<string>>;
  excludedByCountry: Map<string, Set<string>>;
}

function addToCountryMap(map: Map<string, Set<string>>, countryId: string, lawId: string): void {
  const ids = map.get(countryId) ?? new Set<string>();
  ids.add(lawId);
  map.set(countryId, ids);
}

export function resolveDepartmentDeliveryExpectations(
  activeLaws: ReadonlyArray<
    Pick<EnactedLaw, "countryId" | "legislationTypeId" | "policyOptionIndex" | "jurisdictionMode">
  >,
  legislationTypes: ReadonlyArray<Pick<LegislationType, "_id" | "administration" | "policyOptions">>
): DepartmentDeliveryExpectations {
  const typeById = new Map(legislationTypes.map((type) => [type._id, type]));
  const expectedByCountry = new Map<string, Set<string>>();
  const excludedByCountry = new Map<string, Set<string>>();
  for (const law of activeLaws) {
    const type = typeById.get(law.legislationTypeId);
    const option = type?.policyOptions?.[law.policyOptionIndex ?? -1];
    if (!type?.administration || !option?.implementation) continue;
    const countryId = law.countryId ?? "US";
    const lawIds = deliveryLawIds(law.legislationTypeId);
    for (const lawId of lawIds) addToCountryMap(expectedByCountry, countryId, lawId);
    const jurisdictionMode = resolvePolicyOptionJurisdiction(type, option, law.jurisdictionMode);
    if (jurisdictionMode === "regional_discretion") {
      for (const lawId of lawIds) addToCountryMap(excludedByCountry, countryId, lawId);
    }
  }
  return { expectedByCountry, excludedByCountry };
}

/** One projected budget read for every country in the outcome pass. */
export async function loadDepartmentDeliveryMultipliersByCountry(
  db: Db,
  currentTurn: number,
  enabled: boolean,
  countryIds?: readonly string[]
): Promise<Map<string, Map<string, number>>> {
  if (!enabled) return new Map();
  const countryFilter = countryIds?.length ? { countryId: { $in: [...countryIds] } } : {};
  const lawCountryFilter = countryIds?.length
    ? {
        $or: [
          { countryId: { $in: [...countryIds] } },
          ...(countryIds.includes("US") ? [{ countryId: { $exists: false } }] : []),
        ],
      }
    : {};
  const [budgets, activeLaws] = await Promise.all([
    db
      .collection<FederalBudget>("federalBudget")
      .find(countryFilter, { projection: { countryId: 1, departmentAccounts: 1 } })
      .toArray(),
    db
      .collection<EnactedLaw>("enactedLaws")
      .find(
        { scope: "national", repealedAt: { $exists: false }, ...lawCountryFilter },
        {
          projection: {
            countryId: 1,
            legislationTypeId: 1,
            policyOptionIndex: 1,
            jurisdictionMode: 1,
          },
        }
      )
      .toArray(),
  ]);
  const activeTypeIds = [...new Set(activeLaws.map((law) => law.legislationTypeId))];
  const types =
    activeTypeIds.length === 0
      ? []
      : await db
          .collection<LegislationType>("legislationTypes")
          .find(
            { _id: { $in: activeTypeIds } },
            { projection: { _id: 1, administration: 1, policyOptions: 1 } }
          )
          .toArray();
  // Keep the outcome path compatible with worlds that enable the feature
  // before the metadata migration has materialized every legacy row. The
  // settlement shell uses the same in-memory fallback.
  const expectations = resolveDepartmentDeliveryExpectations(
    activeLaws,
    withLawAdministration(types)
  );
  const byCountry = new Map(
    budgets.map((budget) => [
      budget.countryId,
      resolveDepartmentDeliveryMultipliers({
        currentTurn,
        accounts: budget.departmentAccounts ?? {},
        expectedLawIds: expectations.expectedByCountry.get(budget.countryId),
        nationalDeliveryExcludedLawIds: expectations.excludedByCountry.get(budget.countryId),
      }),
    ])
  );
  for (const [countryId, expectedLawIds] of expectations.expectedByCountry) {
    if (byCountry.has(countryId)) continue;
    byCountry.set(
      countryId,
      resolveDepartmentDeliveryMultipliers({
        currentTurn,
        accounts: {},
        expectedLawIds,
        nationalDeliveryExcludedLawIds: expectations.excludedByCountry.get(countryId),
      })
    );
  }
  return byCountry;
}

type RegionalSettlementMap = NonNullable<RegionalBudget["programSettlements"]>;

export function resolveRegionalDeliveryMultipliers(
  programs: RegionalSettlementMap | NonNullable<StateBudget["regionalProgramSettlements"]>,
  currentTurn: number
): Map<string, number> {
  const multipliers = new Map<string, number>();
  for (const program of Object.values(programs)) {
    const isCurrent =
      program.lastSettledTurn <= currentTurn &&
      currentTurn <= (program.validThroughTurn ?? program.lastSettledTurn);
    const multiplier =
      isCurrent && Number.isFinite(program.implementationFactor)
        ? clampRatio(program.implementationFactor)
        : 0;
    for (const lawId of deliveryLawIds(program.legislationTypeId)) {
      multipliers.set(lawId, Math.max(multipliers.get(lawId) ?? 0, multiplier));
    }
  }
  return multipliers;
}

/** Load the latest cabinet-free regional settlements from both budget models. */
export async function loadRegionalDeliveryMultipliersByRegion(
  db: Db,
  currentTurn: number,
  enabled: boolean,
  regionIds?: readonly string[]
): Promise<Map<string, Map<string, number>>> {
  if (!enabled) return new Map();
  const filter = regionIds?.length ? { _id: { $in: [...regionIds] } } : {};
  const [regionalBudgets, stateBudgets] = await Promise.all([
    db
      .collection<RegionalBudget>("regionalBudgets")
      .find(filter, { projection: { programSettlements: 1 } })
      .toArray(),
    db
      .collection<StateBudget>("stateBudgets")
      .find(filter, { projection: { regionalProgramSettlements: 1 } })
      .toArray(),
  ]);
  const byRegion = new Map<string, Map<string, number>>();
  for (const budget of regionalBudgets) {
    byRegion.set(
      String(budget._id),
      resolveRegionalDeliveryMultipliers(budget.programSettlements ?? {}, currentTurn)
    );
  }
  for (const budget of stateBudgets) {
    const existing = byRegion.get(String(budget._id)) ?? new Map<string, number>();
    for (const [lawId, factor] of resolveRegionalDeliveryMultipliers(
      budget.regionalProgramSettlements ?? {},
      currentTurn
    )) {
      existing.set(lawId, Math.max(existing.get(lawId) ?? 0, factor));
    }
    byRegion.set(String(budget._id), existing);
  }
  return byRegion;
}
