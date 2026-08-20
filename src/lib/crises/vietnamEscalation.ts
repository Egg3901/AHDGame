import type { Db } from "mongodb";
import type { CrisisEffect } from "@/lib/db/types/crisis";
import { toNativeEffectValue } from "@/lib/crises/effectScale";

/**
 * The Vietnam escalation ladder: the shared state behind the chained Vietnam
 * crisis family.
 *
 * The crisis templates are the surface: each rung spawns a crisis that asks both
 * superpower leaders what they want to do. This module is the substance. It owns
 * the ladder itself (which rung the war is on), the two sides' committed
 * support, how long the war has dragged on, and the derived dial values every
 * other system reads.
 *
 * Everything above `getVietnamEscalation` is pure and DB-free so the ladder can
 * be tested as a state machine. The DB layer is a thin read/modify/write over a
 * single singleton document.
 */

export const VIETNAM_ESCALATION_ID = "current";
export const VIETNAM_ESCALATION_COLLECTION = "vietnamEscalation";

/** In-game years the Vietnam family may run. Matches the template era windows. */
export const VIETNAM_FROM_YEAR = 1955;
export const VIETNAM_UNTIL_YEAR = 1975;

/** Which side of the ladder a superpower commands. */
export type VietnamSide = "west" | "east";

/**
 * Which superpower commands which side. The Americans back the South, the
 * Soviets back the North, and nobody else is on this ladder: a third country
 * with an opinion about Vietnam has other channels for it.
 */
export const VIETNAM_LADDER_SIDES: Readonly<Record<string, VietnamSide>> = {
  US: "west",
  RU: "east",
};

export function vietnamSideForCountry(countryId: string): VietnamSide | null {
  return VIETNAM_LADDER_SIDES[countryId] ?? null;
}

export interface VietnamRung {
  /** 0 = no shooting war on the ladder. 1..6 climb toward general war. */
  level: number;
  /** Stable id, also the crisis template key suffix. */
  key: string;
  label: string;
  /** One line of player-facing framing for the rung. */
  summary: string;
  /** Global readiness this rung pulls DEFCON toward (5 = calm, 1 = imminent). */
  defcon: number;
  /** Share of GDP a support pledge costs at this rung. */
  supportPctGdp: number;
  /** Extra procurement demand this rung creates, as a multiplier on the baseline. */
  procurementMultiplier: number;
  /**
   * Earliest in-game year this rung may be reached, anchored to the historical
   * arc (Gulf of Tonkin 1964, Rolling Thunder 1965, ground troops 1965-66).
   * Pressure alone cannot climb past a rung before its year: without this floor
   * an aggressive US/RU races the whole 1955-1975 ladder in a couple of game
   * years. The opening rung shares VIETNAM_FROM_YEAR so it is never blocked.
   */
  earliestYear: number;
}

/**
 * The ladder. Six rungs, historically shaped: advisors, then materiel, then the
 * naval incident that changes the legal footing of the whole war, then bombing,
 * then ground troops, then a war nobody can quietly leave.
 *
 * Level 0 is not a rung. It is the ladder being empty, which is what a
 * successful de-escalation off rung 1 produces.
 */
