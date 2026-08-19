/**
 * Authored national orders of battle — the composition of a country's starting
 * force, replacing the random `3 + rand(3)` units per branch that
 * `buildCountryRoster` invents for unauthored countries.
 *
 * Composition ONLY. Unit names, veterancy, readiness, posture, XP and equipment
 * stay generated from the seeded RNG, so rosters remain deterministic.
 *
 * Canonical rosters are pegged to **1953** (not the 2019 default preset): DD, CS
 * and YU do not exist in 2019 at all, so 1953 is the only era in which a full
 * roster is meaningful for them. A country with no era override therefore fields
 * its 1953 composition in a later-era game — bounded, because `getUnitTypesForYear`
 * and `MAX_TECH_TIER_BY_ERA` still adapt equipment to the era.
 *
 * A branch NOT named by a country's table keeps random generation (see
 * `buildCountryRoster`) — a 1953 table cannot name RU's 1959 rocket force or
 * 1992 space force, and treating that silence as "seed nothing" would delete
 * those services from every later era.
 */
import type { CountryId } from "@/lib/constants/countries";

export interface OrderOfBattleEntry {
  /** Must match a Branch id for this country (`MILITARY_BRANCHES_BY_COUNTRY`). */
  branchId: string;
  /** Must match a UNIT_TYPES archetype in that branch's domain. */
  type: string;
  count: number;
}

/**
 * Canonical rosters, authored against the 1953 world.
 *
 * "1953" describes the calibration point, not an activation year: NG's entries
 * cannot apply before 1964, AT's before 1955 and DD's before 1956, because the
 * branch era gates drop them until then. The table is a composition target for
 * whenever those branches exist.
 */
