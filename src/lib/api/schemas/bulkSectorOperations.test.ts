import { describe, expect, it } from "vitest";
import { bulkSectorOperationsSchema } from "./corporations";

describe("bulkSectorOperationsSchema", () => {
  it("accepts a By-Type growth-only request", () => {
    const r = bulkSectorOperationsSchema.safeParse({
      countryId: "US",
      sectorType: "energy",
      targetGrowthRate: 8,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a Corporate-Wide request (no sectorType)", () => {
    const r = bulkSectorOperationsSchema.safeParse({ countryId: "US", productionPolicy: 10 });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown country", () => {
    const r = bulkSectorOperationsSchema.safeParse({ countryId: "ZZ", targetGrowthRate: 8 });
    expect(r.success).toBe(false);
  });

  it("rejects an out-of-range production policy", () => {
    const r = bulkSectorOperationsSchema.safeParse({ countryId: "US", productionPolicy: 99 });
    expect(r.success).toBe(false);
  });

  it("accepts a pricing-posture-only Corporate-Wide request", () => {
    const r = bulkSectorOperationsSchema.safeParse({ countryId: "US", pricingPosture: -0.1 });
    expect(r.success).toBe(true);
  });

  it("accepts pricingPosture null (Auto)", () => {
    const r = bulkSectorOperationsSchema.safeParse({ countryId: "US", pricingPosture: null });
    expect(r.success).toBe(true);
  });

  it("rejects when neither growth, output policy, nor pricing is supplied", () => {
    const r = bulkSectorOperationsSchema.safeParse({ countryId: "US", sectorType: "energy" });
    expect(r.success).toBe(false);
  });

  it("rejects an out-of-range pricing posture", () => {
    const r = bulkSectorOperationsSchema.safeParse({ countryId: "US", pricingPosture: 0.5 });
    expect(r.success).toBe(false);
  });
});
