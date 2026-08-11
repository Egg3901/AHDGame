import { describe, it, expect } from "vitest";
import { COUNTRY_ORDER, getCountryConfig } from "@/lib/constants/countries";

describe("Parameterized Country Tests", () => {
  for (const countryId of COUNTRY_ORDER) {
    describe(`${countryId} - Country Config`, () => {
      it("should have complete CountryConfig", () => {
        const config = getCountryConfig(countryId);

        expect(config.id).toBe(countryId);
        expect(config.name).toBeTruthy();
        expect(config.code).toBeTruthy();
        expect(config.regionLabel).toBeTruthy();
        expect(config.regionLabelPlural).toBeTruthy();
        expect(config.executiveTitle).toBeTruthy();
        expect(config.legislature.name).toBeTruthy();
        expect(config.legislature.path).toBeTruthy();
        expect(config.officeTypes.length).toBeGreaterThan(0);
        expect(config.majorPartyIds.length).toBeGreaterThan(0);
      });

      it("should have valid map path", () => {
        const config = getCountryConfig(countryId);
        expect(config.mapPath).toContain("/country/");
      });

      it("should have valid legislature configuration", () => {
        const config = getCountryConfig(countryId);

        expect(config.legislature.lowerChamber.seats).toBeGreaterThan(0);
        expect(config.legislature.lowerChamber.key).toBeTruthy();

        // `upperChamber` is optional — genuinely unicameral legislatures omit
        // it (see LegislatureConfig). Which countries may do so is pinned
        // centrally in phase3-integration; here we only require that an upper
        // chamber, when present, is well-formed.
        const upper = config.legislature.upperChamber;
        if (upper) {
          expect(upper.seats).toBeGreaterThan(0);
          expect(upper.key).toBeTruthy();
        }
      });

      it("should have at least one executive office type", () => {
        const config = getCountryConfig(countryId);
        const executive = config.officeTypes.find((o) => o.isExecutive);

        expect(executive).toBeTruthy();
        expect(executive?.actionBonus).toBeGreaterThan(0);
      });

      it("should have valid paths", () => {
        const config = getCountryConfig(countryId);

        expect(config.entryPath).toBeTruthy();
        expect(config.entryPath).toMatch(/^\//); // Starts with /
        expect(config.overviewPath).toBeTruthy();
        expect(config.overviewPath).toMatch(/^\//);
        expect(config.mapPath).toBeTruthy();
        expect(config.mapPath).toMatch(/^\//);
      });
    });
  }
});
