import type { CountryId } from "./countries";
import type { UnitDomain, Posture, MilitaryUnit, UnitEquipment } from "@/lib/db/types/militaryUnit";

export interface Branch {
  id: string;
  name: string;
  abbr: string;
  domain: UnitDomain;
  /**
   * Real-world year the branch stood up. A branch whose establishedYear is after
   * the game's starting year is not seeded (mirrors foundedYear on international
   * orgs). Optional so legacy callers and undated entries stay valid for every era.
   */
  establishedYear?: number;
  /**
   * First year the branch no longer exists (abolished / renamed into a successor).
   * When set, the branch is active only while liveYear < dissolvedYear.
   */
  dissolvedYear?: number;
}
export interface UnitArchetype {
  type: string;
  icon: string;
  cost: number;
  upkeep: number;
  personnel: number;
  power: number;
  /** Optional era gate; same semantics as Branch.establishedYear. */
  establishedYear?: number;
  /** Optional era gate; same semantics as Branch.dissolvedYear. */
  dissolvedYear?: number;
}
export interface PostureDef {
  id: Posture;
  label: string;
  upkeepMult: number;
  powerMult: number;
}

export const POSTURES: PostureDef[] = [
  { id: "garrison", label: "Garrison", upkeepMult: 0.85, powerMult: 0.9 },
  { id: "standard", label: "Standard", upkeepMult: 1.0, powerMult: 1.0 },
  { id: "forward", label: "Forward-Deployed", upkeepMult: 1.25, powerMult: 1.12 },
  { id: "alert", label: "High Alert", upkeepMult: 1.5, powerMult: 1.22 },
];

export const TECH_TIERS = ["Legacy", "Standard", "Modernized", "Cutting-Edge"];
/** effective tech multiplier = 0.8 + tier*0.08 (tier 0..3 → 0.8..1.04) */
export function techPowerMult(tier: number): number {
  return 0.8 + tier * 0.08;
}

/**
 * What a tech tier does to a unit's running cost, index = techTier 0..3.
 *
 * Modernisation used to be pure upside: a tier bought +8% power and a political
 * `defenseIndustry` bump, cost nothing to buy, and cost nothing to keep — so the only
 * question was how fast a nation could click through it.
 *
 * Deliberately steeper than `techPowerMult`: Legacy → Cutting-Edge is ×1.30 power for
 * ×1.71 upkeep. A modern division is better than an old one and worse value than two of
 * them, which is the choice this is meant to create. Cheap legacy kit is a real option
 * for a nation that needs mass.
 */
export const TECH_UPKEEP_MULT = [0.85, 1.0, 1.2, 1.45];

/** Upkeep multiplier for a tier, defaulting a malformed tier to Standard (never free). */
export function techUpkeepMult(tier: number): number {
  return TECH_UPKEEP_MULT[tier] ?? 1;
}

/** Veterancy power multiplier, index = vet 0..4 (Green..Elite). Canonical home; combat.ts re-exports. */
export const VETM = [0.9, 1.0, 1.08, 1.16, 1.25];

/**
 * Average of a unit's three equipment tracks.
 *
 * Tolerates a missing or partial `equipment` (legacy/unmigrated units) so one
 * malformed unit degrades to zero rather than throwing — a data anomaly must not
 * take down the whole force-aggregation path (and with it the SecDef office).
 */
export function eqAvg(e?: Partial<UnitEquipment> | null): number {
  if (!e) return 0;
  return ((e.firepower ?? 0) + (e.protection ?? 0) + (e.support ?? 0)) / 3;
}

