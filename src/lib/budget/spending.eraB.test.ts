import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { resolveNationalMedianIncome } from "./spending";

describe("phantom-line gate contract", () => {
  it("an era-inactive enacted law is excluded when the year is set; included when null", () => {
    expect(isLegislationTypeActive("cn_common_prosperity", 2009)).toBe(false);
    expect(isLegislationTypeActive("cn_common_prosperity", 2025)).toBe(true);
    expect(isLegislationTypeActive("cn_common_prosperity", null)).toBe(true);
  });
});

describe("resolveNationalMedianIncome", () => {
  it("reads economic.medianIncome.value from the national stateMetrics doc", async () => {
    const db = createMockDb();
    db.collection("macroMetrics"); // register the lazy collection mock
    db.collectionMocks.macroMetrics.findOne.mockResolvedValue({
      _id: "cn_national",
      economic: { medianIncome: { value: 52_000 } },
    });
    await expect(resolveNationalMedianIncome(db as unknown as Db, "CN")).resolves.toBe(52_000);
    expect(db.collectionMocks.macroMetrics.findOne).toHaveBeenCalledWith(
      { _id: "cn_national" },
      expect.anything()
    );
  });

  it("returns undefined when the doc or value is missing/non-finite", async () => {
    const db = createMockDb();
    db.collection("macroMetrics");
    db.collectionMocks.macroMetrics.findOne.mockResolvedValue(null);
    await expect(resolveNationalMedianIncome(db as unknown as Db, "CN")).resolves.toBeUndefined();
    db.collectionMocks.macroMetrics.findOne.mockResolvedValue({
      _id: "cn_national",
      economic: { medianIncome: { value: Number.NaN } },
    });
    await expect(resolveNationalMedianIncome(db as unknown as Db, "CN")).resolves.toBeUndefined();
  });
});
