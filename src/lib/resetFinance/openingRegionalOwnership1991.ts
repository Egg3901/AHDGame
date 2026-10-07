import { states1991 } from "@/lib/countries/us/data/usStates1991";
import { ukRegions1991 } from "@/lib/countries/uk/data/ukRegions1991";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";
import { ieRegions1991 } from "@/lib/countries/ie/data/ieRegions1991";
import {
  generateStateBudgets,
  getInitialNationalBudgetsForPreset,
} from "@/lib/seeds/reference/budgets";
import { openingLawReferences } from "@/lib/resetLegislation/openingLaw";
import { openingFiscalBooks1991, type ResetOpeningCountry } from "./opening1991";
import { allocateRegionalOpeningClaims } from "./rules/regionalOpeningAllocation";

const REGIONS = {
  US: states1991,
  UK: ukRegions1991,
  JP: jpRegions1991,
  IE: ieRegions1991,
} as const;

/** Pooled source costs are allocated by each region's opening service envelope.
 * This is a seed audit, not a future law price or a regional Cabinet account.
 */
export function openingRegionalFiscalOwnership1991() {
  const national = getInitialNationalBudgetsForPreset("1991-default");
  const books = openingFiscalBooks1991();
  return Object.fromEntries(
    (["US", "UK", "JP", "IE"] as const).map((country: ResetOpeningCountry) => {
      const nationalBudget = national.find((budget) => budget.countryId === country);
      if (!nationalBudget) throw new Error(`${country} national 1991 budget missing`);
      const regions = generateStateBudgets(
        REGIONS[country].map((region) => ({
          id: region._id,
          countryId: region.countryId,
          population: region.population,
          gdp: region.gdp,
        })),
        nationalBudget.fiscalYear
      );
      const claims = openingLawReferences
        .filter((reference) => reference.country === country && reference.scope === "regional")
        .flatMap((reference) =>
          reference.sourceComponents
            .filter((component) => component.fiscalRole === "single-booked-owner")
            .map((component) => ({
              sourceId: component.sourceId,
              familyId: reference.familyId,
              annualBooked: component.annualBooked,
            }))
        );
      const allocated = allocateRegionalOpeningClaims(
        regions.map((region) => ({
          regionId: region.stateId,
          annualSpending: region.spending.total,
        })),
        claims
      );
      if (Math.abs(allocated.annualSpending - books[country].regionalSpending) > 0.01) {
        throw new Error(`${country} regional envelope changed during ownership audit`);
      }
      return [country, allocated];
    })
  ) as Record<ResetOpeningCountry, ReturnType<typeof allocateRegionalOpeningClaims>>;
}
