import { describe, it, expect } from "vitest";
import { resolveOfficeActionBonusForType, resolveOfficeNiBonus } from "./officeBonusRegistry";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * The live `gameConfig.officeActionBonus` map. Only US/UK/DE/JP/CN/CA keys were
 * ever added to it, which is exactly the gap these helpers close.
 */
const LIVE_CONFIG_MAP: Record<string, number> = {
  house: 1,
  senate: 2,
  stateSenate: 1,
  governor: 2,
  president: 4,
  vicePresident: 2,
  commons: 1,
  primeMinister: 4,
  regionalCouncil: 1,
  premier: 2,
  bundestag: 1,
  bundesrat: 2,
  chancellor: 4,
  ministerPresident: 2,
  landtag: 1,
  sangiin: 1,
  shugiin: 1,
  npcDelegate: 1,
  peoplesCongress: 1,
  parliamentaryCabinet: 1,
  ukCabinet: 1,
  usCabinet: 1,
};

describe("resolveOfficeActionBonusForType", () => {
  it("prefers an explicit gameConfig entry over the country registry", () => {
    // DD's registry entry for `governor` is 2; the config says 2 as well, but
    // the point is the config is consulted first — prove it with an override.
    expect(resolveOfficeActionBonusForType("governor", { governor: 9 }, "DD")).toBe(9);
  });

  it("keeps a configured zero rather than falling back to the registry", () => {
    expect(resolveOfficeActionBonusForType("senate", { senate: 0 }, "US")).toBe(0);
  });

  it("grants a Volkskammer deputy their registry bonus (ticket #974)", () => {
    expect(resolveOfficeActionBonusForType("volkskammerDeputy", LIVE_CONFIG_MAP, "DD")).toBe(1);
  });

  it("grants a DD Landtag deputy their registry bonus", () => {
    expect(resolveOfficeActionBonusForType("landAssembly", LIVE_CONFIG_MAP, "DD")).toBe(1);
  });

  it("resolves without a countryId by scanning every country", () => {
    expect(resolveOfficeActionBonusForType("volkskammerDeputy", LIVE_CONFIG_MAP)).toBe(1);
  });

  it("returns 0 for an office no source knows", () => {
    expect(resolveOfficeActionBonusForType("notAnOffice", LIVE_CONFIG_MAP, "US")).toBe(0);
  });

  it("returns 0 for no office", () => {
    expect(resolveOfficeActionBonusForType(undefined, LIVE_CONFIG_MAP, "US")).toBe(0);
  });

  it("leaves no elected office in any country resolving to a zero bonus", () => {
    const zeroed: string[] = [];
    for (const [countryId, config] of Object.entries(COUNTRY_CONFIGS)) {
      for (const office of config.officeTypes) {
        if (office.actionBonus <= 0) continue;
        const resolved = resolveOfficeActionBonusForType(
          office.key,
          LIVE_CONFIG_MAP,
          countryId as CountryId
        );
        if (resolved <= 0) zeroed.push(`${countryId}/${office.key}`);
      }
    }
    expect(zeroed).toEqual([]);
  });
});

describe("resolveOfficeNiBonus", () => {
  it("keeps the tuned tier for offices in the override table", () => {
    expect(resolveOfficeNiBonus("president", "US")).toBe(2.5);
    expect(resolveOfficeNiBonus("vicePresident", "US")).toBe(2.0);
    expect(resolveOfficeNiBonus("house", "US")).toBe(1.0);
    expect(resolveOfficeNiBonus("governor", "US")).toBe(1.0);
  });

  it("gives non-US legislators the rank-and-file tier (ticket #974)", () => {
    expect(resolveOfficeNiBonus("volkskammerDeputy", "DD")).toBe(1.0);
    expect(resolveOfficeNiBonus("landAssembly", "DD")).toBe(1.0);
    expect(resolveOfficeNiBonus("supremeSovietDeputy", "RU")).toBe(1.0);
    expect(resolveOfficeNiBonus("dail", "IE")).toBe(1.0);
  });

  it("gives a non-US national executive the executive-head tier", () => {
    expect(resolveOfficeNiBonus("chairmanOfStateCouncil", "DD")).toBe(2.5);
  });

  it("returns 0 for unknown or absent offices", () => {
    expect(resolveOfficeNiBonus("notAnOffice", "US")).toBe(0);
    expect(resolveOfficeNiBonus(undefined)).toBe(0);
  });
});
