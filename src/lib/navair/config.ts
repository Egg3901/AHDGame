/**
 * What each naval vessel and air wing does. NAVAL_TYPES (Carrier Strike Group,
 * Guided-Missile Destroyer, Attack Submarine, Frigate Squadron, Amphibious Group)
 * and AIR_TYPES carry power and crew; ORGANIC_AA is how much of a hull fights
 * aircraft (carriers 0.55, submarines near zero). NAVAL_MISSIONS (Blockade, Sea
 * Control, Sea Denial, Escort, Transit, Return to Port) and AIR_MISSIONS set lane
 * pressure, combat weight and the readiness each mission costs per turn.
 */
/**
 * Blue Water: tuning and taxonomy.
 *
 * Every balance number in the engine lives here, following AHD's own rule that
 * `src/lib/military/calc.ts` may contain no magic numbers. Unit archetypes are the
 * real AHD ones (`src/lib/constants/military.ts` UNIT_TYPES) with their published
 * `power` untouched, so a formation is worth the same here as it is in the game.
 */

/** Naval archetypes, verbatim from AHD UNIT_TYPES.naval. */
export const NAVAL_TYPES = {
  "Carrier Strike Group": { icon: "carrier", power: 99, personnel: 7500, speed: 2 },
  "Guided-Missile Destroyer": { icon: "ship", power: 64, personnel: 330, speed: 2 },
  "Attack Submarine": { icon: "sub", power: 81, personnel: 130, speed: 2 },
  "Frigate Squadron": { icon: "ship", power: 49, personnel: 600, speed: 2 },
  "Amphibious Group": { icon: "carrier", power: 70, personnel: 2800, speed: 1 },
} as const;

export type NavalType = keyof typeof NAVAL_TYPES;
export type NavalTypeInfo = (typeof NAVAL_TYPES)[NavalType];

/** Air archetypes, verbatim from AHD UNIT_TYPES.air (Drone Command is 1995+, so omitted). */
export const AIR_TYPES = {
  "Fighter Wing": { icon: "jet", power: 88, personnel: 1800, radius: 1 },
  "Bomber Squadron": { icon: "jet", power: 84, personnel: 900, radius: 2 },
  "Airlift Wing": { icon: "transport", power: 38, personnel: 1500, radius: 2 },
  "Air Defense Wing": { icon: "missile", power: 66, personnel: 1100, radius: 0 },
} as const;

export type AirType = keyof typeof AIR_TYPES;
export type AirTypeInfo = (typeof AIR_TYPES)[AirType];

/**
 * How much of a hull's own combat value is available to shoot down aircraft.
 *
 * A carrier's number is high because the number IS its air wing: this model does not
 * embark separate squadrons, so the CSG's organic fighters are folded into its own
 * self-defence. A destroyer is the dedicated AAW escort of the period and rates second.
 * A submarine dives and contributes essentially nothing, which is what makes a
 * sub-only blockade cheap to mount and cheap to break.
 */
export const ORGANIC_AA: Record<NavalType, number> = {
  "Carrier Strike Group": 0.55,
  "Guided-Missile Destroyer": 0.4,
  "Frigate Squadron": 0.28,
  "Amphibious Group": 0.15,
  "Attack Submarine": 0.04,
} as const;

/** Which hulls can fly missions. Only the carrier: that is the point of a carrier. */
export const CAN_FLY: ReadonlySet<NavalType> = new Set<NavalType>(["Carrier Strike Group"]);

/**
 * Naval postures. `embargo` is the share of the hull's value that counts toward closing
 * a sea lane; `combat` is its share in a surface engagement; `signature` is how much
 * easier it is to find and therefore to hit.
 */