export const VIETNAM_RUNGS: readonly VietnamRung[] = [
  {
    level: 1,
    key: "advisors",
    label: "Military advisors",
    summary: "A few hundred officers, training missions, and nobody calls it a war.",
    defcon: 4,
    supportPctGdp: 0.001,
    procurementMultiplier: 1.05,
    earliestYear: 1955,
  },
  {
    level: 2,
    key: "materiel",
    label: "Materiel and money",
    summary: "Rifles, trucks, aircraft and hard currency, shipped to a client that cannot pay.",
    defcon: 4,
    supportPctGdp: 0.002,
    procurementMultiplier: 1.15,
    earliestYear: 1959,
  },
  {
    level: 3,
    key: "tonkin_incident",
    label: "Naval incident",
    summary:
      "Shots reported in the gulf. Whatever happened out there, the resolution that follows hands the executive a free hand.",
    defcon: 3,
    supportPctGdp: 0.003,
    procurementMultiplier: 1.35,
    earliestYear: 1964,
  },
  {
    level: 4,
    key: "air_campaign",
    label: "Air campaign",
    summary: "Sustained bombing. Measured in sorties, tonnage, and pilots who do not come back.",
    defcon: 3,
    supportPctGdp: 0.006,
    procurementMultiplier: 1.6,
    earliestYear: 1965,
  },
  {
    level: 5,
    key: "ground_commitment",
    label: "Ground commitment",
    summary: "Combat divisions ashore. The draft stops being an abstraction at home.",
    defcon: 2,
    supportPctGdp: 0.011,
    procurementMultiplier: 2.0,
    earliestYear: 1966,
  },
  {
    level: 6,
    key: "full_war",
    label: "Full war",
    summary: "A land war in Asia with no ceiling, no exit date, and a body count on the news.",
    defcon: 2,
    supportPctGdp: 0.018,
    procurementMultiplier: 2.5,
    earliestYear: 1968,
  },
] as const;

export const VIETNAM_MAX_LEVEL = VIETNAM_RUNGS[VIETNAM_RUNGS.length - 1].level;

/** The level at and above which the war reads as a shooting war at home. */
export const VIETNAM_WAR_LEVEL = 4;

/** The rung for a level, or null when the ladder is empty (level 0). */
export function rungForLevel(level: number): VietnamRung | null {
  return VIETNAM_RUNGS.find((r) => r.level === level) ?? null;
}

/** Crisis template key for a rung level. Null when the ladder is empty. */
export function vietnamTemplateKeyForLevel(level: number): string | null {
  const rung = rungForLevel(level);
  return rung ? `vietnam_${rung.key}` : null;
}

export function clampVietnamLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(VIETNAM_MAX_LEVEL, Math.round(level)));
}

export interface VietnamEscalationState {
  /**
   * True once the family has opened in this world. Distinguishes "the war has
   * not started yet" from "the war was talked down to nothing", which are the
   * same `level: 0` but must not both re-open the chain.
   */
  hasOpened: boolean;
  level: number;
  /** Cumulative support committed by each side, 0..100, as pressure not currency. */
  westSupport: number;
  eastSupport: number;
  /** Turns the ladder has spent at or above VIETNAM_WAR_LEVEL. Drives war weariness. */
  warTurns: number;
  /** Total money each side has actually spent on the ladder, in local currency. */
  westSpend: number;
  eastSpend: number;
  updatedAt: Date;
}

export function emptyVietnamState(): VietnamEscalationState {
  return {
    hasOpened: false,
    level: 0,
    westSupport: 0,
    eastSupport: 0,
    warTurns: 0,
    westSpend: 0,
    eastSpend: 0,
    updatedAt: new Date(0),
  };
}

/** A move on the ladder. `support` pushes it up, `deescalate` pulls it down. */
export type VietnamMove = "support" | "hold" | "deescalate";

const SUPPORT_PRESSURE_STEP = 12;
const DEESCALATE_PRESSURE_STEP = 15;

/**
 * How much pressure one side must accumulate before the ladder climbs a rung.
 *
 * Deliberately not "one click, one rung". A superpower can pour materiel into a
 * client for years without the war changing shape, and it should take repeated
 * commitment to move from bombing to ground troops.
 */
export const VIETNAM_RUNG_PRESSURE = 24;

