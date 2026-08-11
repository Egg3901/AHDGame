import { describe, it, expect } from "vitest";
import {
  INDEX_FUND_BID_PREMIUM,
  INDEX_FUND_BID_MAX_OPEN_TURNS,
  fundBidLimitPriceLocal,
} from "./fundBidPolicy";

describe("fundBidPolicy", () => {
  it("INDEX_FUND_BID_PREMIUM is 0.02", () => {
    expect(INDEX_FUND_BID_PREMIUM).toBe(0.02);
  });

  it("INDEX_FUND_BID_MAX_OPEN_TURNS is 24", () => {
    expect(INDEX_FUND_BID_MAX_OPEN_TURNS).toBe(24);
  });

  it("fundBidLimitPriceLocal returns price * 1.02", () => {
    expect(fundBidLimitPriceLocal(100)).toBeCloseTo(102);
    expect(fundBidLimitPriceLocal(50)).toBeCloseTo(51);
    expect(fundBidLimitPriceLocal(0)).toBe(0);
  });

  it("rounds consistently with multiplication", () => {
    const price = 1234.56;
    expect(fundBidLimitPriceLocal(price)).toBeCloseTo(price * 1.02, 10);
  });
});
