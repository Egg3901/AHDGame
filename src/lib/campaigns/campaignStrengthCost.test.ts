import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_STRENGTH_POINTS_PER_ACTION,
  CAMPAIGN_STRENGTH_PRICE_PER_POINT,
  CAMPAIGN_STRENGTH_TAU,
  campaignStrengthContributionActions,
  campaignStrengthContributionCost,
} from "./campaignStrength";

/**
 * The property that motivated the rewrite (see campaignStrength.ts): the OLD
 * `sqrt(currentCS + added)` price was charged per click and ignored the
 * quantity bought, so a high-influence player reached any given CS for a small
 * fraction of a low-influence player's bill. Everything here pins the fix.
 */
describe("campaignStrengthContributionCost", () => {
  it("charges nothing for a zero or negative contribution", () => {
    expect(campaignStrengthContributionCost(1000, 0)).toBe(0);
    expect(campaignStrengthContributionCost(1000, -50)).toBe(0);
  });

  it("scales linearly with the amount bought at a fixed starting strength", () => {
    const single = campaignStrengthContributionCost(0, 100);
    const double = campaignStrengthContributionCost(0, 200);
    // Not exactly 2x — the saturation surcharge rises within the purchase —
    // but the leading term is linear, unlike the old sqrt price.
    expect(double).toBeGreaterThan(single * 1.99);
  });

  it("costs more the more strength the campaign already has", () => {
    const early = campaignStrengthContributionCost(0, 3000);
    const late = campaignStrengthContributionCost(150_000, 3000);
    expect(late).toBeGreaterThan(early);
  });

  it("charges the exact integral of the quadratic marginal price", () => {
    const added = 3000;
    const current = 50_000;
    const end = current + added;
    const expected =
      CAMPAIGN_STRENGTH_PRICE_PER_POINT *
      (added + (end ** 3 - current ** 3) / (3 * CAMPAIGN_STRENGTH_TAU * CAMPAIGN_STRENGTH_TAU));
    expect(campaignStrengthContributionCost(current, added)).toBeCloseTo(expected, 6);
  });

  // The midpoint rule undercharges a quadratic by added^3 / (12 * TAU^2), an
  // error proportional to step size — exactly the high-influence discount this
  // rewrite removes. Pin that we do NOT use it.
  it("does not use the midpoint rule, which would discount large steps", () => {
    const current = 0;
    const added = 30_000;
    const midpointPrice =
      CAMPAIGN_STRENGTH_PRICE_PER_POINT *
      added *
      (1 + ((current + added / 2) / CAMPAIGN_STRENGTH_TAU) ** 2);
    const actual = campaignStrengthContributionCost(current, added);
    expect(actual).toBeGreaterThan(midpointPrice);
    const shortfall =
      (CAMPAIGN_STRENGTH_PRICE_PER_POINT * added ** 3) /
      (12 * CAMPAIGN_STRENGTH_TAU * CAMPAIGN_STRENGTH_TAU);
    expect(actual - midpointPrice).toBeCloseTo(shortfall, 3);
  });

  it("raises the per-point price 10x by three tau of saturation", () => {
    const perPoint = (cs: number): number => campaignStrengthContributionCost(cs, 1);
    const base = perPoint(0);
    expect(perPoint(CAMPAIGN_STRENGTH_TAU) / base).toBeCloseTo(2, 2);
    expect(perPoint(2 * CAMPAIGN_STRENGTH_TAU) / base).toBeCloseTo(5, 2);
    expect(perPoint(3 * CAMPAIGN_STRENGTH_TAU) / base).toBeCloseTo(10, 2);
  });

  it("treats a null or missing current strength as zero", () => {
    expect(campaignStrengthContributionCost(null, 1000)).toBeCloseTo(
      campaignStrengthContributionCost(0, 1000),
      6
    );
    expect(campaignStrengthContributionCost(undefined, 1000)).toBeCloseTo(
      campaignStrengthContributionCost(0, 1000),
      6
    );
  });

  // The core fairness property: total spend to reach a target CS must not
  // depend on how big each step is, i.e. not on the buyer's national influence.
  it("costs the same total to reach a target regardless of step size", () => {
    const target = 150_000;
    const totalForStep = (step: number): number => {
      let total = 0;
      for (let cs = 0; cs < target; cs += step) {
        total += campaignStrengthContributionCost(cs, Math.min(step, target - cs));
      }
      return total;
    };

    const whale = totalForStep(3000); // ~4,000 national influence
    const midsize = totalForStep(750); // ~1,000 national influence
    const minnow = totalForStep(75); // ~100 national influence

    // The exact-integral form telescopes, so these are equal to floating-point
    // precision — not merely close. This is the anti-whale property.
    expect(midsize / whale).toBeCloseTo(1, 9);
    expect(minnow / whale).toBeCloseTo(1, 9);
  });

  it("prices a full run to bonus saturation at the intended magnitude", () => {
    const target = 150_000;
    let total = 0;
    for (let cs = 0; cs < target; cs += 3000) {
      total += campaignStrengthContributionCost(cs, 3000);
    }
    // Closed form: PRICE * (S + S^3 / (3 * TAU^2)).
    const expected =
      CAMPAIGN_STRENGTH_PRICE_PER_POINT *
      (target + target ** 3 / (3 * CAMPAIGN_STRENGTH_TAU * CAMPAIGN_STRENGTH_TAU));
    expect(total / expected).toBeCloseTo(1, 9);

    // Calibration intent: saturating the +100% vote bonus costs more than the
    // ~$31M full campaign upgrade tree, so it is an aspirational commitment.
    expect(total).toBeGreaterThan(31_000_000);
    expect(total).toBeGreaterThan(45_000_000);
    expect(total).toBeLessThan(55_000_000);

    // Old formula, for the record: ~12.9k for the same result at this step
    // size — and ~40x that at a 75-point step.
    let legacy = 0;
    for (let cs = 0; cs < target; cs += 3000) {
      legacy += Math.sqrt(cs + 3000);
    }
    expect(total / legacy).toBeGreaterThan(3000);
  });
});

