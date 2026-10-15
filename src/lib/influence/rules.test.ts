import { describe, expect, it } from "vitest";
import { EXTERNAL_ATTACK_PREMIUM, priceExternalBoost, quoteSelfActionsForGain } from "./rules";

describe("priceExternalBoost", () => {
  it("adds the premium and rounds action points down", () => {
    expect(priceExternalBoost([{ apCost: 5, fundCostAnchor: 100_000 }])).toEqual({
      actionCost: 6,
      fundsCostAnchor: 125_000,
    });
    expect(
      priceExternalBoost([
        { apCost: 3, fundCostAnchor: 60_000 },
        { apCost: 4, fundCostAnchor: 80_000 },
      ])
    ).toEqual({
      actionCost: 8,
      fundsCostAnchor: 175_000,
    });
  });

  it("applies the action distance multiplier before rounding down", () => {
    expect(priceExternalBoost([{ apCost: 5, fundCostAnchor: 100_000 }], 1.25)).toEqual({
      actionCost: 7,
      fundsCostAnchor: 125_000,
    });
    expect(priceExternalBoost([{ apCost: 5, fundCostAnchor: 100_000 }], 1.5)).toEqual({
      actionCost: 9,
      fundsCostAnchor: 125_000,
    });
  });

  it("sums full-delta self-action quotes before applying the premium", () => {
    expect(
      priceExternalBoost([
        { apCost: 3, fundCostAnchor: 41_000 },
        { apCost: 4, fundCostAnchor: 42_000 },
        { apCost: 5, fundCostAnchor: 43_000 },
      ])
    ).toEqual({ actionCost: 15, fundsCostAnchor: 157_500 });
  });

  it("prices attacks at 1.50x while positive boosts remain at 1.25x", () => {
    const selfActions = [{ apCost: 9, fundCostAnchor: 240_000 }];
    expect(priceExternalBoost(selfActions)).toEqual({
      actionCost: 11,
      fundsCostAnchor: 300_000,
    });
    expect(priceExternalBoost(selfActions, 1, EXTERNAL_ATTACK_PREMIUM)).toEqual({
      actionCost: 13,
      fundsCostAnchor: 360_000,
    });
  });
});

describe("quoteSelfActionsForGain", () => {
  it("accumulates full action gains and re-quotes at the updated stat", () => {
    const requestedStats: number[] = [];
    const quote = quoteSelfActionsForGain(80, 2, (stat) => {
      requestedStats.push(stat);
      return { apCost: 3, fundCostAnchor: 25_000, statGain: stat >= 81 ? 0.5 : 1 };
    });

    expect(quote).toEqual({
      ok: true,
      actions: [
        { apCost: 3, fundCostAnchor: 25_000 },
        { apCost: 3, fundCostAnchor: 25_000 },
        { apCost: 3, fundCostAnchor: 25_000 },
      ],
      statGain: 2,
    });
    expect(requestedStats).toEqual([80, 81, 81.5]);
  });

  it("rejects an action quote that makes no progress", () => {
    expect(
      quoteSelfActionsForGain(50, 1, () => ({
        apCost: 1,
        fundCostAnchor: 10,
        statGain: 0,
      }))
    ).toEqual({ ok: false, error: "The equivalent self-action quote was invalid." });
  });
});