/**
 * Apply one leader's move to the ladder. Pure: takes a state, returns the next
 * state. This is the whole escalation mechanic in one function, which is what
 * makes it testable without a database.
 *
 * Rules:
 *  - Support adds pressure to that side and can climb at most one rung per move.
 *  - The ladder never climbs past the last rung.
 *  - De-escalation drains that side's own pressure first; only once its pressure
 *    is spent does the rung itself come down. A superpower cannot undo the other
 *    superpower's commitment by announcing restraint.
 *  - Both sides supporting is how the ladder actually climbs fastest, because
 *    pressure is compared per side and the higher one governs.
 *  - A rung is also gated by its `earliestYear`: pressure can max out but the
 *    ladder holds until the calendar reaches the next rung's floor, so an
 *    aggressive US/RU tracks the historical arc's ceiling rather than outrunning
 *    it. Pass `currentYear` to enforce the floor; omit it (tests, callers with
 *    no clock) to fall back to pressure-only, the pre-floor behaviour.
 */
export function applyVietnamMove(
  state: VietnamEscalationState,
  side: VietnamSide,
  move: VietnamMove,
  currentYear?: number
): VietnamEscalationState {
  const next: VietnamEscalationState = { ...state, updatedAt: new Date() };
  const key = side === "west" ? "westSupport" : "eastSupport";

  if (move === "hold") return next;

  if (move === "support") {
    next[key] = Math.min(100, state[key] + SUPPORT_PRESSURE_STEP);
    const pressure = Math.max(next.westSupport, next.eastSupport);
    const nextRung = rungForLevel(next.level + 1);
    const yearAllows =
      currentYear === undefined || nextRung === null || currentYear >= nextRung.earliestYear;
    if (pressure >= VIETNAM_RUNG_PRESSURE && next.level < VIETNAM_MAX_LEVEL && yearAllows) {
      next.level = clampVietnamLevel(next.level + 1);
      next.westSupport = Math.max(0, next.westSupport - VIETNAM_RUNG_PRESSURE);
      next.eastSupport = Math.max(0, next.eastSupport - VIETNAM_RUNG_PRESSURE);
    } else if (pressure > VIETNAM_RUNG_PRESSURE && !yearAllows) {
      // Year-blocked: hold pressure at the rung threshold rather than letting it
      // balloon to 100, so the first support once the year arrives climbs cleanly.
      next.westSupport = Math.min(next.westSupport, VIETNAM_RUNG_PRESSURE);
      next.eastSupport = Math.min(next.eastSupport, VIETNAM_RUNG_PRESSURE);
    }
    return next;
  }

  // De-escalate.
  const drained = Math.max(0, state[key] - DEESCALATE_PRESSURE_STEP);
  next[key] = drained;
  if (drained === 0 && next.level > 0) {
    next.level = clampVietnamLevel(next.level - 1);
  }
  return next;
}

/** Advance the war clock. Called once per turn while a rung crisis is live. */
export function tickVietnamWarClock(state: VietnamEscalationState): VietnamEscalationState {
  if (state.level < VIETNAM_WAR_LEVEL) return state;
  return { ...state, warTurns: state.warTurns + 1, updatedAt: new Date() };
}

// ── Derived dials ───────────────────────────────────────────────────────────

/**
 * Everything the rest of the game reads off the ladder. Pure, so the values on
 * the conflicts hub, the Cold War dial sync and any future consumer are all the
 * same numbers derived the same way.
 *
 * `cohesionWest` / `cohesionEast` feed the proxy-war supply model and the crisis
 * board's credibility. `defcon` feeds readiness, which the detente and home
 * front boards both already key off, so one derived DEFCON moves all three.
 */
export interface VietnamDials {
  defcon: number;
  cohesionWest: number;
  cohesionEast: number;
  /** 0..100 war weariness at home. Zero below the war level. */
  warWeariness: number;
  /** Multiplier on baseline defence procurement demand. 1 = no war pressure. */
  procurementMultiplier: number;
  /** Detente goodwill penalty, 0..60. Higher rungs poison the negotiating table. */
  detenteGoodwillPenalty: number;
}

const BASE_COHESION = 60;

