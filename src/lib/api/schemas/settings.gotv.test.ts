import { describe, expect, it } from "vitest";
import { gotvBudgetSchema, suppressionBudgetSchema } from "./settings";

// Regression for bug #0700: a CN (Huazhong) party treasurer could not set a GOTV
// target — the category enum only allowed uk_voterGroups/jp_voterGroups, so
// cn/de/ie/br_voterGroups were rejected. The enum now derives from the
// demographics SSOT, covering every country.
describe("gotv/suppression target category enum (#0700)", () => {
  const ALL_COUNTRY_BUCKETS = [
    "uk_voterGroups",
    "jp_voterGroups",
    "de_voterGroups",
    "ie_voterGroups",
    "cn_voterGroups",
    "br_voterGroups",
  ];
  const US_DIMENSIONS = ["race", "age", "education", "wealth", "ideology"];

  it("accepts every country's voterGroups bucket as a GOTV target", () => {
    for (const category of ALL_COUNTRY_BUCKETS) {
      const r = gotvBudgetSchema.safeParse({ gotvBudgetPercent: 10, gotvTargetCategory: category });
      expect(r.success, `gotv rejected "${category}"`).toBe(true);
    }
  });

  it("accepts US Layer-1 dimensions as a GOTV target", () => {
    for (const category of US_DIMENSIONS) {
      const r = gotvBudgetSchema.safeParse({ gotvBudgetPercent: 10, gotvTargetCategory: category });
      expect(r.success, `gotv rejected "${category}"`).toBe(true);
    }
  });

  it("accepts every country's voterGroups bucket as a suppression target", () => {
    for (const category of ALL_COUNTRY_BUCKETS) {
      const r = suppressionBudgetSchema.safeParse({
        suppressionBudgetPercent: 10,
        suppressionTargetCategory: category,
      });
      expect(r.success, `suppression rejected "${category}"`).toBe(true);
    }
  });

  it("rejects an unknown category", () => {
    expect(
      gotvBudgetSchema.safeParse({ gotvBudgetPercent: 10, gotvTargetCategory: "not_a_category" })
        .success
    ).toBe(false);
  });
});
