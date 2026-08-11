import { describe, expect, it } from "vitest";
import {
  US_STATE_SENATE_1990,
  UK_REGIONAL_COUNCIL_1992,
  JP_REGIONAL_COUNCIL_1991,
  DE_LANDTAG_1990,
  DE_LANDTAG_2020,
  getPresetSeats,
} from "./historicalSeats";
import { states } from "@/lib/seeds/reference/states";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { deRegions } from "@/lib/seeds/de/deRegions";

describe("US_STATE_SENATE_1990", () => {
  // Build a lookup of configured chamber sizes from the canonical state seed,
  // so we catch any future drift (e.g. a state's `stateSenateSeats` changes
  // without the historical dataset being updated to match).
  const usStateSenateSize = new Map(
    states.filter((s) => s.countryId === "US").map((s) => [s._id, s.stateSenateSeats])
  );

  it("covers every US state except Nebraska and DC", () => {
    const covered = new Set(US_STATE_SENATE_1990.map((seat) => seat.state));
    // NE: unicameral nonpartisan. DC: federal district, no state senate
    // (DC Council is a unicameral 13-seat body modeled with seats: 0).
    const skip = new Set(["NE", "DC"]);
    const expected = [...usStateSenateSize.keys()].filter((id) => !skip.has(id));
    for (const stateId of expected) {
      expect(covered.has(stateId), `missing 1990 state senate data for ${stateId}`).toBe(true);
    }
    expect(covered.has("NE"), "Nebraska should be omitted (unicameral nonpartisan)").toBe(false);
    expect(covered.has("DC"), "DC should be omitted (no state senate)").toBe(false);
  });

  it("per-state seat totals match the configured stateSenateSeats", () => {
    const totals = new Map<string, number>();
    for (const seat of US_STATE_SENATE_1990) {
      expect(seat.officeType).toBe("stateSenate");
      expect(seat.seatsHeld, `seatsHeld missing on ${seat.state}/${seat.party}`).toBeGreaterThan(0);
      totals.set(seat.state, (totals.get(seat.state) ?? 0) + (seat.seatsHeld ?? 0));
    }
    for (const [stateId, total] of totals) {
      const expectedSize = usStateSenateSize.get(stateId);
      expect(
        total,
        `${stateId} 1990 state senate totals (${total}) must equal configured size (${expectedSize})`
      ).toBe(expectedSize);
    }
  });

  it("uses only known party slugs", () => {
    const allowed = new Set(["democrat", "republican", "independent"]);
    for (const seat of US_STATE_SENATE_1990) {
      expect(allowed.has(seat.party), `unknown party slug "${seat.party}" in ${seat.state}`).toBe(
        true
      );
    }
  });
});

describe("UK_REGIONAL_COUNCIL_1992", () => {
  // The regional council seat count lives in `stateSenateSeats` for UK
  // regions (per the comment in ukRegions.ts — UK regions have no separate
  // state-level upper chamber, so that slot stores the regional council
  // size). Matching against that ensures gameplay chamber sizes line up.
  const ukRegionalCouncilSize = new Map(ukRegions.map((r) => [r._id, r.stateSenateSeats]));

  it("covers every UK region", () => {
    const covered = new Set(UK_REGIONAL_COUNCIL_1992.map((seat) => seat.state));
    for (const regionId of ukRegionalCouncilSize.keys()) {
      expect(covered.has(regionId), `missing 1992 regional council data for ${regionId}`).toBe(
        true
      );
    }
  });

  it("per-region seat totals match the configured regional council size", () => {
    const totals = new Map<string, number>();
    for (const seat of UK_REGIONAL_COUNCIL_1992) {
      expect(seat.officeType).toBe("regionalCouncil");
      expect(seat.seatsHeld, `seatsHeld missing on ${seat.state}/${seat.party}`).toBeGreaterThan(0);
      totals.set(seat.state, (totals.get(seat.state) ?? 0) + (seat.seatsHeld ?? 0));
    }
    for (const [regionId, total] of totals) {
      const expectedSize = ukRegionalCouncilSize.get(regionId);
      expect(
        total,
        `${regionId} 1992 regional council totals (${total}) must equal configured size (${expectedSize})`
      ).toBe(expectedSize);
    }
  });

  it("uses only UK-eligible party slugs", () => {
    // Union of:
    //  - Default UK parties available in 1991-default (uk_labour, uk_conservative,
    //    uk_libdem, uk_snp, uk_plaid, uk_dup, uk_uup, uk_sf, uk_independent)
    //  - Slugs preserved as historical attribution even if not seeded as default
    //    parties (uk_sdlp, uk_alliance — fall back to independent via the
    //    seedHistorical resolver, matching UK_COMMONS_1992's convention)
    const allowed = new Set([
      "uk_labour",
      "uk_conservative",
      "uk_libdem",
      "uk_snp",
      "uk_plaid",
      "uk_dup",
      "uk_uup",
      "uk_sf",
      "uk_sdlp",
      "uk_alliance",
      "uk_independent",
    ]);
    for (const seat of UK_REGIONAL_COUNCIL_1992) {
      expect(
        allowed.has(seat.party),
        `unknown UK party slug "${seat.party}" in ${seat.state}`
      ).toBe(true);
    }
  });
});

