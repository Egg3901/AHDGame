import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  INFRA_ENVELOPE_FALLBACK_GDP_FRACTION,
  INFRA_DISCRETIONARY_FRACTION,
  INFRA_DISCRETIONARY_BASELINE,
  INFRA_DISCRETIONARY_CAP,
  INFRA_UPKEEP_UNIT,
} from "@/lib/constants/cabinetInfra";

/**
 * Read-only transportation discretionary budget (absolute currency): the LARGER of the
 * resolved appropriation (enacted transportation → infrastructure → baseline either → gdp
 * fallback) × INFRA_DISCRETIONARY_FRACTION, or the baseline allowance. Never mutates the budget.
 */
export async function resolveInfraEnvelope(db: Db, countryId: string): Promise<number> {
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ countryId });
  if (!budget) return 0;
  const enacted = budget.spending?.byCategory;
  const base = budget.baselineSpendingByCategory;
  const gdp = budget.gdp;
  let raw = 0;
  if (typeof enacted?.transportation === "number" && enacted.transportation > 0) {
    raw = enacted.transportation;
  } else if (typeof enacted?.infrastructure === "number" && enacted.infrastructure > 0) {
    raw = enacted.infrastructure;
  } else if (typeof enacted?.transport === "number" && enacted.transport > 0) {
    // DE's actual budgetCategory (deLegislationTypes.ts: de_rail_transport,
    // de_digital_infrastructure) — the 1953 baseline was renamed "infrastructure"
    // → "transport" to match it (fiscal-scale audit, 2026-07-28); this fallback
    // keeps DE's transportation envelope resolving off that renamed key.
    raw = enacted.transport;
  } else if (typeof base?.transportation === "number" && base.transportation > 0) {
    raw = base.transportation;
  } else if (typeof base?.infrastructure === "number" && base.infrastructure > 0) {
    raw = base.infrastructure;
  } else if (typeof base?.transport === "number" && base.transport > 0) {
    raw = base.transport;
  } else if (typeof gdp === "number" && gdp > 0) {
    raw = gdp * INFRA_ENVELOPE_FALLBACK_GDP_FRACTION;
  }
  const slice = raw * INFRA_DISCRETIONARY_FRACTION;
  return Math.min(
    Math.max(slice, INFRA_DISCRETIONARY_BASELINE * INFRA_UPKEEP_UNIT),
    INFRA_DISCRETIONARY_CAP * INFRA_UPKEEP_UNIT
  );
}
