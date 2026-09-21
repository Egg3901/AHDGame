import { describe, expect, it } from "vitest";
import { PRODUCT_KINDS } from "./catalog";

describe("product catalog", () => {
  it("limits Industrial Manufacturing to commodities the combined sector already outputs", () => {
    const industrialOutputs = new Set(
      PRODUCT_KINDS.filter((kind) => kind.family === "industrial_manufacturing").map(
        (kind) => kind.outputCommodity
      )
    );

    expect(industrialOutputs).toEqual(
      new Set(["vehicles", "electronics", "steel", "building_materials"])
    );
  });

  it("does not include rejected bus or machinery products", () => {
    const ids = PRODUCT_KINDS.map((kind) => kind.id);
    expect(ids).not.toContain("bus");
    expect(ids).not.toContain("machinery");
  });

  it("gates every media product to at least one operating model", () => {
    for (const kind of PRODUCT_KINDS.filter((item) => item.family === "media_entertainment")) {
      expect(kind.operatingModels.length).toBeGreaterThan(0);
    }
  });
});
