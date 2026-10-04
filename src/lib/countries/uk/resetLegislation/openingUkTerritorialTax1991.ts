import { ukRegions1991 } from "@/lib/countries/uk/data/ukRegions1991";
import {
  generateStateBudgets,
  getInitialNationalBudgetsForPreset,
} from "@/lib/seeds/reference/budgets";
import { computeStateGdpScalars } from "@/lib/admin/seed/reconcileStateGdp";
import { ukTerritorialTaxOpening1991 } from "./ukTerritorialTax1991";

/** V2-only 1991 legal fixture. It never modifies the live v1 budget model. */
export function buildUkTerritorialTaxOpenings1991() {
  const national = getInitialNationalBudgetsForPreset("1991-default").find(
    (budget) => budget.countryId === "UK"
  );
  if (!national) throw new Error("1991 UK national budget missing");
  // The bootstrap reconciles 1991 regional GDP to the authored national GDP
  // before it derives regional budgets. Mirror that same pure calculation here
  // so the reviewed tax identity fixture certifies the budget rows that are
  // actually written, rather than the pre-reconciliation source regions.
  const scalar = computeStateGdpScalars(ukRegions1991, new Map([["UK", national.gdp]])).find(
    (row) => row.countryId === "UK"
  )?.scalar;
  if (scalar === undefined) throw new Error("1991 UK regional GDP scalar missing");
  const budgets = generateStateBudgets(
    ukRegions1991.map((region) => ({
      id: region._id,
      countryId: region.countryId,
      population: region.population,
      gdp: region.gdp * scalar,
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
