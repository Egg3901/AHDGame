import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  PORTFOLIO_BUDGET_CATEGORY,
  BUDGET_CATEGORY_ALIASES,
  ESTATE_ENVELOPE_FALLBACK_GDP_FRACTION,
  ESTATE_DISCRETIONARY_FRACTION,
  ESTATE_DISC_FLOOR,
  ESTATE_DISC_CAP,
  ESTATE_UPKEEP_UNIT,
} from "@/lib/constants/cabinetEstates";

/**
 * Read-only portfolio discretionary budget (absolute currency): the discretionary slice of the
 * resolved appropriation (enacted category → baseline → gdp fallback) × ESTATE_DISCRETIONARY_FRACTION,
 * clamped to an ABSOLUTE band [FLOOR, CAP] (in the upkeep unit). Estate upkeep is country-
 * independent, so an absolute band gives every portfolio comparable room regardless of economy
 * size. Never mutates the budget.
 */
export async function resolvePortfolioEnvelope(
  db: Db,
  countryId: string,
  portfolioKey: string
): Promise<number> {
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ countryId });
  if (!budget) return 0;
  const cat = PORTFOLIO_BUDGET_CATEGORY[portfolioKey];
  let raw = 0;
  if (cat) {
    // Canonical key first, then the non-canonical keys real budgets use for it
    // (see BUDGET_CATEGORY_ALIASES). Enacted beats baseline for every key before
    // falling through, mirroring resolveInfraEnvelope's chain.
    const keys = [cat, ...(BUDGET_CATEGORY_ALIASES[cat] ?? [])];
    for (const key of keys) {
      const enacted = budget.spending?.byCategory?.[key];
      if (typeof enacted === "number" && enacted > 0) {
        raw = enacted;
        break;
      }
      const baseline = budget.baselineSpendingByCategory?.[key];
      if (typeof baseline === "number" && baseline > 0) {
        raw = baseline;
        break;
      }
    }
  }
  const gdp = budget.gdp;
  if (raw === 0 && typeof gdp === "number" && gdp > 0) {
    raw = gdp * ESTATE_ENVELOPE_FALLBACK_GDP_FRACTION;
  }
  const slice = raw * ESTATE_DISCRETIONARY_FRACTION;
  // Clamp to an absolute band so every portfolio gets comparable room regardless of economy size.
  return Math.min(
    Math.max(slice, ESTATE_DISC_FLOOR * ESTATE_UPKEEP_UNIT),
    ESTATE_DISC_CAP * ESTATE_UPKEEP_UNIT
  );
}
