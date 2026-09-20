import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { COUNTRY_CONFIGS, ERA_COUNTRY_CONFIG_OVERRIDES, getCountryConfig } from "./countries";
import { SHIPPING_PRESETS } from "@/lib/world/eraRoster";
import { vacantSeatsFor } from "@/lib/world/eraRoster";
import { US_HOUSE_2020 } from "./historicalSeats";

describe("era country config overrides", () => {
  it("gives the 1953 Senate 96 seats, for 48 states", () => {
    expect(getCountryConfig("US", "1953-default").legislature.upperChamber?.seats).toBe(96);
    expect(getCountryConfig("US", "2019-default").legislature.upperChamber?.seats).toBe(100);
  });

  it("gives the 1991 Commons the 650 seats the 1983 boundaries drew", () => {
    // 650, not 651. A 1991 world opens in January 1991; 651 is the chamber the
    // 1992 boundary review produced and the April 1992 election first filled.
    expect(getCountryConfig("UK", "1991-default").legislature.lowerChamber.seats).toBe(650);
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
      // JP-1953 was the hole. Japan holds overrides in TWO eras and this loop
      // pinned only 1991, despite the comment below warning that a country may
      // have entries in several eras. The 1953 override supplies a full
      // `legislature`, so the shallow merge replaces it wholesale -- exactly the
      // case this test exists to catch, in the era it was not watching.
      ["JP", "1953-default"],
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

  it("gives the 1953 Diet its era chamber sizes", () => {
    // 466 Shugiin (pre-1996 multi-member districts) and 248 Sangiin. The 1953
    // override also carries usdExchangeRate 1.0, majorPartyIds and a
    // coalitionThreshold of 234, none of which any test watched before.
    const jp = getCountryConfig("JP", "1953-default");
    expect(jp.legislature.lowerChamber.seats).toBe(466);
    expect(jp.legislature.upperChamber?.seats).toBe(248);
    expect(jp.usdExchangeRate).toBe(1.0);
    expect(jp.majorPartyIds).toEqual(["ryo", "jsp"]);
    expect(jp.coalitionThreshold).toBe(234);
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

describe("US House, February 2020", () => {
  it("matches the real chamber, with its five vacancies declared not seated", () => {
    const byParty: Record<string, number> = {};
    for (const row of US_HOUSE_2020) {
      byParty[row.party] = (byParty[row.party] ?? 0) + (row.seatsHeld ?? 1);
    }
    // The file header's own reference composition, now actually met.
    expect(byParty).toEqual({ democrat: 232, republican: 197, independent: 1 });

    const occupied = Object.values(byParty).reduce((a, b) => a + b, 0);
    expect(occupied).toBe(430);
    expect(vacantSeatsFor("2019-default", "US", "house")).toBe(5);
    expect(occupied + vacantSeatsFor("2019-default", "US", "house")).toBe(
      getCountryConfig("US", "2019-default").legislature.lowerChamber.seats
    );
  });

  it("gives every state its apportioned seats, less any vacancy", () => {
    // The total is a consequence of the per-state rows, so this checks the map
    // rather than the arithmetic: a correct national total over a wrong
    // delegation would still misallocate House elections.
    const VACANCY_STATES: Record<string, number> = { CA: 1, MD: 1, NY: 1, TX: 1, WI: 1 };
    const APPORTIONMENT: Record<string, number> = {
      AL: 7,
      AK: 1,
      AZ: 9,
      AR: 4,
      CA: 53,
      CO: 7,
      CT: 5,
      DE: 1,
      FL: 27,
      GA: 14,
      HI: 2,
      ID: 2,
      IL: 18,
      IN: 9,
      IA: 4,
      KS: 4,
      KY: 6,
      LA: 6,
      ME: 2,
      MD: 8,
      MA: 9,
      MI: 14,
      MN: 8,
      MS: 4,
      MO: 8,
      MT: 1,
      NE: 3,
      NV: 4,
      NH: 2,
      NJ: 12,
      NM: 3,
      NY: 27,
      NC: 13,
      ND: 1,
      OH: 16,
      OK: 5,
      OR: 5,
      PA: 18,
      RI: 2,
      SC: 7,
      SD: 1,
      TN: 9,
      TX: 36,
      UT: 4,
      VT: 1,
      VA: 11,
      WA: 10,
      WV: 3,
      WI: 8,
      WY: 1,
    };
    const byState: Record<string, number> = {};
    for (const row of US_HOUSE_2020) {
      byState[row.state] = (byState[row.state] ?? 0) + (row.seatsHeld ?? 1);
    }
    for (const [state, apportioned] of Object.entries(APPORTIONMENT)) {
      expect(byState[state] ?? 0, state).toBe(apportioned - (VACANCY_STATES[state] ?? 0));
    }
    expect(Object.values(APPORTIONMENT).reduce((a, b) => a + b, 0)).toBe(435);
  });

  it("puts Iowa the right way round", () => {
    // Regression lock. Iowa was recorded as 3 Republicans and 1 Democrat; the
    // 2018 election returned the reverse, and that single transposition was the
    // whole of the national two-seat error.
    const iowa = US_HOUSE_2020.filter((r) => r.state === "IA");
    expect(iowa.find((r) => r.party === "democrat")?.seatsHeld).toBe(3);
    expect(iowa.find((r) => r.party === "republican")?.seatsHeld).toBe(1);
  });
  /**
   * An era file can define `config` and have it silently ignored.
   *
   * `ERA_COUNTRY_CONFIG_OVERRIDES` is the WIRING; the country folder is only the
   * data. `getCountryConfig` consults the table, so a country whose era file
   * defines a perfectly good override reaches nothing until someone also adds it
   * there. DE, IE and CN each carried a `1991-default` config that applied to
   * nothing, and the folder looked completely correct while it did.
   *
   * Reads the era files from disk rather than importing 29 `*_ERAS` barrels,
   * matching how `sentryExampleRemoved` and `historicalRosters` already assert
   * over the tree. The regex only has to spot a top-level `config:` key, which
   * is exactly the shape `gen-country-eras.ts` emits.
   */
  it("wires every era config override into the lookup table", () => {
    const root = path.join(process.cwd(), "src", "lib", "countries");
    const countries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "eras")))
      .map((entry) => entry.name);

    const unwired: string[] = [];
    for (const country of countries) {
      for (const preset of SHIPPING_PRESETS) {
        const file = path.join(root, country, "eras", `${preset.slice(0, 4)}.ts`);
        if (!fs.existsSync(file)) continue;
        if (!/^\s{2}config:\s*\{/m.test(fs.readFileSync(file, "utf-8"))) continue;
        const id = country.toUpperCase() as keyof (typeof ERA_COUNTRY_CONFIG_OVERRIDES)[string];
        if (ERA_COUNTRY_CONFIG_OVERRIDES[preset]?.[id] == null) {
          unwired.push(`${preset} ${country.toUpperCase()}`);
        }
      }
    }
    expect(unwired).toEqual([]);
  });
});
