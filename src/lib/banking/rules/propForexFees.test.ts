import { describe, expect, it } from "vitest";
import { addPropForexVolume, quotePropForexFee, recentPropForexVolume } from "./propForexFees";
import { FOREX_MAX_TRADE_FEE } from "@/lib/constants/currencies";

const input = {
  markLocal: 1_000_000_000,
  currencyCode: "USD" as const,
  homeRate: 1,
  priorAnchor: 0,
  homeVolumeAnchor: 1_000_000_000,
  foreignVolumeAnchor: 1_000_000_000,
};

describe("forex prop fees", () => {
  it("charges the production fee curve without treating the fee as a position asset", () => {
    const quote = quotePropForexFee(input);
    expect(quote.feeLocal).toBeGreaterThan(input.markLocal * 0.00275);
    expect(quote.feeRate).toBeLessThanOrEqual(FOREX_MAX_TRADE_FEE);
    expect(quote.revenueLocal + quote.reserveLocal + quote.burnLocal).toBeCloseTo(
      quote.feeLocal,
      6
    );
  });
  it("makes splitting large trades cost the same, within minor-unit rounding", () => {
    const full = quotePropForexFee({ ...input, markLocal: 100_000_000_000 });
    let fees = 0;
    for (let i = 0; i < 10; i++)
      fees += quotePropForexFee({
        ...input,
        markLocal: 10_000_000_000,
        priorAnchor: i * 10_000_000_000,
      }).feeLocal;
    expect(Math.abs(fees - full.feeLocal)).toBeLessThanOrEqual(0.05);
  });
  it("keeps currency units and anchor volume separate", () => {
    const usd = quotePropForexFee(input);
    const yen = quotePropForexFee({
      ...input,
      currencyCode: "JPY",
      markLocal: input.markLocal * 100,
      homeRate: 100,
    });
    expect(yen.anchorAmount).toBe(usd.anchorAmount);
    expect(yen.feeRate).toBe(usd.feeRate);
    expect(yen.feeLocal).toBe(Math.round(yen.feeLocal));
    expect(yen.revenueLocal + yen.reserveLocal + yen.burnLocal).toBe(yen.feeLocal);
  });
  it.each(["USD", "JPY"] as const)("conserves tiny rounded fees in %s", (currencyCode) => {
    for (const markLocal of [0.01, 0.1, 1, 2, 3, 5, 10, 100, 300]) {
      const quote = quotePropForexFee({ ...input, currencyCode, markLocal });
      expect(quote.burnLocal).toBeGreaterThanOrEqual(0);
      expect(quote.revenueLocal + quote.reserveLocal + quote.burnLocal).toBeCloseTo(
        quote.feeLocal,
        8
      );
    }
  });
  it("counts both trades in a turn and expires volume outside the production lookback", () => {
    let rows = addPropForexVolume([], 10, 100);
    rows = addPropForexVolume(rows, 10, 200);
    rows = addPropForexVolume(rows, 11, 300);
    expect(recentPropForexVolume(rows, 11)).toBe(600);
    expect(recentPropForexVolume(rows, 35)).toBe(300);
    expect(addPropForexVolume(rows, 36, 400)).toEqual([{ turn: 36, anchorAmount: 400 }]);
  });
  it.each([0, -1, Infinity, NaN])("refuses invalid home conversion rate %s", (homeRate) => {
    expect(() => quotePropForexFee({ ...input, homeRate })).toThrow("Invalid forex cash quote");
  });
});
