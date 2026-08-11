import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  ENERGY_ENVELOPE_FALLBACK_GDP_FRACTION,
  ENERGY_DISCRETIONARY_FRACTION,
  ENERGY_DISCRETIONARY_BASELINE,
  ENERGY_DISCRETIONARY_CAP,
  ENERGY_UPKEEP_UNIT,
} from "@/lib/constants/cabinetEnergy";

/**
 * Read-only energy discretionary budget (absolute currency). Energy has no federal category,
 * so the slice is gdp × ENERGY_ENVELOPE_FALLBACK_GDP_FRACTION × ENERGY_DISCRETIONARY_FRACTION;
 * the envelope is the LARGER of that or the baseline allowance (so smaller economies have room).
 * Never mutates the budget.
 */
export async function resolveEnergyEnvelope(db: Db, countryId: string): Promise<number> {
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ countryId });
  if (!budget) return 0;
  const gdp = budget.gdp;
  const slice =
    typeof gdp === "number" && gdp > 0
      ? gdp * ENERGY_ENVELOPE_FALLBACK_GDP_FRACTION * ENERGY_DISCRETIONARY_FRACTION
      : 0;
  return Math.min(
    Math.max(slice, ENERGY_DISCRETIONARY_BASELINE * ENERGY_UPKEEP_UNIT),
    ENERGY_DISCRETIONARY_CAP * ENERGY_UPKEEP_UNIT
  );
}