export const UNIT_TYPES: Record<UnitDomain, UnitArchetype[]> = {
  ground: [
    {
      type: "Armored Division",
      icon: "tank",
      cost: 4200,
      upkeep: 180,
      personnel: 15000,
      power: 92,
    },
    {
      type: "Mechanized Brigade",
      icon: "tank",
      cost: 2100,
      upkeep: 95,
      personnel: 4500,
      power: 61,
    },
    {
      type: "Infantry Division",
      icon: "soldier",
      cost: 1600,
      upkeep: 70,
      personnel: 12000,
      power: 48,
    },
    {
      type: "Artillery Regiment",
      icon: "artillery",
      cost: 1300,
      upkeep: 55,
      personnel: 3000,
      power: 44,
    },
    {
      type: "Special Forces Group",
      icon: "soldier",
      cost: 2400,
      upkeep: 120,
      personnel: 1400,
      power: 78,
    },
    {
      type: "Air Defense Battalion",
      icon: "missile",
      cost: 1900,
      upkeep: 88,
      personnel: 900,
      power: 57,
    },
  ],
  naval: [
    {
      type: "Carrier Strike Group",
      icon: "carrier",
      cost: 13800,
      upkeep: 620,
      personnel: 7500,
      power: 99,
    },
    {
      type: "Guided-Missile Destroyer",
      icon: "ship",
      cost: 2200,
      upkeep: 110,
      personnel: 330,
      power: 64,
    },
    { type: "Attack Submarine", icon: "sub", cost: 3400, upkeep: 150, personnel: 130, power: 81 },
    { type: "Frigate Squadron", icon: "ship", cost: 1700, upkeep: 80, personnel: 600, power: 49 },
    {
      type: "Amphibious Group",
      icon: "carrier",
      cost: 4100,
      upkeep: 190,
      personnel: 2800,
      power: 70,
    },
  ],
  air: [
    { type: "Fighter Wing", icon: "jet", cost: 5600, upkeep: 250, personnel: 1800, power: 88 },
    { type: "Bomber Squadron", icon: "jet", cost: 4800, upkeep: 220, personnel: 900, power: 84 },
    {
      type: "Airlift Wing",
      icon: "transport",
      cost: 2300,
      upkeep: 100,
      personnel: 1500,
      power: 38,
    },
    {
      type: "Air Defense Wing",
      icon: "missile",
      cost: 2600,
      upkeep: 115,
      personnel: 1100,
      power: 66,
    },
    // MQ-1 Predator entered USAF service 1995 (USAF Historical Research Agency).
    {
      type: "Drone Command",
      icon: "drone",
      cost: 1900,
      upkeep: 70,
      personnel: 600,
      power: 59,
      establishedYear: 1995,
    },
  ],
  rocket: [
    {
      type: "Ballistic Missile Brigade",
      icon: "missile",
      cost: 6200,
      upkeep: 240,
      personnel: 1200,
      power: 95,
    },
    {
      type: "Cruise Missile Regiment",
      icon: "missile",
      cost: 3100,
      upkeep: 130,
      personnel: 800,
      power: 72,
    },
    {
      type: "Strategic Deterrent Force",
      icon: "missile",
      cost: 9800,
      upkeep: 410,
      personnel: 2000,
      power: 100,
    },
  ],
  // Space-domain archetypes only make sense alongside a space branch (USSF 2019 /
  // PLA SSF 2016). Gate at 2019 so a stray recruit path cannot invent them earlier.
  space: [
    {
      type: "Orbital Surveillance Delta",
      icon: "satellite",
      cost: 3800,
      upkeep: 160,
      personnel: 700,
      power: 74,
      establishedYear: 2019,
    },
    {
      type: "Launch Operations Delta",
      icon: "satellite",
      cost: 2900,
      upkeep: 120,
      personnel: 500,
      power: 52,
      establishedYear: 2019,
    },
    {
      type: "Space Defense Squadron",
      icon: "satellite",
      cost: 4400,
      upkeep: 190,
      personnel: 900,
      power: 80,
      establishedYear: 2019,
    },
  ],
  marine: [
    {
      type: "Marine Expeditionary Unit",
      icon: "soldier",
      cost: 3200,
      upkeep: 150,
      personnel: 2200,
      power: 76,
    },
    {
      type: "Marine Division",
      icon: "soldier",
      cost: 4600,
      upkeep: 210,
      personnel: 18000,
      power: 83,
    },
    {
      type: "Littoral Combat Team",
      icon: "ship",
      cost: 1800,
      upkeep: 85,
      personnel: 1100,
      power: 54,
    },
  ],
};

