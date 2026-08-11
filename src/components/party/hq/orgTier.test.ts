import { describe, expect, it } from "vitest";
import { orgTier, toneColor, orgFill, leanLabelFromValue } from "./orgTier";

describe("orgTier", () => {
  it("maps org% to label + tone by threshold", () => {
    expect(orgTier(90)).toMatchObject({ label: "Dominant", tone: "good" });
    expect(orgTier(70)).toMatchObject({ label: "Strong", tone: "good" });
    expect(orgTier(50)).toMatchObject({ label: "Competitive", tone: "mid" });
    expect(orgTier(30)).toMatchObject({ label: "Developing", tone: "warn" });
    expect(orgTier(5)).toMatchObject({ label: "Minimal", tone: "bad" });
  });
});

describe("toneColor", () => {
  it("returns a css color for each tone", () => {
    for (const t of ["good", "mid", "warn", "bad"] as const) {
      expect(typeof toneColor(t)).toBe("string");
      expect(toneColor(t).length).toBeGreaterThan(0);
    }
  });
});

describe("orgFill", () => {
  it("returns a darker-to-brighter fill as org rises", () => {
    expect(orgFill(90)).toMatch(/^(#|rgb)/i);
    expect(orgFill(10)).toMatch(/^(#|rgb)/i);
    expect(orgFill(90)).not.toBe(orgFill(10));
  });
});

describe("leanLabelFromValue", () => {
  it("labels lean by sign and magnitude", () => {
    expect(leanLabelFromValue(0).label).toMatch(/Even|Tossup|Centrist/i);
    expect(leanLabelFromValue(4).label.length).toBeGreaterThan(0);
    expect(leanLabelFromValue(-4).label.length).toBeGreaterThan(0);
  });
});
