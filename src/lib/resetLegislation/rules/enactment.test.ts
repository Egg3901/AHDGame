import { describe, expect, it } from "vitest";
import { resetLawFamilyById } from "../catalog";
import { openingLawReference } from "../openingLaw";
import { buildOpeningLawBoards1991 } from "../openingBoards1991";
import type { ReviewedLawOption } from "./reviewedOption";
import { enactReviewedLawOption } from "./enactment";

const family = resetLawFamilyById("L19")!;
const reference = openingLawReference("US", "national", "L19")!;

function reviewed(
  choice: ReviewedLawOption["choice"],
  annualAllocation: number,
  supersedesSourceIds: readonly string[] = ["us_public_health"]
): ReviewedLawOption {
  return {
    familyId: "L19",
    country: "US",
    scope: "national",
    choice,
    effectiveFromYear: 1991,
    legalAuthorityId: "us_public_health",
    fundingAccountId: "us_hhs",
    serviceDelivererId: "us_public_health_service",
    annualAllocation,
    accruedTransitionLiability: 30_000_000,
    supersedesSourceIds,
    review: { legal: "approved", fiscal: "approved", outcome: "approved" },
  };
}

describe("v2 law family enactment", () => {
  it("compares a first reform with the explicit 1991 source obligation", () => {
    const result = enactReviewedLawOption({
      family,
      reference,
      option: reviewed("center_left", 3_400_000_000),
      current: null,
      openingChoice: "center",
      year: 1991,
      turn: 2,
    });
    expect(result.previousAnnualAllocation).toBe(2_585_421_384);
    expect(result.nextAnnualAllocation).toBe(3_400_000_000);
    expect(result.annualAllocationDelta).toBe(814_578_616);
    expect(result.transitionClaim).toBe(30_000_000);
  });

  it("prices a later amendment against the live program, not the 1991 source twice", () => {
    const first = enactReviewedLawOption({
      family,
      reference,
      option: reviewed("center_left", 3_400_000_000),
      current: null,
      openingChoice: "center",
      year: 1991,
      turn: 2,
    });
    const next = enactReviewedLawOption({
      family,
      reference,
      option: reviewed("center_right", 2_100_000_000),
      current: first.program,
      openingChoice: "center",
      year: 1991,
      turn: 3,
    });
    expect(next.previousAnnualAllocation).toBe(3_400_000_000);
    expect(next.nextAnnualAllocation).toBe(2_100_000_000);
    expect(next.annualAllocationDelta).toBe(-1_300_000_000);
  });

  it("adds a new program without deleting the old law, then requires explicit supersession", () => {
    const additive = enactReviewedLawOption({
      family,
      reference,
      option: reviewed("center_left", 400_000_000, []),
      current: null,
      openingChoice: "center",
      year: 1991,
      turn: 2,
    });
    expect(additive.previousAnnualAllocation).toBe(2_585_421_384);
    expect(additive.nextAnnualAllocation).toBe(2_985_421_384);
    expect(additive.annualAllocationDelta).toBe(400_000_000);
    const replacement = enactReviewedLawOption({
      family,
      reference,
      option: reviewed("center_right", 2_100_000_000),
      current: additive.program,
      openingChoice: "center",
      year: 1991,
      turn: 3,
    });
    expect(replacement.annualAllocationDelta).toBe(-885_421_384);
    expect(() =>
      enactReviewedLawOption({
        family,
        reference,
        option: reviewed("far_right", 0, []),
        current: replacement.program,
        openingChoice: "center",
        year: 1991,
        turn: 4,
      })
    ).toThrow(/cannot silently restore/);
  });

  it("blocks unchanged and unreviewed choices before altering the program", () => {
    expect(() =>
      enactReviewedLawOption({
        family,
        reference,
        option: reviewed("center", 1_000_000_000),
        current: null,
        openingChoice: "center",
        year: 1991,
        turn: 2,
      })
    ).toThrow(/unavailable/);
    expect(() =>
      enactReviewedLawOption({
        family,
        reference,
        option: { ...reviewed("center_left", 1_000_000_000), review: undefined } as never,
        current: null,
        openingChoice: "center",
        year: 1991,
        turn: 2,
      })
    ).toThrow(/unreviewed/);
  });

  it("rejects corrupted or same-turn current state before calculating a budget delta", () => {
    const first = enactReviewedLawOption({
      family,
      reference,
      option: reviewed("center_left", 3_400_000_000),
      current: null,
      openingChoice: "center",
      year: 1991,
      turn: 2,
    });
    const input = {
      family,
      reference,
      option: reviewed("center_right", 2_100_000_000),
      current: first.program,
      openingChoice: "center" as const,
      year: 1991,
      turn: 2,
    };
    expect(() => enactReviewedLawOption(input)).toThrow(/already changed this turn/);
    expect(() =>
      enactReviewedLawOption({
        ...input,
        turn: 3,
        current: { ...first.program, annualAgencyAllocation: Number.NaN },
      })
    ).toThrow(/invalid/);
    expect(() =>
      enactReviewedLawOption({
        ...input,
        turn: 3,
        current: { ...first.program, supersededSourceIds: ["unknown_source"] },
      })
    ).toThrow(/invalid source supersessions/);
  });

  it("prices a state reform against that state's share, not the nationwide regional pool", () => {
    const stateReference = buildOpeningLawBoards1991("world-test", 1).find(
      (board) => board._id === "US:PA"
    )!.references.L19!;
    const sourceShare = stateReference.sourceComponents[0]!.annualBooked;
    const result = enactReviewedLawOption({
      family,
      reference: stateReference,
      option: {
        ...reviewed("center_left", 400_000_000, ["us_state_public_health"]),
        scope: "regional",
        fundingAccountId: "regional_budget",
        serviceDelivererId: "pa_health_service",
      },
      current: null,
      openingChoice: "center",
      year: 1991,
      turn: 2,
    });
    expect(sourceShare).toBeGreaterThan(0);
    expect(sourceShare).toBeLessThan(
      openingLawReference("US", "regional", "L19")!.sourceComponents[0]!.annualBooked
    );
    expect(result.previousAnnualAllocation).toBe(sourceShare);
    expect(result.annualAllocationDelta).toBeCloseTo(400_000_000 - sourceShare, 2);
  });
});
