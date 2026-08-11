import { describe, it, expect } from "vitest";
import { evaluateCell } from "./evaluate";

describe("evaluateCell", () => {
  it("produces a result with meanDisplay, spread, and a loss number", () => {
    const r = evaluateCell("US", "2019");
    expect(r).not.toBeNull();
    expect(typeof r!.meanDisplay).toBe("number");
    expect(typeof r!.spread).toBe("number");
    expect(typeof r!.loss).toBe("number");
    expect(Array.isArray(r!.failures)).toBe(true);
  });

  it("returns null for a cell with no target", () => {
    // NG has no calibration targets defined
    expect(evaluateCell("NG", "1979")).toBeNull();
  });
});
