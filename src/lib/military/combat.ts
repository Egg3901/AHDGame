// Combat unit model + per-unit combat math, ported verbatim from the Combat
// Command design's DCLogic. Pure functions: doctrine + general modifiers are
// passed in (from doctrineTree.natMods and generals.genMods) so nothing here
// touches React or global state. Battle resolution lives in battle.ts.
import type { NatMods } from "./doctrineTree";
import type { GenMods } from "./generals";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { VETM, eqAvg, computeEffectivePower } from "@/lib/constants/military";
import { NAVAL_REACH, FRONT_CAPACITY_BASE, TERRAIN_CAPACITY } from "./config";

// VETM + eqAvg live canonically in constants/military.ts (the one power model);
// re-exported here so combat-suite consumers keep importing from "./combat".
export { VETM, eqAvg };

export type Domain = "ground" | "naval" | "air" | "marine" | "rocket" | "space";

export interface Posture {
  id: string;
  label: string;
  up: number;
  pw: number;
}
export const POSTURES: Posture[] = [
  { id: "garrison", label: "Garrison", up: 0.85, pw: 0.9 },
  { id: "standard", label: "Standard", up: 1.0, pw: 1.0 },
  { id: "forward", label: "Forward-Deployed", up: 1.25, pw: 1.12 },
  { id: "alert", label: "High Alert", up: 1.5, pw: 1.22 },
];

export const VET = ["Green", "Regular", "Seasoned", "Veteran", "Elite"];
export const VETC = ["#8a8a9a", "#7ba3ec", "#86d978", "#4fd1c5", "#e0a3f5"];
export const TECH = ["Legacy", "Standard", "Modernized", "Cutting-Edge"];
export const TECHC = ["#8a8a9a", "#7ba3ec", "#86d978", "#4fd1c5"];
export const EQ = [
  { key: "firepower", label: "Firepower / weapons" },
  { key: "protection", label: "Protection / platforms" },
  { key: "support", label: "C4ISR & logistics" },
] as const;
export const CAP = 4;

export interface Archetype {
  type: string;
  icon: string;
  personnel: number;
  power: number;
  upkeep: number;
  plat?: number;
}
export const ARCHES: Record<string, Archetype[]> = {
  ground: [
    { type: "Armored Division", icon: "tank", personnel: 15000, power: 92, upkeep: 180 },
    { type: "Mechanized Brigade", icon: "tank", personnel: 4500, power: 61, upkeep: 95 },
    { type: "Infantry Division", icon: "soldier", personnel: 12000, power: 48, upkeep: 70 },
    { type: "Artillery Regiment", icon: "artillery", personnel: 3000, power: 44, upkeep: 55 },
    { type: "Special Forces Group", icon: "soldier", personnel: 1400, power: 78, upkeep: 120 },
    { type: "Air Defense Battalion", icon: "missile", personnel: 900, power: 57, upkeep: 88 },
  ],
  naval: [
    {
      type: "Carrier Strike Group",
      icon: "carrier",
      personnel: 7500,
      power: 99,
      upkeep: 620,
      plat: 11,
    },
    {
      type: "Guided-Missile Destroyer",
      icon: "ship",
      personnel: 330,
      power: 64,
      upkeep: 110,
      plat: 1,
    },
    { type: "Attack Submarine", icon: "sub", personnel: 130, power: 81, upkeep: 150, plat: 1 },
    { type: "Frigate Squadron", icon: "ship", personnel: 600, power: 49, upkeep: 80, plat: 4 },
    { type: "Amphibious Group", icon: "carrier", personnel: 2800, power: 70, upkeep: 190, plat: 6 },
  ],
  air: [
    { type: "Fighter Wing", icon: "jet", personnel: 1800, power: 88, upkeep: 250, plat: 72 },
    { type: "Bomber Squadron", icon: "jet", personnel: 900, power: 84, upkeep: 220, plat: 24 },
    { type: "Airlift Wing", icon: "transport", personnel: 1500, power: 38, upkeep: 100, plat: 40 },
    {
      type: "Air Defense Wing",
      icon: "missile",
      personnel: 1100,
      power: 66,
      upkeep: 115,
      plat: 32,
    },
    { type: "Drone Command", icon: "drone", personnel: 600, power: 59, upkeep: 70, plat: 48 },
  ],
  marine: [
    { type: "Marine Expeditionary Unit", icon: "soldier", personnel: 2200, power: 76, upkeep: 150 },
    { type: "Marine Division", icon: "soldier", personnel: 18000, power: 83, upkeep: 210 },
    { type: "Littoral Combat Team", icon: "ship", personnel: 1100, power: 54, upkeep: 85 },
  ],
  rocket: [
    {
      type: "Ballistic Missile Brigade",
      icon: "missile",
      personnel: 1200,
      power: 95,
      upkeep: 240,
      plat: 18,
    },
    {
      type: "Cruise Missile Regiment",
      icon: "missile",
      personnel: 800,
      power: 72,
      upkeep: 130,
      plat: 24,
    },
    {
      type: "Strategic Deterrent Force",
      icon: "missile",
      personnel: 2000,
      power: 100,
      upkeep: 410,
      plat: 24,
    },
  ],
  space: [
    {
      type: "Orbital Surveillance Delta",
      icon: "satellite",
      personnel: 700,
      power: 74,
      upkeep: 160,
    },
    { type: "Launch Operations Delta", icon: "satellite", personnel: 500, power: 52, upkeep: 120 },
    { type: "Space Defense Squadron", icon: "satellite", personnel: 900, power: 80, upkeep: 190 },
  ],
};

