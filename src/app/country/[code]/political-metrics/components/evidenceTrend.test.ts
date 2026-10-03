import { describe, expect, it } from "vitest";
import { evidenceTrendClass, risingIsGood } from "./evidenceTrend";
import { EVIDENCE_SERIES } from "@/lib/politicalMetrics/evidence";

describe("risingIsGood", () => {
  it("reads polarity from the macro metric catalog", () => {
    expect(risingIsGood("unemploymentRate")).toBe(false);
    expect(risingIsGood("medianIncome")).toBe(true);
    expect(risingIsGood("dependencyRatio")).toBe(false);
    expect(risingIsGood("birthRate")).toBe(true);
  });

  it("knows the polarity of every catalog statistic the evidence panel shows", () => {
    // Bank and budget rows carry no trend, so only macro rows need a polarity.
    const macroIds = Object.values(EVIDENCE_SERIES)
      .flat()
      .flatMap((source) => (source && source.kind === "macro" ? [source.metricId] : []));
    expect(macroIds.length).toBeGreaterThan(0);
    for (const id of macroIds) expect(risingIsGood(id), id).not.toBeNull();
  });

  it("returns null for a statistic outside the catalog", () => {
    expect(risingIsGood("primeRate")).toBeNull();
  });
});

describe("evidenceTrendClass", () => {
  it("shows rising unemployment as bad news", () => {
    expect(evidenceTrendClass("unemploymentRate", 0.4)).toBe("text-error");
    expect(evidenceTrendClass("unemploymentRate", -0.4)).toBe("text-success");
  });

  it("shows rising income as good news", () => {
    expect(evidenceTrendClass("medianIncome", 1.2)).toBe("text-success");
    expect(evidenceTrendClass("medianIncome", -1.2)).toBe("text-error");
  });

  it("keeps the old reading where the polarity is not known", () => {
    expect(evidenceTrendClass("primeRate", 0.25)).toBe("text-success");
    expect(evidenceTrendClass("primeRate", -0.25)).toBe("text-error");
  });
});
