import { describe, expect, it } from "vitest";
import { projectLawToLegislationType } from "../project";
import { getCatalog, getCoreCatalog, getRegionalCatalog, getLaw } from "../catalog";
import { US_STATE_TAX_BASELINES, US_STATE_TAX_LAWS } from "./usStateTaxLaws";

describe("US state tax regional sidecar", () => {
  it("is five regional tax sliders keyed to state budget rates", () => {
    expect(US_STATE_TAX_LAWS).toHaveLength(5);
    for (const law of US_STATE_TAX_LAWS) {
      expect(law.kind).toBe("tax");
      expect(law.countryId).toBe("US");
      expect(law.allowedScope).toBe("regional");
      expect(law.taxPolicy?.scope).toBe("state");
      expect(law.targets).toEqual([]);
      expect(getLaw(law.id)?.id).toBe(law.id);
    }
    expect(US_STATE_TAX_LAWS.map((l) => l.taxPolicy?.taxType).sort()).toEqual([
      "domesticCorporateTax",
      "foreignCorporateTax",
      "incomeTax",
      "propertyTax",
      "salesTax",
    ]);
  });

  it("baselines match generateStateBudgets US defaults", () => {
    for (const law of US_STATE_TAX_LAWS) {
      const taxType = law.taxPolicy!.taxType as keyof typeof US_STATE_TAX_BASELINES;
      expect(law.taxPolicy!.baselineRate).toBe(US_STATE_TAX_BASELINES[taxType]);
    }
  });

  it("projects to pipeline allowedScope state with a taxSlider and no options ladder", () => {
    for (const law of US_STATE_TAX_LAWS) {
      const doc = projectLawToLegislationType(law);
      expect(doc.allowedScope).toBe("state");
      expect(doc.policyDomain).toBe("tax");
      expect(doc.policyOptions).toBeUndefined();
      expect(doc.taxSlider?.scope).toBe("state");
      expect(doc.taxRateChange).toEqual({
        scope: "state",
        taxType: law.taxPolicy!.taxType,
      });
    }
  });

  it("is merged into getCatalog but not the core topology catalog", () => {
    expect(getCoreCatalog("US")).toHaveLength(110);
    expect(getRegionalCatalog("US")).toHaveLength(5);
    expect(getCatalog("US")).toHaveLength(115);
    expect(getCatalog("US").filter((l) => l.allowedScope === "regional")).toHaveLength(5);
  });
});
