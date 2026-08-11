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
    expect(res).toEqual({ states: 2, totalPS: 11, totalDelta: 2.0, skipped: ["TX"], pending: [] });
  });

  it("reports states without a cached preview as pending", () => {
    const res = sumBulkEstimate({ selected: ["CA"], previews: {} });
    expect(res.pending).toEqual(["CA"]);
  });
});
