import { describe, it, expect } from "vitest";
import {
  COUNTRY_ORDER,
  getCountryConfig,
  getExecutiveFormationForGovernmentType,
  getHeadOfStateTitle,
  isParliamentarySystem,
} from "@/lib/constants/countries";

describe("Phase 3 Integration - All configured countries", () => {
  it("should have every CountryId in COUNTRY_ORDER", () => {
    expect(COUNTRY_ORDER).toEqual([
      "US",
      "UK",
      "JP",
      "DE",
      "IE",
      "BR",
      "CN",
      "NG",
      "HU",
      "PL",
      "RO",
      "YU",
      "BG",
      "CS",
      "RU",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
      "DD",
    ]);
    // 24, not 26: BLR and BAL are latent (constituent Soviet union republics,
    // seeded as RU regions BEL/BLT), so they are configured but not ordered.
    expect(COUNTRY_ORDER.length).toBe(24);
  });

  // `LegislatureConfig.upperChamber` is optional, so the per-country checks
  // below can only verify an upper chamber that exists. This pins WHICH
  // countries are allowed to omit one, so a chamber lost by accident still
  // fails loudly here. Note the repo models weak/appointed second chambers as
  // a configured `upperChamber` with `bicameral: false` (UK Lords, DE and AT
  // Bundesrat, IE Seanad) — omission means genuinely no second chamber.
  it("only genuinely unicameral countries omit an upper chamber", () => {
    const unicameral = COUNTRY_ORDER.filter((id) => !getCountryConfig(id).legislature.upperChamber);
    expect(unicameral).toEqual(["GR", "FI"]);
  });

  for (const countryId of COUNTRY_ORDER) {
    describe(`${countryId} Full Stack Test`, () => {
      it("should have complete CountryConfig", () => {
        const config = getCountryConfig(countryId);

        // Basic properties
        expect(config.id).toBe(countryId);
        expect(config.name).toBeTruthy();
        expect(config.code).toBeTruthy();
        expect(config.flagEmoji).toBeTruthy();

        // Political structure
        expect(config.executiveTitle).toBeTruthy();
        expect(getHeadOfStateTitle(config)).toBeTruthy();
        expect(config.governmentType).toMatch(
          /^(presidential|parliamentaryMonarchy|parliamentaryRepublic|onePartyState)$/
        );

        // Regions
        expect(config.regionLabel).toBeTruthy();
        expect(config.regionLabelPlural).toBeTruthy();
      });

      it("should have all required config fields", () => {
        const config = getCountryConfig(countryId);

        if (config.legislature.upperChamber) {
          expect(config.legislature.upperChamber.seats).toBeGreaterThan(0);
        }
        expect(config.legislature.lowerChamber.seats).toBeGreaterThan(0);
        expect(config.legislature.name).toBeTruthy();
        expect(config.legislature.path).toBeTruthy();
        expect(config.officeTypes.length).toBeGreaterThan(0);
        expect(config.majorPartyIds.length).toBeGreaterThan(0);
      });

      it("should have at least one executive office type", () => {
        const config = getCountryConfig(countryId);
        const executive = config.officeTypes.find((o) => o.isExecutive);

        expect(executive).toBeTruthy();
        expect(executive?.key).toBeTruthy();
        expect(executive?.label).toBeTruthy();
        expect(executive?.actionBonus).toBeGreaterThan(0);
        expect(executive?.partyStrengthWeight).toBeGreaterThan(0);
      });

      it("should have valid chamber configurations", () => {
        const config = getCountryConfig(countryId);

        // Upper chamber — optional (unicameral legislatures omit it), but must
        // be complete when present. See "unicameral countries" pin below.
        const upper = config.legislature.upperChamber;
        if (upper) {
          expect(upper.key).toBeTruthy();
          expect(upper.name).toBeTruthy();
          expect(upper.shortName).toBeTruthy();
          expect(upper.description).toBeTruthy();
        }

        // Lower chamber
        expect(config.legislature.lowerChamber.key).toBeTruthy();
        expect(config.legislature.lowerChamber.name).toBeTruthy();
        expect(config.legislature.lowerChamber.shortName).toBeTruthy();
        expect(config.legislature.lowerChamber.description).toBeTruthy();
      });

      it("should have valid election systems", () => {
        const config = getCountryConfig(countryId);

        // Lower chamber should always have election system + a configured method
        expect(config.lowerElectionSystem).toBeTruthy();
        expect(config.electionSystems.lowerChamber).toBeTruthy();
        expect(config.lowerElectionSystem?.termYears).toBeGreaterThan(0);
        expect(config.lowerElectionSystem?.seatsContested).toBeTruthy();

        // Upper chamber election system may be undefined (appointed chambers)
        if (config.upperElectionSystem) {
          expect(config.upperElectionSystem.seatsContested).toBeTruthy();
        }
      });

      it("should have valid paths and metadata", () => {
        const config = getCountryConfig(countryId);

        expect(config.entryPath).toBeTruthy();
        expect(config.overviewPath).toBeTruthy();
        expect(config.mapPath).toBeTruthy();
        expect(config.heroImage).toBeTruthy();
        expect(config.tagline).toBeTruthy();
        expect(config.descriptor).toBeTruthy();
        expect(config.status).toMatch(/active|beta|coming-soon/);
      });

      it("should have coalition threshold for parliamentary systems", () => {
        const config = getCountryConfig(countryId);

        if (isParliamentarySystem(config)) {
          expect(config.coalitionThreshold).toBeGreaterThan(0);
          // confidenceVoteMechanism is a per-country config; not all parliamentary
          // systems use it (e.g. CN's NPC model has no no-confidence mechanism).
        }
      });
    });
  }

  describe("Country-specific configurations", () => {
    it("US should have presidential system", () => {
      const config = getCountryConfig("US");
      expect(config.governmentType).toBe("presidential");
      expect(getExecutiveFormationForGovernmentType(config.governmentType)).toBe("direct_election");
    });

    it("UK should be a parliamentary monarchy", () => {
      const config = getCountryConfig("UK");
      expect(config.governmentType).toBe("parliamentaryMonarchy");
      expect(getExecutiveFormationForGovernmentType(config.governmentType)).toBe(
        "confidence_of_legislature"
      );
      expect(config.executiveTitle).toBe("Prime Minister");
    });

    it("DE should be a parliamentary republic", () => {
      const config = getCountryConfig("DE");
      expect(config.governmentType).toBe("parliamentaryRepublic");
      expect(getExecutiveFormationForGovernmentType(config.governmentType)).toBe(
        "confidence_of_legislature"
      );
      expect(config.executiveTitle).toBe("Chancellor");
    });

    it("DE should be a parliamentary republic with MMP", () => {
      const config = getCountryConfig("DE");
      expect(config.governmentType).toBe("parliamentaryRepublic");
      expect(getExecutiveFormationForGovernmentType(config.governmentType)).toBe(
        "confidence_of_legislature"
      );
      expect(config.executiveTitle).toBe("Chancellor");
      expect(config.electionSystems.lowerChamber).toBe("ams");
      expect(config.legislature.lowerChamber.seats).toBe(630);
      expect(config.legislature.upperChamber?.seats).toBe(69);
    });

    it("JP should be a parliamentary monarchy", () => {
      const config = getCountryConfig("JP");
      expect(config.governmentType).toBe("parliamentaryMonarchy");
      expect(getExecutiveFormationForGovernmentType(config.governmentType)).toBe(
        "confidence_of_legislature"
      );
      expect(config.executiveTitle).toBe("Prime Minister");
    });

    it("IE should be a parliamentary republic", () => {
      const config = getCountryConfig("IE");
      expect(config.governmentType).toBe("parliamentaryRepublic");
      expect(getExecutiveFormationForGovernmentType(config.governmentType)).toBe(
        "confidence_of_legislature"
      );
      expect(config.executiveTitle).toBe("Taoiseach");
    });

    it("BR should have presidential system", () => {
      const config = getCountryConfig("BR");
      expect(config.governmentType).toBe("presidential");
      expect(getExecutiveFormationForGovernmentType(config.governmentType)).toBe("direct_election");
      expect(config.executiveTitle).toBe("President");
    });

    it("CN should be a one-party state", () => {
      const config = getCountryConfig("CN");
      expect(config.governmentType).toBe("onePartyState");
      expect(getExecutiveFormationForGovernmentType(config.governmentType)).toBe(
        "confidence_of_legislature"
      );
      expect(config.executiveTitle).toBe("Premier");
    });

    it("NG should have presidential system", () => {
      const config = getCountryConfig("NG");
      expect(config.governmentType).toBe("presidential");
      expect(getExecutiveFormationForGovernmentType(config.governmentType)).toBe("direct_election");
      expect(config.executiveTitle).toBe("President");
    });
  });
});
