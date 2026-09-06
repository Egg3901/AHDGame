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
  // ── The powers that had no authored roster until now ─────────────────────
  //
  // Before this table existed for them, `buildCountryRoster` invented 3-5 random
  // units per branch, which put Ireland (14 units, 927 power, two guided-missile
  // destroyers and a bomber squadron) ahead of the United States (13 units, 767
  // power, no aircraft carrier) in the 1953 world. Composition is now authored
  // for every country that fields a force in any era.

  /**
   * Korean-War peak. 20 Army divisions and 3 Marine divisions were under arms,
   * SAC was the strategic arm (the US has no `rocket` branch: the bomb rode
   * bombers until the missile age, and the catalogue models that), and the fleet
   * ran ~16 Essex-class carriers. Guided-missile ships are deliberately absent:
   * USS Boston, the first, converted in 1955.
   */
  US: [
    { branchId: "army", type: "Infantry Division", count: 8 },
    { branchId: "army", type: "Armored Division", count: 4 },
    { branchId: "army", type: "Artillery Regiment", count: 3 },
    { branchId: "army", type: "Air Defense Battalion", count: 2 },
    // 10th Special Forces Group activated 1952: the first, and era-correct.
    { branchId: "army", type: "Special Forces Group", count: 1 },
    { branchId: "navy", type: "Carrier Strike Group", count: 3 },
    { branchId: "navy", type: "Attack Submarine", count: 3 },
    { branchId: "navy", type: "Frigate Squadron", count: 3 },
    { branchId: "navy", type: "Amphibious Group", count: 2 },
    { branchId: "airforce", type: "Fighter Wing", count: 5 },
    { branchId: "airforce", type: "Bomber Squadron", count: 5 },
    { branchId: "airforce", type: "Airlift Wing", count: 3 },
    { branchId: "airforce", type: "Air Defense Wing", count: 2 },
    // Exactly the three divisions the Marine Corps fielded in 1953.
    { branchId: "marines", type: "Marine Division", count: 3 },
    { branchId: "marines", type: "Marine Expeditionary Unit", count: 1 },
  ],
  /**
   * National Service still running: a large conscript army, six fleet carriers,
   * and Bomber Command working up to the V-force. Clearly the third power, well
   * ahead of France, well behind the US and USSR.
   */
  UK: [
    { branchId: "army", type: "Infantry Division", count: 6 },
    { branchId: "army", type: "Armored Division", count: 2 },
    { branchId: "army", type: "Artillery Regiment", count: 2 },
    { branchId: "navy", type: "Carrier Strike Group", count: 2 },
    { branchId: "navy", type: "Attack Submarine", count: 2 },
    { branchId: "navy", type: "Frigate Squadron", count: 4 },
    { branchId: "navy", type: "Amphibious Group", count: 1 },
    { branchId: "raf", type: "Fighter Wing", count: 4 },
    { branchId: "raf", type: "Bomber Squadron", count: 3 },
    { branchId: "raf", type: "Air Defense Wing", count: 1 },
    { branchId: "raf", type: "Airlift Wing", count: 1 },
  ],
  /**
   * The Bundeswehr's establishment shape. Like NG, AT and DD, this is a
   * composition target rather than an activation year: the branches carry
   * establishedYear 1955, so a 1953 world correctly seeds Germany nothing and
   * this table first applies once the Bundeswehr exists.
   *
   * No bomber squadron, in any era. The Luftwaffe was rebuilt as a defensive
   * and tactical air force under the Paris Accords, and never operated a
   * strategic bombing arm.
   */
  DE: [
    { branchId: "heer", type: "Infantry Division", count: 5 },
    { branchId: "heer", type: "Armored Division", count: 4 },
    { branchId: "heer", type: "Mechanized Brigade", count: 3 },
    { branchId: "heer", type: "Artillery Regiment", count: 2 },
    { branchId: "heer", type: "Air Defense Battalion", count: 2 },
    // A Baltic coastal navy: frigates and small submarines, no capital ships.
    { branchId: "marine", type: "Frigate Squadron", count: 3 },
    { branchId: "marine", type: "Attack Submarine", count: 2 },
    { branchId: "luftwaffe", type: "Fighter Wing", count: 4 },
    { branchId: "luftwaffe", type: "Air Defense Wing", count: 2 },
    { branchId: "luftwaffe", type: "Airlift Wing", count: 1 },
  ],
  /**
   * Names BOTH the 1952-54 National Safety Force and the JSDF that replaced it,
   * and lets the branch era gates choose. A 1953 world resolves to the NSF/CSF
   * entries alone (7 units, an internal-security force under occupation-era
   * constraints); every later world resolves to the JSDF entries alone.
   *
   * No bomber squadron and no carrier before 2019, in any era: Article 9 barred
   * offensive platforms, and the JMSDF's post-war shape is ASW escorts and
   * submarines pointed at the Soviet Pacific Fleet.
   */
  JP: [
    { branchId: "nsf", type: "Infantry Division", count: 4 },
    { branchId: "nsf", type: "Artillery Regiment", count: 1 },
    { branchId: "csf", type: "Frigate Squadron", count: 2 },
    { branchId: "jgsdf", type: "Infantry Division", count: 5 },
    { branchId: "jgsdf", type: "Mechanized Brigade", count: 2 },
    { branchId: "jgsdf", type: "Artillery Regiment", count: 2 },
    { branchId: "jgsdf", type: "Air Defense Battalion", count: 1 },
    { branchId: "jmsdf", type: "Frigate Squadron", count: 4 },
    { branchId: "jmsdf", type: "Attack Submarine", count: 2 },
    { branchId: "jmsdf", type: "Guided-Missile Destroyer", count: 1 },
    { branchId: "jasdf", type: "Fighter Wing", count: 4 },
    { branchId: "jasdf", type: "Air Defense Wing", count: 2 },
    { branchId: "jasdf", type: "Airlift Wing", count: 1 },
  ],
  /**
   * A neutral state with a Permanent Defence Force of about eight thousand, three
   * corvettes and a handful of Vampires. Four units total, below Austria and
   * Finland, which is the point. The random fallback had Ireland outgunning the
   * United States.
   */
  IE: [
    { branchId: "army", type: "Infantry Division", count: 1 },
    { branchId: "army", type: "Artillery Regiment", count: 1 },
    { branchId: "navy", type: "Frigate Squadron", count: 1 },
    { branchId: "aircorps", type: "Fighter Wing", count: 1 },
  ],
  /**
   * Straight out of Korea: infantry mass, almost no armour, a coastal navy that
   * barely existed, and a MiG-15 air force that had just fought the USAF. The
   * largest army on the board by headcount and one of the lowest in power per
   * man. The Second Artillery Corps is 1966, so no rocket branch here.
   */
  CN: [
    { branchId: "pla", type: "Infantry Division", count: 16 },
    { branchId: "pla", type: "Artillery Regiment", count: 4 },
    { branchId: "pla", type: "Mechanized Brigade", count: 2 },
    { branchId: "plan", type: "Frigate Squadron", count: 2 },
    { branchId: "plaaf", type: "Fighter Wing", count: 5 },
    { branchId: "plaaf", type: "Bomber Squadron", count: 1 },
  ],
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

