import { describe, it, expect } from "vitest";
import { allocateSeatsByShare } from "./ngSeatAllocation";

describe("allocateSeatsByShare", () => {
  it("largest-remainder: 95 seats @ 42/58 → sdp 40, nrc 55 (sum 95)", () => {
    const r = allocateSeatsByShare(95, { sdp: 42, nrc: 58 });
    expect(r).toEqual({ sdp: 40, nrc: 55 });
    expect(r.sdp + r.nrc).toBe(95);
  });
  it("always sums to total (21 seats @ 42/58)", () => {
    const r = allocateSeatsByShare(21, { sdp: 42, nrc: 58 });
    expect(r.sdp + r.nrc).toBe(21);
  });
  it("handles a three-way split summing exactly", () => {
    const r = allocateSeatsByShare(10, { a: 33, b: 33, c: 34 });
    expect(r.a + r.b + r.c).toBe(10);
  });
});