export const NAVAL_MISSIONS = {
  BLOCKADE: {
    label: "Blockade",
    embargo: 1.0,
    combat: 0.7,
    signature: 1.35,
    readiness: 14,
    desc: "Maximum pressure on the lane. You are sitting still where everyone can see you.",
  },
  SEA_CONTROL: {
    label: "Sea Control",
    embargo: 0.55,
    combat: 1.0,
    signature: 1.0,
    readiness: 12,
    desc: "Fight for the water. Some lane pressure, full weight in a surface action.",
  },
  SEA_DENIAL: {
    label: "Sea Denial",
    embargo: 0.7,
    combat: 0.6,
    signature: 0.45,
    readiness: 10,
    desc: "Submarine posture. Hard to find, hard to strike, weak in a stand-up fight.",
  },
  ESCORT: {
    label: "Escort",
    embargo: 0.15,
    combat: 0.8,
    signature: 0.8,
    readiness: 8,
    desc: "Screen the group. Doubles this hull's anti-air contribution.",
  },
  TRANSIT: {
    label: "Transit",
    embargo: 0,
    combat: 0.4,
    signature: 0.9,
    readiness: 10,
    desc: "Move. You fight badly while you are moving.",
  },
  PORT: {
    label: "Return to Port",
    embargo: 0,
    combat: 0.2,
    signature: 0.5,
    readiness: -30,
    desc: "Rest and rearm. Recovers readiness fast, projects nothing.",
  },
} as const;

export type NavalMissionKey = keyof typeof NAVAL_MISSIONS;
export type NavalMission = (typeof NAVAL_MISSIONS)[NavalMissionKey];

/** Air missions. One per wing per turn. */
export const AIR_MISSIONS = {
  CAP: {
    label: "Combat Air Patrol",
    readiness: 12,
    desc: "Defend everything you own in this region. Intercepts inbound strikes.",
  },
  STRIKE_NAVAL: {
    label: "Anti-Ship Strike",
    readiness: 20,
    desc: "Hit enemy hulls in a region you can reach. Needs a detection level of 2 or better.",
  },
  STRIKE_AIRBASE: {
    label: "Airfield Strike",
    readiness: 22,
    desc: "Hit enemy air wings on the ground. The only way to stop a bomber threat at its source.",
  },
  CAS: {
    label: "Close Air Support",
    readiness: 16,
    desc: "Add weight to the ground front. The only air mission that moves the land war.",
  },
  PATROL: {
    label: "Recon Patrol",
    readiness: 8,
    desc: "Raise detection here and one region out. Contributes nothing to a fight.",
  },
  AIRLIFT: {
    label: "Airlift",
    readiness: 8,
    desc: "Sustain friendly assets here and one region out. Raises their supply ceiling.",
  },
  STANDDOWN: {
    label: "Stand Down",
    readiness: -30,
    desc: "Rest the crews. Recovers readiness fast.",
  },
} as const;

export type AirMissionKey = keyof typeof AIR_MISSIONS;
export type AirMission = (typeof AIR_MISSIONS)[AirMissionKey];

export const ESCORT_AA_BONUS = 2.0;

/**
 * How much port capacity a formation consumes to operate out of a region.
 *
 * Not crew, not displacement: logistical footprint. A carrier group needs fuel, ordnance,
 * aviation stores and a tender; a submarine needs a pier and a torpedo shed. The ratio,
 * not the absolute numbers, is what matters: three subs cost what one carrier costs.
 */
export const BERTH_COST: Record<NavalType, number> = {
  "Carrier Strike Group": 3,
  "Amphibious Group": 2,
  "Guided-Missile Destroyer": 1,
  "Frigate Squadron": 1,
  "Attack Submarine": 1,
} as const;

/**
 * What share of a region's port capacity is actually available to you, by whose region
 * it is.
 *
 * Basing rights are political, not geographic. Your own ports are yours. An ally's ports
 * are yours on sufferance and never at full throughput, 75%, because you are queueing
 * behind their navy for the same cranes and the same fuel. A neutral sells you what it
 * feels like selling. Operating off a hostile coast means you brought everything with you.
 *
 * This is the term that stops a superpower steamrolling by mass. A big fleet can go
 * anywhere; it cannot be SUSTAINED anywhere, and unsustained tonnage fights badly.
 */
