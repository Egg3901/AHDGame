import { describe, expect, it } from "vitest";
import { matchesLegislatureBillStatusFilter } from "@/lib/legislature/billStatusFilters";

describe("matchesLegislatureBillStatusFilter", () => {
  it("matches all statuses for the all filter", () => {
    expect(matchesLegislatureBillStatusFilter("active", "all")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("signed", "all")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("failed", "all")).toBe(true);
  });

  it("groups passed-style statuses together", () => {
    expect(matchesLegislatureBillStatusFilter("passed_origin", "passed")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("signed", "passed")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("enacted", "passed")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("active", "passed")).toBe(false);
  });

  it("groups failed-style statuses together", () => {
    expect(matchesLegislatureBillStatusFilter("failed", "failed")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("withdrawn", "failed")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("vetoed", "failed")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("active_other", "failed")).toBe(false);
  });

  it("treats in-flight statuses as voting", () => {
    expect(matchesLegislatureBillStatusFilter("proposed", "voting")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("active", "voting")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("active_other", "voting")).toBe(true);
    expect(matchesLegislatureBillStatusFilter("signed", "voting")).toBe(false);
    expect(matchesLegislatureBillStatusFilter("failed", "voting")).toBe(false);
  });
});