export const MILITARY_BRANCHES_BY_COUNTRY: Record<CountryId, Branch[]> = {
  US: [
    { id: "army", name: "U.S. Army", abbr: "USA", domain: "ground" },
    { id: "navy", name: "U.S. Navy", abbr: "USN", domain: "naval" },
    // National Security Act of 1947 (effective 18 Sep 1947) — valid in 1953.
    {
      id: "airforce",
      name: "U.S. Air Force",
      abbr: "USAF",
      domain: "air",
      establishedYear: 1947,
    },
    { id: "marines", name: "U.S. Marine Corps", abbr: "USMC", domain: "marine" },
    // FY2020 NDAA / spaceforce.mil: established 20 Dec 2019.
    {
      id: "space",
      name: "U.S. Space Force",
      abbr: "USSF",
      domain: "space",
      establishedYear: 2019,
    },
  ],
  CN: [
    // PLA ground/navy/air services predate 1953 (PLAAF founded 11 Nov 1949; PLAN 23 Apr 1949).
    { id: "pla", name: "PLA Ground Force", abbr: "PLAGF", domain: "ground" },
    { id: "plan", name: "PLA Navy", abbr: "PLAN", domain: "naval" },
    { id: "plaaf", name: "PLA Air Force", abbr: "PLAAF", domain: "air" },
    // Second Artillery Corps founded 1 Jul 1966; renamed PLA Rocket Force 31 Dec 2015.
    // Catalog keeps the modern label; gate on the 1966 force stand-up so 1979+ still seeds.
    {
      id: "rocket",
      name: "PLA Rocket Force",
      abbr: "PLARF",
      domain: "rocket",
      establishedYear: 1966,
    },
    // PLA Strategic Support Force stood up 31 Dec 2015 (catalog name "Aerospace Force"
    // reflects the 2024 Space Systems Department successor — same space/cyber slot).
    {
      id: "ssf",
      name: "Aerospace Force",
      abbr: "PLAASF",
      domain: "space",
      establishedYear: 2016,
    },
  ],
  UK: [
    { id: "army", name: "British Army", abbr: "Army", domain: "ground" },
    { id: "navy", name: "Royal Navy", abbr: "RN", domain: "naval" },
    { id: "raf", name: "Royal Air Force", abbr: "RAF", domain: "air" },
  ],
  // Bundeswehr: first volunteers sworn 12 Nov 1955 (bundeswehr.de). West Germany had
  // no armed forces in 1953 (demilitarized under occupation / Blank Office planning only),
  // so a 1953 world correctly seeds DE with zero branches — no invented predecessor.
  DE: [
    {
      id: "heer",
      name: "Heer",
      abbr: "Heer",
      domain: "ground",
      establishedYear: 1955,
    },
    {
      id: "marine",
      name: "Marine",
      abbr: "Marine",
      domain: "naval",
      establishedYear: 1955,
    },
    {
      id: "luftwaffe",
      name: "Luftwaffe",
      abbr: "Lw",
      domain: "air",
      establishedYear: 1955,
    },
  ],
  JP: [
    // National Safety Force (保安隊, Hoantai): NPR renamed 15 Oct 1952; became JGSDF
    // 1 Jul 1954 (National Archives of Japan; Self-Defense Forces Act 1954).
    {
      id: "nsf",
      name: "National Safety Force",
      abbr: "NSF",
      domain: "ground",
      establishedYear: 1952,
      dissolvedYear: 1954,
    },
    // Safety Security Force / Coastal Safety Force (警備隊): under National Safety
    // Agency from 1 Aug 1952; became JMSDF 1 Jul 1954.
    {
      id: "csf",
      name: "Coastal Safety Force",
      abbr: "CSF",
      domain: "naval",
      establishedYear: 1952,
      dissolvedYear: 1954,
    },
    // JSDF branches: Self-Defense Forces Act, 1 Jul 1954.
    {
      id: "jgsdf",
      name: "Ground Self-Defense Force",
      abbr: "JGSDF",
      domain: "ground",
      establishedYear: 1954,
    },
    {
      id: "jmsdf",
      name: "Maritime Self-Defense Force",
      abbr: "JMSDF",
      domain: "naval",
      establishedYear: 1954,
    },
    {
      id: "jasdf",
      name: "Air Self-Defense Force",
      abbr: "JASDF",
      domain: "air",
      establishedYear: 1954,
    },
  ],
  IE: [
    { id: "army", name: "Irish Army", abbr: "Army", domain: "ground" },
    { id: "navy", name: "Naval Service", abbr: "NS", domain: "naval" },
    { id: "aircorps", name: "Air Corps", abbr: "AC", domain: "air" },
  ],
  BR: [
    { id: "exercito", name: "Army", abbr: "EB", domain: "ground" },
    { id: "marinha", name: "Navy", abbr: "MB", domain: "naval" },
    { id: "aerea", name: "Air Force", abbr: "FAB", domain: "air" },
  ],
  // Nigeria: Navy from the 1956 Nigerian Naval Force; Army on independence
  // (1 Oct 1960); Air Force established 1964.
  NG: [
    { id: "army", name: "Nigerian Army", abbr: "NA", domain: "ground", establishedYear: 1960 },
    { id: "navy", name: "Nigerian Navy", abbr: "NN", domain: "naval", establishedYear: 1956 },
    {
      id: "airforce",
      name: "Nigerian Air Force",
      abbr: "NAF",
      domain: "air",
      establishedYear: 1964,
    },
  ],
  HU: [
    { id: "ground", name: "Ground Forces", abbr: "MH", domain: "ground" },
    { id: "airforce", name: "Air Force", abbr: "MHL", domain: "air" },
  ],
  PL: [
    { id: "ground", name: "Land Forces", abbr: "WL", domain: "ground" },
    { id: "navy", name: "Navy", abbr: "MW", domain: "naval" },
    { id: "airforce", name: "Air Force", abbr: "SP", domain: "air" },
  ],
  RO: [
    { id: "ground", name: "Land Forces", abbr: "FT", domain: "ground" },
    { id: "navy", name: "Naval Forces", abbr: "FN", domain: "naval" },
    { id: "airforce", name: "Air Force", abbr: "FA", domain: "air" },
  ],
  // Yugoslav People's Army — dissolved with the SFRY in 1992.
  YU: [
    { id: "ground", name: "Ground Forces", abbr: "KoV", domain: "ground", dissolvedYear: 1992 },
    { id: "navy", name: "Navy", abbr: "JRM", domain: "naval", dissolvedYear: 1992 },
    { id: "airforce", name: "Air Force", abbr: "JRV", domain: "air", dissolvedYear: 1992 },
  ],
  BG: [
    { id: "ground", name: "Land Forces", abbr: "SV", domain: "ground" },
    { id: "navy", name: "Navy", abbr: "VMS", domain: "naval" },
    { id: "airforce", name: "Air Force", abbr: "VVS", domain: "air" },
  ],
  // Union-republic forces. Constitutionally these existed: the February 1944
  // amendment gave each union republic its own People's Commissariat of Defence,
  // which is the legal fiction that put the Ukrainian and Byelorussian SSRs in
  // the UN as founding members. In practice the Soviet military districts did
  // the fighting, so the republican establishments here are deliberately small
  // relative to the satellites - these are garrison and territorial forces, not
  // national armies. Ukraine gets a navy (Odesa, Sevastopol, Mykolaiv) and
  // Byelorussia does not, because Byelorussia is landlocked.
  UKR: [
    { id: "ground", name: "Ground Forces", abbr: "SV", domain: "ground" },
    { id: "navy", name: "Naval Forces", abbr: "VMS", domain: "naval" },
    { id: "airforce", name: "Air Force", abbr: "VPS", domain: "air" },
  ],
  BLR: [
    { id: "ground", name: "Ground Forces", abbr: "SV", domain: "ground" },
    { id: "airforce", name: "Air Force", abbr: "VVS", domain: "air" },
  ],
  // Czechoslovakia dissolved 1 Jan 1993 — landlocked, no naval branch.
  CS: [
    { id: "ground", name: "Ground Forces", abbr: "PV", domain: "ground", dissolvedYear: 1993 },
    { id: "airforce", name: "Air Force", abbr: "CSL", domain: "air", dissolvedYear: 1993 },
  ],
  // The Baltic republics are one country here, so one set of branches. The naval
  // branch matters more than the ground branch: Tallinn, Riga and Liepaja were
  // the Baltic Fleet's home ports.
  BAL: [
    { id: "ground", name: "Ground Forces", abbr: "SV", domain: "ground" },
    { id: "navy", name: "Naval Forces", abbr: "VMS", domain: "naval" },
    { id: "airforce", name: "Air Force", abbr: "VVS", domain: "air" },
  ],
  // ── Soviet Union / Russia ────────────────────────────────────────────────
  // Era-neutral service names: one row serves both a 1953 Soviet and a 2019
  // Russian game (Branch has no namesByYear). PVO Strany became a separate
  // service 1948; RVSN stood up 17 Dec 1959; Military Space Forces 1992.
  RU: [
    { id: "ground", name: "Ground Forces", abbr: "SV", domain: "ground" },
    { id: "navy", name: "Navy", abbr: "VMF", domain: "naval" },
    { id: "airforce", name: "Air Force", abbr: "VVS", domain: "air" },
    { id: "pvo", name: "Air Defence Forces", abbr: "PVO", domain: "air", establishedYear: 1948 },
    {
      id: "rocket",
      name: "Strategic Rocket Forces",
      abbr: "RVSN",
      domain: "rocket",
      establishedYear: 1959,
    },
    { id: "space", name: "Space Forces", abbr: "VKS", domain: "space", establishedYear: 1992 },
  ],
  FR: [
    { id: "terre", name: "Army", abbr: "AdT", domain: "ground" },
    { id: "marine", name: "Navy", abbr: "MN", domain: "naval" },
    { id: "air", name: "Air Force", abbr: "AdA", domain: "air" },
  ],
  IT: [
    { id: "esercito", name: "Army", abbr: "EI", domain: "ground" },
    { id: "marina", name: "Navy", abbr: "MM", domain: "naval" },
    { id: "aeronautica", name: "Air Force", abbr: "AM", domain: "air" },
  ],
  ES: [
    { id: "tierra", name: "Army", abbr: "ET", domain: "ground" },
    { id: "armada", name: "Navy", abbr: "AE", domain: "naval" },
    { id: "aire", name: "Air Force", abbr: "EA", domain: "air" },
  ],
  SE: [
    { id: "army", name: "Army", abbr: "Armén", domain: "ground" },
    { id: "navy", name: "Navy", abbr: "Marinen", domain: "naval" },
    { id: "airforce", name: "Air Force", abbr: "Flygvapnet", domain: "air" },
  ],
  TR: [
    { id: "ground", name: "Land Forces", abbr: "KKK", domain: "ground" },
    { id: "navy", name: "Naval Forces", abbr: "DzKK", domain: "naval" },
    { id: "airforce", name: "Air Force", abbr: "HvKK", domain: "air" },
  ],
  GR: [
    { id: "army", name: "Hellenic Army", abbr: "ES", domain: "ground" },
    { id: "navy", name: "Hellenic Navy", abbr: "PN", domain: "naval" },
    { id: "airforce", name: "Hellenic Air Force", abbr: "PA", domain: "air" },
  ],
  // Bundesheer: re-established under the Austrian State Treaty, 1955. Landlocked.
  AT: [
    { id: "heer", name: "Land Forces", abbr: "ÖBH", domain: "ground", establishedYear: 1955 },
    { id: "luft", name: "Air Forces", abbr: "ÖLK", domain: "air", establishedYear: 1955 },
  ],
  FI: [
    { id: "army", name: "Army", abbr: "MAAV", domain: "ground" },
    { id: "navy", name: "Navy", abbr: "MERIV", domain: "naval" },
    { id: "airforce", name: "Air Force", abbr: "ILMAV", domain: "air" },
  ],
  // Nationale Volksarmee: stood up 1 Mar 1956; dissolved with the GDR 3 Oct 1990.
  DD: [
    {
      id: "landstreitkraefte",
      name: "Land Forces",
      abbr: "LaSK",
      domain: "ground",
      establishedYear: 1956,
      dissolvedYear: 1990,
    },
    {
      id: "volksmarine",
      name: "People's Navy",
      abbr: "VM",
      domain: "naval",
      establishedYear: 1956,
      dissolvedYear: 1990,
    },
    {
      id: "luftstreitkraefte",
      name: "Air Force / Air Defence",
      abbr: "LSK/LV",
      domain: "air",
      establishedYear: 1956,
      dissolvedYear: 1990,
    },
  ],
  SCO: [],
  WAL: [],
};

