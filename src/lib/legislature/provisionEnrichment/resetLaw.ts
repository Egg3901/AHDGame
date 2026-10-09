/** Reset-law bill displays use the frozen proposal price, including retained claims. */
import type { ResetLawProvision } from "@/lib/db/types/legislation";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { ProvisionDisplay } from "./types";

export function resolveResetLawProvision(provision: ResetLawProvision): ProvisionDisplay {
  const currentCost = provision.currentAnnualAllocationSnapshot;
  // The reviewed allocation is only the new program. The snapshot delta also
  // accounts for source claims retained or superseded by this proposal.
  const proposedCost = currentCost + provision.annualAllocationDeltaSnapshot;
  return {
    legislationTypeName: provision.titleSnapshot,
    current: {
      name: provision.currentLawSnapshot,
      explanation: provision.currentLawDescriptionSnapshot,
    },
    proposed: { name: provision.titleSnapshot, explanation: provision.descriptionSnapshot },
    effectDirection: 0,
    directionLabel: "Center",
    fiscal: {
      currencyCode: COUNTRY_CURRENCY_MAP[provision.reviewedOption.country],
      current: { cost: currentCost, revenue: 0, net: -currentCost },
      proposed: { cost: proposedCost, revenue: 0, net: -proposedCost },
      netDelta: -provision.annualAllocationDeltaSnapshot,
      transitionCost: provision.reviewedOption.accruedTransitionLiability,
    },
  };
}
