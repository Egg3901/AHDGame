// Tuning + presentation config for the Military Commands suite. All balance
// values live here — calc.ts must contain no magic numbers. Values are ported
// verbatim from the design mockup's DCLogic.
import type { CommandType, CommandPosture } from "./types";

export const COMMAND_TYPES: Record<
  CommandType,
  {
    label: string;
    short: string;
    bonuses: string[];
    mockupKey: "homeland" | "regional" | "logistics";
  }
> = {
  HOMELAND_DEFENSE: {
    label: "Homeland Defense",
    short: "HOMELAND",
    mockupKey: "homeland",
    bonuses: ["+ homeland defense", "+ air-defense integration", "+ faster reserve mobilization"],
  },
  REGIONAL: {
    label: "Regional Command",
    short: "REGIONAL",
    mockupKey: "regional",
    bonuses: ["+ balanced command", "+ regional readiness", "+ multi-region responsibility"],
  },
  LOGISTICS: {
    label: "Logistics",
    short: "LOGISTICS",
    mockupKey: "logistics",
    bonuses: ["+ supply throughput", "+ deployment speed", "+ overseas sustainment"],
  },
};

/** Map mockup lowercase key -> enum (for porting seed data). */
export const TYPE_FROM_MOCKUP: Record<string, CommandType> = {
  homeland: "HOMELAND_DEFENSE",
  regional: "REGIONAL",
  logistics: "LOGISTICS",
};

export const POSTURES: CommandPosture[] = [
  "Defensive",
  "Deterrence",
  "Expeditionary",
  "Counterinsurgency",
  "Invasion Prep",
  "Occupation",
  "Sea Control",
  "Sea Denial",
  "Air Defense",
  "Strategic Strike",
  "Rapid Response",
  "Training / Reserve",
];

export const POSTURE_FX: Record<CommandPosture, string[]> = {
  Defensive: ["+ defense readiness", "− offensive planning speed"],
  Deterrence: ["+ crisis response", "+ forward presence"],
  Expeditionary: ["+ deployment speed", "+ overseas sustainment", "− higher supply cost"],
  Counterinsurgency: [
    "+ stability operations",
    "+ intelligence-led security",
    "− conventional offense",
  ],
  "Invasion Prep": ["+ planning bonus", "+ amphibious/airborne readiness", "− high political risk"],
  Occupation: ["+ garrison control", "− tied-down forces"],
  "Sea Control": ["+ sea-lane security", "+ carrier operations"],
  "Sea Denial": ["+ area denial", "+ submarine ops"],
  "Air Defense": ["+ interception", "+ airspace integrity"],
  "Strategic Strike": ["+ deep strike", "+ deterrence"],
  "Rapid Response": ["+ reaction speed", "− sustainment depth"],
  "Training / Reserve": ["+ readiness recovery", "− not deployable"],
};

/** SVG path data for force branch icons (rendered in the detail panel). */
export const FORCE_ICONS: Record<string, string> = {
  army: "M4 20h16M6 20V9l6-4 6 4v11M9 20v-5h6v5",
  armor: "M3 15h18v3H3zM5 15v-3h14v3M8 12V9h8v3M11 9V7",
  air: "M12 3v18M3 12h18M6 8l6-5 6 5M6 16l6 5 6-5",
  marine: "M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z",
  navy: "M4 16l8 4 8-4M6 16V8l6-3 6 3v8M12 5v11",
  log: "M3 8h11v8H3zM14 11h4l3 3v2h-7zM7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm10 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  missile: "M12 2c2 2 3 5 3 9v5l2 3H7l2-3v-5c0-4 1-7 3-9zM12 20v2",
};

/** Effectiveness color thresholds -> AHD status intent ("success" | "warn" | "error"). */
export const EFF_THRESHOLDS = { good: 82, ok: 70 } as const;

/** Effectiveness penalty tuning (from mockup effOf). */
export const CAPACITY = {
  /** −10 effectiveness when a command has no commander. */
  noCommanderPenalty: 10,
  /** −1.6 effectiveness per point of force-load over capacity. */
  overCapacityFactor: 1.6,
  effFloor: 20,
} as const;

/**
 * Theater Commander — the one general `inCharge` of a Conflict.
 *
 * Their command bonus applies once, front-wide, to every own unit there: this
 * share of the combat-value edge their own trained traits would give the units
 * they personally lead. Deliberately a fraction, so a single strong TC can never
 * replace putting good generals on the units themselves — being in charge is
 * worth less than being present.
 *
 * Tune here. 0 disables the bonus without touching battle math.
 */