describe("JP_REGIONAL_COUNCIL_1991", () => {
  // Like UK, JP regions use `stateSenateSeats` to store the regional council
  // (prefectural assembly aggregate) seat count.
  const jpRegionalCouncilSize = new Map(jpRegions.map((r) => [r._id, r.stateSenateSeats]));

  it("covers every JP region", () => {
    const covered = new Set(JP_REGIONAL_COUNCIL_1991.map((seat) => seat.state));
    for (const regionId of jpRegionalCouncilSize.keys()) {
      expect(covered.has(regionId), `missing 1991 regional council data for ${regionId}`).toBe(
        true
      );
    }
  });

  it("per-region seat totals match the configured regional council size", () => {
    const totals = new Map<string, number>();
    for (const seat of JP_REGIONAL_COUNCIL_1991) {
      expect(seat.officeType).toBe("regionalCouncil");
      expect(seat.seatsHeld, `seatsHeld missing on ${seat.state}/${seat.party}`).toBeGreaterThan(0);
      totals.set(seat.state, (totals.get(seat.state) ?? 0) + (seat.seatsHeld ?? 0));
    }
    for (const [regionId, total] of totals) {
      const expectedSize = jpRegionalCouncilSize.get(regionId);
      expect(
        total,
        `${regionId} 1991 regional council totals (${total}) must equal configured size (${expectedSize})`
      ).toBe(expectedSize);
    }
  });

  it("uses only 1991-era JP party slugs", () => {
    // 1991-era JP defaults: LDP, JSP (1991-only), Komeito, JCP, DSP (1991-only),
    // jp_independent. Excludes CDP / DPFP / Ishin which are 2019-era parties.
    const allowed = new Set([
      "jp_ldp",
      "jp_jsp",
      "jp_komeito",
      "jp_jcp",
      "jp_dsp",
      "jp_independent",
    ]);
    for (const seat of JP_REGIONAL_COUNCIL_1991) {
      expect(
        allowed.has(seat.party),
        `unknown JP party slug "${seat.party}" in ${seat.state}`
      ).toBe(true);
    }
  });
});

describe("DE_LANDTAG_1990", () => {
  // DE Länder store Landtag seat counts in `stateSenateSeats` (matches the
  // UK/JP convention — no separate sub-national upper chamber).
  const deLandtagSize = new Map(deRegions.map((r) => [r._id, r.stateSenateSeats]));

  it("covers every DE Land", () => {
    const covered = new Set(DE_LANDTAG_1990.map((seat) => seat.state));
    for (const landId of deLandtagSize.keys()) {
      expect(covered.has(landId), `missing 1990 Landtag data for ${landId}`).toBe(true);
    }
  });

  it("per-Land seat totals match the configured Landtag size", () => {
    const totals = new Map<string, number>();
    for (const seat of DE_LANDTAG_1990) {
      expect(seat.officeType).toBe("landtag");
      expect(seat.seatsHeld, `seatsHeld missing on ${seat.state}/${seat.party}`).toBeGreaterThan(0);
      totals.set(seat.state, (totals.get(seat.state) ?? 0) + (seat.seatsHeld ?? 0));
    }
    for (const [landId, total] of totals) {
      const expectedSize = deLandtagSize.get(landId);
      expect(
        total,
        `${landId} 1990 Landtag totals (${total}) must equal configured size (${expectedSize})`
      ).toBe(expectedSize);
    }
  });

  it("uses only 1990-era DE party slugs", () => {
    // 1990-era DE defaults: CDU, CSU (Bayern only), SPD, FDP, Grüne, PDS
    // (1991-only, East German Länder + Berlin). Linke/AfD are post-1990
    // parties and don't appear here. de_independent absorbs SSW (Schleswig
    // minority party) and STATT (Hamburg local).
    const allowed = new Set([
      "de_cdu",
      "de_csu",
      "de_spd",
      "de_fdp",
      "de_greens",
      "de_pds",
      "de_independent",
    ]);
    for (const seat of DE_LANDTAG_1990) {
      expect(
        allowed.has(seat.party),
        `unknown DE party slug "${seat.party}" in ${seat.state}`
      ).toBe(true);
    }
  });

  it("CSU appears only in Bayern (and CDU does not)", () => {
    // Sanity check: CSU is Bayern-only, CDU is everywhere else. Mixing the
    // two in the same Land would be a data-entry bug.
    const csuByLand = new Map<string, number>();
    const cduByLand = new Map<string, number>();
    for (const seat of DE_LANDTAG_1990) {
      if (seat.party === "de_csu") csuByLand.set(seat.state, (csuByLand.get(seat.state) ?? 0) + 1);
      if (seat.party === "de_cdu") cduByLand.set(seat.state, (cduByLand.get(seat.state) ?? 0) + 1);
    }
    expect([...csuByLand.keys()]).toEqual(["BY"]);
    expect(cduByLand.has("BY"), "CDU should not appear in Bayern (CSU territory)").toBe(false);
  });

  it("PDS appears only in former-GDR Länder + Berlin", () => {
    // Sanity check: PDS was the East German successor to the SED and
    // didn't have meaningful Western representation in 1990. Berlin
    // counts as PDS-eligible because of East Berlin.
    const allowedPDS = new Set(["BE", "BB", "MV", "SN", "ST", "TH"]);
    for (const seat of DE_LANDTAG_1990) {
      if (seat.party !== "de_pds") continue;
      expect(
        allowedPDS.has(seat.state),
        `PDS should not appear in Western Land ${seat.state}`
      ).toBe(true);
    }
  });
});