/**
 * Per-country COST scale — applied to both unit upkeep and acquisition price so
 * the two stay symmetric. NOT a force-SIZE knob: roster size comes from the
 * authored order of battle. (Ported from prototype: US 2.6, CN 2.0, JP 1.4.)
 */
export const MILITARY_COUNTRY_SCALE: Record<CountryId, number> = {
  US: 2.6,
  CN: 2.0,
  JP: 1.4,
  UK: 1.7,
  DE: 1.0,
  IE: 1.0,
  BR: 1.0,
  NG: 0.85,
  HU: 0.9,
  PL: 1.0,
  RO: 0.9,
  YU: 0.95,
  BG: 0.85,
  // Union republics buy at all-Union prices, so no discount against RU's scale;
  // their force is small because the order of battle is small, not because
  // equipment is cheap.
  UKR: 1.1,
  BLR: 1.0,
  CS: 1.0,
  BAL: 1.0,
  RU: 2.4,
  FR: 1.5,
  IT: 1.2,
  ES: 1.0,
  SE: 1.1,
  TR: 1.0,
  GR: 0.9,
  AT: 0.85,
  FI: 0.9,
  DD: 1.2,
  SCO: 1.0,
  WAL: 1.0,
};

/** Defense cabinet position per country. */
export const DEFENSE_POSITION_BY_COUNTRY: Record<CountryId, string | null> = {
  US: "secretary_of_defense",
  UK: "defence_secretary",
  CN: "minister_of_defense",
  DE: "defense_minister",
  JP: "defense_minister",
  IE: "minister_for_defence",
  BR: null,
  NG: "minister_of_defence",
  HU: "minister_of_defence",
  PL: "minister_of_defence",
  RO: "minister_of_defence",
  YU: "minister_of_defence",
  BG: "minister_of_defence",
  // Republican defence commissariats/ministries existed on paper from 1944 (see
  // MILITARY_BRANCHES_BY_COUNTRY), so the post is real even though the Soviet
  // General Staff held the actual command authority.
  UKR: "minister_of_defence",
  BLR: "minister_of_defence",
  CS: "minister_of_defence",
  BAL: "minister_of_defence",
  RU: "minister_of_defence",
  FR: null,
  IT: null,
  ES: null,
  SE: null,
  TR: null,
  GR: null,
  AT: null,
  FI: null,
  DD: "minister_of_defence",
  SCO: null,
  WAL: null,
};