/** RU's Cold War force. 1979 and 1991 are the same Soviet Army: one table, two eras. */
const RU_COLD_WAR: OrderOfBattleEntry[] = [
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
];

/**
 * The British force after the 2010 SDSR and the Queen Elizabeth class. Two
 * carriers again from 2017, no bomber arm since Tornado, drones from Reaper.
 * 2019 and 2023 are the same force.
 */
const UK_MODERN: OrderOfBattleEntry[] = [
  { branchId: "army", type: "Infantry Division", count: 1 },
  { branchId: "army", type: "Armored Division", count: 2 },
  { branchId: "army", type: "Mechanized Brigade", count: 3 },
  { branchId: "army", type: "Artillery Regiment", count: 1 },
  { branchId: "army", type: "Special Forces Group", count: 1 },
  { branchId: "navy", type: "Carrier Strike Group", count: 2 },
  { branchId: "navy", type: "Attack Submarine", count: 3 },
  { branchId: "navy", type: "Guided-Missile Destroyer", count: 2 },
  { branchId: "navy", type: "Frigate Squadron", count: 2 },
  { branchId: "navy", type: "Amphibious Group", count: 1 },
  { branchId: "raf", type: "Fighter Wing", count: 3 },
  { branchId: "raf", type: "Airlift Wing", count: 1 },
  { branchId: "raf", type: "Drone Command", count: 2 },
];

/** Ireland during the Troubles: a slightly larger army, still four aircraft. */
const IE_TROUBLES: OrderOfBattleEntry[] = [
  { branchId: "army", type: "Infantry Division", count: 1 },
  { branchId: "army", type: "Mechanized Brigade", count: 1 },
  { branchId: "army", type: "Artillery Regiment", count: 1 },
  { branchId: "navy", type: "Frigate Squadron", count: 1 },
  { branchId: "aircorps", type: "Fighter Wing", count: 1 },
  { branchId: "aircorps", type: "Airlift Wing", count: 1 },
];

/**
 * Ireland after 1999, when the Air Corps retired the Fouga Magister and the
 * state stopped operating armed jets entirely. No fighter wing in any later
 * era: an air arm of transports and patrol aircraft, which is what it is.
 */
const IE_MODERN: OrderOfBattleEntry[] = [
  { branchId: "army", type: "Infantry Division", count: 1 },
  { branchId: "army", type: "Mechanized Brigade", count: 1 },
  { branchId: "army", type: "Artillery Regiment", count: 1 },
  { branchId: "navy", type: "Frigate Squadron", count: 1 },
  { branchId: "aircorps", type: "Airlift Wing", count: 1 },
];

/**
 * Era-specific overrides, keyed by era id (`eraForPreset` output: "1979",
 * "1991", "1999", "2007", "2019", "2023") then country.
 *
 * There is deliberately NO "1953" key — 1953 IS {@link ORDERS_OF_BATTLE}, and
 * duplicating it here would create two sources of truth for one era.
 *
 * Every era is now authored for every country that changes shape across the
 * Cold War and after it: US, UK, DE, JP, IE, CN and RU. A country absent from
 * an era key falls back to its 1953 composition, which is the right answer for
 * the ones whose force structure genuinely did not move (the Warsaw Pact
 * satellites dissolve before the later eras; FR/IT/ES/SE/TR/GR/AT/FI/BR/NG keep
 * a stable establishment).
 *
 * Two rules the tables must respect, both enforced by `buildCountryRoster`:
 *  - An unnamed branch falls back to RANDOM generation, so any branch a country
 *    has in an era must appear here or accept 3-5 invented units. RU's rocket
 *    force is why: a 1953-pegged table cannot name a 1959 branch.
 *  - A branch named ONLY with archetypes that do not exist yet in that era also
 *    falls back to random. Space archetypes are gated at 2019, so no space entry
 *    may appear in an earlier key even though RU's Space Forces date from 1992.
 */
export const ORDERS_OF_BATTLE_BY_ERA: Partial<
  Record<string, Partial<Record<CountryId, OrderOfBattleEntry[]>>>
