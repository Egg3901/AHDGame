import { describe, it, expect } from "vitest";
import { buildPortfolioRoster } from "./seedCabinetEstates";
import { getEstateArchetype } from "@/lib/constants/cabinetEstates";

describe("buildPortfolioRoster", () => {
  it("is deterministic for the same inputs", () => {
    const a = buildPortfolioRoster(
      "US",
      "secretary_of_education",
      "education",
      ["US-CA", "US-NY"],
      [],
      1
    );
    const b = buildPortfolioRoster(
      "US",
      "secretary_of_education",
      "education",
      ["US-CA", "US-NY"],
      [],
      1
    );
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("domestic estates site in regions with valid archetypes", () => {
    const roster = buildPortfolioRoster(
      "US",
      "secretary_of_education",
      "education",
      ["US-CA", "US-NY"],
      [],
      1
    );
    for (const e of roster) {
      expect(e.siteScope).toBe("region");
      expect(["US-CA", "US-NY"]).toContain(e.siteId);
      expect(getEstateArchetype("education", e.archetypeId)).toBeDefined();
      expect(e.tier).toBeGreaterThanOrEqual(0);
      expect(e.tier).toBeLessThanOrEqual(1);
      expect(e.fundingLevel).toBe("standard");
      expect(e.condition).toBe(100);
      expect(e.countryId).toBe("US");
      expect(e.positionId).toBe("secretary_of_education");
    }
  });

  it("foreign estates site abroad, one of each archetype per host country", () => {
    const roster = buildPortfolioRoster(
      "US",
      "secretary_of_state",
      "foreign",
      [],
      ["UK", "DE", "JP"],
      1
    );
    for (const e of roster) {
      expect(e.siteScope).toBe("country");
      expect(["UK", "DE", "JP"]).toContain(e.siteId);
      expect(e.siteId).not.toBe("US");
    }
    const keys = roster.map((e) => `${e.archetypeId}@${e.siteId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("RU trade missions site in other countries, not RU regions", () => {
    const roster = buildPortfolioRoster(
      "RU",
      "minister_of_foreign_trade",
      "trade_mission",
      ["RU-MOS", "RU-LEN"],
      ["US", "DD"],
      1
    );
    expect(roster.length).toBeGreaterThan(0);
    for (const e of roster) {
      expect(e.siteScope).toBe("country");
      expect(["US", "DD"]).toContain(e.siteId);
    }
  });

  it("RU heavy industry sites in RU regions", () => {
    const roster = buildPortfolioRoster(
      "RU",
      "minister_of_machine_building",
      "heavy_industry",
      ["RU-MOS", "RU-LEN"],
      ["US", "DD"],
      1
    );
    expect(roster.length).toBeGreaterThan(0);
    for (const e of roster) {
      expect(e.siteScope).toBe("region");
      expect(["RU-MOS", "RU-LEN"]).toContain(e.siteId);
    }
  });

  it("returns [] when no sites are available", () => {
    expect(buildPortfolioRoster("US", "secretary_of_education", "education", [], [], 1)).toEqual(
      []
    );
    expect(buildPortfolioRoster("US", "secretary_of_state", "foreign", [], [], 1)).toEqual([]);
  });
});
