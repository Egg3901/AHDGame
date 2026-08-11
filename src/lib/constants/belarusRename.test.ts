import { describe, it, expect } from "vitest";
import { COUNTRY_CONFIGS, ALL_COUNTRY_IDS } from "@/lib/constants/countries";
import { WEST_DE_REGION_CODES } from "@/lib/maps/germanyGeometry";
import { resolveCountryFlagCode } from "@/lib/constants/flags";

/**
 * Belarus is BLR, not BY. `BY` is Bavaria's German Landesliste state code and is
 * used far more widely, so Belarus — the smaller and latent side — was moved.
 * These tests exist to stop a future blanket rename collapsing the two again.
 */
describe("Belarus BY -> BLR rename", () => {
  it("registers Belarus under BLR, not BY", () => {
    expect(ALL_COUNTRY_IDS).toContain("BLR");
    expect(ALL_COUNTRY_IDS).not.toContain("BY");
    expect(COUNTRY_CONFIGS.BLR?.name).toMatch(/belarus/i);
  });

  it("keeps the Belarus flag resolvable via the alpha-2 override", () => {
    // flagcdn serves ISO alpha-2, so "blr" would 404.
    expect(resolveCountryFlagCode("BLR")).toBe("BY");
  });

  it("leaves Bavaria's BY state code untouched", () => {
    // BY here is Bayern, a German Landesliste state code — NOT Belarus.
    expect(WEST_DE_REGION_CODES).toContain("BY");
  });
});
