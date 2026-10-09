import { describe, expect, it } from "vitest";
import type { ResetLawProvision } from "@/lib/db/types/legislation";
import { resolveResetLawProvision } from "./resetLaw";

describe("resolveResetLawProvision", () => {
  it("exposes every snapshotted metric and the proposal-time budget comparison", () => {
    const provision = {
      type: "reset_law",
      familyId: "L16",
      scope: "national",
      choice: "far_left",
      reviewedOption: {
        familyId: "L16",
        country: "US",
        scope: "national",
        choice: "far_left",
        effectiveFromYear: 1991,
        legalAuthorityId: "US:national:L16",
        fundingAccountId: "us_health",
        serviceDelivererId: "us_health",
        annualAllocation: 125_000_000,
        accruedTransitionLiability: 4_000_000,
        supersedesSourceIds: [],
        review: { legal: "approved", fiscal: "approved", outcome: "approved" },
      },
      titleSnapshot: "Universal Care Guarantee",
      descriptionSnapshot: "Extend public coverage broadly.",
      currentLawSnapshot: "Medicare and Medicaid",
      currentLawDescriptionSnapshot: "Existing coverage components.",
      currentChoiceSnapshot: "center_right",
      currentAnnualAllocationSnapshot: 95_000_000,
      annualAllocationDeltaSnapshot: 30_000_000,
      overseeingSeatIdSnapshot: "secretary_of_health",
      overseeingAgencyIdSnapshot: "us_health",
      primaryMetricEffectsSnapshot: [
        { metricId: "16", favorableNormalizedPoints: 0.91 },
        { metricId: "17", favorableNormalizedPoints: 0.91 },
        { metricId: "19", favorableNormalizedPoints: 0.91 },
      ],
      balanceBasis: "game-calibrated-provisional",
    } as ResetLawProvision;

    expect(resolveResetLawProvision(provision)).toMatchObject({
      metricEffects: [
        { metric: "Effective health coverage", favorableNormalizedDelta: 0.42 },
        { metric: "Care affordability", favorableNormalizedDelta: 0.42 },
        { metric: "Preventable mortality", favorableNormalizedDelta: 0.42 },
      ],
      fiscal: {
        currencyCode: "USD",
        current: { cost: 95_000_000, revenue: 0, net: -95_000_000 },
        proposed: { cost: 125_000_000, revenue: 0, net: -125_000_000 },
        netDelta: -30_000_000,
        transitionCost: 4_000_000,
      },
    });
  });
});
