import { describe, expect, it } from "vitest";
import { estimateWageChange } from "./bulkWagePreview";
describe("bulk wage cost estimates", () => {
  it("retains a negotiated floor when the requested wage is lower", () => {
    expect(estimateWageChange(120, 1, 0.8, 1.2)).toEqual({ current: 120, projected: 120 });
    expect(estimateWageChange(120, 1, 1.5, 1.2)?.projected).toBe(150);
  });
  it("does not invent costs for holdings with no recorded wage bill", () => {
    expect(estimateWageChange(undefined, 1, 1.2, 0)).toBeNull();
    expect(estimateWageChange(0, 1, 1.2, 0)).toEqual({ current: 0, projected: 0 });
  });
});
