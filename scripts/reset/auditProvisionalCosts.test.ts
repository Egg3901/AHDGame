import { describe, expect, it } from "vitest";
import { auditProvisionalCosts1991 } from "./auditProvisionalCosts";

describe("1991 provisional cost-to-source audit", () => {
  const rows = auditProvisionalCosts1991();

  it("covers every national family for US, UK, and JP without approving options", () => {
    expect(rows).toHaveLength(153);
    expect(new Set(rows.map((row) => `${row.country}:${row.familyId}`)).size).toBe(153);
    expect(rows.every((row) => row.status === "provisional-design-only")).toBe(true);
    expect(
      rows.every((row) =>
        row.fiveAnchoredAnnual.every((amount) => Number.isFinite(amount) && amount >= 0)
      )
    ).toBe(true);
  });

  it("anchors funded center estimates to source claims and new programs to GDP", () => {
    for (const row of rows) {
      if (row.sourceAnnual > 0) {
        expect(row.pricingAnchor).toBe("source-book");
        expect(row.fiveAnchoredAnnual[2]).toBe(row.sourceAnnual);
      } else {
        expect(row.pricingAnchor).toBe("new-program-gdp-proxy");
        expect(row.fiveAnchoredAnnual[2]).toBe(row.designCenterAnnual);
      }
    }
  });

  it("does not erase the US fiscal source claim with a small prototype price", () => {
    const row = rows.find((entry) => entry.country === "US" && entry.familyId === "L08")!;
    expect(row.centerToSourceRatio).toBeLessThan(0.01);
    // Keep the funded source claim after opening-envelope calibration, rather
    // than substituting the much smaller provisional agency design estimate.
    expect(row.fiveAnchoredAnnual[2]).toBe(108_308_193_146);
    expect(row.designCenterAnnual).toBe(372_000_000);
  });
});