export const THEATER_COMMAND = {
  /** Fraction of the TC's own cv edge that carries to the whole front. */
  bonusShare: 0.25,
  /**
   * Share of a fighting general's award that the TC earns for a battle in their
   * theater, whether or not they led any unit in it.
   *
   * Directing a front earned NOTHING before this: a player ran three successful
   * offensives as Theater Commander and their general gained no XP at all, because
   * credit flowed only to generals with units assigned to them at that front.
   *
   * The measure is what a general leading ONE AVERAGE FORMATION at that front would
   * have earned. Deliberately not the front's total: that would let a superpower's TC
   * level many times faster than a small nation's for the same work. Deliberately not
   * the mean over the generals present either — that moves when you reshuffle which
   * general holds which unit, so command structure could be gamed for XP. This measure
   * reads only the fighting.
   *
   * Half, because commanding is worth less than commanding AND fighting.
   */
  xpShare: 0.5,
} as const;

/** Max regions per command. */
export const REGION_CAP = 3;

export const MAP_FILTERS = [
  { id: "coverage", label: "COVERAGE" },
  { id: "threat", label: "THREAT" },
  { id: "logi", label: "LOGISTICS" },
  { id: "naval", label: "NAVAL" },
  { id: "air", label: "AIRBASE" },
  { id: "ops", label: "OPERATIONS" },
  { id: "unassigned", label: "UNASSIGNED" },
];

/** Static national-doctrine effects surfaced in the command detail (design's DOCTRINE list). */
export const NATIONAL_DOCTRINE_EFFECTS = [
  { val: "+8%", label: "joint operations — Joint Staff System" },
  { val: "+10%", label: "supply throughput — Strategic Logistics" },
  { val: "+6%", label: "Army/Air coordination — Air-Land Battle" },
  { val: "+8%", label: "overseas command range — Blue-Water Navy" },
  { val: "+10%", label: "overseas sustainment — Expeditionary Supply Chains" },
];

export const MISSING_SYNERGY =
  "Unified Theater Commands would reduce over-capacity penalties across regional commands.";

/** Attrition, manpower and retreat tuning (first-pass — expected to move in playtest). */
export const ATTRITION = {
  /** A side breaks when its round track falls below this (of 100). */
  retreatTrack: 25,
  /** Casualty multiplier for the side that broke off. */
  retreatCasualtyMult: 0.6,
  /** Max fraction of establishment refilled per turn, by mode. */
  trainedFillRatio: 0.1,
  conscriptFillRatio: 0.25,
  /** Experience score (vet×100 + xp) replacements arrive with. */
  trainedExpScore: 100,
  conscriptExpScore: 0,
  /** Pool regen per turn = population × this × stance multiplier. */
  manpowerRegenFraction: 0.0005,
  /** Pool ceiling = population × this × stance multiplier. */
  manpowerPoolCapFraction: 0.02,
} as const;

/**
 * How much of a naval formation's combat value reaches a LAND battle.
 *
 * A carrier air wing genuinely strikes inland; escorts exist to screen the carrier and
 * hold sea lanes, and contribute almost nothing to a division fighting inland of them.
 * Before this, `temperate` and `arid` -- the two families covering every inland front in
 * the game -- carried no naval multiplier at all, so a carrier strike group defended a
 * German forest at full strength and an attack submarine did it at 1.05.
 */
export const NAVAL_REACH = {
  coastal: { carrier: 1.0, escort: 0.4 },
  inland: { carrier: 0.5, escort: 0.1 },
} as const;

/**
 * Territorial control. `ConflictDoc.control` is the share of the HOST country's
 * territory held by side B (0 = side A holds all of it, 100 = side B holds all).
 * Battles move it; reaching a pole ends the war.
 */
export const OCCUPATION = {
  /** Battle `margin` at which a win counts as decisive (mirrors the verdict ladder). */
  decisiveMargin: 45,
  /** Points of the 0–100 track a decisive win takes. */
  maxShift: 5,
  /** Ground multiplier when the loser broke off instead of being broken in place. */
  retreatYield: 0.7,
  /**
   * Depth threshold, read two ways. For the advance drag it is the winner's ABSOLUTE
   * share — the last quarter of the track, the enemy heartland. For the
   * winding-down status it is progress from the front's STARTING line, since an
   * interstate war opens with the defender already holding all of its own soil.
   */
  deepPushDepth: 0.75,
  deepPushMult: 0.5,
  /** Supply lost at full compression / full overextension, off the side's baseline. */
  compressionPenalty: 40,
  overextensionPenalty: 15,
  /** Supply never falls below this. */
  minSupply: 10,
  /** Conflict supply at which a side's theatre logistics are neutral (×1.0). */
  supplyNeutral: 60,
} as const;
