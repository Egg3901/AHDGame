import { describe, expect, it } from "vitest";
import {
  clampShare,
  finitePriceChange,
  isTradableListing,
  tradableListingIds,
  tradableListings,
} from "./listingEligibility";

describe("isTradableListing", () => {
  it("accepts ordinary public corporations with issued shares and float", () => {
    expect(isTradableListing({ totalShares: 1000, publicFloat: 500 })).toBe(true);
  });

  it("rejects zero-share and zero-float state enterprises", () => {
    expect(isTradableListing({ totalShares: 0, publicFloat: 0 })).toBe(false);
    expect(isTradableListing({ totalShares: 0, publicFloat: 100 })).toBe(false);
    expect(isTradableListing({ totalShares: 1000, publicFloat: 0 })).toBe(false);
  });

  it("rejects missing, negative, and non-finite issuance", () => {
    expect(isTradableListing({})).toBe(false);
    expect(isTradableListing({ totalShares: -5, publicFloat: 10 })).toBe(false);
    expect(isTradableListing({ totalShares: 10, publicFloat: -1 })).toBe(false);
    expect(isTradableListing({ totalShares: NaN, publicFloat: 10 })).toBe(false);
    expect(isTradableListing({ totalShares: 10, publicFloat: Infinity })).toBe(false);
  });

  it("filters and identifies the eligible set by row id", () => {
    const rows = [
      { _id: { toString: () => "a" }, totalShares: 100, publicFloat: 10 },
      { _id: { toString: () => "b" }, totalShares: 0, publicFloat: 0 },
      { _id: { toString: () => "c" }, totalShares: 50, publicFloat: 0 },
    ];
    expect(tradableListings(rows).map((r) => r._id.toString())).toEqual(["a"]);
    expect(tradableListingIds(rows)).toEqual(new Set(["a"]));
  });
});

describe("clampShare", () => {
  it("bounds breadth shares to 0..1 and preserves nulls", () => {
    expect(clampShare(0.5)).toBe(0.5);
    expect(clampShare(1.4)).toBe(1);
    expect(clampShare(-0.2)).toBe(0);
    expect(clampShare(null)).toBeNull();
    expect(clampShare(NaN)).toBeNull();
    expect(clampShare(Infinity)).toBeNull();
  });
});

describe("finitePriceChange", () => {
  it("passes finite returns through and neutralizes the rest", () => {
    expect(finitePriceChange(2.5)).toBe(2.5);
    expect(finitePriceChange(0)).toBe(0);
    expect(finitePriceChange(NaN)).toBe(0);
    expect(finitePriceChange(Infinity)).toBe(0);
    expect(finitePriceChange(undefined)).toBe(0);
    expect(finitePriceChange(null)).toBe(0);
  });
});