export const ORDERS_OF_BATTLE: Partial<Record<CountryId, OrderOfBattleEntry[]>> = {
  RU: [
    { branchId: "ground", type: "Infantry Division", count: 12 },
    { branchId: "ground", type: "Armored Division", count: 5 },
    { branchId: "ground", type: "Mechanized Brigade", count: 5 },
    { branchId: "ground", type: "Artillery Regiment", count: 4 },
    { branchId: "ground", type: "Air Defense Battalion", count: 3 },
    { branchId: "navy", type: "Attack Submarine", count: 4 },
    { branchId: "navy", type: "Frigate Squadron", count: 3 },
    { branchId: "navy", type: "Amphibious Group", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 4 },
    { branchId: "airforce", type: "Bomber Squadron", count: 3 },
    { branchId: "pvo", type: "Air Defense Wing", count: 5 },
  ],
  DD: [
    { branchId: "landstreitkraefte", type: "Infantry Division", count: 3 },
    { branchId: "landstreitkraefte", type: "Mechanized Brigade", count: 2 },
    { branchId: "landstreitkraefte", type: "Artillery Regiment", count: 1 },
    { branchId: "volksmarine", type: "Frigate Squadron", count: 1 },
    { branchId: "luftstreitkraefte", type: "Fighter Wing", count: 2 },
    { branchId: "luftstreitkraefte", type: "Air Defense Wing", count: 1 },
  ],
  PL: [
    { branchId: "ground", type: "Infantry Division", count: 4 },
    { branchId: "ground", type: "Armored Division", count: 2 },
    { branchId: "ground", type: "Artillery Regiment", count: 2 },
    { branchId: "navy", type: "Frigate Squadron", count: 1 },
    { branchId: "navy", type: "Attack Submarine", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 3 },
    { branchId: "airforce", type: "Air Defense Wing", count: 1 },
  ],
  CS: [
    { branchId: "ground", type: "Infantry Division", count: 4 },
    { branchId: "ground", type: "Armored Division", count: 2 },
    { branchId: "ground", type: "Artillery Regiment", count: 2 },
    { branchId: "airforce", type: "Fighter Wing", count: 3 },
    { branchId: "airforce", type: "Air Defense Wing", count: 1 },
  ],
  HU: [
    { branchId: "ground", type: "Infantry Division", count: 3 },
    { branchId: "ground", type: "Mechanized Brigade", count: 2 },
    { branchId: "ground", type: "Artillery Regiment", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 2 },
  ],
  RO: [
    { branchId: "ground", type: "Infantry Division", count: 4 },
    { branchId: "ground", type: "Mechanized Brigade", count: 2 },
    { branchId: "ground", type: "Artillery Regiment", count: 2 },
    { branchId: "navy", type: "Frigate Squadron", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 2 },
  ],
  BG: [
    { branchId: "ground", type: "Infantry Division", count: 3 },
    { branchId: "ground", type: "Mechanized Brigade", count: 2 },
    { branchId: "ground", type: "Artillery Regiment", count: 1 },
    { branchId: "navy", type: "Frigate Squadron", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 2 },
  ],
  // Union republics. Deliberately thinner than the satellites: the real combat
  // power on this ground belonged to the Soviet military districts, which are
  // counted in RU's roster. What is authored here is the republican
  // establishment - garrison infantry, a fighter regiment, and coastal forces
  // where the republic has a coast. Double-counting the Kyiv or Baltic district
  // here would inflate Warsaw Pact strength by tens of divisions.
  UKR: [
    { branchId: "ground", type: "Infantry Division", count: 4 },
    { branchId: "ground", type: "Mechanized Brigade", count: 2 },
    { branchId: "ground", type: "Artillery Regiment", count: 2 },
    { branchId: "navy", type: "Frigate Squadron", count: 1 }, // Black Sea coastal
    { branchId: "airforce", type: "Fighter Wing", count: 2 },
  ],
  BLR: [
    { branchId: "ground", type: "Infantry Division", count: 3 },
    { branchId: "ground", type: "Mechanized Brigade", count: 1 },
    { branchId: "ground", type: "Artillery Regiment", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 1 },
  ],
  BAL: [
    { branchId: "ground", type: "Infantry Division", count: 2 },
    { branchId: "ground", type: "Artillery Regiment", count: 1 },
    // Weighted naval rather than ground: Tallinn, Riga and Liepaja were Baltic
    // Fleet bases, and the coast is what the republics were garrisoned for.
    { branchId: "navy", type: "Frigate Squadron", count: 1 },
    { branchId: "navy", type: "Attack Submarine", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 1 },
  ],
  YU: [
    { branchId: "ground", type: "Infantry Division", count: 5 },
    { branchId: "ground", type: "Armored Division", count: 1 },
    { branchId: "ground", type: "Artillery Regiment", count: 2 },
    { branchId: "ground", type: "Special Forces Group", count: 1 },
    { branchId: "navy", type: "Frigate Squadron", count: 1 },
    { branchId: "navy", type: "Attack Submarine", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 2 },
  ],
  NG: [
    { branchId: "army", type: "Infantry Division", count: 2 },
    { branchId: "army", type: "Artillery Regiment", count: 1 },
    { branchId: "navy", type: "Frigate Squadron", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 1 },
  ],
  FR: [
    { branchId: "terre", type: "Infantry Division", count: 5 },
    { branchId: "terre", type: "Armored Division", count: 3 },
    { branchId: "terre", type: "Artillery Regiment", count: 2 },
    // Arromanches (ex-HMS Colossus) was in French service from 1946, so a 1953
    // carrier is historically right despite the modern archetype label.
    { branchId: "marine", type: "Carrier Strike Group", count: 1 },
    { branchId: "marine", type: "Frigate Squadron", count: 3 },
    { branchId: "marine", type: "Attack Submarine", count: 2 },
    { branchId: "air", type: "Fighter Wing", count: 4 },
    { branchId: "air", type: "Bomber Squadron", count: 2 },
  ],
  IT: [
    { branchId: "esercito", type: "Infantry Division", count: 4 },
    { branchId: "esercito", type: "Armored Division", count: 2 },
    { branchId: "esercito", type: "Artillery Regiment", count: 2 },
    { branchId: "marina", type: "Frigate Squadron", count: 3 },
    { branchId: "marina", type: "Attack Submarine", count: 1 },
    { branchId: "aeronautica", type: "Fighter Wing", count: 3 },
  ],
  ES: [
    { branchId: "tierra", type: "Infantry Division", count: 4 },
    { branchId: "tierra", type: "Armored Division", count: 1 },
    { branchId: "tierra", type: "Artillery Regiment", count: 2 },
    { branchId: "armada", type: "Frigate Squadron", count: 2 },
    { branchId: "aire", type: "Fighter Wing", count: 2 },
  ],
  SE: [
    { branchId: "army", type: "Infantry Division", count: 3 },
    { branchId: "army", type: "Armored Division", count: 1 },
    { branchId: "army", type: "Artillery Regiment", count: 1 },
    { branchId: "navy", type: "Frigate Squadron", count: 2 },
    { branchId: "navy", type: "Attack Submarine", count: 2 },
    { branchId: "airforce", type: "Fighter Wing", count: 4 },
    { branchId: "airforce", type: "Air Defense Wing", count: 1 },
  ],
  TR: [
    { branchId: "ground", type: "Infantry Division", count: 6 },
    { branchId: "ground", type: "Armored Division", count: 1 },
    { branchId: "ground", type: "Artillery Regiment", count: 2 },
    { branchId: "navy", type: "Frigate Squadron", count: 2 },
    { branchId: "navy", type: "Attack Submarine", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 3 },
  ],
  GR: [
    { branchId: "army", type: "Infantry Division", count: 4 },
    { branchId: "army", type: "Artillery Regiment", count: 1 },
    { branchId: "navy", type: "Frigate Squadron", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 2 },
  ],
  AT: [
    { branchId: "heer", type: "Infantry Division", count: 2 },
    { branchId: "heer", type: "Artillery Regiment", count: 1 },
    { branchId: "luft", type: "Fighter Wing", count: 1 },
  ],
  FI: [
    { branchId: "army", type: "Infantry Division", count: 3 },
    { branchId: "army", type: "Artillery Regiment", count: 1 },
    { branchId: "navy", type: "Frigate Squadron", count: 1 },
    { branchId: "airforce", type: "Fighter Wing", count: 1 },
  ],
  BR: [
    { branchId: "exercito", type: "Infantry Division", count: 4 },
    { branchId: "exercito", type: "Armored Division", count: 1 },
    { branchId: "exercito", type: "Artillery Regiment", count: 1 },
    { branchId: "marinha", type: "Frigate Squadron", count: 2 },
    { branchId: "marinha", type: "Attack Submarine", count: 1 },
    { branchId: "aerea", type: "Fighter Wing", count: 2 },
  ],
};