export interface UnitStatProfile {
  atk: number;
  arm: number;
  shk: number;
  mob: number;
  rng: number;
  aa: number;
  rec: number;
  traits: string[];
}
export const USTATS: Record<string, UnitStatProfile> = {
  "Armored Division": {
    atk: 78,
    arm: 90,
    shk: 88,
    mob: 55,
    rng: 25,
    aa: 20,
    rec: 35,
    traits: ["armored", "antiarmor", "shock", "ap"],
  },
  "Mechanized Brigade": {
    atk: 64,
    arm: 70,
    shk: 68,
    mob: 74,
    rng: 28,
    aa: 30,
    rec: 45,
    traits: ["armored", "rapid", "allweather"],
  },
  "Infantry Division": {
    atk: 50,
    arm: 42,
    shk: 45,
    mob: 40,
    rng: 30,
    aa: 25,
    rec: 50,
    traits: ["allweather"],
  },
  "Artillery Regiment": {
    atk: 92,
    arm: 30,
    shk: 42,
    mob: 35,
    rng: 90,
    aa: 10,
    rec: 30,
    traits: ["longrange", "antiarmor"],
  },
  "Special Forces Group": {
    atk: 72,
    arm: 35,
    shk: 70,
    mob: 78,
    rng: 40,
    aa: 20,
    rec: 92,
    traits: ["stealth", "recon", "rapid"],
  },
  "Air Defense Battalion": {
    atk: 40,
    arm: 45,
    shk: 30,
    mob: 50,
    rng: 70,
    aa: 95,
    rec: 55,
    traits: ["antiair", "allweather"],
  },
  "Carrier Strike Group": {
    atk: 95,
    arm: 70,
    shk: 80,
    mob: 60,
    rng: 98,
    aa: 90,
    rec: 88,
    traits: ["longrange", "antiair", "strategic"],
  },
  "Guided-Missile Destroyer": {
    atk: 76,
    arm: 60,
    shk: 60,
    mob: 70,
    rng: 85,
    aa: 82,
    rec: 70,
    traits: ["antiair", "longrange"],
  },
  "Attack Submarine": {
    atk: 85,
    arm: 40,
    shk: 88,
    mob: 55,
    rng: 75,
    aa: 5,
    rec: 72,
    traits: ["stealth", "antiarmor"],
  },
  "Frigate Squadron": {
    atk: 58,
    arm: 50,
    shk: 50,
    mob: 72,
    rng: 65,
    aa: 60,
    rec: 66,
    traits: ["allweather", "antiair"],
  },
  "Amphibious Group": {
    atk: 60,
    arm: 55,
    shk: 58,
    mob: 55,
    rng: 45,
    aa: 50,
    rec: 55,
    traits: ["amphibious"],
  },
  "Fighter Wing": {
    atk: 88,
    arm: 30,
    shk: 82,
    mob: 98,
    rng: 80,
    aa: 92,
    rec: 78,
    traits: ["antiair", "rapid", "allweather"],
  },
  "Bomber Squadron": {
    atk: 94,
    arm: 35,
    shk: 80,
    mob: 85,
    rng: 95,
    aa: 20,
    rec: 60,
    traits: ["longrange", "strategic"],
  },
  "Airlift Wing": {
    atk: 18,
    arm: 25,
    shk: 20,
    mob: 90,
    rng: 88,
    aa: 10,
    rec: 40,
    traits: ["rapid", "logistics"],
  },
  "Air Defense Wing": {
    atk: 45,
    arm: 35,
    shk: 35,
    mob: 60,
    rng: 78,
    aa: 96,
    rec: 70,
    traits: ["antiair"],
  },
  "Drone Command": {
    atk: 66,
    arm: 15,
    shk: 50,
    mob: 70,
    rng: 82,
    aa: 20,
    rec: 95,
    traits: ["recon", "stealth", "longrange"],
  },
  "Marine Expeditionary Unit": {
    atk: 70,
    arm: 50,
    shk: 72,
    mob: 68,
    rng: 40,
    aa: 40,
    rec: 60,
    traits: ["amphibious", "rapid"],
  },
  "Marine Division": {
    atk: 76,
    arm: 58,
    shk: 78,
    mob: 55,
    rng: 42,
    aa: 45,
    rec: 55,
    traits: ["amphibious", "shock"],
  },
  "Littoral Combat Team": {
    atk: 56,
    arm: 40,
    shk: 55,
    mob: 78,
    rng: 45,
    aa: 45,
    rec: 62,
    traits: ["amphibious", "rapid"],
  },
  "Ballistic Missile Brigade": {
    atk: 96,
    arm: 35,
    shk: 90,
    mob: 45,
    rng: 99,
    aa: 5,
    rec: 50,
    traits: ["longrange", "strategic", "deterrent"],
  },
  "Cruise Missile Regiment": {
    atk: 80,
    arm: 30,
    shk: 75,
    mob: 55,
    rng: 92,
    aa: 10,
    rec: 55,
    traits: ["longrange", "ap"],
  },
  "Strategic Deterrent Force": {
    atk: 99,
    arm: 50,
    shk: 95,
    mob: 30,
    rng: 99,
    aa: 10,
    rec: 60,
    traits: ["strategic", "deterrent", "longrange"],
  },
  "Orbital Surveillance Delta": {
    atk: 30,
    arm: 20,
    shk: 25,
    mob: 40,
    rng: 99,
    aa: 60,
    rec: 98,
    traits: ["recon", "strategic", "longrange"],
  },
  "Launch Operations Delta": {
    atk: 20,
    arm: 25,
    shk: 20,
    mob: 30,
    rng: 90,
    aa: 30,
    rec: 70,
    traits: ["logistics", "strategic"],
  },
  "Space Defense Squadron": {
    atk: 55,
    arm: 40,
    shk: 45,
    mob: 45,
    rng: 95,
    aa: 90,
    rec: 80,
    traits: ["antiair", "strategic"],
  },
};