export type BasingKey = "home" | "allied" | "neutral" | "hostile";
export const BASING_FACTOR: Record<BasingKey, number> = {
  home: 1.0,
  allied: 0.75,
  neutral: 0.4,
  hostile: 0.2,
} as const;

/** Supply ceiling lost per point of berth demand over the available capacity. */
export const OVERCROWD_PENALTY = 6;

/**
 * Forward basing the defence ministry can buy: tenders, anchorages, fuel barges.
 *
 * The answer to a hostile-coast penalty you cannot politically fix. Deliberately slow and
 * rationed: the point is to make the player commit engineering effort several turns
 * before the blockade needs it, not to hand out a toggle that erases the constraint.
 */
export const PORT_WORKS = {
  /** Turns from breaking ground to the capacity arriving. */
  buildTurns: 3,
  /** Capacity added when it completes. */
  capacityGain: 2,
  /** Concurrent projects allowed. One: this is a choice, not a build queue. */
  maxConcurrent: 1,
} as const;

/** Readiness and supply both scale combat value, and neither ever zeroes it out. */
export const READINESS_FLOOR = 0.45;
export const SUPPLY_FLOOR = 0.5;

/**
 * The operational-tempo escalator, the same idea as AHD's `READINESS_TEMPO_K`.
 *
 * A worn formation pays up to `1 + K` times the base readiness cost for the same
 * sortie.
 *
 * Set to 3 to match AHD's existing `READINESS_TEMPO_K`, NOT to the reference's 1.2.
 * The reference softened it because its scenario is twelve turns: it measured that at
 * 3, a wing that flew twice was finished, and the cadence choice collapsed into
 * "never fly". That finding stands and is the known risk here. It is accepted because
 * a 400+ turn world has room to recover between sorties that a twelve turn one does
 * not, and because one subsystem quietly running a different tempo constant from the
 * rest of the military model is the worse failure.
 *
 * If the static replay shows air formations parking permanently, this is the first
 * constant to look at.
 */
export const TEMPO_K = 3;

/** Readiness recovered per turn beyond whatever the mission charges. */
export const READINESS_REGEN = 6;

/** Supply moves toward its ceiling by this much per turn, in both directions. */
export const SUPPLY_STEP = 15;

/** Supply ceiling = 100 - hops * this - the terrain's logistics penalty. */
export const SUPPLY_PER_HOP = 17;
export type LogiLevel = "Low" | "Medium" | "High" | "Severe";
export const LOGI_PENALTY: Record<LogiLevel, number> = {
  Low: 0,
  Medium: 6,
  High: 14,
  Severe: 24,
} as const;
export const AIRLIFT_SUPPLY_BONUS = 25;
export const MIN_SUPPLY = 10;

/**
 * Share of a force that the worst possible engagement takes. AHD's
 * `CASUALTY_RATE_SCALE`, unchanged at 0.5.
 */
export const CASUALTY_RATE_SCALE = 0.5;

/**
 * What share of that a single turn's surface action actually delivers.
 *
 * AHD applies `CASUALTY_RATE_SCALE` to a much richer formula with frontage caps and
 * armour mitigation in front of it. Applied raw here it cost each side 25% of its hulls
 * per turn at parity, so any contested water annihilated both fleets in four turns and
 * the twelve-turn scenario was decided before the embargo track could move at all.
 *
 * At 0.4 a parity engagement costs about a tenth of a force per turn: contesting a lane
 * is a grind you can choose to fight or choose to avoid, which is the decision the
 * positioning layer is supposed to present.
 */
export const NAVAL_ENGAGEMENT_INTENSITY = 0.4;

/** Extra readiness a unit loses for having been in a fight at all. */
export const COMBAT_READINESS_DROP = 10;

/**
 * Damage repair per turn.
 *
 * Without this every contested position is terminal: nothing in a twelve-turn scenario
 * could recover a hull, so a blockade that got shot at once was on a countdown and the
 * only unbeaten strategy was to never contest anything. Repair turns that into a
 * ROTATION decision, pull the damaged ship home and lose the lane pressure while it
 * mends, or keep it on station at declining value, which is the choice the positioning
 * layer exists to pose.
 *
 * Deliberately zero for a unit that fought this turn. You mend between engagements, not
 * during one.
 */
