import { describe, expect, it } from "vitest";
import {
  NPP_ACQUISITION_PREMIUM_MULTIPLIER,
  isNppAutoResolvableTarget,
  meetsNppAcquisitionThreshold,
  nppAcquisitionMinimumPrice,
} from "./rules";

describe("NPP acquisition rules (#217)", () => {
  it("uses a modest 10 percent premium", () => {
    expect(NPP_ACQUISITION_PREMIUM_MULTIPLIER).toBe(1.1);
    expect(nppAcquisitionMinimumPrice(1_000_000)).toBe(1_100_000);
  });

  it("rounds the asking price up so it never drops below value plus premium", () => {
    expect(nppAcquisitionMinimumPrice(1)).toBe(2);
    expect(nppAcquisitionMinimumPrice(999)).toBe(1099);
  });

  it("treats zero, negative, or non-finite valuations as a zero asking price", () => {
    expect(nppAcquisitionMinimumPrice(0)).toBe(0);
    expect(nppAcquisitionMinimumPrice(-500)).toBe(0);
    expect(nppAcquisitionMinimumPrice(Number.NaN)).toBe(0);
    expect(nppAcquisitionMinimumPrice(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("accepts exactly at the threshold and rejects one unit below", () => {
    const valuation = 1_000_000;
    const asking = nppAcquisitionMinimumPrice(valuation);
    expect(meetsNppAcquisitionThreshold(asking, valuation)).toBe(true);
    expect(meetsNppAcquisitionThreshold(asking - 1, valuation)).toBe(false);
    expect(meetsNppAcquisitionThreshold(asking + 1, valuation)).toBe(true);
  });

  it("rejects non-finite offer prices", () => {
    expect(meetsNppAcquisitionThreshold(Number.NaN, 1_000_000)).toBe(false);
    expect(meetsNppAcquisitionThreshold(Number.POSITIVE_INFINITY, 1_000_000)).toBe(false);
  });

  it("auto-resolves only genuinely AI-run targets", () => {
    expect(isNppAutoResolvableTarget({ ceoType: "npp" })).toBe(true);
    // Caretaker-run corps stay player property: human flow, not auto-resolve.
    expect(isNppAutoResolvableTarget({ ceoType: "npp", caretakerCeo: { foo: 1 } })).toBe(false);
    expect(isNppAutoResolvableTarget({ ceoType: "character" })).toBe(false);
    expect(isNppAutoResolvableTarget({ ceoType: "imperial" })).toBe(false);
    expect(isNppAutoResolvableTarget({})).toBe(false);
  });
});
