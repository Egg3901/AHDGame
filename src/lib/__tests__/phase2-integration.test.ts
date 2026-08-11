import { describe, it, expect } from "vitest";
import { COUNTRY_ORDER, getCountryConfig } from "@/lib/constants/countries";

describe("Phase 2 Integration - Routing & Components", () => {
  for (const countryId of COUNTRY_ORDER) {
    describe(`${countryId} Routes`, () => {
      it("should have valid config paths", () => {
        const config = getCountryConfig(countryId);

        expect(config.mapPath).toContain("/country/");
        expect(config.overviewPath).toContain("/country/");
        expect(config.legislature.path).toBeTruthy();
      });

      it("should have complete legislature config", () => {
        const config = getCountryConfig(countryId);

        expect(config.legislature.name).toBeTruthy();
        expect(config.legislature.lowerChamber.name).toBeTruthy();
        expect(config.legislature.lowerChamber.seats).toBeGreaterThan(0);

        // Unicameral legislatures omit `upperChamber`; the set allowed to do
        // so is pinned in phase3-integration.
        const upper = config.legislature.upperChamber;
        if (upper) {
          expect(upper.name).toBeTruthy();
          expect(upper.seats).toBeGreaterThan(0);
        }
      });

      it("should have regionLabel configured", () => {
        const config = getCountryConfig(countryId);

        expect(config.regionLabel).toBeTruthy();
        expect(config.regionLabelPlural).toBeTruthy();
      });
    });
  }
});
