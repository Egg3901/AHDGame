import { describe, expect, it } from "vitest";
import { openingLawReference } from "../openingLaw";
import {
  compareOpeningLawReference,
  compareReviewedComponentBundle,
  type OpeningComponent,
} from "./componentBundle";

const opening: OpeningComponent[] = [
  {
    id: "us_public_health",
    historicalDisposition: "retained-legal-lineage",
    fiscalOwnerFamilyId: "L19",
    annualBooked: 2_799_164_700,
  },
  {
    id: "other_health_obligation",
    historicalDisposition: "retained-legal-lineage",
    fiscalOwnerFamilyId: "L18",
    annualBooked: 500_000_000,
  },
  {
    id: "future_1993_act",
    historicalDisposition: "not-adopted-as-1991-law",
    fiscalOwnerFamilyId: "L19",
    annualBooked: 100_000_000,
  },
];

describe("reviewed source component comparison", () => {
  it("replaces only an explicitly named 1991 component and one owned allocation", () => {
    const result = compareReviewedComponentBundle(opening, {
      familyId: "L19",
      optionId: "center_left",
      supersedes: ["us_public_health"],
      legalReview: "approved",
      annualAgencyAllocation: 3_400_000_000,
      transitionLiability: 30_000_000,
    });
    expect(result.currentAnnualAllocation).toBe(2_799_164_700);
    expect(result.annualAllocationDelta).toBe(600_835_300);
    expect(result.carriedLiability).toBe(30_000_000);
    expect(result.components.map((component) => component.relation)).toEqual([
      "amend_or_replace",
      "preserve",
      "historical_exclusion",
    ]);
  });

  it("rejects unknown, duplicate, and historically excluded supersessions", () => {
    const option = {
      familyId: "L19",
      optionId: "center_left",
      legalReview: "approved" as const,
      annualAgencyAllocation: 3_400_000_000,
      transitionLiability: 0,
    };
    expect(() =>
      compareReviewedComponentBundle(opening, { ...option, supersedes: ["missing"] })
    ).toThrow(/unknown supersession/);
    expect(() =>
      compareReviewedComponentBundle(opening, {
        ...option,
        supersedes: ["us_public_health", "us_public_health"],
      })
    ).toThrow(/duplicate supersession/);
    expect(() =>
      compareReviewedComponentBundle(opening, { ...option, supersedes: ["future_1993_act"] })
    ).toThrow(/historically excluded/);
  });

  it("keeps same-family costs that the bill does not supersede", () => {
    const withSecondProgram: OpeningComponent[] = [
      ...opening,
      {
        id: "independent_prevention_program",
        historicalDisposition: "retained-legal-lineage",
        fiscalOwnerFamilyId: "L19",
        annualBooked: 600_000_000,
      },
    ];
    const result = compareReviewedComponentBundle(withSecondProgram, {
      familyId: "L19",
      optionId: "targeted_prevention",
      supersedes: ["us_public_health"],
      legalReview: "approved",
      annualAgencyAllocation: 3_400_000_000,
      transitionLiability: 0,
    });
    expect(result.currentAnnualAllocation).toBe(3_399_164_700);
    expect(result.supersededAnnualAllocation).toBe(2_799_164_700);
    expect(result.retainedAnnualAllocation).toBe(600_000_000);
    expect(result.newAgencyAllocation).toBe(3_400_000_000);
    expect(result.proposedAnnualAllocation).toBe(4_000_000_000);
    expect(result.annualAllocationDelta).toBe(600_835_300);
  });

  it("treats a new program as additive when no existing cost is superseded", () => {
    const result = compareReviewedComponentBundle(opening, {
      familyId: "L19",
      optionId: "new_prevention_program",
      supersedes: [],
      legalReview: "approved",
      annualAgencyAllocation: 400_000_000,
      transitionLiability: 0,
    });
    expect(result.currentAnnualAllocation).toBe(2_799_164_700);
    expect(result.supersededAnnualAllocation).toBe(0);
    expect(result.proposedAnnualAllocation).toBe(3_199_164_700);
    expect(result.annualAllocationDelta).toBe(400_000_000);
  });

  it("cannot erase another family's booked cost by amending its legal component", () => {
    const result = compareReviewedComponentBundle(opening, {
      familyId: "L19",
      optionId: "cross_family_legal_amendment",
      supersedes: ["other_health_obligation"],
      legalReview: "approved",
      annualAgencyAllocation: 100_000_000,
      transitionLiability: 0,
    });
    expect(result.supersededAnnualAllocation).toBe(0);
    expect(result.annualAllocationDelta).toBe(100_000_000);
  });

  it("compares a priced choice to the checked-in US 1991 public-health source", () => {
    const reference = openingLawReference("US", "national", "L19")!;
    const result = compareOpeningLawReference(reference, {
      familyId: "L19",
      optionId: "center_left",
      supersedes: ["us_public_health"],
      legalReview: "approved",
      annualAgencyAllocation: 3_400_000_000,
      transitionLiability: 0,
    });
    expect(result.currentAnnualAllocation).toBe(2_799_164_700);
    expect(result.annualAllocationDelta).toBe(600_835_300);
  });

  it("does not let an ordinary option replace a protected grant transfer", () => {
    const reference = openingLawReference("JP", "national", "L08")!;
    expect(() =>
      compareOpeningLawReference(reference, {
        familyId: "L08",
        optionId: "far_left",
        supersedes: ["jp_local_allocation_tax"],
        legalReview: "approved",
        annualAgencyAllocation: 8_000_000_000_000,
        transitionLiability: 0,
      })
    ).toThrow(/protected transfer/);
    const ukReference = openingLawReference("UK", "national", "L06")!;
    expect(() =>
      compareOpeningLawReference(ukReference, {
        familyId: "L06",
        optionId: "center_right",
        supersedes: ["uk_local_government_funding"],
        legalReview: "approved",
        annualAgencyAllocation: 18_000_000_000,
        transitionLiability: 0,
      })
    ).toThrow(/protected transfer/);
  });
});