/** National readiness tier → global force modifier. */
export const TIER_FORCE_MODIFIER: Record<string, { readinessMult: number; upkeepMult: number }> = {
  reduced: { readinessMult: 0.9, upkeepMult: 0.85 },
  standard: { readinessMult: 1.0, upkeepMult: 1.0 },
  elevated: { readinessMult: 1.1, upkeepMult: 1.25 },
};

export const DEFENSE_ENVELOPE_FALLBACK_GDP_FRACTION = 0.03;

/**
 * Whether a branch (or unit archetype) exists at `liveYear`. Undated entries are
 * always active. Matches international-org founding: active iff
 * establishedYear <= liveYear < dissolvedYear (dissolvedYear exclusive).
 */
export function isMilitaryEraActive(
  def: Pick<Branch, "establishedYear" | "dissolvedYear">,
  liveYear: number | null | undefined
): boolean {
  if (liveYear == null) return true;
  if (def.establishedYear != null && liveYear < def.establishedYear) return false;
  if (def.dissolvedYear != null && liveYear >= def.dissolvedYear) return false;
  return true;
}

/**
 * Branches for a country. With `liveYear`, applies established/dissolved gates.
 * Without a year (UI / legacy callers), omits dissolved predecessors so the
 * default view matches the modern catalog (e.g. JSDF, not 1952–54 NSF).
 */
