import { ukRegions1991 } from "@/lib/countries/uk/data/ukRegions1991";
import {
  generateStateBudgets,
  getInitialNationalBudgetsForPreset,
} from "@/lib/seeds/reference/budgets";
import { ukTerritorialTaxOpening1991 } from "./ukTerritorialTax1991";

/** V2-only 1991 legal fixture. It never modifies the live v1 budget model. */
export function buildUkTerritorialTaxOpenings1991() {
  const national = getInitialNationalBudgetsForPreset("1991-default").find(
    (budget) => budget.countryId === "UK"
  );
  if (!national) throw new Error("1991 UK national budget missing");
  const budgets = generateStateBudgets(
    ukRegions1991.map((region) => ({
      id: region._id,
      countryId: region.countryId,
      population: region.population,
      gdp: region.gdp,
    })),
    national.fiscalYear
  );
  const openings = budgets.map((budget) =>
    ukTerritorialTaxOpening1991({
      regionId: budget.stateId,
      propertyTaxProxy: budget.revenue.propertyTax,
      domesticCorporateTaxProxy: budget.revenue.domesticCorporateTax,
      foreignCorporateTaxProxy: budget.revenue.foreignCorporateTax,
    })
  );
  if (openings.length !== 12 || new Set(openings.map((row) => row.regionId)).size !== 12) {
    throw new Error("1991 UK local-tax opening requires 12 macroregions");
  }
  return openings;
}
