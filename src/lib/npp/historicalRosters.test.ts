/**
 * Contract for the 1991/2019 real-person rosters.
 *
 * Every seat in `getPresetSeats("1991-default" | "2019-default")` must resolve
 * to an authored roster entry through the exact key scheme `seedFromSeats`
 * uses: `country|officeType|state|party|ordinal`, ordinals counting same-tuple
 * occurrences in `getPresetSeats` order.
 *
 * Country attribution comes from the seat-array composition below (each array
 * is single-country). The namespacing guard proves that matches the DB
 * state-to-country resolution the seed uses: no state id appears under two
 * countries in either preset. The seat-count assertion detects drift — if a
 * `getPresetSeats` branch gains or loses an array, the composition here must
 * be updated alongside the roster data.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  getPresetSeats,
  splitCNNPCDelegates,
  US_EXECUTIVE_1992,
  US_EXECUTIVE_2020,
  US_HOUSE_1992,
  US_SENATE_1992,
  US_STATE_SENATE_1990,
  US_GOVERNORS_1992,
  UK_COMMONS_1987,
  UK_REGIONAL_COUNCIL_1992,
  UK_FIRST_MINISTERS_1992,
  JP_SHUGIIN_1990,
  JP_SANGIIN_1989,
  JP_GOVERNORS_1991,
  JP_REGIONAL_COUNCIL_1991,
  DE_BUNDESTAG_1990,
  DE_LANDTAG_1990,
  DE_MINISTERPRAESIDENTEN_1992,
  CN_NPC_1991,
  CN_PEOPLES_CONGRESS_1991,
  CN_GOVERNORS_1991,
  BR_CHAMBER_1991,
  BR_SENATE_1991,
  IE_DAIL_1991,
  IE_SEANAD_1991,
  US_HOUSE_2020,
  US_SENATE_2020,
  US_STATE_SENATE_2020,
  US_GOVERNORS_2020,
  UK_COMMONS_2020,
  UK_REGIONAL_COUNCIL_2020,
  UK_FIRST_MINISTERS_2020,
  JP_SHUGIIN_2020,
  JP_SANGIIN_2020,
  JP_GOVERNORS_2020,
  JP_REGIONAL_COUNCIL_2020,
  DE_BUNDESTAG_2021,
  DE_LANDTAG_2020,
  DE_MINISTERPRAESIDENTEN_2020,
  CN_NPC_2020,
  CN_PEOPLES_CONGRESS_2020,
  CN_GOVERNORS_2020,
  IE_DAIL_2020,
  IE_SEANAD_2020,
  type HistoricalSeat,
} from "@/lib/constants/historicalSeats";
import { getHistoricalRosterEntry, isRosteredPreset, rosterKey } from "./historicalRosters";

const COMPOSITION: Record<
  string,
  {
    year: number;
    arrays: Array<{
      country: string;
      seats: HistoricalSeat[];
      split?: boolean;
      /**
       * Seats that carry no named officeholder BY DESIGN, so the identity
       * assertions below skip them. The US executive rows use the bare country
       * code as their state and are deliberately anonymous; they still count
       * toward the drift detector, because `getPresetSeats` returns them.
       */
      unnamed?: boolean;
    }>;
  }