export function deriveVietnamDials(state: VietnamEscalationState): VietnamDials {
  const rung = rungForLevel(state.level);
  if (!rung) {
    return {
      defcon: 5,
      cohesionWest: BASE_COHESION,
      cohesionEast: BASE_COHESION,
      warWeariness: 0,
      procurementMultiplier: 1,
      detenteGoodwillPenalty: 0,
    };
  }

  // Backing a winning client builds bloc cohesion; backing a stalemate burns it.
  // The lead side gains, the trailing side loses, and both lose to a long war.
  const lead = state.westSupport - state.eastSupport;
  const drag = Math.min(20, Math.floor(state.warTurns / 2));
  const cohesionWest = clamp01to100(BASE_COHESION + lead / 3 - drag);
  const cohesionEast = clamp01to100(BASE_COHESION - lead / 3 - drag);

  const warWeariness =
    state.level >= VIETNAM_WAR_LEVEL
      ? clamp01to100((state.level - VIETNAM_WAR_LEVEL + 1) * 15 + state.warTurns * 2)
      : 0;

  return {
    defcon: rung.defcon,
    cohesionWest,
    cohesionEast,
    warWeariness,
    procurementMultiplier: vietnamProcurementMultiplier(state.level),
    detenteGoodwillPenalty: Math.min(60, state.level * 9),
  };
}

function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * ROTDM: defence procurement demand created by the war.
 *
 * The single, clearly-named integration point for the defence-contract work. It
 * deliberately reads nothing and writes nothing. It is a pure multiplier on
 * whatever baseline procurement demand the contracting system computes, so that
 * system can adopt it with one call and no coupling in the other direction.
 * Surfaced to players on the conflicts hub via `getVietnamEscalationSummary`.
 */
export function vietnamProcurementMultiplier(level: number): number {
  return rungForLevel(clampVietnamLevel(level))?.procurementMultiplier ?? 1;
}

// ── Approval costs ──────────────────────────────────────────────────────────

const ANTIWAR_BASE = -0.012;
const HAWK_BASE = -0.015;

function approvalEffect(swing: number, label: string): CrisisEffect {
  return {
    effectType: "flat",
    targetType: "approval",
    metricCategory: "government",
    metricField: "overall",
    sectorType: null,
    strategyId: null,
    value: toNativeEffectValue("flat", swing),
    label,
  };
}

/**
 * Approval cost of escalating, paid to the anti-war side of the electorate.
 * Scales with the rung AND with how long the war has already run, so the third
 * year of a ground war is far more expensive to prolong than the first month of
 * an advisory mission.
 */
export function escalationApprovalCost(state: VietnamEscalationState): CrisisEffect[] {
  const level = clampVietnamLevel(state.level);
  const dragFactor = 1 + Math.min(2, state.warTurns / 12);
  const swing = ANTIWAR_BASE * Math.max(1, level) * dragFactor;
  return [approvalEffect(swing, "Anti-war opinion hardens against the escalation")];
}

/**
 * Approval cost of de-escalating, paid to hawks. Climbing down from a high rung
 * costs more than never climbing it: there is a constituency for the war by then.
 */
export function deescalationApprovalCost(state: VietnamEscalationState): CrisisEffect[] {
  const level = clampVietnamLevel(state.level);
  const swing = HAWK_BASE * Math.max(1, level);
  return [approvalEffect(swing, "Hawks call the climb-down a surrender")];
}

/** Share of GDP one support pledge costs at the ladder's current rung. */
export function supportPctGdpForLevel(level: number): number {
  return rungForLevel(clampVietnamLevel(level))?.supportPctGdp ?? 0.001;
}

// ── Persistence ─────────────────────────────────────────────────────────────

type StoredState = VietnamEscalationState & { _id: string };

