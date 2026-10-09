import { describe, expect, it } from "vitest";
import { gotvBudgetSchema, suppressionBudgetSchema } from "./settings";
import { getAllTurnoutTargetOptions } from "@/lib/demographics/turnoutTargets";
import { getAllDemographicCategoryKeys } from "@/lib/demographics/countryDemographics";

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
  const INTERNATIONAL_DIMENSIONS = ["ethnicity", "income", "religion", "urbanization"];

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

  it("accepts the additional Layer-1 dimensions shown outside the US", () => {
    for (const category of INTERNATIONAL_DIMENSIONS) {
      const r = gotvBudgetSchema.safeParse({ gotvBudgetPercent: 10, gotvTargetCategory: category });
      expect(r.success, `gotv rejected "${category}"`).toBe(true);
    }
  });

  it("keeps the schema allowlist in sync with every modeled target dimension", () => {
    const modeledDimensions = new Set(getAllTurnoutTargetOptions().map((target) => target.dim));
    for (const category of modeledDimensions) {
      expect(
        gotvBudgetSchema.safeParse({ gotvBudgetPercent: 10, gotvTargetCategory: category }).success,
        `gotv rejected modeled dimension "${category}"`
      ).toBe(true);
    }
  });

  it("keeps the schema allowlist in sync with every legacy target category", () => {
    for (const category of getAllDemographicCategoryKeys()) {
      expect(
        suppressionBudgetSchema.safeParse({
          suppressionBudgetPercent: 10,
          suppressionTargetCategory: category,
        }).success,
        `suppression rejected legacy category "${category}"`
      ).toBe(true);
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
