import { describe, it, expect } from "vitest";
import { stateConfigToCsv, allStatesLeanToCsv } from "./csv";
import { editorConfigFromSeed, computeDerivedComposition } from "./derive";
import type { Layer1Config } from "@/lib/seeds/stateDemographics";

const CFG: Layer1Config = {
  race: { white: 60, black: 20, hispanic: 12, asian: 5, other: 3 },
  education: { no_college: 55, college: 30, graduate: 15 },
  wealth: { low: 30, middle: 50, high: 20 },
  age: { young: 25, mid: 28, mature: 25, senior: 22 },
  ideology: {
    evangelicals: 15,
    environmentalists: 15,
    libertarians: 10,
    progressives: 18,
    patriots: 18,
    gunowners: 14,
  },
};

describe("csv", () => {
  it("single-state CSV has a header and Layer-1 + derived rows", () => {
    const cfg = editorConfigFromSeed("CA", "US", "2019", CFG);
    const csv = stateConfigToCsv(cfg, computeDerivedComposition(cfg));
    expect(csv.split("\n")[0]).toContain("section");
    expect(csv).toContain("layer1");
    expect(csv).toContain("derived");
    expect(csv).toContain("white");
  });

  it("all-states CSV has one row per state", () => {
    const csv = allStatesLeanToCsv("2019", "US", [
      { stateId: "CA", economic: -1.2, social: -0.8, display: -1 },
      { stateId: "TX", economic: 0.9, social: 1.1, display: 1 },
    ]);
    expect(csv.trim().split("\n")).toHaveLength(3); // header + 2
  });

  it("single-state CSV is schema self-consistent (R5: import-ready, no importer in v1)", () => {
    const cfg = editorConfigFromSeed("CA", "US", "2019", CFG);
    const derived = computeDerivedComposition(cfg);
    const rows = stateConfigToCsv(cfg, derived)
      .split("\n")
      .slice(1)
      .map((l) => l.split(","));
    const layer1Rows = rows.filter((r) => r[0] === "layer1");
    expect(layer1Rows.length).toBeGreaterThan(0);
    for (const r of layer1Rows) {
      expect(r).toHaveLength(10);
      expect(Number.isNaN(Number(r[6]))).toBe(false);
    }
    const derivedRows = rows.filter((r) => r[0] === "derived");
    expect(derivedRows.length).toBe(derived.archetypes.length);
  });
});
