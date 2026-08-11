import { describe, it, expect } from "vitest";
import { deriveSpec, specLabelOf, SPEC_ORDER, UNASSIGNED_SPEC_LABEL } from "../deriveSpec";
import { SPEC_SEED } from "../generalsTree";

describe("deriveSpec", () => {
  it("names the spec whose seed the general most matches", () => {
    // armor: ["ar1", "ar2", "mn1"]
    expect(deriveSpec(["ar1", "ar2"]).spec).toBe("armor");
  });

  it("reports fit as the share of that spec's seed they have trained", () => {
    const r = deriveSpec(["ar1", "ar2"]); // 2 of armor's 3
    expect(r.spec).toBe("armor");
    expect(r.fit).toBeCloseTo(2 / 3, 5);
  });

  it("is a perfect fit when the whole seed is trained", () => {
    expect(deriveSpec(SPEC_SEED.naval).fit).toBe(1); // naval: ["nl1", "nl2"]
    expect(deriveSpec(SPEC_SEED.naval).spec).toBe("naval");
  });

  // The point of the whole change: the label follows what you actually trained.
  it("drifts as a general trains into another discipline", () => {
    expect(deriveSpec(["ar1"]).spec).toBe("armor");
    // su1/su2/ma1 is logi's entire seed — it now outweighs the single armor node.
    expect(deriveSpec(["ar1", "su1", "su2", "ma1"]).spec).toBe("logi");
  });

  it("ignores learned nodes that belong to no spec seed", () => {
    const r = deriveSpec(["ar1", "ar2", "zz9", "qq1"]);
    expect(r.spec).toBe("armor");
    expect(r.fit).toBeCloseTo(2 / 3, 5);
  });

  // A general who has trained nothing has not specialised — don't invent one for them.
  it("reports no fit for a general who has learned nothing", () => {
    expect(deriveSpec([])).toEqual({ spec: SPEC_ORDER[0], fit: 0 });
  });

  it("breaks ties deterministically by a fixed spec order, not insertion order", () => {
    // One node from each of armor and offense: both 1/3.
    const a = deriveSpec(["ar1", "ag1"]);
    const b = deriveSpec(["ag1", "ar1"]);
    expect(a).toEqual(b);
    expect(SPEC_ORDER.indexOf(a.spec)).toBeLessThan(SPEC_ORDER.indexOf("naval"));
  });

  it("is stable across repeated calls", () => {
    const learned = ["ar1", "ag1", "de1"];
    expect(deriveSpec(learned)).toEqual(deriveSpec(learned));
  });

  it("prefers the better-matched spec over one with a bigger seed", () => {
    // naval seed is 2 long; matching both beats matching 1 of armor's 3.
    expect(deriveSpec(["nl1", "nl2", "ar1"]).spec).toBe("naval");
  });
});

// Every newly commissioned general starts having trained nothing, so a 0 fit must
// not be dressed up as the first discipline in SPEC_ORDER.
describe("specLabelOf", () => {
  it("reports an untrained general as unassigned, not as a discipline", () => {
    expect(specLabelOf(deriveSpec([]))).toBe(UNASSIGNED_SPEC_LABEL);
  });

  it("reports unassigned when nothing trained matches any spec seed", () => {
    expect(specLabelOf(deriveSpec(["tr1", "zz9"]))).toBe(UNASSIGNED_SPEC_LABEL);
  });

  it("names the discipline once they have trained into one", () => {
    expect(specLabelOf(deriveSpec(["ar1", "ar2"]))).toBe("Armor Officer");
  });
});