export function getBranches(countryId: string, liveYear?: number | null): Branch[] {
  const all = MILITARY_BRANCHES_BY_COUNTRY[countryId as CountryId] ?? [];
  if (liveYear == null) {
    return all.filter((b) => b.dissolvedYear == null);
  }
  return all.filter((b) => isMilitaryEraActive(b, liveYear));
}

/** Unit archetypes for a domain, optionally filtered to those active in `liveYear`. */
export function getUnitTypesForYear(domain: UnitDomain, liveYear?: number | null): UnitArchetype[] {
  const all = UNIT_TYPES[domain] ?? [];
  if (liveYear == null) return all;
  return all.filter((t) => isMilitaryEraActive(t, liveYear));
}
export function getUnitArchetype(domain: UnitDomain, type: string): UnitArchetype | undefined {
  return UNIT_TYPES[domain]?.find((u) => u.type === type);
}
export function postureDef(p: Posture): PostureDef {
  return POSTURES.find((x) => x.id === p) ?? POSTURES[1];
}
/**
 * Strength (personnel ÷ archetype establishment), clamped 0..1. A unit at half
 * strength fights at half power.
 *
 * Optional by design: `personnel`/`domain`/`type` absent — or an unknown archetype —
 * means "assume full strength" (×1), never zero. Unmigrated or malformed units must
 * degrade gracefully rather than silently losing all combat power. An explicit
 * `personnel: 0` is a real zero.
 */