export const TRAITS: Record<string, { label: string; c: string }> = {
  armored: { label: "Armored", c: "#7ba3ec" },
  antiarmor: { label: "Anti-Armor", c: "#ef8a8a" },
  ap: { label: "Armor-Piercing", c: "#f0a0a0" },
  shock: { label: "Shock", c: "#d4af37" },
  rapid: { label: "Rapid", c: "#86d978" },
  allweather: { label: "All-Weather", c: "#9cc0f5" },
  antiair: { label: "Anti-Air", c: "#4fd1c5" },
  longrange: { label: "Long-Range", c: "#e0b352" },
  stealth: { label: "Stealth", c: "#a6a8f6" },
  recon: { label: "Recon", c: "#57c98a" },
  amphibious: { label: "Amphibious", c: "#7ba3ec" },
  strategic: { label: "Strategic", c: "#e0a3f5" },
  deterrent: { label: "Nuclear Deterrent", c: "#ef8a8a" },
  logistics: { label: "Logistics", c: "#8a8a9a" },
  elite: { label: "Elite", c: "#e0a3f5" },
};

export interface TerrainDef {
  note: string;
  domain?: Record<string, number>;
  trait?: Record<string, number>;
}

/**
 * Terrain effects, keyed by terrain FAMILY.
 *
 * This table used to be keyed by the ids of the four retired static theaters
 * (`afghan`, `nicaragua`, `angola`, `ogaden`). Conflicts are dynamic now, so every
 * live front's id missed the lookup and `terrainFactor` returned 1 — meaning no
 * per-domain or per-trait terrain effect applied anywhere in the game.
 *
 * The families are the same ones `createConflict.terrainProfile` already matches on,
 * so terrain has one vocabulary across the system and a new conflict is covered the
 * moment it is created rather than needing an entry of its own.
 */
