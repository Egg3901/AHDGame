/**
 * Regional spending breakdown for the region budget page.
 *
 * Lives here rather than in the route because a Next.js route segment may only
 * export handlers — and because the turn engine and the page MUST price the
 * same enactment the same way. They previously did not: the engine priced
 * regional laws through the v2 cost engine while the route read
 * `annualCostPerCapita` off a legacy `legislationTypes` doc. On the
 * political-legislation preset those docs are unseeded, so a London that the
 * engine was charging £59.0M/yr reported £0.0M of spending on its own page.
 */

import type { CountryId } from "@/lib/constants/countries";
import type { LegislationType } from "@/lib/db/types/legislation";
import { budgetKeyForLaw } from "@/lib/politicalLegislation/budgetKeys";
import { getLaw } from "@/lib/politicalLegislation/catalog";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";

/** Display labels for legacy policy domains. */
const DOMAIN_LABELS: Record<string, string> = {
  healthcare: "Healthcare",
  education: "Education",
  infrastructure: "Infrastructure",
  publicSafety: "Public Safety",
  environment: "Environment",
  social: "Social Services",
  governance: "Governance",
  economic: "Economic Development",
  defense: "Defense",
  immigration: "Immigration",
  agriculture: "Agriculture",
  foreign_policy: "Foreign Policy",
  technology: "Technology",
  law_justice: "Law & Justice",
};

export interface RegionalSpendingPolicy {
  legislationTypeId: string;
  policyOptionId?: string;
  policyOptionIndex?: number;
}

export interface RegionalSpendingInput {
  policies: RegionalSpendingPolicy[];
  /** Legacy legislation types, for policies not in the v2 catalog. May be empty. */
  legTypes: LegislationType[];
  countryId: CountryId;
  /** Region GDP in absolute local currency (states.gdp × 1e6). */
  regionGdp: number;
  regionPopulation: number;
}

/**
 * Annual spending per budget category for a region's enacted policies.
 *
 * v2 catalog laws price through `computeLawCost` on the region's own fiscal
 * base and charge the NET burden (cost − revenue), matching
 * `enactedRegionalPolicyCost` in the turn engine. Legacy policies keep the
 * `annualCostPerCapita × population` form. Tax laws generate revenue rather
 * than spend, so they are skipped; a policy whose type exists in neither place
 * contributes nothing.
 */
export function computeRegionalSpendingByCategory(
  input: RegionalSpendingInput
): Record<string, number> {
  const legTypeMap = new Map(input.legTypes.map((lt) => [lt._id, lt]));
  const base = { gdp: input.regionGdp, population: input.regionPopulation };
  const byCategory: Record<string, number> = {};

  // Accumulates the NET burden faithfully, negatives included: 42 of the
  // authored law-levels earn more than they cost (extraction levies), and the
  // turn engine subtracts those from the region's spending line. Dropping them
  // here would put the page above the ledger — the disagreement this module
  // exists to prevent. Exact zeros are pruned at the end so a level-0 policy
  // does not render an empty row.
  const add = (category: string, amount: number) => {
    if (!Number.isFinite(amount) || amount === 0) return;
    byCategory[category] = (byCategory[category] ?? 0) + amount;
  };

  for (const policy of input.policies) {
    const law = getLaw(policy.legislationTypeId);
    if (law && law.kind !== "tax" && law.levels) {
      const level = Math.max(0, Math.min(4, policy.policyOptionIndex ?? 0));
      const fiscal = computeLawCost(law.levels[level], base, law.countryId, null);
      add(budgetKeyForLaw(law), fiscal.cost - fiscal.revenue);
      continue;
    }

    const legType = legTypeMap.get(policy.legislationTypeId);
    const option = legType?.policyOptions?.find((o) => o.id === policy.policyOptionId);
    const costPerCapita = option?.annualCostPerCapita ?? 0;
    const category = DOMAIN_LABELS[legType?.policyDomain ?? ""] ?? legType?.policyDomain ?? "Other";
    add(category, costPerCapita * input.regionPopulation);
  }

  for (const [category, amount] of Object.entries(byCategory)) {
    if (amount === 0) delete byCategory[category];
  }

  return byCategory;
}
