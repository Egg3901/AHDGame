import { describe, expect, it } from "vitest";
import { projectLawToLegislationType } from "../project";
import { getCatalog, getCoreCatalog, getRegionalCatalog, getLaw } from "../catalog";
import { DD_LAND_LAWS, DD_LAND_STATE_IDS } from "./ddLandLaws";

describe("DD Land regional sidecar", () => {
  it("is structurally valid (regional secondaries with 5 levels)", () => {
    for (const law of DD_LAND_LAWS) {
      expect(law.kind).toBe("secondary");
      expect(law.allowedScope).toBe("regional");
      expect(law.countryId).toBe("DD");
      expect(law.targets.length).toBeGreaterThanOrEqual(2);
      expect(law.targets.length).toBeLessThanOrEqual(5);
      expect(law.levels).toHaveLength(5);
      expect(law.levels![0].gdpCostFraction).toBeUndefined();
      expect(getLaw(law.id)?.id).toBe(law.id);
    }
  });

  it("is exactly six regional secondaries covering the six Länder domains", () => {
    expect(DD_LAND_LAWS).toHaveLength(6);
    expect(DD_LAND_STATE_IDS).toEqual(["BEO", "MV", "BB", "ST", "SN", "TH"]);
  });

  it("projects to pipeline allowedScope state", () => {
    for (const law of DD_LAND_LAWS) {
      expect(projectLawToLegislationType(law).allowedScope).toBe("state");
    }
  });

  it("is merged into getCatalog but not the core topology catalog", () => {
    expect(getCoreCatalog("DD")).toHaveLength(109);
    expect(getRegionalCatalog("DD")).toHaveLength(6);
    expect(getCatalog("DD")).toHaveLength(115);
    expect(getCatalog("DD").filter((l) => l.allowedScope === "regional")).toHaveLength(6);
  });

  it("keeps RU catalog free of regional sidecars", () => {
    expect(getRegionalCatalog("RU")).toHaveLength(0);
    expect(getCatalog("RU")).toHaveLength(109);
  });
});
