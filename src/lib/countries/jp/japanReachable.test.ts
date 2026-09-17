import { describe, expect, it } from "vitest";
import { getCountryConfig, COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getCabinetIdentity } from "@/lib/constants/cabinetIdentity";
import { getNationalIdentity } from "@/lib/constants/nationalIdentity";
import { getTreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { COUNTRY_CONTINENT } from "@/lib/constants/countryContinents";
import { COUNTRY_TO_ISO_NUMERIC, ISO_NUMERIC_TO_COUNTRY } from "@/lib/constants/countryIso";
import { REP_ECON } from "@/lib/era/legislationCostCatalog";
import { NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY } from "@/lib/turn/gdpGrowth";
import { LEGISLATIVE_PROCESS } from "@/lib/legislature/process";
import { STATE_ADJACENCY } from "@/lib/constants/stateAdjacency";
import { TOTAL_JP_SHUGIIN_SEATS, TOTAL_JP_SANGIIN_SEATS } from "@/lib/constants/states";
import { COUNTRY_READINESS_EXPECTATIONS } from "@/lib/constants/countryReadinessExpectations";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { CORE5_NORMALS } from "@/lib/era/metricCatalog";
import { REGION_ROSTERS } from "@/lib/demographics/substrateCoverage";
import { SHIPPING_PRESETS } from "@/lib/world/eraRoster";
import { ORDERS_BY_COUNTRY } from "@/lib/constants/cabinetOrders";
import { MECHANICS_BY_COUNTRY } from "@/lib/constants/cabinetMechanics";

/**
 * JAPAN IS STILL REACHABLE THROUGH THE REGISTRIES CONSUMERS ACTUALLY USE.
 *
 * ⚠️ THIS IS THE CHECK THAT SURVIVED. Through D2-D6 a committed fixture,
 * `__snapshots__/jp.pre-move.json`, proved the FOLDER held the right values. It
 * said nothing about whether anything still REACHED them -- two different
 * failures, and it caught only one. D7 deleted it: with the move finished it
 * pinned a world that no longer exists, so the first legitimate edit to Japan's
 * data would have failed it, and the only fix available would have been to
 * rewrite the fixture -- at which point it proved nothing at all.
 *
 * This file is what replaced it. That is why the expected values below are
 * written out inline rather than read from anywhere.
 *
 * ⚠️ WHY IT MATTERS MOST NOW. 51 of 74 moved registries are
 * `Partial<Record<CountryId, X>>`. Dropping Japan's key from one of those is NOT
 * a type error -- the registry is still valid, Japan just silently stops
 * existing in it. Nothing else in this repo catches that: typecheck is happy and
 * the folder still holds the data, so every check that looks AT the folder
 * passes. Only a check that looks THROUGH a registry fails, and this is it.
 *
 * ⚠️ EXPECTED VALUES ARE INLINE, DELIBERATELY. They were transcribed from the
 * pre-move snapshot while it still existed, precisely so this test would outlive
 * it. A permanent regression test cannot depend on a fixture that is going away.
 *
 * These are ANCHORS, not a full inventory: one value per subject area, chosen so
 * that a whole registry going missing fails loudly. Adding Japan facts does not
 * require adding assertions here.
 */
describe("Japan is reachable through its registries", () => {
  it("resolves through the country config accessor", () => {
    expect(getCountryConfig("JP").name).toBe("Japan");
    expect(getCountryConfig("JP").legislature.lowerChamber.seats).toBe(465);
    // The era overrides are the ones a shallow merge can silently empty.
    expect(getCountryConfig("JP", "1953-default").legislature.lowerChamber.seats).toBe(466);
    expect(getCountryConfig("JP", "1991-default").legislature.lowerChamber.seats).toBe(512);
    expect(getCountryConfig("JP", "1991-default").legislature.upperChamber?.seats).toBe(252);
    // Preserved through the merge rather than replaced wholesale.
    expect(getCountryConfig("JP", "1953-default").legislature.name).toBe("Kokkai");
    expect(COUNTRY_CONFIGS.JP).toBeDefined();
  });

  it("resolves identity through its accessors", () => {
    expect(getCabinetIdentity("JP").glyph).toBe("日");
    expect(getNationalIdentity("JP").name).toBe("Japan National Corporation");
    // DERIVED from TREASURY_TEXT plus the national palette: proves the
    // composition still runs, not just that the text moved.
    expect(getTreasuryIdentity("JP").budgetTitle).toBe("国家予算");
    expect(getTreasuryIdentity("JP").palette).toBe(getNationalIdentity("JP").palette);
  });

  it("resolves the economy constants", () => {
    expect(COUNTRY_CURRENCY_MAP.JP).toBe("JPY");
    // Balance surface: a changed number here is not a refactor.
    expect(REP_ECON.JP).toEqual({ gdp: 550_000_000_000_000, population: 126_000_000 });
    expect(NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY.JP).toBe(10);
  });

  it("resolves geography, including both halves of the ISO pair", () => {
    expect(COUNTRY_CONTINENT.JP).toBe("Asia");
    expect(COUNTRY_TO_ISO_NUMERIC.JP).toBe("392");
    // ⚠️ The inverse is a separate registry. If the two drift, a lookup by code
    // and a lookup by country disagree about the same single fact.
    expect(ISO_NUMERIC_TO_COUNTRY["392"]).toBe("JP");
    expect(Object.keys(STATE_ADJACENCY.JP)).toHaveLength(8);
  });

  it("resolves institutions and the seat tables", () => {
    expect(LEGISLATIVE_PROCESS.JP?.executive.title).toBe("The Emperor");
    expect(TOTAL_JP_SHUGIIN_SEATS).toBe(465);
    expect(TOTAL_JP_SANGIIN_SEATS).toBe(248);
    // The readiness expectation is derived from the two chambers; if it and the
    // seat tables disagree, one of them moved wrong.
    expect(COUNTRY_READINESS_EXPECTATIONS.JP?.seatMin).toBe(
      TOTAL_JP_SHUGIIN_SEATS + TOTAL_JP_SANGIIN_SEATS
    );
    expect(COUNTRY_READINESS_EXPECTATIONS.JP?.extras).toHaveLength(1);
    expect(typeof COUNTRY_READINESS_EXPECTATIONS.JP?.extras?.[0]).toBe("function");
  });

  it("resolves the cabinet data the file moves made forward on their own", () => {
    // These were never edited: relocating their source modules is what made the
    // registries forward. "It should still work" is the assumption being tested.
    expect(Object.keys(ORDERS_BY_COUNTRY.JP ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(MECHANICS_BY_COUNTRY.JP ?? {}).length).toBeGreaterThan(0);
  });

  it("resolves per-era seed data through its accessors", () => {
    // ⚠️ Signature is (countryId, REGION id, preset) -- passing the preset as the
    // second argument silently returns null rather than erroring, which is how
    // this assertion first "passed" against nothing.
    const hok1979 = getRegionCensusData("JP", "HOK", "1979-default");
    const hok2019 = getRegionCensusData("JP", "HOK", "2019-default");
    expect(hok1979, "no 1979 census for HOK").not.toBeNull();
    expect(hok2019, "no 2019 census for HOK").not.toBeNull();
    // ⚠️ `toBe`, not `toEqual`. These registries hold module REFERENCES, and an
    // early D5 draft replaced them with generated copies -- deep equality passed
    // while Japan quietly gained a second source for every census bundle. The
    // 1979 record must not be an alias of the 2019 one.
    expect(hok1979).not.toBe(hok2019);
    expect(getRegionMetricPresets("JP", "HOK", "1979-default")).not.toBeNull();
    // Every shipping preset has a roster thunk. Asserted against
    // SHIPPING_PRESETS rather than a literal: upstream's 2027 preset arrived
    // mid-branch and a hard-coded 7 would have had to be found by hand.
    expect(Object.keys(REGION_ROSTERS.JP ?? {})).toHaveLength(SHIPPING_PRESETS.length);
  });

  it("keeps the shared metric fallbacks that belong to every country", () => {
    // ⚠️ CORE5_NORMALS is metric-first. Japan's slices moved; `global` did not,
    // and it is what every country without its own anchors falls back to.
    for (const metric of [
      "gdpGrowth",
      "unemploymentRate",
      "lifeExpectancy",
      "violentCrimeRate",
      "povertyRate",
    ]) {
      expect(CORE5_NORMALS[metric]?.JP, `${metric}.JP`).toBeDefined();
      expect(CORE5_NORMALS[metric]?.global, `${metric}.global`).toBeDefined();
    }
  });
});
