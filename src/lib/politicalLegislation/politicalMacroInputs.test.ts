import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { loadPoliticalMacroInputs } from "./politicalMacroInputs";
import { LIFE_EXPECTANCY_MID } from "@/lib/demographics/flows/mortality";

describe("loadPoliticalMacroInputs", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  function setDocs(docs: unknown[]) {
    db.collection("politicalMetrics");
    db.collectionMocks.politicalMetrics!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(docs),
    });
  }

  it("resolves a legacy path to a real unit for a political region", async () => {
    setDocs([{ _id: "MA", countryId: "US", values: { "health.outcomes": 100 } }]);
    const inputs = await loadPoliticalMacroInputs(db as unknown as Db);
    expect(inputs.has("MA")).toBe(true);
    expect(inputs.legacyUnit("MA", "healthcare.lifeExpectancy")).toBe(85);
  });

  it("returns the neutral real unit when the family sits at 50", async () => {
    setDocs([{ _id: "MA", countryId: "US", values: { "health.outcomes": 50 } }]);
    const inputs = await loadPoliticalMacroInputs(db as unknown as Db);
    expect(inputs.legacyUnit("MA", "healthcare.lifeExpectancy")).toBe(LIFE_EXPECTANCY_MID);
  });

  it("reports non-political regions as absent so callers keep the legacy read", async () => {
    setDocs([]);
    const inputs = await loadPoliticalMacroInputs(db as unknown as Db);
    expect(inputs.has("TOK")).toBe(false);
    expect(inputs.legacyUnit("TOK", "healthcare.lifeExpectancy")).toBeNull();
    expect(inputs.score("TOK", "society.demography")).toBeNull();
  });

  it("exposes the raw score for already-0-100 consumers", async () => {
    setDocs([{ _id: "MA", countryId: "US", values: { "society.demography": 63 } }]);
    const inputs = await loadPoliticalMacroInputs(db as unknown as Db);
    expect(inputs.score("MA", "society.demography")).toBe(63);
  });

  it("never yields NaN when the region is on the board but the family is missing", async () => {
    // A partial values doc must not produce NaN: legacyUnit feeds straight into
    // the mortality modifier and the TFP basket, where a NaN would silently
    // poison a region's deaths and potential growth rather than throwing.
    setDocs([{ _id: "MA", countryId: "US", values: {} }]);
    const inputs = await loadPoliticalMacroInputs(db as unknown as Db);
    expect(inputs.has("MA")).toBe(true);
    for (const path of [
      "healthcare.lifeExpectancy",
      "healthcare.preventableMortality",
      "education.workforceSkill",
      "infrastructure.transportEfficiency",
      "infrastructure.broadbandAccess",
      "infrastructure.powerGridReliability",
    ]) {
      const v = inputs.legacyUnit("MA", path);
      expect(v === null || Number.isFinite(v), `${path} -> ${v}`).toBe(true);
    }
    expect(inputs.score("MA", "society.demography")).toBeNull();
  });

  it("returns null for a path with no band even when the region is political", async () => {
    setDocs([{ _id: "MA", countryId: "US", values: { "economy.stability": 80 } }]);
    const inputs = await loadPoliticalMacroInputs(db as unknown as Db);
    expect(inputs.legacyUnit("MA", "economic.gdpGrowth")).toBeNull();
  });
});