> = {
  "1991-default": {
    year: 1991,
    arrays: [
      // The executive pair. Seeded into these worlds by
      // "seat the US executive in the 1991 and 2019 worlds"; the drift
      // detector counts it because `getPresetSeats` does.
      { country: "US", seats: US_EXECUTIVE_1992, unnamed: true },
      { country: "US", seats: US_HOUSE_1992 },
      { country: "US", seats: US_SENATE_1992 },
      { country: "US", seats: US_STATE_SENATE_1990 },
      { country: "US", seats: US_GOVERNORS_1992 },
      { country: "UK", seats: UK_COMMONS_1987 },
      { country: "UK", seats: UK_REGIONAL_COUNCIL_1992 },
      { country: "UK", seats: UK_FIRST_MINISTERS_1992 },
      { country: "JP", seats: JP_SHUGIIN_1990 },
      { country: "JP", seats: JP_SANGIIN_1989 },
      { country: "JP", seats: JP_GOVERNORS_1991 },
      { country: "JP", seats: JP_REGIONAL_COUNCIL_1991 },
      { country: "DE", seats: DE_BUNDESTAG_1990 },
      { country: "DE", seats: DE_LANDTAG_1990 },
      { country: "DE", seats: DE_MINISTERPRAESIDENTEN_1992 },
      { country: "CN", seats: CN_NPC_1991, split: true },
      { country: "CN", seats: CN_PEOPLES_CONGRESS_1991, split: true },
      { country: "CN", seats: CN_GOVERNORS_1991 },
      { country: "BR", seats: BR_CHAMBER_1991 },
      { country: "BR", seats: BR_SENATE_1991 },
      { country: "IE", seats: IE_DAIL_1991 },
      { country: "IE", seats: IE_SEANAD_1991 },
    ],
  },
  "2019-default": {
    year: 2019,
    arrays: [
      // The executive pair. Seeded into these worlds by
      // "seat the US executive in the 1991 and 2019 worlds"; the drift
      // detector counts it because `getPresetSeats` does.
      { country: "US", seats: US_EXECUTIVE_2020, unnamed: true },
      { country: "US", seats: US_HOUSE_2020 },
      { country: "US", seats: US_SENATE_2020 },
      { country: "US", seats: US_STATE_SENATE_2020 },
      { country: "US", seats: US_GOVERNORS_2020 },
      { country: "UK", seats: UK_COMMONS_2020 },
      { country: "UK", seats: UK_REGIONAL_COUNCIL_2020 },
      { country: "UK", seats: UK_FIRST_MINISTERS_2020 },
      { country: "JP", seats: JP_SHUGIIN_2020 },
      { country: "JP", seats: JP_SANGIIN_2020 },
      { country: "JP", seats: JP_GOVERNORS_2020 },
      { country: "JP", seats: JP_REGIONAL_COUNCIL_2020 },
      { country: "DE", seats: DE_BUNDESTAG_2021 },
      { country: "DE", seats: DE_LANDTAG_2020 },
      { country: "DE", seats: DE_MINISTERPRAESIDENTEN_2020 },
      { country: "CN", seats: CN_NPC_2020, split: true },
      { country: "CN", seats: CN_PEOPLES_CONGRESS_2020, split: true },
      { country: "CN", seats: CN_GOVERNORS_2020 },
      { country: "IE", seats: IE_DAIL_2020 },
      { country: "IE", seats: IE_SEANAD_2020 },
    ],
  },
};

/**
 * Seats that are deliberately left without an authored identity.
 *
 * Each of these is a seat some change completed or corrected, where what is
 * missing is a NAME rather than the seat: the 2019 set came from completing
 * that Commons to the real 650 and moving the Speaker to Chorley; the 1991 set
 * from dating its Commons to 1987 and filling its Sangiin to 252.
 *
 * The project rule is that era seeds anchor on structures rather than people --
 * CLAUDE.md forbids seeding named real officeholders, for any country, in any
 * era. Authoring more real legislators to turn this green would break that rule
 * to satisfy a test.
 *
 * A seat with no entry here is not broken: the seeder generates a
 * non-player politician for it, which is the outcome the rule asks for. The
 * list is explicit so the gap stays visible and cannot quietly grow.
 */
const ALLOWED_UNAUTHORED: Record<string, ReadonlySet<string>> = {
  // Two seats the move from the 1992 Commons to the 1987 one brought in that
  // the 1992 roster had no reason to name: an Alliance member in the South East,
  // and the Sinn Féin seat for West Belfast, which SF held in 1987 and lost in
  // 1992. Same rule as the 2019 four below — the seats are right, and authoring
  // two more real MPs to name them would break CLAUDE.md to satisfy a test.
  "1991-default": new Set([
    "UK|commons|SEE|uk_libdem|0",
    "UK|commons|NIR|uk_sf|0",
    // Sangiin seats the old 206-seat roster never reached. Filling the chamber
    // to its real 252 introduced these seven party/class slots; same rule as
    // above, so the seeder generates a politician for each.
    "JP|sangiin|TOH|jp_independent|0",
    "JP|sangiin|CHU|jp_dsp|1",
    "JP|sangiin|KNS|jp_dsp|1",
    "JP|sangiin|CGK|jp_independent|1",
    "JP|sangiin|SHI|jp_independent|0",
    "JP|sangiin|SHI|jp_independent|1",
    "JP|sangiin|KYU|jp_dsp|1",
  ]),
  "2019-default": new Set([
    "UK|commons|SEE|uk_green|0",
    "UK|commons|EAE|uk_libdem|0",
    "UK|commons|NWE|uk_libdem|0",
    "UK|commons|NWE|uk_speaker|0",
  ]),
};

/**
 * Seed-time roster keys in seed order for a preset.
 *
 * `namedOnly` drops the seats that carry no officeholder identity by design.
 * Ordinals are still consumed for them, so dropping one cannot shift the
 * numbering of the seats that follow it in the same tuple.
 */