export const REPAIR = {
  /** Resting in port, or an air wing stood down. */
  inPort: 12,
  /** On station and out of contact, at full supply. */
  onStation: 5,
  /**
   * Repair scales linearly with supply from nothing at `minSupply` to full at 100,
   * rather than switching on at a threshold.
   *
   * A hard gate at 60 put the Arctic station at supply 59, one point short, so a fleet
   * blockading Murmansk could never mend at all, and every game plateaued with both
   * navies wrecked and the lane stuck below target. Scaling also gives Airlift a real
   * job: lifting the Arctic to 84 supply roughly triples what a hull recovers there.
   */
  minSupply: 35,
} as const;

/**
 * Air-to-sea exchange.
 *
 * A strike that arrives over an undefended group is devastating and a strike that
 * arrives over a defended one gets mauled, which is the whole reason to spend a wing
 * on CAP instead of on the front.
 */
export const STRIKE = {
  /**
   * Damage to the target force at total air superiority.
   *
   * The ramp below starts at an edge of 0.40 rather than 0.35, so a defended group takes
   * very little and an undefended one takes a great deal. A shallower curve made every
   * air decision worth about four points of hull, which is to say worth nothing.
   */
  maxTargetLoss: 0.55,
  /** Air-superiority edge below which a strike achieves nothing. */
  edgeFloor: 0.4,
  /** Losses to the strike package when the defence is at parity or better. */
  maxStrikeLoss: 0.3,
  /** Detection level below which a strike cannot be assigned a target. */
  minDetection: 2,
  /**
   * An airfield's own flak and dispersal, scaled off the region's airbase rating.
   *
   * Without it a developed airbase was softer than a frigate: strike packages faced only
   * whatever fighters happened to be on CAP, so suppressing enemy air was free and the
   * air theatre collapsed into whoever struck first.
   */
  airbaseDefenceScale: 4.5,
} as const;

/** Detection levels, 0 (dark) to 3 (full order of battle). */
export const DETECTION = {
  PRESENT: 3,
  PATROL_HERE: 3,
  PATROL_ADJACENT: 2,
  PASSIVE_ADJACENT: 1,
  /** A contact you held last turn and lost decays by this much rather than vanishing. */
  DECAY: 1,
} as const;

/**
 * Embargo. Pressure is a track, not a state: it takes several turns of presence to
 * close a lane and one turn of absence to lose most of it. That asymmetry is what
 * makes the positioning decision a commitment rather than a toggle.
 */
export const EMBARGO = {
  buildPerTurn: 12,
  /**
   * Still faster than the build, so leaving station is never free, but 25 was punitive
   * against a twelve-turn clock: one turn of the carrier flying air defence cost two
   * turns of rebuilding, so any reactive play fell permanently behind the objective.
   */
  decayPerTurn: 15,
  /**
   * A big port resists closure. Defence value = port rating * this.
   *
   * Calibrated against the fleet that has to overcome it: the whole NATO force is worth
   * about 200 embargo value at full health and rather less after a few turns of contact.
   * At 12 the Mediterranean alone defended at 96, so a worn two-ship blockade could not
   * move that lane at all and the southern half of the map was decoration.
   */
  portDefenceScale: 7,
} as const;

/**
 * Ground front. Air is the only lever this slice gives you over it.
 *
 * Calibrated so the scenario's standing deficit costs about 3.5 control points a turn,
 * the line falls around turn ten if you never fly close air support, and so ONE fighter
 * wing on CAS slightly more than cancels it. That makes the front a standing tax on your
 * air, not a side show: the wing holding the line is the wing not covering the fleet.
 */
export const FRONT = {
  /** Control points moved per unit of net push. */
  pushScale: 2.2,
  /** CAS combat value converted to push at this rate. */
  casScale: 0.02,
} as const;