/**
 * Era-specific overrides, keyed by era id (`eraForPreset` output: "1979",
 * "1991", "1999", "2007", "2019", "2023") then country.
 *
 * There is deliberately NO "1953" key — 1953 IS {@link ORDERS_OF_BATTLE}, and
 * duplicating it here would create two sources of truth for one era.
 *
 * RU authors 1979, 1991, and 2019 compositions (later-era branches the 1953
 * table cannot name). Every other country falls back to its 1953 composition
 * in later eras. No logic change is needed to add another country's override.
 */
export const ORDERS_OF_BATTLE_BY_ERA: Partial<
  Record<string, Partial<Record<CountryId, OrderOfBattleEntry[]>>>
> = {
  /**
   * RU is the one country whose 1953 composition does NOT survive the fallback
   * into later eras: `rocket` (1959) and `space` (1992) are unnamed in the
   * canonical table, so they would fall back to random generation. These
   * overrides keep those branches authored. The post-1959 Soviet Army is more
   * mechanised and missile-heavy than Stalin's; changing a count here re-scales
   * how far a player must grow the force before the budget bites (the seeded
   * roster is the upkeep baseline, not a cap).
   */
  // 5,944 upkeep-base — the 1979 baseline `seedRosterUpkeepFor` measures for RU.
  "1979": {
    RU: [
      { branchId: "ground", type: "Infantry Division", count: 8 },
      { branchId: "ground", type: "Armored Division", count: 5 },
      { branchId: "ground", type: "Mechanized Brigade", count: 5 },
      { branchId: "ground", type: "Artillery Regiment", count: 4 },
      { branchId: "ground", type: "Air Defense Battalion", count: 3 },
      { branchId: "navy", type: "Attack Submarine", count: 4 },
      { branchId: "navy", type: "Frigate Squadron", count: 3 },
      { branchId: "navy", type: "Amphibious Group", count: 1 },
      { branchId: "airforce", type: "Fighter Wing", count: 4 },
      { branchId: "airforce", type: "Bomber Squadron", count: 2 },
      { branchId: "pvo", type: "Air Defense Wing", count: 5 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 2 },
    ],
  },
  // The Warsaw Pact is intact in this era's RU force too; same composition.
  "1991": {
    RU: [
      { branchId: "ground", type: "Infantry Division", count: 8 },
      { branchId: "ground", type: "Armored Division", count: 5 },
      { branchId: "ground", type: "Mechanized Brigade", count: 5 },
      { branchId: "ground", type: "Artillery Regiment", count: 4 },
      { branchId: "ground", type: "Air Defense Battalion", count: 3 },
      { branchId: "navy", type: "Attack Submarine", count: 4 },
      { branchId: "navy", type: "Frigate Squadron", count: 3 },
      { branchId: "navy", type: "Amphibious Group", count: 1 },
      { branchId: "airforce", type: "Fighter Wing", count: 4 },
      { branchId: "airforce", type: "Bomber Squadron", count: 2 },
      { branchId: "pvo", type: "Air Defense Wing", count: 5 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 2 },
    ],
  },
  // Post-Soviet Russia: a smaller conventional army, the space forces stood up.
  // 5,879 upkeep-base — the 1991 baseline `seedRosterUpkeepFor` measures for RU.
  "2019": {
    RU: [
      { branchId: "ground", type: "Infantry Division", count: 6 },
      { branchId: "ground", type: "Armored Division", count: 4 },
      { branchId: "ground", type: "Mechanized Brigade", count: 4 },
      { branchId: "ground", type: "Artillery Regiment", count: 4 },
      { branchId: "ground", type: "Air Defense Battalion", count: 3 },
      { branchId: "navy", type: "Attack Submarine", count: 4 },
      { branchId: "navy", type: "Frigate Squadron", count: 3 },
      { branchId: "navy", type: "Amphibious Group", count: 1 },
      { branchId: "airforce", type: "Fighter Wing", count: 4 },
      { branchId: "airforce", type: "Bomber Squadron", count: 2 },
      { branchId: "pvo", type: "Air Defense Wing", count: 5 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 2 },
      { branchId: "space", type: "Orbital Surveillance Delta", count: 1 },
      { branchId: "space", type: "Space Defense Squadron", count: 1 },
    ],
  },
};

/**
 * The roster to seed for a country, or `null` when none is authored — the
 * caller's signal to fall back to legacy random generation.
 */
export function resolveOrderOfBattle(countryId: string, era?: string): OrderOfBattleEntry[] | null {
  const override = era ? ORDERS_OF_BATTLE_BY_ERA[era]?.[countryId as CountryId] : undefined;
  return override ?? ORDERS_OF_BATTLE[countryId as CountryId] ?? null;
}