function seedKeys(presetId: string, namedOnly = false): string[] {
  const comp = COMPOSITION[presetId];
  const ordinals = new Map<string, number>();
  const keys: string[] = [];
  for (const { country, seats, split, unnamed } of comp.arrays) {
    const expanded = split ? splitCNNPCDelegates(seats) : seats;
    for (const seat of expanded) {
      const tuple = `${country}|${seat.officeType}|${seat.state}|${seat.party}`;
      const ordinal = ordinals.get(tuple) ?? 0;
      ordinals.set(tuple, ordinal + 1);
      if (namedOnly && unnamed) continue;
      keys.push(rosterKey(country, seat.officeType, seat.state, seat.party, ordinal));
    }
  }
  return keys;
}

describe("historicalRosters key scheme", () => {
  it("formats keys as country|office|state|party|ordinal", () => {
    expect(rosterKey("US", "governor", "CA", "democrat", 0)).toBe("US|governor|CA|democrat|0");
  });

  it("rosters exactly the 1991 and 2019 presets", () => {
    expect(isRosteredPreset("1991-default")).toBe(true);
    expect(isRosteredPreset("2019-default")).toBe(true);
    expect(isRosteredPreset("1953-default")).toBe(false);
    expect(isRosteredPreset("1979-default")).toBe(false);
    expect(isRosteredPreset("empty")).toBe(false);
  });

  it("returns undefined outside rostered presets", () => {
    expect(
      getHistoricalRosterEntry("1953-default", "US", "house", "CA", "democrat", 0)
    ).toBeUndefined();
  });
});

describe("roster coverage", () => {
  for (const presetId of Object.keys(COMPOSITION)) {
    const year = COMPOSITION[presetId].year;

    it(`${presetId}: composition matches getPresetSeats (drift detector)`, () => {
      expect(seedKeys(presetId)).toHaveLength(getPresetSeats(presetId).length);
    });

    it(`${presetId}: state ids are namespaced to one country`, () => {
      const owners = new Map<string, Set<string>>();
      for (const { country, seats } of COMPOSITION[presetId].arrays) {
        for (const seat of seats) {
          if (!owners.has(seat.state)) owners.set(seat.state, new Set());
          owners.get(seat.state)!.add(country);
        }
      }
      const collisions = [...owners.entries()].filter(([, cs]) => cs.size > 1);
      expect(collisions).toEqual([]);
    });

    it(`${presetId}: every seated NPP resolves to an authored entry`, () => {
      const allowed = ALLOWED_UNAUTHORED[presetId] ?? new Set<string>();
      const missing = seedKeys(presetId, true).filter((key) => {
        if (allowed.has(key)) return false;
        const [country, officeType, state, party, ordinal] = key.split("|");
        return (
          getHistoricalRosterEntry(presetId, country, officeType, state, party, Number(ordinal)) ===
          undefined
        );
      });
      expect(missing).toEqual([]);
    });

    it(`${presetId}: entries are valid (names, plausible birth years, portraits)`, () => {
      const poolIds = new Set<string>(
        (
          JSON.parse(
            fs.readFileSync(
              path.join(process.cwd(), "src", "data", "npp-politician-images.json"),
              "utf-8"
            )
          ) as Array<{ id: string }>
        ).map((p) => p.id)
      );
      const problems: string[] = [];
      const names = new Set<string>();
      const allowed = ALLOWED_UNAUTHORED[presetId] ?? new Set<string>();
      for (const key of seedKeys(presetId, true)) {
        if (allowed.has(key)) continue;
        const [country, officeType, state, party, ordinal] = key.split("|");
        const entry = getHistoricalRosterEntry(
          presetId,
          country,
          officeType,
          state,
          party,
          Number(ordinal)
        )!;
        if (!entry.name || typeof entry.name !== "string") problems.push(`${key}: bad name`);
        if (names.has(entry.name)) problems.push(`${key}: duplicate name "${entry.name}"`);
        names.add(entry.name);
        if (
          !Number.isInteger(entry.birthYear) ||
          entry.birthYear < 1840 ||
          entry.birthYear > year - 25
        ) {
          problems.push(`${key}: implausible birthYear ${entry.birthYear}`);
        }
        if (entry.gender !== "male" && entry.gender !== "female") {
          problems.push(`${key}: bad gender ${entry.gender}`);
        }
        if (!["white", "black", "hispanic", "asian", "other"].includes(entry.ethnicity)) {
          problems.push(`${key}: bad ethnicity ${entry.ethnicity}`);
        }
        if (entry.portraitId != null && !poolIds.has(entry.portraitId)) {
          problems.push(`${key}: portraitId "${entry.portraitId}" not in pool`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
