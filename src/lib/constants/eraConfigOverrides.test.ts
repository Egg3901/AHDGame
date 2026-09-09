import { describe, expect, it } from "vitest";
import { COUNTRY_CONFIGS, getCountryConfig } from "./countries";

describe("era country config overrides", () => {
  it("gives the 1953 Senate 96 seats, for 48 states", () => {
    expect(getCountryConfig("US", "1953-default").legislature.upperChamber?.seats).toBe(96);
    expect(getCountryConfig("US", "2019-default").legislature.upperChamber?.seats).toBe(100);
  });

  it("gives the 1992 Commons 651 seats", () => {
    expect(getCountryConfig("UK", "1991-default").legislature.lowerChamber.seats).toBe(651);
    expect(getCountryConfig("UK", "2019-default").legislature.lowerChamber.seats).toBe(650);
  });

  it("gives the 1990 Diet its era chamber sizes", () => {
    const jp = getCountryConfig("JP", "1991-default").legislature;
    expect(jp.lowerChamber.seats).toBe(512);
    // 252, not the modern 248 and not the roster's incomplete 206.
    expect(jp.upperChamber?.seats).toBe(252);
  });

  /**
   * `getCountryConfig` spreads (`{ ...base, ...override }`), so an override that
   * supplies `legislature` replaces it WHOLESALE. A partial object silently
   * drops chamber keys, names, descriptions and flags, and nothing would fail
   * loudly - the chamber would just stop existing for that era.
   */
  it("does not lose the rest of the legislature to the shallow merge", () => {
    for (const [id, preset] of [
      ["US", "1953-default"],
      ["UK", "1991-default"],
      ["JP", "1991-default"],
    ] as const) {
      const base = COUNTRY_CONFIGS[id].legislature;
      const era = getCountryConfig(id, preset).legislature;
      expect(era.lowerChamber.key, `${preset}/${id}`).toBe(base.lowerChamber.key);
      expect(era.upperChamber?.key, `${preset}/${id}`).toBe(base.upperChamber?.key);
      expect(era.name, `${preset}/${id}`).toBe(base.name);
      expect(era.path, `${preset}/${id}`).toBe(base.path);
      expect(era.bicameral, `${preset}/${id}`).toBe(base.bicameral);
      expect(era.lowerChamber.description, `${preset}/${id}`).toBeTruthy();
      expect(era.upperChamber?.description, `${preset}/${id}`).toBeTruthy();
    }
  });

  it("keeps each era's override to its own era", () => {
    // The table is preset-keyed and a country may hold entries in several eras:
    // the UK already had a 1953 override at 625 seats, which the new 1991 entry
    // must not disturb, and 1991's must not leak forward into 2019.
    expect(getCountryConfig("UK", "1953-default").legislature.lowerChamber.seats).toBe(625);
    expect(getCountryConfig("UK", "2019-default").legislature.lowerChamber.seats).toBe(650);
    expect(getCountryConfig("JP", "2019-default").legislature.lowerChamber.seats).toBe(465);
    expect(getCountryConfig("JP", "2019-default").legislature.upperChamber?.seats).toBe(248);
    expect(getCountryConfig("US", "2019-default").legislature.upperChamber?.seats).toBe(100);
  });
});
