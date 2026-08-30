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
  /**
   * A side breaks when its round track falls below this (of 100).
   *
   * Was 25, which fired in 88-92% of battles -- so `retreatYield` and
   * `retreatCasualtyMult` were flat taxes the code described as conditional. At 9 a
   * break is roughly one battle in three: uncommon without being rare, which is what
   * makes both modifiers mean something again.
   */
  retreatTrack: 9,
  /**
   * How far a single battle's luck can move the odds it is actually fought at.
   *
   * `battleForecast` clamps `ratio` to 0.02..0.98 and every player-facing surface
   * calls it a chance -- the war room's "You attack" row, and the wiki's "Your chance
   * if you launch the offensive". The five-round attrition loop did not deliver that.
   * Its damage multipliers are `0.5 + ratio` and `1.5 - ratio`, so over five rounds
   * the two tracks separate by about `80 * (2 * ratio - 1)` against a round-to-round
   * spread of only ~15. That is a near-deterministic function of the force balance: a
   * projected 16% won 0.01% of the time and a projected 84% won 99.99%. Players read
   * the number as a probability, watched the stronger side win every time, and filed
   * it as the odds being wrong or the enemy being impossibly lucky. Both readings were
   * fair -- `oddsPct` was a force share wearing a probability's label.
   *
   * One roll per battle shifts the ratio the loop fights at:
   *
   *   effective = ratio + uniform(-fortuneSpread, +fortuneSpread)
   *
   * At exactly 0.5 the arithmetic is self-calibrating rather than fitted. The loop
   * turns on whether `effective` clears 0.5, and `effective` is uniform on a window of
   * width 1 centred on `ratio`, so P(effective > 0.5) is `ratio` itself. Measured over
   * 300k seeds the realised win rate tracks the projection to within 0.7 points from
   * 10% to 90%, with the tails compressed inward (2% -> 4.8%, 98% -> 95.3%) because
   * round-to-round noise still smears across the clamp.
   *
   * Drawn ONCE for the whole engagement, not per round: a side that has a good day
   * fights the whole battle well, which is what the round notes, the casualty split
   * and the margin already assume.
   */
  fortuneSpread: 0.5,
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
/**
 * What one engagement takes out of a formation's readiness, before modifiers.
 *
 * Readiness used to be ASSIGNED a level rather than subtracted, which inverted two of
 * its own terms: `armorMit` and the role's casualty weight both correctly reduce
 * CASUALTIES, and applied to a level they left armour and safe roles MORE exhausted. A
 * carrier that lost three men ended a battle at 8 readiness while an infantry division
 * that lost thousands ended at 25.
 */
/**
 * How much combat value a front can hold in contact at once, on open ground.
 *
 * A front has finite width. Value beyond this is in DEPTH: it neither fights nor bleeds
 * this turn. Bounds the casualty growth at its source -- side totals used to go as
 * roughly `0.6N + 1`, so committing more men cost more men even when they could not all
 * reach the line -- and makes the ground cap a consequence of frontage rather than an
 * arbitrary rule.
 *
 * Denominated in `frontageCost` -- combat value WITHOUT the readiness curve -- so this
 * number is not comparable to the 900 that preceded it. Frontage used to be billed at
 * full combat value, which charged an army for how good and how rested it was; the old
 * calibration note read "East Germany's eleven formations are 731 combat value", a
 * figure that both predated general modifiers (x1.4-2.3) and moved every time a force
 * rested. Same formations under the current bill: 1,138.
 *
 * Re-derived at 4,000 in scripts/sim/frontCapacity2026-08-28.ts. It is the SMALLEST
 * frontage at which the size of an army orders the result the way a player expects. At
 * 900 and at 2,400 the curve is inverted -- the Soviet Army's 44 formations fight worse
 * alone than East Germany's 11, because a cap this tight is spent on whichever side has
 * the better divisions rather than the bigger army. From 4,000 the ordering is
 * DD alone 47% < RU alone 56% < DD+RU 60%, and the war run forward resolves the way the
 * fiction says it should: East Germany alone loses to the US on turn 385, and with
 * Soviet backing takes the map on turn 42.
 *
 * Deliberately not higher. Above 6,000 the whole coalition is in the line at once and
 * the war collapses to 26 turns, which buys nothing the ordering has not already given
 * and removes the cost of winning it.
 */
export const FRONT_CAPACITY_BASE = 4000;

/**
 * Share of a formation's strength that the worst possible engagement takes.
 *
 * Was an unnamed `0.5` inline in the casualty formula, which this file's own opening
 * line forbids: all balance values live here. Named so it can be tuned against a
 * simulation rather than found by reading the calc layer.
 *
 * DELIBERATELY UNCHANGED at 0.5. The design expected to cut this by about 11%, to absorb
 * the casualty discount that stopped being near-universal once `retreatTrack` made a
 * break uncommon. Measured after front capacity and the readiness ledger landed, the
 * compensation is not needed and would overshoot: casualties FELL rather than rose,
 * because capacity removed the formations that were bleeding without ever reaching the
 * line. A solo offensive costs 5.4% of the attacking force against 7.8% before this
 * work. Revisit only against a fresh simulation.
 */
export const CASUALTY_RATE_SCALE = 0.5;

/** How much of that width each terrain family actually offers. */
export const TERRAIN_CAPACITY = {
  /** The armoured corridor. The calibration case. */
  temperate: 1.0,
  /** Open desert, the widest frontage there is. */
  arid: 1.1,
  /** No land frontage to constrict. */
  maritime: 1.0,
  /** Canopy, swamp and delta break up a line. */
  littoral: 0.8,
  /** Passes constrict everything. */
  highland: 0.65,
} as const;

export const READINESS_DROP_BASE = 12;

/**
 * How much harder a worn formation is worked than a rested one, at full depletion.
 *
 * The operational-tempo escalator. A rested formation pays the base cost; one that has
 * been fighting without rest pays up to `1 + K` times as much for the same battle, so a
 * continuous pace genuinely leaves little room for rest.
 *
 * This term, not a smaller base, is what creates a cadence tradeoff. Measured: cutting
 * the cost from 77 to 8 with no escalator still made attacking every single turn the
 * best play by a wide margin. At K = 3 the optimum is every third turn and attacking
 * every turn goes NEGATIVE on ground taken.
 */
export const READINESS_TEMPO_K = 3;

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
   * Progress from the front's STARTING line at which a war reads as winding down
   * (`battleResolution.ts`). `peaceOffer.ts` keeps its own copy of the same value
   * as the ground a settlement may demand. Measured from the start, since an
   * interstate war opens with the defender already holding all of its own soil.
   *
   * This used to also gate a `deepPushMult` that halved every advance once the
   * winner's ABSOLUTE share crossed it. Because it keyed on the winner, past that
   * mark the attacker's wins were halved and the defender's were not, which on a
   * near-even front is a wall rather than a slowdown (see
   * `scripts/sim/reports/control-drift-deep-push.md`). The supply penalties in
   * `derivedSupply` already slow a deep push, so the drag was removed from
   * `occupationShift`.
   */
  deepPushDepth: 0.75,
  /** Supply lost at full compression / full overextension, off the side's baseline. */
  compressionPenalty: 40,
  overextensionPenalty: 15,
  /** Supply never falls below this. */
  minSupply: 10,
  /** Conflict supply at which a side's theatre logistics are neutral (×1.0). */
  supplyNeutral: 60,
} as const;