function strengthRatio(unit: Partial<Pick<MilitaryUnit, "personnel" | "domain" | "type">>): number {
  if (unit.personnel == null || !unit.domain || !unit.type) return 1;
  const establishment = getUnitArchetype(unit.domain, unit.type)?.personnel;
  if (!establishment || establishment <= 0) return 1;
  return Math.max(0, Math.min(1, unit.personnel / establishment));
}

export function computeEffectivePower(
  unit: Pick<MilitaryUnit, "basePower" | "posture" | "techTier" | "vet" | "equipment"> &
    Partial<Pick<MilitaryUnit, "personnel" | "domain" | "type">>
): number {
  return Math.round(
    unit.basePower *
      postureDef(unit.posture).powerMult *
      techPowerMult(unit.techTier) *
      VETM[unit.vet] *
      (1 + eqAvg(unit.equipment) * 0.03) *
      strengthRatio(unit)
  );
}
/**
 * A unit's running cost.
 *
 * `tier` is the country's FORCE tier setting (standard/elevated/...), not the unit's
 * tech tier — they are different axes and both apply.
 */
export function computeEffectiveUpkeep(
  unit: Pick<MilitaryUnit, "upkeepBase" | "posture" | "techTier">,
  countryId: string,
  tier: string | null
): number {
  const scale = MILITARY_COUNTRY_SCALE[countryId as CountryId] ?? 1;
  const tierMult = TIER_FORCE_MODIFIER[tier ?? "standard"]?.upkeepMult ?? 1;
  return Math.round(
    unit.upkeepBase *
      postureDef(unit.posture).upkeepMult *
      scale *
      tierMult *
      techUpkeepMult(unit.techTier)
  );
}

