/** 1991 source-book comparison for non-selectable design agency-cost assumptions. */
import { openingFiscalBooks1991 } from "../../src/lib/resetFinance/opening1991";
import { openingFiscalOwnership1991 } from "../../src/lib/resetFinance/openingOwnership1991";
import { resetLawFamilies } from "../../src/lib/resetLegislation/catalog";
import profiles from "../../src/lib/resetLegislation/provisionalBalanceProfiles.json";
import { provisionalPriceVector } from "../../src/lib/resetLegislation/rules/provisionalPricing";

type Country = "US" | "UK" | "JP";

export interface ProvisionalCostComparison {
  country: Country;
  familyId: string;
  sourceAnnual: number;
  designCenterAnnual: number;
  centerToSourceRatio: number | null;
  rawFiveDesignAnnual: number[];
  fiveAnchoredAnnual: number[];
  pricingAnchor: "source-book" | "new-program-gdp-proxy";
  status: "provisional-design-only";
}

export function auditProvisionalCosts1991(): ProvisionalCostComparison[] {
  const books = openingFiscalBooks1991();
  const ownership = openingFiscalOwnership1991();
  const profileByFamily = new Map(profiles.map((profile) => [profile.familyId, profile]));
  const rows: ProvisionalCostComparison[] = [];
  for (const country of ["US", "UK", "JP"] as const) {
    for (const family of resetLawFamilies) {
      if (!family.availability.national.includes(country)) continue;
      const profile = profileByFamily.get(family.id);
      if (
        profile?.status !== "provisional-design-only" ||
        !Number.isFinite(profile.baseCostFractionOfGdp) ||
        profile.baseCostFractionOfGdp < 0 ||
        profile.allocationFactors.length !== 5 ||
        profile.allocationFactors.some((factor) => !Number.isFinite(factor) || factor < 0)
      ) {
        throw new Error(`Missing provisional cost vector for ${country}/${family.id}`);
      }
      const rawFiveDesignAnnual = profile.allocationFactors.map((factor) =>
        Math.round(books[country].gdp * profile.baseCostFractionOfGdp * factor)
      );
      const sourceAnnual = ownership[country].familyTotals[family.id] ?? 0;
      const priced = provisionalPriceVector({
        gdp: books[country].gdp,
        sourceAnnual,
        profile,
      });
      const designCenterAnnual = priced.rawDesignCenterAnnual;
      rows.push({
        country,
        familyId: family.id,
        sourceAnnual,
        designCenterAnnual,
        centerToSourceRatio: sourceAnnual > 0 ? designCenterAnnual / sourceAnnual : null,
        rawFiveDesignAnnual,
        fiveAnchoredAnnual: priced.fiveAnnualAllocations,
        pricingAnchor: priced.anchor,
        status: "provisional-design-only",
      });
    }
  }
  return rows;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/auditProvisionalCosts.ts")) {
  const rows = auditProvisionalCosts1991();
  const books = openingFiscalBooks1991();
  const summary = (["US", "UK", "JP"] as const).map((country) => {
    const countryRows = rows.filter((row) => row.country === country);
    const funded = countryRows.filter((row) => row.centerToSourceRatio !== null);
    return {
      country,
      families: countryRows.length,
      sourceFunded: funded.length,
      noDedicatedSourceCost: countryRows.length - funded.length,
      centerBelowQuarterOfSource: funded.filter((row) => row.centerToSourceRatio! < 0.25).length,
      centerAboveFourTimesSource: funded.filter((row) => row.centerToSourceRatio! > 4).length,
      anchoredAllFarLeftPercentGdp:
        (countryRows.reduce((sum, row) => sum + row.fiveAnchoredAnnual[0]!, 0) /
          books[country].gdp) *
        100,
    };
  });
  const extreme = rows
    .filter((row) => row.centerToSourceRatio !== null)
    .sort(
      (a, b) =>
        Math.abs(Math.log(b.centerToSourceRatio!)) - Math.abs(Math.log(a.centerToSourceRatio!))
    )
    .slice(0, 12);
  console.log(
    JSON.stringify(
      { meaning: "provisional design audit, not law prices", summary, extreme },
      null,
      2
    )
  );
}
