import { describe, expect, it } from "vitest";
import { sumBulkEstimate } from "./bulkEstimate";

describe("sumBulkEstimate", () => {
  it("sums eligible previews and lists skipped", () => {
    const res = sumBulkEstimate({
      selected: ["CA", "NY", "TX"],
      previews: {
        CA: { ok: true, effectiveCost: 5, projectedGain: 1.2 },
        NY: { ok: true, effectiveCost: 6, projectedGain: 0.8 },
        TX: { ok: false, reason: "no-presence" },
      },
    });
    expect(res).toEqual({
      states: 2,
      totalPS: 11,
      totalCash: 0,
      totalDelta: 2.0,
      skipped: ["TX"],
      pending: [],
    });
  });

  // Bulk Build Org bills the NATIONAL treasury once per state, so the running
  // estimate has to total the cash as well as the PS — otherwise a chair
  // selecting 30 states sees a price that omits the larger of the two costs.
  it("sums the cash price across eligible states", () => {
    const res = sumBulkEstimate({
      selected: ["CA", "NY", "TX"],
      previews: {
        CA: { ok: true, effectiveCost: 5, projectedGain: 1.2, cashPrice: 28_125 },
        NY: { ok: true, effectiveCost: 6, projectedGain: 0.8, cashPrice: 33_750 },
        TX: { ok: false, reason: "no-presence" },
      },
    });
    expect(res.totalCash).toBe(61_875);
  });

  it("treats a preview with no cash price as costing nothing", () => {
    const res = sumBulkEstimate({
      selected: ["CA"],
      previews: { CA: { ok: true, effectiveCost: 5, projectedGain: 1.2 } },
    });
    expect(res.totalCash).toBe(0);
  });

  it("reports states without a cached preview as pending", () => {
    const res = sumBulkEstimate({ selected: ["CA"], previews: {} });
    expect(res.pending).toEqual(["CA"]);
  });
});
