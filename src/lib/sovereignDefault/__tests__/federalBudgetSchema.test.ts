import { describe, it, expectTypeOf } from "vitest";
import type { FederalBudget } from "@/lib/db/types/budget";

describe("FederalBudget sovereign-default schema additions", () => {
  it("has sovereignCrisisState field", () => {
    expectTypeOf<NonNullable<FederalBudget["sovereignCrisisState"]>>().toEqualTypeOf<
      "normal" | "warning" | "crisisPending" | "crisisResolving" | "recovering"
    >();
  });

  it("has failedAuctionConsecutiveCount and lastAuctionDemandRatio", () => {
    expectTypeOf<
      NonNullable<FederalBudget["failedAuctionConsecutiveCount"]>
    >().toEqualTypeOf<number>();
    expectTypeOf<NonNullable<FederalBudget["lastAuctionDemandRatio"]>>().toEqualTypeOf<number>();
  });

  it("has crisis lifecycle fields", () => {
    expectTypeOf<NonNullable<FederalBudget["crisisFiredAt"]>>().toEqualTypeOf<{
      turn: number;
      realtimeMs: number;
    }>();
    expectTypeOf<NonNullable<FederalBudget["crisisChoice"]>>().toEqualTypeOf<
      "repudiate" | "restructure" | "bailout" | "monetize"
    >();
  });

  it("has recovery fields", () => {
    expectTypeOf<NonNullable<FederalBudget["recoveryStartedAt"]>>().toEqualTypeOf<{
      turn: number;
    }>();
    expectTypeOf<NonNullable<FederalBudget["lastDefaultTurn"]>>().toEqualTypeOf<number>();
  });

  it("has recovery GDP penalty intent fields (phase 6)", () => {
    expectTypeOf<NonNullable<FederalBudget["recoveryGdpPenaltyPercent"]>>().toEqualTypeOf<number>();
    expectTypeOf<
      NonNullable<FederalBudget["recoveryGdpPenaltyTurnsRemaining"]>
    >().toEqualTypeOf<number>();
  });
});

describe("FederalBudget IMF sovereign facility fields", () => {
  it("has imfSovereignBailoutActive flag", () => {
    expectTypeOf<
      NonNullable<FederalBudget["imfSovereignBailoutActive"]>
    >().toEqualTypeOf<boolean>();
  });

  it("has principal/rate/amortization/capture facility fields", () => {
    expectTypeOf<
      NonNullable<FederalBudget["imfSovereignFacilityPrincipalOutstanding"]>
    >().toEqualTypeOf<number>();
    expectTypeOf<
      NonNullable<FederalBudget["imfSovereignFacilityAnnualRate"]>
    >().toEqualTypeOf<number>();
    expectTypeOf<
      NonNullable<FederalBudget["imfSovereignFacilityAmortizationTurnsRemaining"]>
    >().toEqualTypeOf<number>();
    expectTypeOf<
      NonNullable<FederalBudget["imfSovereignFacilityIncomeCaptureFraction"]>
    >().toEqualTypeOf<number>();
  });
});

describe("FederalBudget IMF Board override fields", () => {
  it("has imfBoardOverride window timing fields", () => {
    expectTypeOf<NonNullable<FederalBudget["imfBoardOverrideWindowEndAt"]>>().toEqualTypeOf<{
      turn: number;
      realtimeMs: number;
    }>();
  });

  it("has board action audit fields", () => {
    expectTypeOf<NonNullable<FederalBudget["imfBoardOverrideKind"]>>().toEqualTypeOf<
      "termsModified" | "publicEndorsement" | "publicCriticism"
    >();
    expectTypeOf<NonNullable<FederalBudget["imfBoardOverrideRateDelta"]>>().toEqualTypeOf<number>();
    expectTypeOf<
      NonNullable<FederalBudget["imfBoardOverrideCaptureDelta"]>
    >().toEqualTypeOf<number>();
    expectTypeOf<NonNullable<FederalBudget["imfBoardPublicStatement"]>>().toEqualTypeOf<string>();
  });
});