> = {
  "1979": {
    /**
     * The 16-division Cold War Army, 13 carriers, and the guided-missile fleet
     * that did not exist in 1953. Sits ~11% above the Soviet force in total
     * power: the US is the stronger power on aggregate, the USSR keeps the
     * larger ground army, which is the shape of the actual 1979 balance.
     */
    US: [
      { branchId: "army", type: "Infantry Division", count: 4 },
      { branchId: "army", type: "Armored Division", count: 5 },
      { branchId: "army", type: "Mechanized Brigade", count: 3 },
      { branchId: "army", type: "Artillery Regiment", count: 2 },
      { branchId: "army", type: "Air Defense Battalion", count: 2 },
      { branchId: "army", type: "Special Forces Group", count: 1 },
      { branchId: "navy", type: "Carrier Strike Group", count: 3 },
      { branchId: "navy", type: "Attack Submarine", count: 4 },
      { branchId: "navy", type: "Guided-Missile Destroyer", count: 3 },
      { branchId: "navy", type: "Frigate Squadron", count: 2 },
      { branchId: "navy", type: "Amphibious Group", count: 2 },
      { branchId: "airforce", type: "Fighter Wing", count: 5 },
      { branchId: "airforce", type: "Bomber Squadron", count: 3 },
      { branchId: "airforce", type: "Airlift Wing", count: 3 },
      { branchId: "airforce", type: "Air Defense Wing", count: 2 },
      { branchId: "marines", type: "Marine Division", count: 2 },
      { branchId: "marines", type: "Marine Expeditionary Unit", count: 2 },
    ],
    /** BAOR-weighted: four divisions in Germany, Polaris boats, no fleet carrier. */
    UK: [
      { branchId: "army", type: "Infantry Division", count: 3 },
      { branchId: "army", type: "Armored Division", count: 3 },
      { branchId: "army", type: "Mechanized Brigade", count: 2 },
      { branchId: "army", type: "Artillery Regiment", count: 2 },
      { branchId: "navy", type: "Carrier Strike Group", count: 1 },
      { branchId: "navy", type: "Attack Submarine", count: 4 },
      { branchId: "navy", type: "Guided-Missile Destroyer", count: 2 },
      { branchId: "navy", type: "Frigate Squadron", count: 3 },
      { branchId: "navy", type: "Amphibious Group", count: 1 },
      { branchId: "raf", type: "Fighter Wing", count: 4 },
      { branchId: "raf", type: "Bomber Squadron", count: 2 },
      { branchId: "raf", type: "Air Defense Wing", count: 1 },
      { branchId: "raf", type: "Airlift Wing", count: 1 },
    ],
    /** The Bundeswehr at its peak: twelve divisions, 495,000 men, NATO's largest European army. */
    DE: [
      { branchId: "heer", type: "Infantry Division", count: 5 },
      { branchId: "heer", type: "Armored Division", count: 4 },
      { branchId: "heer", type: "Mechanized Brigade", count: 4 },
      { branchId: "heer", type: "Artillery Regiment", count: 2 },
      { branchId: "heer", type: "Air Defense Battalion", count: 3 },
      { branchId: "marine", type: "Frigate Squadron", count: 3 },
      { branchId: "marine", type: "Attack Submarine", count: 3 },
      { branchId: "marine", type: "Guided-Missile Destroyer", count: 1 },
      { branchId: "luftwaffe", type: "Fighter Wing", count: 5 },
      { branchId: "luftwaffe", type: "Air Defense Wing", count: 2 },
      { branchId: "luftwaffe", type: "Airlift Wing", count: 1 },
    ],
    /** Thirteen JGSDF divisions and an ASW fleet aimed at the Soviet Pacific Fleet. */
    JP: [
      { branchId: "jgsdf", type: "Infantry Division", count: 6 },
      { branchId: "jgsdf", type: "Mechanized Brigade", count: 2 },
      { branchId: "jgsdf", type: "Artillery Regiment", count: 2 },
      { branchId: "jgsdf", type: "Air Defense Battalion", count: 2 },
      { branchId: "jmsdf", type: "Frigate Squadron", count: 5 },
      { branchId: "jmsdf", type: "Attack Submarine", count: 3 },
      { branchId: "jmsdf", type: "Guided-Missile Destroyer", count: 2 },
      { branchId: "jasdf", type: "Fighter Wing", count: 4 },
      { branchId: "jasdf", type: "Air Defense Wing", count: 2 },
      { branchId: "jasdf", type: "Airlift Wing", count: 1 },
    ],
    IE: IE_TROUBLES,
    /** Still an infantry-mass army, now with the Second Artillery Corps (1966). */
    CN: [
      { branchId: "pla", type: "Infantry Division", count: 14 },
      { branchId: "pla", type: "Armored Division", count: 2 },
      { branchId: "pla", type: "Mechanized Brigade", count: 3 },
      { branchId: "pla", type: "Artillery Regiment", count: 4 },
      { branchId: "plan", type: "Frigate Squadron", count: 3 },
      { branchId: "plan", type: "Attack Submarine", count: 2 },
      { branchId: "plaaf", type: "Fighter Wing", count: 5 },
      { branchId: "plaaf", type: "Bomber Squadron", count: 2 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 2 },
    ],
    RU: RU_COLD_WAR,
  },
  "1991": {
    /** Desert Storm: the peak of American conventional power against a collapsing USSR. */
    US: [
      { branchId: "army", type: "Infantry Division", count: 4 },
      { branchId: "army", type: "Armored Division", count: 5 },
      { branchId: "army", type: "Mechanized Brigade", count: 4 },
      { branchId: "army", type: "Artillery Regiment", count: 2 },
      { branchId: "army", type: "Air Defense Battalion", count: 2 },
      { branchId: "army", type: "Special Forces Group", count: 2 },
      { branchId: "navy", type: "Carrier Strike Group", count: 4 },
      { branchId: "navy", type: "Attack Submarine", count: 4 },
      { branchId: "navy", type: "Guided-Missile Destroyer", count: 3 },
      { branchId: "navy", type: "Frigate Squadron", count: 2 },
      { branchId: "navy", type: "Amphibious Group", count: 2 },
      { branchId: "airforce", type: "Fighter Wing", count: 5 },
      { branchId: "airforce", type: "Bomber Squadron", count: 3 },
      { branchId: "airforce", type: "Airlift Wing", count: 3 },
      { branchId: "airforce", type: "Air Defense Wing", count: 2 },
      { branchId: "marines", type: "Marine Division", count: 2 },
      { branchId: "marines", type: "Marine Expeditionary Unit", count: 2 },
    ],
    /** Options for Change begins: the army starts shrinking, the fleet holds. */
    UK: [
      { branchId: "army", type: "Infantry Division", count: 2 },
      { branchId: "army", type: "Armored Division", count: 3 },
      { branchId: "army", type: "Mechanized Brigade", count: 2 },
      { branchId: "army", type: "Artillery Regiment", count: 2 },
      { branchId: "navy", type: "Carrier Strike Group", count: 1 },
      { branchId: "navy", type: "Attack Submarine", count: 4 },
      { branchId: "navy", type: "Guided-Missile Destroyer", count: 2 },
      { branchId: "navy", type: "Frigate Squadron", count: 3 },
      { branchId: "navy", type: "Amphibious Group", count: 1 },
      { branchId: "raf", type: "Fighter Wing", count: 4 },
      { branchId: "raf", type: "Bomber Squadron", count: 2 },
      { branchId: "raf", type: "Air Defense Wing", count: 1 },
      { branchId: "raf", type: "Airlift Wing", count: 1 },
    ],
    /** Reunification year: the Bundeswehr absorbs the NVA and immediately begins cutting. */
    DE: [
      { branchId: "heer", type: "Infantry Division", count: 4 },
      { branchId: "heer", type: "Armored Division", count: 4 },
      { branchId: "heer", type: "Mechanized Brigade", count: 4 },
      { branchId: "heer", type: "Artillery Regiment", count: 2 },
      { branchId: "heer", type: "Air Defense Battalion", count: 2 },
      { branchId: "marine", type: "Frigate Squadron", count: 3 },
      { branchId: "marine", type: "Attack Submarine", count: 3 },
      { branchId: "marine", type: "Guided-Missile Destroyer", count: 1 },
      { branchId: "luftwaffe", type: "Fighter Wing", count: 5 },
      { branchId: "luftwaffe", type: "Air Defense Wing", count: 2 },
      { branchId: "luftwaffe", type: "Airlift Wing", count: 1 },
    ],
    /** Bubble-era budgets: the JMSDF grows into one of the largest escort fleets afloat. */
    JP: [
      { branchId: "jgsdf", type: "Infantry Division", count: 6 },
      { branchId: "jgsdf", type: "Mechanized Brigade", count: 2 },
      { branchId: "jgsdf", type: "Artillery Regiment", count: 2 },
      { branchId: "jgsdf", type: "Air Defense Battalion", count: 2 },
      { branchId: "jmsdf", type: "Frigate Squadron", count: 5 },
      { branchId: "jmsdf", type: "Attack Submarine", count: 4 },
      { branchId: "jmsdf", type: "Guided-Missile Destroyer", count: 3 },
      { branchId: "jasdf", type: "Fighter Wing", count: 4 },
      { branchId: "jasdf", type: "Air Defense Wing", count: 2 },
      { branchId: "jasdf", type: "Airlift Wing", count: 1 },
    ],
    IE: IE_TROUBLES,
    /** Post-Deng: the four-million-man army is being cut, modernisation is slow. */
    CN: [
      { branchId: "pla", type: "Infantry Division", count: 12 },
      { branchId: "pla", type: "Armored Division", count: 2 },
      { branchId: "pla", type: "Mechanized Brigade", count: 4 },
      { branchId: "pla", type: "Artillery Regiment", count: 4 },
      { branchId: "plan", type: "Frigate Squadron", count: 3 },
      { branchId: "plan", type: "Attack Submarine", count: 3 },
      { branchId: "plaaf", type: "Fighter Wing", count: 5 },
      { branchId: "plaaf", type: "Bomber Squadron", count: 2 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 3 },
    ],
    RU: RU_COLD_WAR,
  },
  "1999": {
    /**
     * The peace dividend: ten Army divisions, the Reaper's ancestors entering
     * service (Predator, 1995), and the strategic bomber fleet cut hard.
     */
    US: [
      { branchId: "army", type: "Infantry Division", count: 3 },
      { branchId: "army", type: "Armored Division", count: 4 },
      { branchId: "army", type: "Mechanized Brigade", count: 3 },
      { branchId: "army", type: "Artillery Regiment", count: 2 },
      { branchId: "army", type: "Air Defense Battalion", count: 1 },
      { branchId: "army", type: "Special Forces Group", count: 2 },
      { branchId: "navy", type: "Carrier Strike Group", count: 4 },
      { branchId: "navy", type: "Attack Submarine", count: 3 },
      { branchId: "navy", type: "Guided-Missile Destroyer", count: 4 },
      { branchId: "navy", type: "Frigate Squadron", count: 1 },
      { branchId: "navy", type: "Amphibious Group", count: 2 },
      { branchId: "airforce", type: "Fighter Wing", count: 5 },
      { branchId: "airforce", type: "Bomber Squadron", count: 2 },
      { branchId: "airforce", type: "Airlift Wing", count: 3 },
      { branchId: "airforce", type: "Air Defense Wing", count: 1 },
      { branchId: "airforce", type: "Drone Command", count: 1 },
      { branchId: "marines", type: "Marine Division", count: 2 },
      { branchId: "marines", type: "Marine Expeditionary Unit", count: 2 },
    ],
    /** After the 1998 Strategic Defence Review. */
    UK: [
      { branchId: "army", type: "Infantry Division", count: 2 },
      { branchId: "army", type: "Armored Division", count: 2 },
      { branchId: "army", type: "Mechanized Brigade", count: 2 },
      { branchId: "army", type: "Artillery Regiment", count: 1 },
      { branchId: "navy", type: "Carrier Strike Group", count: 1 },
      { branchId: "navy", type: "Attack Submarine", count: 3 },
      { branchId: "navy", type: "Guided-Missile Destroyer", count: 2 },
      { branchId: "navy", type: "Frigate Squadron", count: 3 },
      { branchId: "navy", type: "Amphibious Group", count: 1 },
      { branchId: "raf", type: "Fighter Wing", count: 3 },
      { branchId: "raf", type: "Bomber Squadron", count: 1 },
      { branchId: "raf", type: "Air Defense Wing", count: 1 },
      { branchId: "raf", type: "Airlift Wing", count: 1 },
    ],
    /** Cut to 330,000 after reunification; conscription still running. */
    DE: [
      { branchId: "heer", type: "Infantry Division", count: 3 },
      { branchId: "heer", type: "Armored Division", count: 3 },
      { branchId: "heer", type: "Mechanized Brigade", count: 3 },
      { branchId: "heer", type: "Artillery Regiment", count: 1 },
      { branchId: "heer", type: "Air Defense Battalion", count: 1 },
      { branchId: "marine", type: "Frigate Squadron", count: 2 },
      { branchId: "marine", type: "Attack Submarine", count: 2 },
      { branchId: "marine", type: "Guided-Missile Destroyer", count: 1 },
      { branchId: "luftwaffe", type: "Fighter Wing", count: 4 },
      { branchId: "luftwaffe", type: "Air Defense Wing", count: 1 },
      { branchId: "luftwaffe", type: "Airlift Wing", count: 1 },
    ],
    JP: [
      { branchId: "jgsdf", type: "Infantry Division", count: 5 },
      { branchId: "jgsdf", type: "Mechanized Brigade", count: 2 },
      { branchId: "jgsdf", type: "Artillery Regiment", count: 1 },
      { branchId: "jgsdf", type: "Air Defense Battalion", count: 2 },
      { branchId: "jmsdf", type: "Frigate Squadron", count: 4 },
      { branchId: "jmsdf", type: "Attack Submarine", count: 4 },
      { branchId: "jmsdf", type: "Guided-Missile Destroyer", count: 3 },
      { branchId: "jasdf", type: "Fighter Wing", count: 4 },
      { branchId: "jasdf", type: "Air Defense Wing", count: 2 },
      { branchId: "jasdf", type: "Airlift Wing", count: 1 },
    ],
    IE: IE_MODERN,
    /** After the Gulf War shock and the 1996 Strait crisis: doctrine turns, hardware lags. */
    CN: [
      { branchId: "pla", type: "Infantry Division", count: 10 },
      { branchId: "pla", type: "Armored Division", count: 2 },
      { branchId: "pla", type: "Mechanized Brigade", count: 4 },
      { branchId: "pla", type: "Artillery Regiment", count: 3 },
      { branchId: "plan", type: "Frigate Squadron", count: 3 },
      { branchId: "plan", type: "Attack Submarine", count: 3 },
      { branchId: "plan", type: "Guided-Missile Destroyer", count: 1 },
      { branchId: "plaaf", type: "Fighter Wing", count: 5 },
      { branchId: "plaaf", type: "Bomber Squadron", count: 2 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 3 },
      { branchId: "rocket", type: "Cruise Missile Regiment", count: 2 },
    ],
    /**
     * The weakest the Russian army has ever been: unpaid, unsupplied, losing in
     * Chechnya. Roughly 70% of the Soviet force it inherited. No space entry:
     * the Space Forces exist from 1992 but every space archetype is gated at
     * 2019, and naming a branch with only future archetypes falls back to random.
     */
    RU: [
      { branchId: "ground", type: "Infantry Division", count: 6 },
      { branchId: "ground", type: "Armored Division", count: 3 },
      { branchId: "ground", type: "Mechanized Brigade", count: 3 },
      { branchId: "ground", type: "Artillery Regiment", count: 3 },
      { branchId: "ground", type: "Air Defense Battalion", count: 2 },
      { branchId: "navy", type: "Attack Submarine", count: 3 },
      { branchId: "navy", type: "Frigate Squadron", count: 2 },
      { branchId: "navy", type: "Amphibious Group", count: 1 },
      { branchId: "airforce", type: "Fighter Wing", count: 3 },
      { branchId: "airforce", type: "Bomber Squadron", count: 2 },
      { branchId: "pvo", type: "Air Defense Wing", count: 3 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 2 },
    ],
  },
  "2007": {
    /** The counter-insurgency decade: fewer heavy divisions, far more SOF and drones. */
    US: [
      { branchId: "army", type: "Infantry Division", count: 4 },
      { branchId: "army", type: "Armored Division", count: 3 },
      { branchId: "army", type: "Mechanized Brigade", count: 4 },
      { branchId: "army", type: "Artillery Regiment", count: 1 },
      { branchId: "army", type: "Air Defense Battalion", count: 1 },
      { branchId: "army", type: "Special Forces Group", count: 3 },
      { branchId: "navy", type: "Carrier Strike Group", count: 4 },
      { branchId: "navy", type: "Attack Submarine", count: 3 },
      { branchId: "navy", type: "Guided-Missile Destroyer", count: 5 },
      { branchId: "navy", type: "Frigate Squadron", count: 1 },
      { branchId: "navy", type: "Amphibious Group", count: 2 },
      { branchId: "airforce", type: "Fighter Wing", count: 5 },
      { branchId: "airforce", type: "Bomber Squadron", count: 2 },
      { branchId: "airforce", type: "Airlift Wing", count: 3 },
      { branchId: "airforce", type: "Air Defense Wing", count: 1 },
      { branchId: "airforce", type: "Drone Command", count: 3 },
      { branchId: "marines", type: "Marine Division", count: 2 },
      { branchId: "marines", type: "Marine Expeditionary Unit", count: 3 },
    ],
    UK: [
      { branchId: "army", type: "Infantry Division", count: 2 },
      { branchId: "army", type: "Armored Division", count: 2 },
      { branchId: "army", type: "Mechanized Brigade", count: 2 },
      { branchId: "army", type: "Artillery Regiment", count: 1 },
      { branchId: "army", type: "Special Forces Group", count: 1 },
      { branchId: "navy", type: "Carrier Strike Group", count: 1 },
      { branchId: "navy", type: "Attack Submarine", count: 3 },
      { branchId: "navy", type: "Guided-Missile Destroyer", count: 2 },
      { branchId: "navy", type: "Frigate Squadron", count: 2 },
      { branchId: "navy", type: "Amphibious Group", count: 1 },
      { branchId: "raf", type: "Fighter Wing", count: 3 },
      { branchId: "raf", type: "Bomber Squadron", count: 1 },
      { branchId: "raf", type: "Airlift Wing", count: 1 },
      { branchId: "raf", type: "Drone Command", count: 1 },
    ],
    /** Conscription winding down, the force reoriented for expeditionary deployment. */
    DE: [
      { branchId: "heer", type: "Infantry Division", count: 2 },
      { branchId: "heer", type: "Armored Division", count: 2 },
      { branchId: "heer", type: "Mechanized Brigade", count: 3 },
      { branchId: "heer", type: "Artillery Regiment", count: 1 },
      { branchId: "heer", type: "Air Defense Battalion", count: 1 },
      { branchId: "marine", type: "Frigate Squadron", count: 2 },
      { branchId: "marine", type: "Attack Submarine", count: 2 },
      { branchId: "marine", type: "Guided-Missile Destroyer", count: 1 },
      { branchId: "luftwaffe", type: "Fighter Wing", count: 3 },
      { branchId: "luftwaffe", type: "Air Defense Wing", count: 1 },
      { branchId: "luftwaffe", type: "Airlift Wing", count: 1 },
    ],
    /** Ballistic-missile defence after the 1998 Taepodong overflight; helicopter destroyers. */
    JP: [
      { branchId: "jgsdf", type: "Infantry Division", count: 4 },
      { branchId: "jgsdf", type: "Mechanized Brigade", count: 3 },
      { branchId: "jgsdf", type: "Artillery Regiment", count: 1 },
      { branchId: "jgsdf", type: "Air Defense Battalion", count: 2 },
      { branchId: "jmsdf", type: "Frigate Squadron", count: 3 },
      { branchId: "jmsdf", type: "Attack Submarine", count: 4 },
      { branchId: "jmsdf", type: "Guided-Missile Destroyer", count: 4 },
      { branchId: "jmsdf", type: "Amphibious Group", count: 1 },
      { branchId: "jasdf", type: "Fighter Wing", count: 4 },
      { branchId: "jasdf", type: "Air Defense Wing", count: 2 },
      { branchId: "jasdf", type: "Airlift Wing", count: 1 },
    ],
    IE: IE_MODERN,
    /** Double-digit budget growth: the ground army mechanises, the navy goes to sea. */
    CN: [
      { branchId: "pla", type: "Infantry Division", count: 8 },
      { branchId: "pla", type: "Armored Division", count: 3 },
      { branchId: "pla", type: "Mechanized Brigade", count: 4 },
      { branchId: "pla", type: "Artillery Regiment", count: 3 },
      { branchId: "pla", type: "Air Defense Battalion", count: 1 },
      { branchId: "plan", type: "Frigate Squadron", count: 3 },
      { branchId: "plan", type: "Attack Submarine", count: 4 },
      { branchId: "plan", type: "Guided-Missile Destroyer", count: 2 },
      { branchId: "plan", type: "Amphibious Group", count: 1 },
      { branchId: "plaaf", type: "Fighter Wing", count: 6 },
      { branchId: "plaaf", type: "Bomber Squadron", count: 2 },
      { branchId: "plaaf", type: "Air Defense Wing", count: 1 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 4 },
      { branchId: "rocket", type: "Cruise Missile Regiment", count: 2 },
    ],
    /** Oil-funded recovery and the start of the Serdyukov reforms. */
    RU: [
      { branchId: "ground", type: "Infantry Division", count: 7 },
      { branchId: "ground", type: "Armored Division", count: 3 },
      { branchId: "ground", type: "Mechanized Brigade", count: 4 },
      { branchId: "ground", type: "Artillery Regiment", count: 3 },
      { branchId: "ground", type: "Air Defense Battalion", count: 2 },
      { branchId: "navy", type: "Attack Submarine", count: 4 },
      { branchId: "navy", type: "Frigate Squadron", count: 2 },
      { branchId: "navy", type: "Amphibious Group", count: 1 },
      { branchId: "airforce", type: "Fighter Wing", count: 4 },
      { branchId: "airforce", type: "Bomber Squadron", count: 2 },
      { branchId: "pvo", type: "Air Defense Wing", count: 4 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 2 },
      { branchId: "rocket", type: "Cruise Missile Regiment", count: 1 },
    ],
  },
  "2019": {
    /**
     * Space Force stood up December 2019, Force Design 2030 turns the Marine
     * Corps littoral, and the drone fleet is now a service in its own right.
     * The space branch MUST be named here: unnamed, it falls back to random.
     */
    US: [
      { branchId: "army", type: "Infantry Division", count: 3 },
      { branchId: "army", type: "Armored Division", count: 3 },
      { branchId: "army", type: "Mechanized Brigade", count: 4 },
      { branchId: "army", type: "Artillery Regiment", count: 1 },
      { branchId: "army", type: "Air Defense Battalion", count: 2 },
      { branchId: "army", type: "Special Forces Group", count: 3 },
      { branchId: "navy", type: "Carrier Strike Group", count: 4 },
      { branchId: "navy", type: "Attack Submarine", count: 4 },
      { branchId: "navy", type: "Guided-Missile Destroyer", count: 5 },
      { branchId: "navy", type: "Frigate Squadron", count: 1 },
      { branchId: "navy", type: "Amphibious Group", count: 2 },
      { branchId: "airforce", type: "Fighter Wing", count: 5 },
      { branchId: "airforce", type: "Bomber Squadron", count: 2 },
      { branchId: "airforce", type: "Airlift Wing", count: 2 },
      { branchId: "airforce", type: "Air Defense Wing", count: 1 },
      { branchId: "airforce", type: "Drone Command", count: 4 },
      { branchId: "marines", type: "Marine Division", count: 2 },
      { branchId: "marines", type: "Marine Expeditionary Unit", count: 2 },
      { branchId: "marines", type: "Littoral Combat Team", count: 2 },
      { branchId: "space", type: "Orbital Surveillance Delta", count: 2 },
      { branchId: "space", type: "Launch Operations Delta", count: 1 },
      { branchId: "space", type: "Space Defense Squadron", count: 1 },
    ],
    UK: UK_MODERN,
    /** Conscription suspended in 2011; 180,000 troops and a readiness crisis. */
    DE: [
      { branchId: "heer", type: "Infantry Division", count: 1 },
      { branchId: "heer", type: "Armored Division", count: 2 },
      { branchId: "heer", type: "Mechanized Brigade", count: 3 },
      { branchId: "heer", type: "Artillery Regiment", count: 1 },
      { branchId: "marine", type: "Frigate Squadron", count: 2 },
      { branchId: "marine", type: "Attack Submarine", count: 2 },
      { branchId: "marine", type: "Guided-Missile Destroyer", count: 1 },
      { branchId: "luftwaffe", type: "Fighter Wing", count: 3 },
      { branchId: "luftwaffe", type: "Airlift Wing", count: 1 },
      { branchId: "luftwaffe", type: "Drone Command", count: 1 },
    ],
    /** Izumo conversion approved 2018, the amphibious rapid deployment brigade stood up. */
    JP: [
      { branchId: "jgsdf", type: "Infantry Division", count: 3 },
      { branchId: "jgsdf", type: "Mechanized Brigade", count: 4 },
      { branchId: "jgsdf", type: "Artillery Regiment", count: 1 },
      { branchId: "jgsdf", type: "Air Defense Battalion", count: 2 },
      { branchId: "jmsdf", type: "Carrier Strike Group", count: 1 },
      { branchId: "jmsdf", type: "Frigate Squadron", count: 3 },
      { branchId: "jmsdf", type: "Attack Submarine", count: 4 },
      { branchId: "jmsdf", type: "Guided-Missile Destroyer", count: 4 },
      { branchId: "jmsdf", type: "Amphibious Group", count: 1 },
      { branchId: "jasdf", type: "Fighter Wing", count: 4 },
      { branchId: "jasdf", type: "Air Defense Wing", count: 2 },
      { branchId: "jasdf", type: "Airlift Wing", count: 1 },
      { branchId: "jasdf", type: "Drone Command", count: 1 },
    ],
    IE: IE_MODERN,
    /**
     * Two carriers, the Strategic Support Force (2016), and a rocket force that
     * is the point of the whole build. Sits below the US and above Russia, which
     * is the 2019 ordering.
     */
    CN: [
      { branchId: "pla", type: "Infantry Division", count: 5 },
      { branchId: "pla", type: "Armored Division", count: 3 },
      { branchId: "pla", type: "Mechanized Brigade", count: 6 },
      { branchId: "pla", type: "Artillery Regiment", count: 2 },
      { branchId: "pla", type: "Air Defense Battalion", count: 2 },
      { branchId: "plan", type: "Carrier Strike Group", count: 2 },
      { branchId: "plan", type: "Frigate Squadron", count: 2 },
      { branchId: "plan", type: "Attack Submarine", count: 4 },
      { branchId: "plan", type: "Guided-Missile Destroyer", count: 4 },
      { branchId: "plan", type: "Amphibious Group", count: 1 },
      { branchId: "plaaf", type: "Fighter Wing", count: 6 },
      { branchId: "plaaf", type: "Bomber Squadron", count: 2 },
      { branchId: "plaaf", type: "Air Defense Wing", count: 2 },
      { branchId: "plaaf", type: "Drone Command", count: 2 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 4 },
      { branchId: "rocket", type: "Cruise Missile Regiment", count: 3 },
      { branchId: "ssf", type: "Orbital Surveillance Delta", count: 1 },
      { branchId: "ssf", type: "Launch Operations Delta", count: 1 },
      { branchId: "ssf", type: "Space Defense Squadron", count: 1 },
    ],
    // Post-Soviet Russia: a smaller conventional army, the space forces stood up.
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
  "2023": {
    /** Pacific pivot: more hulls, the B-21 programme, a larger space service. */
    US: [
      { branchId: "army", type: "Infantry Division", count: 3 },
      { branchId: "army", type: "Armored Division", count: 3 },
      { branchId: "army", type: "Mechanized Brigade", count: 4 },
      { branchId: "army", type: "Artillery Regiment", count: 1 },
      { branchId: "army", type: "Air Defense Battalion", count: 2 },
      { branchId: "army", type: "Special Forces Group", count: 3 },
      { branchId: "navy", type: "Carrier Strike Group", count: 5 },
      { branchId: "navy", type: "Attack Submarine", count: 5 },
      { branchId: "navy", type: "Guided-Missile Destroyer", count: 6 },
      { branchId: "navy", type: "Frigate Squadron", count: 1 },
      { branchId: "navy", type: "Amphibious Group", count: 2 },
      { branchId: "airforce", type: "Fighter Wing", count: 6 },
      { branchId: "airforce", type: "Bomber Squadron", count: 3 },
      { branchId: "airforce", type: "Airlift Wing", count: 2 },
      { branchId: "airforce", type: "Air Defense Wing", count: 1 },
      { branchId: "airforce", type: "Drone Command", count: 4 },
      { branchId: "marines", type: "Marine Division", count: 2 },
      { branchId: "marines", type: "Marine Expeditionary Unit", count: 2 },
      { branchId: "marines", type: "Littoral Combat Team", count: 3 },
      { branchId: "space", type: "Orbital Surveillance Delta", count: 2 },
      { branchId: "space", type: "Launch Operations Delta", count: 1 },
      { branchId: "space", type: "Space Defense Squadron", count: 2 },
    ],
    UK: UK_MODERN,
    /** Zeitenwende: the 100-billion-euro special fund, and a Heer being rebuilt. */
    DE: [
      { branchId: "heer", type: "Infantry Division", count: 1 },
      { branchId: "heer", type: "Armored Division", count: 2 },
      { branchId: "heer", type: "Mechanized Brigade", count: 4 },
      { branchId: "heer", type: "Artillery Regiment", count: 2 },
      { branchId: "heer", type: "Air Defense Battalion", count: 1 },
      { branchId: "marine", type: "Frigate Squadron", count: 2 },
      { branchId: "marine", type: "Attack Submarine", count: 2 },
      { branchId: "marine", type: "Guided-Missile Destroyer", count: 2 },
      { branchId: "luftwaffe", type: "Fighter Wing", count: 3 },
      { branchId: "luftwaffe", type: "Air Defense Wing", count: 1 },
      { branchId: "luftwaffe", type: "Airlift Wing", count: 1 },
      { branchId: "luftwaffe", type: "Drone Command", count: 1 },
    ],
    /** The 2022 National Security Strategy: defence spending to 2% and a counterstrike arm. */
    JP: [
      { branchId: "jgsdf", type: "Infantry Division", count: 3 },
      { branchId: "jgsdf", type: "Mechanized Brigade", count: 4 },
      { branchId: "jgsdf", type: "Artillery Regiment", count: 2 },
      { branchId: "jgsdf", type: "Air Defense Battalion", count: 3 },
      { branchId: "jmsdf", type: "Carrier Strike Group", count: 2 },
      { branchId: "jmsdf", type: "Frigate Squadron", count: 3 },
      { branchId: "jmsdf", type: "Attack Submarine", count: 5 },
      { branchId: "jmsdf", type: "Guided-Missile Destroyer", count: 4 },
      { branchId: "jmsdf", type: "Amphibious Group", count: 1 },
      { branchId: "jasdf", type: "Fighter Wing", count: 4 },
      { branchId: "jasdf", type: "Air Defense Wing", count: 2 },
      { branchId: "jasdf", type: "Airlift Wing", count: 1 },
      { branchId: "jasdf", type: "Drone Command", count: 2 },
    ],
    IE: IE_MODERN,
    /** Three carriers with Fujian launched, and the largest navy afloat by hull count. */
    CN: [
      { branchId: "pla", type: "Infantry Division", count: 4 },
      { branchId: "pla", type: "Armored Division", count: 2 },
      { branchId: "pla", type: "Mechanized Brigade", count: 6 },
      { branchId: "pla", type: "Artillery Regiment", count: 2 },
      { branchId: "pla", type: "Air Defense Battalion", count: 2 },
      { branchId: "plan", type: "Carrier Strike Group", count: 3 },
      { branchId: "plan", type: "Frigate Squadron", count: 2 },
      { branchId: "plan", type: "Attack Submarine", count: 5 },
      { branchId: "plan", type: "Guided-Missile Destroyer", count: 5 },
      { branchId: "plan", type: "Amphibious Group", count: 2 },
      { branchId: "plaaf", type: "Fighter Wing", count: 7 },
      { branchId: "plaaf", type: "Bomber Squadron", count: 2 },
      { branchId: "plaaf", type: "Air Defense Wing", count: 2 },
      { branchId: "plaaf", type: "Drone Command", count: 3 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 5 },
      { branchId: "rocket", type: "Cruise Missile Regiment", count: 3 },
      { branchId: "rocket", type: "Strategic Deterrent Force", count: 1 },
      { branchId: "ssf", type: "Orbital Surveillance Delta", count: 2 },
      { branchId: "ssf", type: "Launch Operations Delta", count: 1 },
      { branchId: "ssf", type: "Space Defense Squadron", count: 1 },
    ],
    /** Mobilised and artillery-heavy, with the pre-war professional army spent. */
    RU: [
      { branchId: "ground", type: "Infantry Division", count: 8 },
      { branchId: "ground", type: "Armored Division", count: 3 },
      { branchId: "ground", type: "Mechanized Brigade", count: 5 },
      { branchId: "ground", type: "Artillery Regiment", count: 5 },
      { branchId: "ground", type: "Air Defense Battalion", count: 3 },
      { branchId: "navy", type: "Attack Submarine", count: 4 },
      { branchId: "navy", type: "Frigate Squadron", count: 3 },
      { branchId: "navy", type: "Amphibious Group", count: 1 },
      { branchId: "airforce", type: "Fighter Wing", count: 4 },
      { branchId: "airforce", type: "Bomber Squadron", count: 2 },
      { branchId: "pvo", type: "Air Defense Wing", count: 5 },
      { branchId: "rocket", type: "Ballistic Missile Brigade", count: 2 },
      { branchId: "rocket", type: "Cruise Missile Regiment", count: 2 },
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
