import { describe, expect, it } from "vitest";
import {
  CENTRAL_BANK_DEPOSIT_BONUS_PERCENT_POINTS,
  CENTRAL_BANK_LOC_SPREAD_HIKE_PERCENT_POINTS,
  CENTRAL_BANK_PRICING_PHASE_IN_TURNS,
  resolveCentralBankPricingAdjustment,
} from "./centralBankPricing";

describe("central-bank pricing phase-in", () => {
  it("ramps both sides linearly and caps at the announced targets", () => {
    const startTurn = 100;

    expect(resolveCentralBankPricingAdjustment(startTurn, startTurn)).toMatchObject({
      spreadHikePercentPoints: 0,
      depositBonusPercentPoints: 0,
      progress: 0,
      turnsRemaining: CENTRAL_BANK_PRICING_PHASE_IN_TURNS,
    });

    expect(resolveCentralBankPricingAdjustment(startTurn + 4, startTurn)).toMatchObject({
      spreadHikePercentPoints: 1,
      depositBonusPercentPoints: 0.125,
      progress: 0.5,
      turnsRemaining: 4,
    });

    expect(
      resolveCentralBankPricingAdjustment(
        startTurn + CENTRAL_BANK_PRICING_PHASE_IN_TURNS,
        startTurn
      )
    ).toMatchObject({
      spreadHikePercentPoints: CENTRAL_BANK_LOC_SPREAD_HIKE_PERCENT_POINTS,
      depositBonusPercentPoints: CENTRAL_BANK_DEPOSIT_BONUS_PERCENT_POINTS,
      progress: 1,
      turnsRemaining: 0,
    });

    expect(resolveCentralBankPricingAdjustment(startTurn + 50, startTurn)).toMatchObject({
      spreadHikePercentPoints: CENTRAL_BANK_LOC_SPREAD_HIKE_PERCENT_POINTS,
      depositBonusPercentPoints: CENTRAL_BANK_DEPOSIT_BONUS_PERCENT_POINTS,
      progress: 1,
      turnsRemaining: 0,
    });
  });
});