export type TerrainFamily = "highland" | "littoral" | "arid" | "temperate" | "maritime";

/**
 * A terrain phrase → its family. Order matters: the first match wins.
 *
 * Every `STRATEGIC_REGIONS[].terrain` string must match one of these, or a conflict
 * hosted there silently gets no terrain effects — the same class of bug as keying by
 * the retired theater ids, just narrower. `combat.test.ts` asserts full coverage.
 */
const TERRAIN_FAMILY_PATTERNS: [RegExp, TerrainFamily][] = [
  [/mountain|arid\b|alpine|ice|tundra|highland/i, "highland"],
  [/jungle|rainforest|littoral|swamp|delta/i, "littoral"],
  [/savanna|desert|steppe|scrub/i, "arid"],
  [/island|atoll|\bsea\b|ocean|naval|maritime|archipelago/i, "maritime"],
  [/plain|continental|developed|forest|farmland|urban|subcontinent/i, "temperate"],
];

/**
 * The family a terrain phrase belongs to, or null when nothing matches.
 *
 * Null means "no terrain effect", never a default family — inventing one would apply
 * armor and amphibious modifiers to ground nobody has described.
 */
export function terrainFamilyOf(terrain: string | undefined): TerrainFamily | null {
  if (!terrain) return null;
  for (const [re, family] of TERRAIN_FAMILY_PATTERNS) if (re.test(terrain)) return family;
  return null;
}

export const TERRAIN: Record<TerrainFamily, TerrainDef> = {
  highland: {
    note: "high passes slow armor; cover rewards light infantry, special forces & recon",
    domain: { air: 0.92, naval: 0.55, marine: 0.95 },
    trait: {
      armored: 0.82,
      antiarmor: 0.9,
      rapid: 0.9,
      amphibious: 0.8,
      stealth: 1.15,
      recon: 1.1,
      allweather: 1.05,
    },
  },
  littoral: {
    note: "jungle canopy blunts air & armor; littoral rewards amphibious & recon",
    domain: { air: 0.9, naval: 1.05, marine: 1.12 },
    trait: {
      armored: 0.85,
      longrange: 0.9,
      rapid: 0.9,
      amphibious: 1.22,
      stealth: 1.2,
      recon: 1.1,
    },
  },
  maritime: {
    note: "blue water: hulls and carrier air decide it; ground formations have no purchase",
    domain: { naval: 1.3, air: 1.05, marine: 1.15, ground: 0.6 },
    trait: { amphibious: 1.15, longrange: 1.08, armored: 0.6 },
  },
  temperate: {
    note: "open plain and forest: the classic armored corridor, with room for long-range fires",
    domain: { air: 1.02 },
    trait: { armored: 1.15, antiarmor: 1.05, rapid: 1.12, longrange: 1.05 },
  },
  arid: {
    note: "open desert favors mobility, air & standoff; exposure punishes light infantry & stealth",
    domain: { air: 1.1 },
    trait: {
      armored: 1.08,
      rapid: 1.15,
      longrange: 1.08,
      recon: 1.1,
      allweather: 1.05,
      stealth: 0.85,
    },
  },
};

