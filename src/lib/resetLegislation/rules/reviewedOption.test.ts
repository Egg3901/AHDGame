import { describe, expect, it } from "vitest";
import { resetLawFamilyById } from "../catalog";
import { openingLawReference } from "../openingLaw";
import { reviewedOptionEligibility, type ReviewedLawOption } from "./reviewedOption";

const family = resetLawFamilyById("L19")!;
const reviewed: ReviewedLawOption = {
  familyId: "L19",
  country: "US",
  scope: "national",
  choice: "center_left",
  effectiveFromYear: 1991,
  legalAuthorityId: "us_congress",
  fundingAccountId: "us_health_department",
  serviceDelivererId: "us_public_health_service",
  annualAllocation: 3_400_000_000,
  accruedTransitionLiability: 0,
  supersedesSourceIds: ["us_public_health"],
  review: { legal: "approved", fiscal: "approved", outcome: "approved" },
};

const input = {
  family,
  option: reviewed,
  country: "US" as const,
  scope: "national" as const,
  choice: "center_left" as const,
  currentChoice: "center" as const,
  year: 1991,
  openingReference: openingLawReference("US", "national", "L19")!,
};

describe("reviewed v2 law proposal gate", () => {
  it("requires a country/era-specific reviewed option in addition to catalog text", () => {
    expect(reviewedOptionEligibility({ ...input, option: null })).toEqual({
      allowed: false,
      reason: "unreviewed",
    });
    expect(reviewedOptionEligibility(input)).toEqual({ allowed: true });
    expect(reviewedOptionEligibility({ ...input, year: 1990 })).toEqual({
      allowed: false,
      reason: "era",
    });
  });

  it("keeps local money in the regional budget, never a Cabinet account", () => {
    const local: ReviewedLawOption = {
      ...reviewed,
      country: "UK",
      scope: "regional",
      fundingAccountId: "regional_budget",
    };
    expect(
      reviewedOptionEligibility({
        ...input,
        option: { ...local, choice: "center_left", supersedesSourceIds: [] },
        country: "UK",
        scope: "regional",
        openingReference: openingLawReference("UK", "regional", "L19")!,
      })
    ).toEqual({ allowed: true });
    expect(
      reviewedOptionEligibility({
        ...input,
        option: { ...local, supersedesSourceIds: ["uk_regional_health"] },
        country: "UK",
        scope: "regional",
        openingReference: openingLawReference("UK", "regional", "L19")!,
      })
    ).toEqual({ allowed: false, reason: "source_conflict" });
    expect(
      reviewedOptionEligibility({
        ...input,
        option: { ...local, fundingAccountId: "uk_health_department" },
        country: "UK",
        scope: "regional",
        openingReference: openingLawReference("UK", "regional", "L19")!,
      })
    ).toEqual({ allowed: false, reason: "authority" });
  });

  it("rejects no-change even if a reviewed record is present", () => {
    expect(reviewedOptionEligibility({ ...input, currentChoice: "center_left" })).toEqual({
      allowed: false,
      reason: "unavailable",
    });
  });

  it("rejects unknown or historically excluded supersession before proposal", () => {
    expect(
      reviewedOptionEligibility({
        ...input,
        option: { ...reviewed, supersedesSourceIds: ["invented_source"] },
      })
    ).toEqual({ allowed: false, reason: "source_conflict" });
    expect(
      reviewedOptionEligibility({
        ...input,
        openingReference: openingLawReference("UK", "national", "L19")!,
      })
    ).toEqual({ allowed: false, reason: "source_conflict" });
  });

  it("keeps the 1991 JP local allocation transfer outside ordinary fiscal-framework options", () => {
    expect(
      reviewedOptionEligibility({
        ...input,
        family: resetLawFamilyById("L08")!,
        country: "JP",
        openingReference: openingLawReference("JP", "national", "L08")!,
        option: {
          ...reviewed,
          familyId: "L08",
          country: "JP",
          supersedesSourceIds: ["jp_local_allocation_tax"],
        },
      })
    ).toEqual({ allowed: false, reason: "source_conflict" });
  });

  it("requires integral allocations, valid eras, and no new federal spend for state discretion", () => {
    expect(
      reviewedOptionEligibility({
        ...input,
        option: { ...reviewed, annualAllocation: 0.5 },
      })
    ).toEqual({ allowed: false, reason: "allocation" });
    expect(
      reviewedOptionEligibility({
        ...input,
        option: { ...reviewed, effectiveFromYear: Number.NaN },
      })
    ).toEqual({ allowed: false, reason: "era" });
    expect(
      reviewedOptionEligibility({
        ...input,
        option: {
          ...reviewed,
          choice: "leave_to_states",
          annualAllocation: 1,
        },
        choice: "leave_to_states",
      })
    ).toEqual({ allowed: false, reason: "allocation" });
  });

  it("fails closed on malformed persisted review or authority metadata", () => {
    expect(
      reviewedOptionEligibility({
        ...input,
        option: { ...reviewed, review: undefined } as unknown as ReviewedLawOption,
      })
    ).toEqual({ allowed: false, reason: "unreviewed" });
    expect(
      reviewedOptionEligibility({
        ...input,
        option: { ...reviewed, fundingAccountId: null } as unknown as ReviewedLawOption,
      })
    ).toEqual({ allowed: false, reason: "authority" });
  });
});
