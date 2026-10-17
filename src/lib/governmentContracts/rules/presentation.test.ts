import { describe, it, expect } from "vitest";
import {
  extractionCapacityQuote,
  contractLocalAmount,
  contractAnchorAmount,
  validContractQuote,
} from "./presentation";
describe("contract presentation", () => {
  it("quotes a share of total daily capacity, independent of current mining output", () => {
    expect(extractionCapacityQuote(10000, 0.1)).toEqual({
      totalDailyUnits: 10000,
      allocatedDailyUnits: 1000,
    });
    expect(extractionCapacityQuote(0, 0.1)).toEqual({ totalDailyUnits: 0, allocatedDailyUnits: 0 });
  });
  it.each([undefined, NaN, Infinity, -1])("does not invent capacity for %s", (capacity) => {
    expect(extractionCapacityQuote(capacity, 0.1)).toBeNull();
  });
  it.each([-0.1, 1.1, NaN])("rejects an invalid share %s", (share) => {
    expect(extractionCapacityQuote(1000, share)).toBeNull();
  });
  it.each([
    { code: "JPY", rate: 123 },
    { code: "USD", rate: 1.25 },
  ])("preserves canonical value through $code local entry", (quote) => {
    expect(contractAnchorAmount(contractLocalAmount(500000, quote), quote)).toBeCloseTo(500000);
  });
  it.each([null, { code: "USD", rate: 0 }, { code: "JPY", rate: Infinity }, { code: "", rate: 1 }])(
    "fails closed without a usable currency quote",
    (quote) => {
      expect(validContractQuote(quote)).toBe(false);
    }
  );
});

it("keeps exact canonical values for unchanged bids and minimum-price quotes", () => {
  const quote = { code: "USD", rate: 1.1234567 },
    stored = 123456.78912345;
  expect(contractAnchorAmount(contractLocalAmount(stored, quote), quote, [stored])).toBe(stored);
  expect(contractAnchorAmount(contractLocalAmount(500, quote), quote, [undefined, 500])).toBe(500);
});