export interface Role {
  id: string;
  label: string;
  note: string;
  engage: number;
  cas: number;
}
export const ROLES: Role[] = [
  {
    id: "frontline",
    label: "Frontline",
    note: "Main fighting force — absorbs most casualties",
    engage: 1.0,
    cas: 1.35,
  },
  {
    id: "support",
    label: "Support Line",
    note: "Artillery, air defense, engineers, logistics",
    engage: 0.5,
    cas: 0.5,
  },
  {
    id: "reserve",
    label: "Reserve",
    note: "Reinforces, counterattacks, prevents collapse",
    engage: 0.25,
    cas: 0.35,
  },
  {
    id: "flank",
    label: "Flank / Screen",
    note: "Protects flanks, scouts, prevents encirclement",
    engage: 0.7,
    cas: 0.8,
  },
  {
    id: "rear",
    label: "Rear Area",
    note: "Supply, command, hospitals, airbases",
    engage: 0.1,
    cas: 0.15,
  },
  {
    id: "deepstrike",
    label: "Deep Strike",
    note: "Air, missiles, SOF & drones hitting the enemy rear",
    engage: 0.35,
    cas: 0.4,
  },
];

export interface Front {
  id: string;
  name: string;
  region: string;
  terrain: string;
  contested: boolean;
  terr: number;
  infra: number;
  /**
   * Whether this front reaches the sea. Set by `conflictToFront`, which derives it from
   * the host's geography unless the conflict overrides it. Absent means unknown, which
   * `navalReach` treats as inland.
   */
  seaAccess?: boolean;
  /**
   * Combat value this front can hold in contact at once. Set by `conflictToFront` from
   * the terrain. Absent means unknown, which `planEngagement` treats as the base width.
   */
  capacity?: number;
  /**
   * The side fighting on its own soil: whichever holds the conflict's host country,
   * which in an interstate war is the nation declared on. Set by `conflictToFront`.
   * Absent means neither, and nobody gets `FRONT_SUPPLY.hostSideThroughput`.
   */
  hostSide?: "A" | "B";
  sev?: string;
  west?: string;
  east?: string;
  enemyBase?: number;
  file?: string;
  /** Enemy composition keys (design ENEMY_MIX), carried per-conflict now. */
  enemyMix?: string[];
}

/**
 * Homeland / reserve front — the always-valid location a unit sits at when not
 * committed to a conflict. The one static Front that survives the dynamic-conflict
 * refactor; every other Front is now derived from a live conflict (conflictToFront).
 */
export const RESERVE_FRONT: Front = {
  id: "reserve",
  name: "Homeland / Reserve",
  region: "Home garrison",
  terrain: "Rear area",
  contested: false,
  terr: 1.0,
  infra: 100,
};
export const DSPEED: Record<string, number> = {
  air: 0.6,
  rocket: 0.6,
  marine: 0.8,
  naval: 0.9,
  ground: 1.2,
  space: 0.5,
};

// The Conflicts suite operates on the one unified persisted unit model.
// `CombatUnit` is retained as an alias so combat-suite consumers keep their imports.
export type CombatUnit = MilitaryUnit;

export function arche(domain: string, type: string): Archetype | Record<string, never> {
  return (ARCHES[domain] || []).find((a) => a.type === type) || {};
}
export function posDef(id: string): Posture {
  return POSTURES.find((p) => p.id === id) || POSTURES[1];
}
/**
 * Resolve a front by id from the live `fronts` map (built from the conflicts in
 * play, via conflictToFront). A missing id — or no map — falls back to homeland
 * reserve. There is no static front table anymore; conflicts are dynamic.
 */
export function frontById(id: string, fronts?: Record<string, Front>): Front {
  return fronts?.[id] ?? RESERVE_FRONT;
}
export function roleDef(id: string): Role {
  return ROLES.find((r) => r.id === id) || ROLES[0];
}
export function techMult(t: number): number {
  return 0.8 + t * 0.08;
}

