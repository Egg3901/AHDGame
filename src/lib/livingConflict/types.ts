import type { CrisisEffect, CrisisDecisionNode } from "@/lib/db/types/crisis";

/**
 * The living-conflict engine.
 *
 * A living conflict is one persistent, phased event (a proxy war, a pandemic, a
 * long disaster) rather than a pile of one-off crises. It owns a single state
 * document; its phase advances slowly along a historical arc; within a phase it
 * emits many lightweight events; and every nation sees the decision tree and
 * effects for its ROLE in the conflict, not a copy authored per country.
 *
 * The Vietnam escalation ladder was the prototype for this (a singleton state
 * machine with year-gated rungs and derived dials). This generalises it so a
 * pandemic or any future conflict is authored as a definition, not bespoke code.
 *
 * Everything in `engine.ts` is pure and DB-free so the whole thing is testable
 * as a state machine. The DB layer and the turn driver sit on top.
 */

/**
 * A nation's standing relative to a conflict. The decision tree it is offered
 * and the effects it takes are both keyed off this, so one phase definition
 * serves every nation without per-country authoring.
 *
 *  - `belligerent`   — a direct combatant (or, for a pandemic, a nation in the
 *                      thick of it).
 *  - `backer_a` / `backer_b` — a great power backing one side.
 *  - `neighbor`      — bordering / heavily exposed but not a principal.
 *  - `bloc`          — aligned to a side by alliance but not exposed.
 *  - `bystander`     — everyone else, who can still act diplomatically.
 */
export type ConflictRole =
  "belligerent" | "backer_a" | "backer_b" | "neighbor" | "bloc" | "bystander";

export const ALL_CONFLICT_ROLES: readonly ConflictRole[] = [
  "belligerent",
  "backer_a",
  "backer_b",
  "neighbor",
  "bloc",
  "bystander",
] as const;

/** What kind of living conflict this is. Drives framing and default surfaces. */
export type LivingConflictType = "proxy_war" | "pandemic" | "disaster" | "geopolitical";

/** How loud an event is, which decides how far it broadcasts. */
export type EventSeverity = "minor" | "major" | "critical";

/** Where a published event lands. Sinks register against these channels. */
export type BroadcastChannel =
  "wire_global" | "wire_national" | "discord_global" | "discord_national";

/**
 * A per-role bundle of effects. Absent role = no effect for that role, which is
 * the common case (a bystander usually takes nothing from a distant war).
 */
export type RoleEffects = Partial<Record<ConflictRole, CrisisEffect[]>>;

/** A per-role decision tree root. A role with no entry gets no decision. */
export type RoleDecisionTrees = Partial<Record<ConflictRole, CrisisDecisionNode>>;

/**
 * How a procedural event decides to fire. Declarative and deterministic: the
 * engine evaluates these against live state and the turn number, never a clock
 * or RNG, so a replayed turn emits exactly the same events.
 */
export interface EventTrigger {
  /** Fires only at or above this intensity (0..100). */
  minIntensity?: number;
  /** Fires only at or below this intensity. */
  maxIntensity?: number;
  /** Fires on the turn the phase is entered. */
  onPhaseEnter?: boolean;
  /** Fires every N turns the conflict has run (deterministic cadence). */
  everyTurns?: number;
}

/** One beat inside a phase. Lightweight data, not a crisis document. */
export interface ConflictEvent {
  key: string;
  kind: "authored" | "procedural" | "reactive";
  severity: EventSeverity;
  /** Roles this event concerns; drives who it broadcasts to. */
  affects: ConflictRole[] | "all";
  /** Procedural/authored trigger. Reactive events are fired by a response, not this. */
  trigger?: EventTrigger;
  headline: string;
  body: string;
  /** Effects applied to each affected nation by its role, when the event fires. */
  effects?: RoleEffects;
}

/** One rung/stage of the conflict. Advancing swaps the tree, effects and events. */
export interface ConflictPhase {
  level: number;
  key: string;
  label: string;
  summary: string;
  /**
   * Earliest in-game year this phase may be reached. Pressure alone cannot climb
   * past a phase before its year, so an aggressive world tracks the historical
   * arc's ceiling rather than outrunning it. Omit on phase 1 (never gated).
   */
  earliestYear?: number;
  /** Minimum turns spent on the previous phase before this one may be entered. */
  minDwellTurns?: number;
  /** Commitment pressure a side must accumulate to advance INTO the next phase. */
  advancePressure: number;
  /**
   * Pressure the conflict generates on its own each turn, added to side "a".
   * A pandemic or wildfire has momentum a proxy war does not: contagion climbs
   * without anyone choosing it. Zero (default) means the phase only advances on
   * committed support, which is the proxy-war case.
   */
  naturalPressure?: number;
  /** Global readiness this phase pulls toward (5 calm .. 1 imminent), if any. */
  defcon?: number;
  /** The decision each role is offered while the conflict sits on this phase. */
  decisionTrees: RoleDecisionTrees;
  /** Per-turn effects each role takes while on this phase. */
  passiveEffects?: RoleEffects;
  /** The event pool for this phase. */
  events: ConflictEvent[];
}

/** Context a role resolver reads to classify a nation. */
export interface RoleContext {
  countryId: string;
  /** Nations that are principals (combatants / epicentres). */
  belligerents: string[];
  /** Great-power backer of side A / side B, if any. */
  backerA?: string;
  backerB?: string;
  /** Nations bordering or otherwise directly exposed. */
  neighbors: string[];
  /** Nations aligned by bloc to either side. */
  blocMembers: string[];
}

/** A full living-conflict definition. Authored once; drives every world. */
export interface LivingConflictDef {
  key: string;
  type: LivingConflictType;
  name: string;
  /** Era window; the conflict cannot open outside it. */
  fromYear?: number;
  untilYear?: number;
  /** The map anchor / host, for surfaces that need one. */
  hostCountry?: string;
  phases: ConflictPhase[];
  /** Classify a nation's role. Pure; reads only RoleContext. */
  roleResolver: (ctx: RoleContext) => ConflictRole;
}

/**
 * The live state of one conflict in one world. A singleton per def per world.
 * `pressure` is bucketed by side ("a" / "b"), mirroring the Vietnam ladder's
 * west/east support, so a two-sided war and a one-sided disaster share a shape.
 */
export interface LivingConflictState {
  defKey: string;
  hasOpened: boolean;
  phaseLevel: number;
  /** 0..100 running intensity, moved by events and phase. */
  intensity: number;
  openedYear: number | null;
  /** Accumulated commitment pressure per side bucket ("a" | "b"). */
  pressure: Record<string, number>;
  /** Turns spent on the current phase (drives minDwellTurns). */
  phaseTurns: number;
  /** Turns since the conflict opened (drives everyTurns cadences). */
  totalTurns: number;
  updatedAt: Date;
}

/** A resolved event ready to publish: the def event plus who and when. */
export interface FiredEvent {
  /** Stable, deterministic id: `${defKey}:${phaseKey}:${turn}:${eventKey}`. */
  id: string;
  defKey: string;
  phaseKey: string;
  turn: number;
  event: ConflictEvent;
}