describe("campaignStrengthContributionActions", () => {
  it("charges nothing for a zero contribution", () => {
    expect(campaignStrengthContributionActions(0)).toBe(0);
    expect(campaignStrengthContributionActions(-10)).toBe(0);
  });

  it("charges at least one action for any positive contribution", () => {
    expect(campaignStrengthContributionActions(1)).toBe(1);
    expect(campaignStrengthContributionActions(75)).toBe(1);
  });

  it("scales with the strength bought", () => {
    expect(campaignStrengthContributionActions(CAMPAIGN_STRENGTH_POINTS_PER_ACTION)).toBe(1);
    expect(campaignStrengthContributionActions(CAMPAIGN_STRENGTH_POINTS_PER_ACTION * 10)).toBe(10);
    expect(campaignStrengthContributionActions(3000)).toBe(10);
  });

  it("costs the same total actions to reach a target regardless of step size", () => {
    const target = 150_000;
    const totalForStep = (step: number): number => {
      let total = 0;
      for (let cs = 0; cs < target; cs += step) {
        total += campaignStrengthContributionActions(Math.min(step, target - cs));
      }
      return total;
    };
    const baseline = totalForStep(3000);
    expect(baseline).toBe(500);
    // Rounding each click up to a whole action adds a little overhead for
    // smaller steps (750 -> ceil(2.5) = 3 actions, so 600), and the 1-action
    // floor dominates for very small ones. Both stay within a small constant
    // factor — the old flat-10-per-click rule charged the smallest buyer 40x.
    expect(totalForStep(750)).toBe(600);
    expect(totalForStep(75)).toBe(2000);
    expect(totalForStep(75)).toBeLessThanOrEqual(baseline * 4);
  });
});