/** Per-unit stat card (design computeCard): 8 stats + up-to-4 trait keys (+elite at vet≥3). */
export function computeCard(u: CombatUnit): { stats: [string, number][]; traitKeys: string[] } {
  const a = USTATS[u.type] || {
    atk: 50,
    arm: 40,
    shk: 45,
    mob: 50,
    rng: 40,
    aa: 30,
    rec: 45,
    traits: [],
  };
  const cl = (v: number) => Math.max(3, Math.min(100, Math.round(v)));
  // Legacy/unmigrated units may lack equipment; default to zeros so the dossier
  // renders instead of throwing on a missing field.
  const eq = u.equipment ?? { firepower: 0, protection: 0, support: 0 };
  const stats: [string, number][] = [
    ["Firepower", cl(a.atk + u.techTier * 4 + eq.firepower * 5 + u.vet * 2)],
    ["Armor", cl(a.arm + eq.protection * 7 + u.techTier * 2)],
    ["Shock", cl(a.shk + u.vet * 3 + u.techTier * 2)],
    ["Morale", cl(48 + u.vet * 11 + (u.readiness - 70) * 0.35)],
    ["Mobility", cl(a.mob + u.techTier * 2)],
    ["Range", cl(a.rng)],
    ["Air Defense", cl(a.aa + eq.support * 3)],
    ["Recon", cl(a.rec + eq.support * 4)],
  ];
  const traitKeys = (a.traits || []).slice(0, 4);
  if (u.vet >= 3 && traitKeys.indexOf("elite") < 0) traitKeys.push("elite");
  return { stats, traitKeys };
}

export interface StatObj {
  fp: number;
  ar: number;
  sh: number;
  mo: number;
  mb: number;
  rn: number;
  aa: number;
  rc: number;
}
const STAT_KEY: Record<string, keyof StatObj> = {
  Firepower: "fp",
  Armor: "ar",
  Shock: "sh",
  Morale: "mo",
  Mobility: "mb",
  Range: "rn",
  "Air Defense": "aa",
  Recon: "rc",
};
export function statObj(u: CombatUnit): StatObj {
  const m = {} as StatObj;
  for (const [label, val] of computeCard(u).stats) m[STAT_KEY[label]] = val;
  return m;
}

/** Base effective power — delegates to the one unified power model in constants/military. */
export function effPower(u: CombatUnit): number {
  return computeEffectivePower(u);
}

/** Combined combat-value multiplier from national + general doctrine (design doctrineMult). */
export function doctrineMult(u: CombatUnit, nm: NatMods, gm: GenMods): number {
  let mult = nm.cvAll * (nm.cvDom[u.domain] || 1) * gm.cv;
  const tk = computeCard(u).traitKeys || [];
  for (const t of tk) {
    if (nm.cvTrait[t]) mult *= nm.cvTrait[t];
    if (gm.cvTrait[t]) mult *= gm.cvTrait[t];
  }
  return mult;
}

/** Effective combat value (design combatValue): effPower × readiness curve × doctrineMult. */
export function combatValue(u: CombatUnit, nm: NatMods, gm: GenMods): number {
  return Math.round(effPower(u) * (0.55 + 0.45 * (u.readiness / 100)) * doctrineMult(u, nm, gm));
}

/**
 * What a formation costs in FRONTAGE — `combatValue` without the readiness curve.
 *
 * Frontage is a claim about physical width: how many formations can stand on this
 * ground at once. Readiness is how much fight is left in them, and a worn division
 * occupies the same country as a rested one. Charging the front at `combatValue` made
 * the two move together, with two consequences neither system wanted: restoring a
 * worn army's readiness SHRANK the line it could hold, so every readiness fix silently
 * re-tightened whatever `FRONT_CAPACITY_BASE` had been calibrated against; and a force
 * could widen its own frontage by letting itself degrade.
 *
 * Everything else about a formation still costs room — base platform, veterancy, tech,
 * equipment, doctrine and its general all remain in `effPower`/`doctrineMult`. Only the
 * readiness term, which is a state rather than a size, comes out.
 *
 * Used ONLY by `planEngagement` to decide who stands in the line. What those formations
 * are then WORTH in the fight is still `combatValue`, readiness included.
 */
export function frontageCost(u: CombatUnit, nm: NatMods, gm: GenMods): number {
  return Math.round(effPower(u) * doctrineMult(u, nm, gm));
}

/** Effective upkeep (design effUpkeep): base × posture × country scale × doctrine × general. */
export function effUpkeep(u: CombatUnit, nm: NatMods, gm: GenMods, countryScale: number): number {
  return Math.round(u.upkeepBase * posDef(u.posture).up * countryScale * nm.upkeep * gm.upkeep);
}

