import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_STRENGTH_MAX_BATCH_CLICKS,
  campaignStrengthBatchQuote,
  campaignStrengthContributionActions,
  campaignStrengthContributionCost,
  maxAffordableCampaignStrengthClicks,
} from "./campaignStrength";

/**
 * The batched Support control (x1 / x5 / Max on the presidential race page)
 * exists to save clicks, NOT to change the price. Everything here pins that:
 * a batch of N must cost exactly what N separate contributions cost, on both
 * the funds axis and the actions axis.
 */

/** Reference implementation: what N sequential single clicks actually charge. */
function sequential(currentStrength: number, strengthPerClick: number, clicks: number) {
  let cs = currentStrength;
  let costFunds = 0;
  let costActions = 0;
  for (let i = 0; i < clicks; i++) {
    costFunds += campaignStrengthContributionCost(cs, strengthPerClick);
    costActions += campaignStrengthContributionActions(strengthPerClick);
    cs += strengthPerClick;
  }
  return { costFunds, costActions, strengthAdded: cs - currentStrength };
}

describe("campaignStrengthBatchQuote", () => {
  it("is exactly equivalent to the same number of single clicks", () => {
    // 100 NPI (perClick 75, under one action's worth) and 8000 NPI (perClick
    // 6000, many actions' worth) sit on opposite sides of the ceiling in the
    // action formula, which is where a naive implementation diverges.
    for (const perClick of [75, 6000]) {
      for (const currentCS of [0, 50_000, 150_000]) {
        for (const clicks of [1, 2, 5, 17]) {
          const quote = campaignStrengthBatchQuote(currentCS, perClick, clicks);
          const ref = sequential(currentCS, perClick, clicks);
          expect(quote.strengthAdded).toBeCloseTo(ref.strengthAdded, 6);
          expect(quote.costFunds).toBeCloseTo(ref.costFunds, 3);
          expect(quote.costActions).toBe(ref.costActions);
        }
      }
    }
  });

  it("does not discount actions for bundling, whatever the influence level", () => {
    // The trap: ceil(5 * 75 / 300) = 2, but five separate clicks cost 5.
    // Charging the merged form would sell a 2.5x action discount to exactly the
    // low-influence players the pricing rewrite exists to protect.
    const perClick = 75;
    expect(campaignStrengthContributionActions(perClick * 5)).toBe(2);
    expect(campaignStrengthBatchQuote(0, perClick, 5).costActions).toBe(5);

    // A high-influence click already exceeds POINTS_PER_ACTION, so it never had
    // a bundling discount to lose. Same rule, same result.
    expect(campaignStrengthBatchQuote(0, 6000, 5).costActions).toBe(
      campaignStrengthContributionActions(6000) * 5
    );
  });

  it("quotes nothing for a zero or negative click count", () => {
    expect(campaignStrengthBatchQuote(0, 75, 0)).toMatchObject({
      clicks: 0,
      strengthAdded: 0,
      costFunds: 0,
      costActions: 0,
    });
    expect(campaignStrengthBatchQuote(0, 75, -3).costFunds).toBe(0);
  });
});

describe("maxAffordableCampaignStrengthClicks", () => {
  const perClick = 75;

  it("returns the largest count both gates actually allow", () => {
    const max = maxAffordableCampaignStrengthClicks({
      currentStrength: 0,
      strengthPerClick: perClick,
      availableFunds: 1_000_000,
      availableActions: 40,
    });
    const at = campaignStrengthBatchQuote(0, perClick, max);
    const over = campaignStrengthBatchQuote(0, perClick, max + 1);
    expect(at.costFunds).toBeLessThanOrEqual(1_000_000);
    expect(at.costActions).toBeLessThanOrEqual(40);
    // max + 1 must break at least one gate, or `max` was not the maximum.
    expect(over.costFunds > 1_000_000 || over.costActions > 40).toBe(true);
  });

  it("is bounded by actions when actions are the scarce resource", () => {
    expect(
      maxAffordableCampaignStrengthClicks({
        currentStrength: 0,
        strengthPerClick: perClick,
        availableFunds: Number.MAX_SAFE_INTEGER,
        availableActions: 7,
      })
    ).toBe(7); // one action per 75-point click
  });

  it("is bounded by funds when funds are the scarce resource", () => {
    const budget = campaignStrengthBatchQuote(0, perClick, 3).costFunds;
    expect(
      maxAffordableCampaignStrengthClicks({
        currentStrength: 0,
        strengthPerClick: perClick,
        availableFunds: budget,
        availableActions: 10_000,
      })
    ).toBe(3);
  });

  it("converts the anchor quote before gating a local balance", () => {
    const budgetAnchor = campaignStrengthBatchQuote(0, perClick, 4).costFunds;
    // Same purchasing power, expressed in a currency worth 1/100th as much.
    expect(
      maxAffordableCampaignStrengthClicks({
        currentStrength: 0,
        strengthPerClick: perClick,
        availableFunds: budgetAnchor * 100,
        availableActions: 10_000,
        fundsRate: 100,
      })
    ).toBe(4);
  });

  it("shrinks as the campaign's strength (and so the price) climbs", () => {
    const cheap = maxAffordableCampaignStrengthClicks({
      currentStrength: 0,
      strengthPerClick: perClick,
      availableFunds: 5_000_000,
      availableActions: 10_000,
    });
    const dear = maxAffordableCampaignStrengthClicks({
      currentStrength: 400_000,
      strengthPerClick: perClick,
      availableFunds: 5_000_000,
      availableActions: 10_000,
    });
    expect(dear).toBeLessThan(cheap);
  });

  it("never exceeds the hard batch ceiling", () => {
    expect(
      maxAffordableCampaignStrengthClicks({
        currentStrength: 0,
        strengthPerClick: perClick,
        availableFunds: Number.MAX_SAFE_INTEGER,
        availableActions: Number.MAX_SAFE_INTEGER,
      })
    ).toBe(CAMPAIGN_STRENGTH_MAX_BATCH_CLICKS);
  });

  it("returns 0 when the player cannot afford even one click", () => {
    expect(
      maxAffordableCampaignStrengthClicks({
        currentStrength: 0,
        strengthPerClick: perClick,
        availableFunds: 0,
        availableActions: 100,
      })
    ).toBe(0);
    expect(
      maxAffordableCampaignStrengthClicks({
        currentStrength: 0,
        strengthPerClick: perClick,
        availableFunds: Number.MAX_SAFE_INTEGER,
        availableActions: 0,
      })
    ).toBe(0);
    expect(
      maxAffordableCampaignStrengthClicks({
        currentStrength: 0,
        strengthPerClick: 0,
        availableFunds: Number.MAX_SAFE_INTEGER,
        availableActions: 100,
      })
    ).toBe(0);
  });
});
