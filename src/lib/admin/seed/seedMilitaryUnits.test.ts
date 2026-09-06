import { describe, it, expect } from "vitest";
import {
  getBranches,
  MILITARY_BRANCHES_BY_COUNTRY,
  isMilitaryEraActive,
} from "@/lib/constants/military";
import { ORDERS_OF_BATTLE } from "@/lib/seeds/reference/ordersOfBattle";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { buildCountryRoster } from "./seedMilitaryUnits";
import { seedRosterUpkeepFor } from "@/lib/military/seedRosterUpkeep";
import type { CountryId } from "@/lib/constants/countries";

describe("buildCountryRoster", () => {
  const regions = ["CA", "TX", "VA", "HI", "AK", "GA"];

  it("is deterministic for the same country", () => {
    const a = buildCountryRoster("US", regions, 1);
    const b = buildCountryRoster("US", regions, 1);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("emits unified fields, starts units in the reserve theater, and uses known branches", () => {
    const roster = buildCountryRoster("US", regions, 1);
    for (const unit of roster) {
      expect(unit.theaterId).toBe("reserve");
      expect(unit.assignedGeneralId).toBeNull();
      expect(unit.vet).toBeGreaterThanOrEqual(0);
      expect(unit.vet).toBeLessThanOrEqual(4);
      expect(unit.equipment).toHaveProperty("firepower");
      expect(unit.equipment).toHaveProperty("protection");
      expect(unit.equipment).toHaveProperty("support");
      // @ts-expect-error location is no longer part of the unified unit
      expect(unit.location).toBeUndefined();
      expect(["army", "navy", "airforce", "marines", "space"]).toContain(unit.branchId);
      expect(unit.readiness).toBeGreaterThanOrEqual(0);
      expect(unit.readiness).toBeLessThanOrEqual(100);
    }
  });

  it("returns empty for a country with no branches", () => {
    // BLR/BAL used to be the case here, but the union republics now field
    // republican garrison forces (see MILITARY_BRANCHES_BY_COUNTRY). The
    // seceded devolved nations are the remaining branchless countries.
    expect(buildCountryRoster("SCO", regions, 1)).toEqual([]);
  });

  it("returns empty when there are no regions to station in", () => {
    expect(buildCountryRoster("US", [], 1)).toEqual([]);
  });
});

describe("military branch era gating", () => {
  const year1953 = getStartingYearForPreset("1953-default");
  const year2019 = getStartingYearForPreset("2019-default");

  it("1953-default excludes Space Force and every post-1953 branch", () => {
    expect(year1953).toBe(1953);
    const us = getBranches("US", year1953).map((b) => b.id);
    expect(us).not.toContain("space");
    expect(us).toEqual(["army", "navy", "airforce", "marines"]);

    const cn = getBranches("CN", year1953).map((b) => b.id);
    expect(cn).not.toContain("rocket");
    expect(cn).not.toContain("ssf");
    expect(cn).toEqual(["pla", "plan", "plaaf"]);

    // Bundeswehr 1955 — West Germany is demilitarized in 1953.
    expect(getBranches("DE", year1953)).toEqual([]);
    // Empty branches → empty roster (no invented predecessor force).
    expect(buildCountryRoster("DE", ["NW", "BY", "BE"], 1, "1953", year1953)).toEqual([]);

    // DD fields nothing in 1953 — the NVA stands up in 1956.
    expect(getBranches("DD", year1953)).toEqual([]);
    expect(buildCountryRoster("DD", ["DD-BE", "DD-SN"], 1, "1953", year1953)).toEqual([]);

    // JSDF 1954 — 1953 seeds NSF / Coastal Safety Force predecessors instead.
    expect(
      getBranches("JP", year1953)
        .map((b) => b.id)
        .sort()
    ).toEqual(["csf", "nsf"]);

    for (const countryId of Object.keys(MILITARY_BRANCHES_BY_COUNTRY) as CountryId[]) {
      for (const branch of getBranches(countryId, year1953)) {
        expect(
          isMilitaryEraActive(branch, year1953),
          `${countryId}/${branch.id} must be active in 1953`
        ).toBe(true);
        if (branch.establishedYear != null) {
          expect(branch.establishedYear).toBeLessThanOrEqual(1953);
        }
      }
    }
  });

  it("2019-default yields the same modern branch set as an unfiltered catalog view", () => {
    expect(year2019).toBe(2019);
    // getBranches() without a year is the pre-gating modern view (dissolved
    // predecessors omitted). 2019 must match that set country-for-country.
    for (const countryId of Object.keys(MILITARY_BRANCHES_BY_COUNTRY) as CountryId[]) {
      expect(getBranches(countryId, year2019).map((b) => b.id)).toEqual(
        getBranches(countryId).map((b) => b.id)
      );
    }
    expect(getBranches("US", year2019).map((b) => b.id)).toEqual([
      "army",
      "navy",
      "airforce",
      "marines",
      "space",
    ]);
    expect(getBranches("CN", year2019).map((b) => b.id)).toEqual([
      "pla",
      "plan",
      "plaaf",
      "rocket",
      "ssf",
    ]);
    expect(getBranches("JP", year2019).map((b) => b.id)).toEqual(["jgsdf", "jmsdf", "jasdf"]);
    expect(getBranches("DE", year2019).map((b) => b.id)).toEqual(["heer", "marine", "luftwaffe"]);
  });

  it("1953 US roster never stations Space Force or drone units", () => {
    const roster = buildCountryRoster("US", ["CA", "TX", "VA"], 1, "1953", year1953);
    expect(roster.length).toBeGreaterThan(0);
    expect(roster.every((u) => u.branchId !== "space")).toBe(true);
    expect(roster.every((u) => u.domain !== "space")).toBe(true);
    expect(roster.every((u) => u.type !== "Drone Command")).toBe(true);
  });

  it("2019 US roster still includes Space Force stations", () => {
    const roster = buildCountryRoster("US", ["CA", "TX", "VA"], 1, "2019", year2019);
    expect(roster.some((u) => u.branchId === "space")).toBe(true);
  });
});

/**
 * Rosters produced by the RANDOM path, captured before any order of battle was
 * authored. These must not move: the r() sequence is shared across every
 * per-unit field, so reordering any draw silently rewrites them.
 *
 * Every one of these countries is authored now, so the test below un-authors
 * them for the duration. That is the point: the random path is still live for
 * any branch an era table does not name, and this is the only fixture that
 * pins it.
 */
const RANDOM_PATH_BASELINE: Record<string, string[]> = {
  US: [
    "army|Air Defense Battalion|4th Sentinel Air Defense Battalion|1|74|0",
    "army|Mechanized Brigade|1st Vanguard Mechanized Brigade|1|64|1",
    "army|Infantry Division|9th Falcon Infantry Division|0|86|3",
    "navy|Frigate Squadron|9th Sentinel Frigate Squadron|1|80|2",
    "navy|Frigate Squadron|2nd Bravo Frigate Squadron|1|97|2",
    "navy|Guided-Missile Destroyer|5th Falcon Guided-Missile Destroyer|1|93|3",
    "navy|Amphibious Group|2nd Trident Amphibious Group|1|61|0",
    "airforce|Air Defense Wing|2nd Sentinel Air Defense Wing|1|64|1",
    "airforce|Air Defense Wing|7th Aegis Air Defense Wing|1|61|1",
    "airforce|Airlift Wing|11th Alpha Airlift Wing|0|81|3",
    "marines|Littoral Combat Team|101st Alpha Littoral Combat Team|1|85|1",
    "marines|Marine Expeditionary Unit|2nd Iron Marine Expeditionary Unit|1|60|2",
    "marines|Marine Division|101st Thunder Marine Division|0|83|0",
  ],
  UK: [
    "army|Mechanized Brigade|101st Thunder Mechanized Brigade|1|82|2",
    "army|Mechanized Brigade|3rd Vanguard Mechanized Brigade|1|62|1",
    "army|Air Defense Battalion|101st Vanguard Air Defense Battalion|1|61|0",
    "navy|Attack Submarine|18th Sentinel Attack Submarine|1|90|1",
    "navy|Amphibious Group|1st Iron Amphibious Group|1|92|3",
    "navy|Attack Submarine|4th Sentinel Attack Submarine|0|82|0",
    "navy|Carrier Strike Group|11th Tempest Carrier Strike Group|1|67|0",
    "navy|Amphibious Group|11th Tempest Amphibious Group|1|84|1",
    "raf|Bomber Squadron|18th Vanguard Bomber Squadron|1|56|0",
    "raf|Fighter Wing|101st Aegis Fighter Wing|1|75|2",
    "raf|Airlift Wing|11th Tempest Airlift Wing|1|88|1",
  ],
  CN: [
    "pla|Artillery Regiment|3rd Vanguard Artillery Regiment|0|89|0",
    "pla|Mechanized Brigade|1st Trident Mechanized Brigade|1|88|3",
    "pla|Mechanized Brigade|4th Thunder Mechanized Brigade|0|78|1",
    "pla|Special Forces Group|12th Bravo Special Forces Group|1|62|2",
    "pla|Mechanized Brigade|1st Vanguard Mechanized Brigade|1|73|0",
    "plan|Guided-Missile Destroyer|7th Bravo Guided-Missile Destroyer|1|61|2",
    "plan|Attack Submarine|12th Alpha Attack Submarine|0|65|3",
    "plan|Guided-Missile Destroyer|1st Iron Guided-Missile Destroyer|1|60|1",
    "plan|Amphibious Group|101st Thunder Amphibious Group|1|65|1",
    "plan|Frigate Squadron|1st Bravo Frigate Squadron|1|57|3",
    "plaaf|Bomber Squadron|5th Trident Bomber Squadron|1|88|2",
    "plaaf|Bomber Squadron|24th Sentinel Bomber Squadron|0|59|1",
    "plaaf|Fighter Wing|3rd Thunder Fighter Wing|1|62|0",
    "plaaf|Air Defense Wing|24th Trident Air Defense Wing|1|64|3",
  ],
  DE: [],
  JP: [
    "nsf|Mechanized Brigade|7th Trident Mechanized Brigade|1|79|0",
    "nsf|Special Forces Group|11th Alpha Special Forces Group|1|95|1",
    "nsf|Infantry Division|82nd Vanguard Infantry Division|1|61|0",
    "nsf|Artillery Regiment|3rd Thunder Artillery Regiment|1|79|2",
    "csf|Amphibious Group|4th Vanguard Amphibious Group|1|67|2",
    "csf|Attack Submarine|82nd Alpha Attack Submarine|1|85|3",
    "csf|Frigate Squadron|2nd Bravo Frigate Squadron|1|87|2",
    "csf|Attack Submarine|5th Sentinel Attack Submarine|1|63|1",
  ],
  IE: [
    "army|Infantry Division|11th Iron Infantry Division|1|57|1",
    "army|Infantry Division|2nd Aegis Infantry Division|1|94|1",
    "army|Infantry Division|2nd Thunder Infantry Division|1|70|1",
    "army|Infantry Division|7th Tempest Infantry Division|0|68|3",
    "navy|Amphibious Group|3rd Sentinel Amphibious Group|1|95|2",
    "navy|Amphibious Group|4th Tempest Amphibious Group|1|79|3",
    "navy|Attack Submarine|24th Bravo Attack Submarine|1|63|2",
    "navy|Guided-Missile Destroyer|12th Alpha Guided-Missile Destroyer|1|92|2",
    "navy|Guided-Missile Destroyer|1st Tempest Guided-Missile Destroyer|1|78|0",
    "aircorps|Fighter Wing|82nd Iron Fighter Wing|1|67|3",
    "aircorps|Airlift Wing|5th Sentinel Airlift Wing|1|72|3",
    "aircorps|Fighter Wing|5th Thunder Fighter Wing|0|91|1",
    "aircorps|Air Defense Wing|2nd Falcon Air Defense Wing|1|69|2",
    "aircorps|Bomber Squadron|11th Bravo Bomber Squadron|1|64|1",
  ],
};

/** Runs `fn` with the named countries' authored rosters removed, then restores them. */
function withoutAuthoredRosters<T>(countryIds: string[], fn: () => T): T {
  const saved = countryIds.map((c) => [c, ORDERS_OF_BATTLE[c as CountryId]] as const);
  for (const [c] of saved) delete ORDERS_OF_BATTLE[c as CountryId];
  try {
    return fn();
  } finally {
    for (const [c, v] of saved) if (v) ORDERS_OF_BATTLE[c as CountryId] = v;
  }
}

describe("authored orders of battle", () => {
  const regions = ["r1", "r2"];

  it("seeds exactly the authored composition for Poland", () => {
    const roster = buildCountryRoster("PL", regions, 1, "1953", 1953);
    const counts = new Map<string, number>();
    for (const u of roster) {
      const key = `${u.branchId}|${u.type}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.get("ground|Infantry Division")).toBe(4);
    expect(counts.get("ground|Armored Division")).toBe(2);
    expect(counts.get("ground|Artillery Regiment")).toBe(2);
    expect(counts.get("navy|Frigate Squadron")).toBe(1);
    expect(counts.get("navy|Attack Submarine")).toBe(1);
    expect(counts.get("airforce|Fighter Wing")).toBe(3);
    expect(counts.get("airforce|Air Defense Wing")).toBe(1);
    expect(roster).toHaveLength(14);
  });

  it("is deterministic for an authored country", () => {
    const a = buildCountryRoster("RU", regions, 1, "1953", 1953);
    const b = buildCountryRoster("RU", regions, 1, "1953", 1953);
    expect(a).toEqual(b);
  });

  it("keeps random generation for a branch with no authored roster", () => {
    const roster = withoutAuthoredRosters(["US"], () =>
      buildCountryRoster("US", regions, 1, "1953", 1953)
    );
    // 4 era-active US branches in 1953 (no Space Force), 3-5 units each.
    expect(roster.length).toBeGreaterThanOrEqual(12);
    expect(roster.length).toBeLessThanOrEqual(20);
  });

  it("seeds the authored US composition instead of a random draw", () => {
    const roster = buildCountryRoster("US", regions, 1, "1953", 1953);
    expect(roster.length).toBe(48);
    // The absurdity this table exists to end: the 1953 US Navy has carriers.
    expect(roster.filter((u) => u.type === "Carrier Strike Group").length).toBe(3);
    expect(roster.filter((u) => u.type === "Marine Division").length).toBe(3);
  });

  it("seeds Ireland a neutral state's defence forces, not a great power's", () => {
    const ie = buildCountryRoster("IE", regions, 1, "1953", 1953);
    const us = buildCountryRoster("US", regions, 1, "1953", 1953);
    expect(ie.length).toBe(4);
    expect(ie.length).toBeLessThan(us.length);
    // The random draw gave Ireland guided-missile destroyers and a bomber wing.
    expect(ie.some((u) => u.type === "Guided-Missile Destroyer")).toBe(false);
    expect(ie.some((u) => u.type === "Bomber Squadron")).toBe(false);
  });

  it("resolves Japan to the National Safety Force in 1953 and the JSDF after 1954", () => {
    const nsf = buildCountryRoster("JP", regions, 1, "1953", 1953);
    expect(nsf.length).toBe(7);
    expect(nsf.every((u) => u.branchId === "nsf" || u.branchId === "csf")).toBe(true);
    const jsdf = buildCountryRoster("JP", regions, 1, "1979", 1979);
    expect(jsdf.some((u) => u.branchId === "jgsdf")).toBe(true);
    expect(jsdf.some((u) => u.branchId === "nsf")).toBe(false);
  });

  // Regression guard for the RNG-order hazard. Comparing two calls to the same
  // build proves nothing here — the baseline came from BEFORE the change.
  it("leaves the random path byte-identical to the pre-authoring baseline", () => {
    const ids = Object.keys(RANDOM_PATH_BASELINE);
    withoutAuthoredRosters(ids, () => {
      for (const [countryId, expected] of Object.entries(RANDOM_PATH_BASELINE)) {
        const got = buildCountryRoster(countryId, regions, 1, "1953", 1953).map(
          (u) => `${u.branchId}|${u.type}|${u.name}|${u.techTier}|${u.readiness}|${u.vet}`
        );
        expect(got, countryId).toEqual(expected);
      }
    });
  });

  it("still generates units for a branch the authored table does not name", () => {
    // RU's rocket force (1959) and space force (1992) cannot appear in a
    // 1953-pegged table, but must not vanish from a 1979+ game.
    const roster = buildCountryRoster("RU", regions, 1, "1979", 1979);
    expect(roster.some((u) => u.branchId === "rocket")).toBe(true);
    // Named branches still follow the authored counts.
    expect(roster.filter((u) => u.branchId === "pvo").length).toBe(5);
  });

  it("drops authored entries whose branch is not era-active", () => {
    // The NVA stands up in 1956, so a 1953 world seeds DD nothing.
    expect(buildCountryRoster("DD", regions, 1, "1953", 1953)).toEqual([]);
    expect(buildCountryRoster("DD", regions, 1, "1979", 1979).length).toBeGreaterThan(0);
  });

  it("caps tech tier to the era", () => {
    for (const u of buildCountryRoster("RU", regions, 1, "1953", 1953)) {
      expect(u.techTier).toBeLessThanOrEqual(1);
    }
  });
});

describe("starting rosters stay inside the defense envelope", () => {
  // The plan calibrated this for 1953 only. RU then went over budget in 1979,
  // 1991 and 2019, because the 1953-pegged table cannot name its 1959 rocket or
  // 1992 space force and those fell back to random generation on TOP of the
  // authored 49 units. A force that starts over budget fires the negative
  // budgetBalance branch and an over-budget warning at turn 1 — the exact state
  // the authored counts exist to avoid. Guards every country, every era.
  // Every era/country that seeds a roster must MEASURE a positive seed upkeep: that figure is
  // the denominator every country's upkeep burden is divided by, and a zero means a free army.
  it("every seeded roster measures a positive seed upkeep in its own era", () => {
    const unmeasurable: string[] = [];
    for (const [era, year] of [
      ["1953", 1953],
      ["1979", 1979],
      ["1991", 1991],
      ["2019", 2019],
    ] as Array<[string, number]>) {
      for (const countryId of Object.keys(ORDERS_OF_BATTLE) as CountryId[]) {
        if (getBranches(countryId, year).length === 0) continue;
        const roster = buildCountryRoster(countryId, ["r1", "r2"], 1, era, year);
        if (roster.length === 0) continue;
        // The old check compared this roster to DEFENSE_DISCRETIONARY_BASELINE, a flat
        // country-independent allowance that no longer exists. What matters now is that the
        // seeded roster is MEASURABLE: `seedRosterUpkeepFor` is the denominator every
        // country's upkeep burden is divided by, so a country whose seed measures zero gets a
        // free army — the exact bug that shipped when the preset fallback only looked
        // backwards and DD/DE/AT/NG seeded nothing in 1953.
        const measured = seedRosterUpkeepFor(`${era}-default`, countryId);
        if (!(measured > 0)) unmeasurable.push(`${era}/${countryId} measures no seed upkeep`);
      }
    }
    expect(unmeasurable).toEqual([]);
  });
});