/**
 * Terrain multiplier on a unit's contribution, clamped 0.6..1.4 (design terrainFactor).
 *
 * Takes the FRONT, not its id: terrain is resolved from `front.terrain`, which every
 * conflict carries (`conflictToFront`). Keying off the id only ever worked for the four
 * static theaters that no longer exist.
 */
export function terrainFactor(
  front: Pick<Front, "terrain"> | undefined,
  domain: string,
  traitKeys: string[]
): number {
  const family = terrainFamilyOf(front?.terrain);
  const T = family ? TERRAIN[family] : undefined;
  if (!T) return 1;
  let m = 1;
  if (T.domain && T.domain[domain]) m *= T.domain[domain];
  if (T.trait) for (const k of traitKeys || []) if (T.trait[k]) m *= T.trait[k];
  return Math.max(0.6, Math.min(1.4, m));
}

/**
 * How much of a naval formation reaches a land battle, by hull class and sea access.
 *
 * Deliberately NOT folded into `terrainFactor`. That function clamps to 0.6..1.4, which
 * encodes a rule worth keeping -- terrain never swings a unit more than +/-40%. Whether
 * a hull can touch the battle at all is a different question and has to go below 0.6.
 *
 * Only `Carrier Strike Group` carries `strategic` among naval types (the other holders
 * are air, rocket and space domain), so scoping to the naval domain makes that trait a
 * clean carrier test without inventing new data.
 *
 * `marine` is deliberately NOT covered. Marines are amphibious GROUND troops and fight
 * ashore perfectly well, so they take no reach penalty; the terrain table already
 * weights them where it should (`maritime` 1.15, `highland` 0.95). Do not "fix" this by
 * folding marine in with the hulls.
 *
 * `Amphibious Group` lands on the escort side of the split, which is a deliberate
 * simplification rather than an oversight: it puts troops ashore, so it is worth more
 * than a frigate on a coastal front and nothing at all inland, and one number cannot say
 * both. If amphibious assault ever needs its own band, that is a third class, not a
 * reclassification of this one.
 */
/**
 * How much combat value this ground can hold in contact, from its terrain.
 *
 * Unrecognised terrain falls back to the base rather than inventing a family, matching
 * `terrainFactor`, which returns 1 for the same reason.
 */
export function capacityOfTerrain(terrain: string | undefined): number {
  const family = terrainFamilyOf(terrain);
  const mult = family ? TERRAIN_CAPACITY[family] : 1;
  return FRONT_CAPACITY_BASE * mult;
}

export function navalReach(
  front: Pick<Front, "seaAccess"> | undefined,
  domain: string,
  traitKeys: string[]
): number {
  if (domain !== "naval") return 1;
  const band = front?.seaAccess ? NAVAL_REACH.coastal : NAVAL_REACH.inland;
  return (traitKeys || []).includes("strategic") ? band.carrier : band.escort;
}

/** Recommended battle role from a unit's profile (design recommendRole). */
export function recommendRole(u: CombatUnit): string {
  const dom = u.domain;
  const ty = u.type;
  const st = statObj(u);
  const tk = computeCard(u).traitKeys;
  const has = (t: string) => tk.indexOf(t) >= 0;
  if (dom === "rocket" || has("deterrent")) return "deepstrike";
  if (dom === "space" || /Airlift|Launch|Orbital/.test(ty)) return "rear";
  if (
    /Bomber|Drone|Strategic Deterrent|Cruise|Ballistic/.test(ty) ||
    /Special Forces|Attack Submarine/.test(ty)
  )
    return "deepstrike";
  if (has("antiair") || /Artillery|Air Defense/.test(ty)) return "support";
  if (has("recon") || (st.mb >= 72 && st.rc >= 55)) return "flank";
  if (
    st.ar >= 60 ||
    has("shock") ||
    dom === "marine" ||
    /Armored|Mechanized|Infantry|Marine/.test(ty)
  )
    return "frontline";
  return "reserve";
}

/** Effective role, honoring an explicit assignment map over the recommendation. */
export function getRole(positions: Record<string, string>, u: CombatUnit): string {
  return positions[String(u._id)] || recommendRole(u);
}
