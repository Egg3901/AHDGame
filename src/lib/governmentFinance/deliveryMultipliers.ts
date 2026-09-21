import type { Db } from "mongodb";
import type { DepartmentAccount, FederalBudget } from "@/lib/db/types/budget";
import type { StateBudget } from "@/lib/db/types/budget";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import { clampRatio } from "./rules/implementation";
import {
  US_PUBLIC_HEALTH_LEGISLATION_TYPE_ID,
  US_PUBLIC_HEALTH_POLITICAL_LAW_ID,
} from "./deliveryMultiplier";

export interface DepartmentDeliveryMultiplierInput {
  currentTurn: number;
  accounts: Record<string, DepartmentAccount>;
}

/**
 * Convert current department settlements into the law contribution factors
 * consumed by the political outcome engine. A stale or invalid settlement is
 * deliberately worth zero; the rules shell must settle delivery every turn.
 */
export function resolveDepartmentDeliveryMultipliers(
  input: DepartmentDeliveryMultiplierInput
): Map<string, number> {
  const multipliers = new Map<string, number>();
  for (const account of Object.values(input.accounts)) {
    for (const program of Object.values(account.programs)) {
      const lawId =
        program.legislationTypeId === US_PUBLIC_HEALTH_LEGISLATION_TYPE_ID
          ? US_PUBLIC_HEALTH_POLITICAL_LAW_ID
          : program.legislationTypeId;
      const multiplier =
        program.lastSettledTurn === input.currentTurn &&
        Number.isFinite(program.implementationFactor)
          ? clampRatio(program.implementationFactor)
          : 0;
      // One enacted option should own one program. Max makes the resolver safe
      // during migrations where an old department account may still coexist.
      multipliers.set(lawId, Math.max(multipliers.get(lawId) ?? 0, multiplier));
    }
  }
  return multipliers;
}

/** One projected budget read for every country in the outcome pass. */
export async function loadDepartmentDeliveryMultipliersByCountry(
  db: Db,
  currentTurn: number,
  enabled: boolean,
  countryIds?: readonly string[]
): Promise<Map<string, Map<string, number>>> {
  if (!enabled) return new Map();
  const filter = countryIds?.length ? { countryId: { $in: [...countryIds] } } : {};
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find(filter, { projection: { countryId: 1, departmentAccounts: 1 } })
    .toArray();
  return new Map(
    budgets.map((budget) => [
      budget.countryId,
      resolveDepartmentDeliveryMultipliers({
        currentTurn,
        accounts: budget.departmentAccounts ?? {},
      }),
    ])
  );
}

type RegionalSettlementMap = NonNullable<RegionalBudget["programSettlements"]>;

export function resolveRegionalDeliveryMultipliers(
  programs: RegionalSettlementMap | NonNullable<StateBudget["regionalProgramSettlements"]>,
  currentTurn: number
): Map<string, number> {
  const multipliers = new Map<string, number>();
  for (const program of Object.values(programs)) {
    const lawId =
      program.legislationTypeId === US_PUBLIC_HEALTH_LEGISLATION_TYPE_ID
        ? US_PUBLIC_HEALTH_POLITICAL_LAW_ID
        : program.legislationTypeId;
    multipliers.set(
      lawId,
      Math.max(
        multipliers.get(lawId) ?? 0,
        program.lastSettledTurn === currentTurn && Number.isFinite(program.implementationFactor)
          ? clampRatio(program.implementationFactor)
          : 0
      )
    );
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