describe("DE_LANDTAG_2020", () => {
  const deLandtagSize = new Map(deRegions.map((r) => [r._id, r.stateSenateSeats]));

  it("covers every DE Land", () => {
    const covered = new Set(DE_LANDTAG_2020.map((seat) => seat.state));
    for (const landId of deLandtagSize.keys()) {
      expect(covered.has(landId), `missing 2020 Landtag data for ${landId}`).toBe(true);
    }
  });

  it("per-Land seat totals match the configured Landtag size", () => {
    const totals = new Map<string, number>();
    for (const seat of DE_LANDTAG_2020) {
      expect(seat.officeType).toBe("landtag");
      expect(seat.seatsHeld, `seatsHeld missing on ${seat.state}/${seat.party}`).toBeGreaterThan(0);
      totals.set(seat.state, (totals.get(seat.state) ?? 0) + (seat.seatsHeld ?? 0));
    }
    for (const [landId, total] of totals) {
      const expectedSize = deLandtagSize.get(landId);
      expect(
        total,
        `${landId} 2020 Landtag totals (${total}) must equal configured size (${expectedSize})`
      ).toBe(expectedSize);
    }
  });

  it("uses only 2019-era DE party slugs (incl. AfD + Linke)", () => {
    // 2019-era DE defaults: CDU, CSU (Bayern only), SPD, FDP, Grüne,
    // Linke, AfD. PDS is 1991-only — must not appear here. Local lists
    // (SSW, BVB/FW, Freie Wähler) fold into de_independent.
    const allowed = new Set([
      "de_cdu",
      "de_csu",
      "de_spd",
      "de_fdp",
      "de_greens",
      "de_linke",
      "de_afd",
      "de_independent",
    ]);
    for (const seat of DE_LANDTAG_2020) {
      expect(
        allowed.has(seat.party),
        `unknown DE party slug "${seat.party}" in ${seat.state}`
      ).toBe(true);
    }
  });

  it("CSU appears only in Bayern (same invariant as 1990)", () => {
    const csuByLand = new Map<string, number>();
    const cduByLand = new Map<string, number>();
    for (const seat of DE_LANDTAG_2020) {
      if (seat.party === "de_csu") csuByLand.set(seat.state, (csuByLand.get(seat.state) ?? 0) + 1);
      if (seat.party === "de_cdu") cduByLand.set(seat.state, (cduByLand.get(seat.state) ?? 0) + 1);
    }
    expect([...csuByLand.keys()]).toEqual(["BY"]);
    expect(cduByLand.has("BY"), "CDU should not appear in Bayern (CSU territory)").toBe(false);
  });

  it("PDS is absent (PDS merged into Die Linke in 2007 — no longer a default party)", () => {
    for (const seat of DE_LANDTAG_2020) {
      expect(seat.party).not.toBe("de_pds");
    }
  });
});

describe("getPresetSeats('2019-default')", () => {
  it("includes DE_LANDTAG_2020", () => {
    const seats = getPresetSeats("2019-default");
    const landtagSeats = seats.filter((s) => s.officeType === "landtag");
    expect(landtagSeats.length).toBe(DE_LANDTAG_2020.length);
  });
});

describe("getPresetSeats('1991-default')", () => {
  it("includes US_STATE_SENATE_1990 alongside the existing 1991 datasets", () => {
    const seats = getPresetSeats("1991-default");
    const stateSenateSeats = seats.filter((s) => s.officeType === "stateSenate");
    // Should match the dataset exactly: every 1990 state senate seat surfaces.
    expect(stateSenateSeats.length).toBe(US_STATE_SENATE_1990.length);
  });

  it("includes UK_REGIONAL_COUNCIL_1992 + JP_REGIONAL_COUNCIL_1991 regional council seats", () => {
    const seats = getPresetSeats("1991-default");
    const regionalCouncilSeats = seats.filter((s) => s.officeType === "regionalCouncil");
    expect(regionalCouncilSeats.length).toBe(
      UK_REGIONAL_COUNCIL_1992.length + JP_REGIONAL_COUNCIL_1991.length
    );
  });

  it("includes DE_LANDTAG_1990 alongside the existing 1991 datasets", () => {
    const seats = getPresetSeats("1991-default");
    const landtagSeats = seats.filter((s) => s.officeType === "landtag");
    expect(landtagSeats.length).toBe(DE_LANDTAG_1990.length);
  });
});
