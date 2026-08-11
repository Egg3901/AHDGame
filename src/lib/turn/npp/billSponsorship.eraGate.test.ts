import { describe, expect, it } from "vitest";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import { isMarketLiberalLegislationType } from "./billSponsorship";

describe("NPP sponsorship era filter", () => {
  it("excludes a windowed type before its window, includes it after, includes all when null", () => {
    const types = ["cn_common_prosperity", "cn_minimum_wage"]; // windowed 2021, always
    const at1995 = types.filter((id) => isLegislationTypeActive(id, 1995));
    const at2022 = types.filter((id) => isLegislationTypeActive(id, 2022));
    const legacy = types.filter((id) => isLegislationTypeActive(id, null));
    expect(at1995).toEqual(["cn_minimum_wage"]);
    expect(at2022).toEqual(["cn_common_prosperity", "cn_minimum_wage"]);
    expect(legacy).toEqual(["cn_common_prosperity", "cn_minimum_wage"]);
  });
});

describe("isMarketLiberalLegislationType", () => {
  it("flags economic-system / price-control / SOE / farm-organization levers", () => {
    expect(isMarketLiberalLegislationType({ _id: "su_economic_system" })).toBe(true);
    expect(isMarketLiberalLegislationType({ _id: "pl_price_controls" })).toBe(true);
    expect(isMarketLiberalLegislationType({ _id: "cn_state_enterprises" })).toBe(true);
    expect(
      isMarketLiberalLegislationType({ _id: "su_agriculture", subCategory: "Farm organization" })
    ).toBe(true);
  });

  it("leaves ordinary fiscal/healthcare types alone", () => {
    expect(isMarketLiberalLegislationType({ _id: "su_enterprise_levy" })).toBe(false);
    expect(isMarketLiberalLegislationType({ _id: "cn_medical_insurance" })).toBe(false);
    expect(isMarketLiberalLegislationType({ _id: "us_medicaid" })).toBe(false);
  });
});
