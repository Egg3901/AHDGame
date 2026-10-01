import { describe, expect, it } from "vitest";
import { resetLawFamilyById } from "../catalog";
import { openingLawReference } from "../openingLaw";
import { buildOpeningLawBoards1991 } from "../openingBoards1991";
import type { ReviewedLawOption } from "./reviewedOption";
import { enactReviewedBill, type ReviewedBillProvision } from "./billEnactment";

function provision(input: {
  country: "US" | "JP";
  familyId: string;
  sourceId: string;
  annualAllocation: number;
  account: string;
}): ReviewedBillProvision {
  const { country, familyId, sourceId, annualAllocation, account } = input;
  const option: ReviewedLawOption = {
    country,
    scope: "national",
    familyId,
    choice: "center_left",
    effectiveFromYear: 1991,
    legalAuthorityId: sourceId,
    fundingAccountId: account,
    serviceDelivererId: `${account}_service`,
    annualAllocation,
    accruedTransitionLiability: 10,
    supersedesSourceIds: [sourceId],
    review: { legal: "approved", fiscal: "approved", outcome: "approved" },
  };
  return {
    family: resetLawFamilyById(familyId)!,
    reference: openingLawReference(country, "national", familyId)!,
    option,
    openingChoice: "center",
    openingFundingAccountId: account,
  };
}

describe("v2 multi-provision bill transition", () => {
  const health = provision({
    country: "US",
    familyId: "L19",
    sourceId: "us_public_health",
    annualAllocation: 3_400_000_000,
    account: "us_hhs",
  });

  it("reviews the whole bill and groups annual changes by department account", () => {
    const secondSource = provision({
      country: "US",
      familyId: "L18",
      sourceId: "us_federal_healthcare_funding",
      annualAllocation: 50_000_000_000,
      account: "us_hhs",
    });
    const second = {
      ...secondSource,
      option: { ...secondSource.option, supersedesSourceIds: [] },
    };
    const result = enactReviewedBill({
      provisions: [health, second],
      existingPrograms: [],
      year: 1991,
      turn: 2,
    });
    expect(result.transitions).toHaveLength(2);
    expect(result.annualAllocationDelta).toBe(
      result.transitions[0]!.annualAllocationDelta + result.transitions[1]!.annualAllocationDelta
    );
    expect(result.transitionClaim).toBe(20);
    expect(result.fundingAccountDeltas).toEqual([
      { fundingAccountId: "us_hhs", annualDelta: result.annualAllocationDelta },
    ]);
  });

  it("blocks a source repeated across different law families", () => {
    const sme = provision({
      country: "JP",
      familyId: "L03",
      sourceId: "jp_sme_support",
      annualAllocation: 200_000_000_000,
      account: "jp_economy",
    });
    const competition = provision({
      country: "JP",
      familyId: "L05",
      sourceId: "jp_sme_support",
      annualAllocation: 100_000_000_000,
      account: "jp_economy",
    });
    expect(() =>
      enactReviewedBill({
        provisions: [sme, competition],
        existingPrograms: [],
        year: 1991,
        turn: 2,
      })
    ).toThrow(/cannot supersede source jp_sme_support twice/);
  });

  it("blocks empty, duplicate-family, and cross-country bills", () => {
    expect(() =>
      enactReviewedBill({ provisions: [], existingPrograms: [], year: 1991, turn: 2 })
    ).toThrow(/at least/);
    expect(() =>
      enactReviewedBill({ provisions: [health, health], existingPrograms: [], year: 1991, turn: 2 })
    ).toThrow(/Duplicate/);
    const jp = provision({
      country: "JP",
      familyId: "L03",
      sourceId: "jp_sme_support",
      annualAllocation: 200_000_000_000,
      account: "jp_economy",
    });
    expect(() =>
      enactReviewedBill({ provisions: [health, jp], existingPrograms: [], year: 1991, turn: 2 })
    ).toThrow(/cannot cross countries/);
  });

  it("blocks a source already superseded by another family's active law", () => {
    const competition = provision({
      country: "JP",
      familyId: "L05",
      sourceId: "jp_sme_support",
      annualAllocation: 100_000_000_000,
      account: "jp_economy",
    });
    expect(() =>
      enactReviewedBill({
        provisions: [competition],
        existingPrograms: [
          {
            country: "JP",
            scope: "national",
            familyId: "L03",
            choice: "center_left",
            annualAgencyAllocation: 200_000_000_000,
            supersededSourceIds: ["jp_sme_support"],
            effectiveTurn: 2,
            legalAuthorityId: "jp_sme_support",
            fundingAccountId: "jp_economy",
            serviceDelivererId: "jp_economy_service",
          },
        ],
        year: 1991,
        turn: 3,
      })
    ).toThrow(/already superseded by L03/);
  });

  it("debits the old account and credits the new one when responsibility changes", () => {
    const current = {
      country: "US" as const,
      scope: "national" as const,
      familyId: "L19",
      choice: "center_left" as const,
      annualAgencyAllocation: 3_400_000_000,
      supersededSourceIds: ["us_public_health"],
      effectiveTurn: 2,
      legalAuthorityId: "us_public_health",
      fundingAccountId: "us_hhs",
      serviceDelivererId: "us_public_health_service",
    };
    const replacement: ReviewedBillProvision = {
      ...health,
      option: {
        ...health.option,
        choice: "center_right",
        annualAllocation: 4_000_000_000,
        fundingAccountId: "us_new_health_account",
      },
    };
    const result = enactReviewedBill({
      provisions: [replacement],
      existingPrograms: [current],
      year: 1991,
      turn: 3,
    });
    expect(result.annualAllocationDelta).toBe(600_000_000);
    expect(result.fundingAccountDeltas).toEqual([
      { fundingAccountId: "us_hhs", annualDelta: -3_400_000_000 },
      { fundingAccountId: "us_new_health_account", annualDelta: 4_000_000_000 },
    ]);
  });

  it("accepts a regional source share and balances its single regional account", () => {
    const reference = buildOpeningLawBoards1991("world-test", 1).find(
      (board) => board._id === "US:PA"
    )!.references.L19!;
    const stateHealth: ReviewedBillProvision = {
      family: resetLawFamilyById("L19")!,
      reference,
      option: {
        ...health.option,
        scope: "regional",
        fundingAccountId: "regional_budget",
        serviceDelivererId: "pa_health_service",
        annualAllocation: 400_000_000,
        supersedesSourceIds: ["us_state_public_health"],
      },
      openingChoice: "center",
      openingFundingAccountId: "regional_budget",
    };
    const result = enactReviewedBill({
      provisions: [stateHealth],
      existingPrograms: [],
      year: 1991,
      turn: 2,
    });
    expect(result.annualAllocationDelta).toBeCloseTo(
      400_000_000 - reference.sourceComponents[0]!.annualBooked,
      2
    );
    expect(result.fundingAccountDeltas).toEqual([
      { fundingAccountId: "regional_budget", annualDelta: result.annualAllocationDelta },
    ]);
  });
});