/** Read the ladder. Returns the empty ladder when the world has never had one. */
export async function getVietnamEscalation(db: Db): Promise<VietnamEscalationState> {
  const doc = await db
    .collection<StoredState>(VIETNAM_ESCALATION_COLLECTION)
    .findOne({ _id: VIETNAM_ESCALATION_ID });
  if (!doc) return emptyVietnamState();
  const empty = emptyVietnamState();
  return {
    hasOpened: doc.hasOpened ?? false,
    level: clampVietnamLevel(doc.level ?? 0),
    westSupport: doc.westSupport ?? empty.westSupport,
    eastSupport: doc.eastSupport ?? empty.eastSupport,
    warTurns: doc.warTurns ?? empty.warTurns,
    westSpend: doc.westSpend ?? empty.westSpend,
    eastSpend: doc.eastSpend ?? empty.eastSpend,
    updatedAt: doc.updatedAt ?? empty.updatedAt,
  };
}

/**
 * Open the ladder at its first rung. Idempotent: a world that has already opened
 * the family (even one that then talked it back down to nothing) is left alone,
 * so the chain cannot restart itself forever.
 */
export async function openVietnamEscalation(db: Db): Promise<VietnamEscalationState | null> {
  const state = await getVietnamEscalation(db);
  if (state.hasOpened) return null;
  const opened: VietnamEscalationState = { ...state, hasOpened: true, level: 1 };
  await putVietnamEscalation(db, opened);
  return opened;
}

async function putVietnamEscalation(db: Db, state: VietnamEscalationState): Promise<void> {
  await db
    .collection<StoredState>(VIETNAM_ESCALATION_COLLECTION)
    .updateOne(
      { _id: VIETNAM_ESCALATION_ID },
      { $set: { ...state, updatedAt: new Date() } },
      { upsert: true }
    );
}

/**
 * Record one leader's move and persist the resulting ladder. Returns both states
 * so a caller can tell whether the rung actually changed.
 */
export async function recordVietnamMove(
  db: Db,
  side: VietnamSide,
  move: VietnamMove,
  spend = 0,
  currentYear?: number
): Promise<{ before: VietnamEscalationState; after: VietnamEscalationState }> {
  const before = await getVietnamEscalation(db);
  // `currentYear` enforces the earliestYear rung floor; callers resolve it from
  // game state. Kept a parameter (not fetched here) so this module never imports
  // the DB-backed game-state reader — VIETNAM_RUNGS is used by a client panel, and
  // a mongodb import at the top would drag the driver into the browser bundle.
  const after = applyVietnamMove(before, side, move, currentYear);
  if (spend > 0) {
    if (side === "west") after.westSpend += spend;
    else after.eastSpend += spend;
  }
  await putVietnamEscalation(db, after);
  return { before, after };
}

/** Advance the war clock by one turn and persist. Called from the crisis turn. */
export async function tickVietnamEscalation(db: Db): Promise<VietnamEscalationState> {
  const before = await getVietnamEscalation(db);
  if (before.level < VIETNAM_WAR_LEVEL) return before;
  const after = tickVietnamWarClock(before);
  await putVietnamEscalation(db, after);
  return after;
}

/**
 * The small query helper other systems read the war off.
 *
 * Anything that should get worse as Vietnam gets worse (protest events, draft
 * politics, defence demand) asks this rather than reaching into the crisis
 * documents. Returns 0 when there is no war.
 */
export async function getVietnamEscalationLevel(db: Db): Promise<number> {
  return (await getVietnamEscalation(db)).level;
}

export interface VietnamEscalationSummary {
  level: number;
  rungKey: string | null;
  rungLabel: string | null;
  rungSummary: string | null;
  westSupport: number;
  eastSupport: number;
  warTurns: number;
  dials: VietnamDials;
}

/** Everything the conflicts hub needs to render the ladder, in one read. */
export async function getVietnamEscalationSummary(db: Db): Promise<VietnamEscalationSummary> {
  const state = await getVietnamEscalation(db);
  const rung = rungForLevel(state.level);
  return {
    level: state.level,
    rungKey: rung?.key ?? null,
    rungLabel: rung?.label ?? null,
    rungSummary: rung?.summary ?? null,
    westSupport: state.westSupport,
    eastSupport: state.eastSupport,
    warTurns: state.warTurns,
    dials: deriveVietnamDials(state),
  };
}