export interface ForceAggregate {
  unitCount: number;
  totalPower: number;
  totalPersonnel: number;
  totalUpkeep: number;
  avgReadiness: number;
  forwardShare: number; // fraction of units in forward/alert
}

export function aggregateForce(
  units: MilitaryUnit[],
  countryId: string,
  tier: string | null
): ForceAggregate {
  if (units.length === 0) {
    return {
      unitCount: 0,
      totalPower: 0,
      totalPersonnel: 0,
      totalUpkeep: 0,
      avgReadiness: 0,
      forwardShare: 0,
    };
  }
  const readinessMult = TIER_FORCE_MODIFIER[tier ?? "standard"]?.readinessMult ?? 1;
  let totalPower = 0;
  let totalPersonnel = 0;
  let totalUpkeep = 0;
  let readinessSum = 0;
  let forward = 0;
  for (const unit of units) {
    totalPower += computeEffectivePower(unit);
    totalPersonnel += unit.personnel;
    totalUpkeep += computeEffectiveUpkeep(unit, countryId, tier);
    readinessSum += Math.min(100, Math.round(unit.readiness * readinessMult));
    if (unit.posture === "forward" || unit.posture === "alert") forward++;
  }
  return {
    unitCount: units.length,
    totalPower,
    totalPersonnel,
    totalUpkeep,
    avgReadiness: Math.round(readinessSum / units.length),
    forwardShare: forward / units.length,
  };
}

/**
 * Force → metric effect coefficients. These are STANDING per-turn deltas applied
 * through the capped cabinet-effect pipeline (×CABINET_EFFECT_STRENGTH 1.25, then
 * clamped to ±MAX_PER_METRIC_MODIFIER_PER_TURN 0.08). Calibrated so a typical
 * seeded force (~1200–1800 combat power, ~70% readiness) contributes ~+0.035 to
 * publicSafetyConfidence and ±~0.05 to budgetBalance — in the same range as the
 * tier/regional standing effects — with only the strongest forces approaching the
 * cap. Re-confirm against live seeded budgets if magnitudes feel off.
 */
export const FORCE_EFFECT = {
  /** publicSafetyConfidence per "normalized power" point (power/POWER_NORM). */
  powerWeight: 0.02,
  // W1 (2026-07-14): after veterancy+equipment entered effPower, seeded-force totalPower rose
  // only ~5% (US) / ~9% (CN), shifting publicSafetyConfidence by ~+0.0006 (both ~0.037, mid-band).
  // POWER_NORM kept at 1500 by decision — vet/equipment now legitimately count as a small buff.
  POWER_NORM: 1500,
  /** publicSafetyConfidence per readiness point above baseline. */
  readinessWeight: 0.0015,
  readinessBaseline: 60,
  /**
   * budgetBalance per unit of `1 - upkeepBurden` (clamped ±1) — the force measured against
   * the country's own seeded roster. At a seeded force the gap is +0.45, so this contributes
   * +0.0225. The dial to reach for if the metric moves too much or too little.
   */
  budgetWeight: 0.05,
  /** publicTrust / socialCohesion tilt at 100% forward/alert share. */
  forwardTrust: 0.02,
  forwardCohesion: -0.02,
};
