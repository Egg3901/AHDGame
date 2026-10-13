import { describe, expect, it } from "vitest";
import {
  EQUITY_POOL_SELL_FLOOR_ANCHOR,
  EQUITY_PRIMARY_PLACE_FLOOR_ANCHOR,
  poolSellCapLocal,
  poolSellPacedMessage,
  poolSellRemainingLocal,
  primaryPlaceCapShares,
} from "./blockPacing";

describe("pool sell pacing", () => {
  it("caps a large company at 5% of its market value per turn", () => {
    // $1.23bn company: the pool buys at most ~$61.4M a turn, so a 90% stake
    // ($1.09bn) takes about 18 turns instead of one.
    const cap = poolSellCapLocal({
      sharePriceLocal: 122.83,
      totalShares: 10_000_000,
      localPerAnchor: 1,
    });
    expect(cap).toBeCloseTo(61_415_000, -2);
  });

  it("never paces small companies below the anchor floor", () => {
    const cap = poolSellCapLocal({ sharePriceLocal: 2, totalShares: 1_000_000, localPerAnchor: 1 });
    expect(cap).toBe(EQUITY_POOL_SELL_FLOOR_ANCHOR);
  });

  it("converts the floor into the company's currency", () => {
    const cap = poolSellCapLocal({ sharePriceLocal: 1, totalShares: 1, localPerAnchor: 150 });
    expect(cap).toBe(EQUITY_POOL_SELL_FLOOR_ANCHOR * 150);
  });

  it("resets usage on a new turn and subtracts it within the same turn", () => {
    expect(
      poolSellRemainingLocal({ capLocal: 100, turn: 9, absorbedTurn: 8, absorbedLocal: 90 })
    ).toBe(100);
    expect(
      poolSellRemainingLocal({ capLocal: 100, turn: 9, absorbedTurn: 9, absorbedLocal: 90 })
    ).toBe(10);
    expect(
      poolSellRemainingLocal({ capLocal: 100, turn: 9, absorbedTurn: 9, absorbedLocal: 150 })
    ).toBe(0);
    expect(poolSellRemainingLocal({ capLocal: 100, turn: 9 })).toBe(100);
  });

  it("explains the limit in plain language", () => {
    expect(poolSellPacedMessage(1_500, "Acme")).toContain("1,500 more Acme shares");
    expect(poolSellPacedMessage(0, "Acme")).toContain("fill over the coming turns");
  });
});

describe("primary placement pacing", () => {
  it("places at most 10% of shares outstanding in one turn for a large company", () => {
    // Doubling a 1bn-share company: 100M shares now, the rest paced.
    expect(
      primaryPlaceCapShares({
        totalShares: 1_000_000_000,
        pricePerShareLocal: 3.86,
        localPerAnchor: 1,
      })
    ).toBe(100_000_000);
  });

  it("lets small issues through whole under the anchor floor", () => {
    const shares = primaryPlaceCapShares({
      totalShares: 1_000_000,
      pricePerShareLocal: 10,
      localPerAnchor: 1,
    });
    expect(shares).toBe(Math.floor(EQUITY_PRIMARY_PLACE_FLOOR_ANCHOR / 10));
  });

  it("is zero-safe when price or shares are missing", () => {
    expect(
      primaryPlaceCapShares({ totalShares: 0, pricePerShareLocal: 0, localPerAnchor: 1 })
    ).toBe(0);
  });
});
