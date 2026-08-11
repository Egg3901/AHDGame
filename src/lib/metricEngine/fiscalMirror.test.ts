import { describe, expect, it } from "vitest";
import { fiscalMirrorFields, type FiscalRatios } from "./fiscalMirror";

const RATIOS: FiscalRatios = {
  debtToGdp: 64.27,
  budgetBalance: -3.14,
  schuldenbremseHeadroom: 0.123,
};

describe("fiscalMirrorFields", () => {
  it("emits rounded value fields only for metrics the region stores", () => {
    const stored = new Set(["governance.debtToGdp", "governance.budgetBalance"]);
    const out = fiscalMirrorFields(RATIOS, (id) => stored.has(id));
    expect(out).toEqual({
      "governance.debtToGdp.value": 64.3, // 1dp
      "governance.budgetBalance.value": -3.1, // 1dp
    });
    // schuldenbremse NOT stored here (1991 / non-DE) → absent
    expect(out["governance.schuldenbremseHeadroom.value"]).toBeUndefined();
  });

  it("rounds schuldenbremse to 2dp when stored", () => {
    const out = fiscalMirrorFields(RATIOS, () => true);
    expect(out["governance.schuldenbremseHeadroom.value"]).toBe(0.12);
  });

  it("returns an empty object when ratios are missing", () => {
    expect(fiscalMirrorFields(undefined, () => true)).toEqual({});
  });
});
