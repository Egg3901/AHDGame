import type {
  MilitaryCommand,
  MilitaryState,
  StrategicRegion,
  MilitaryOperation,
  CalcBreakdown,
  CoverageStatus,
} from "./types";
import { CAPACITY, EFF_THRESHOLDS } from "./config";
import { STRATEGIC_REGIONS } from "./regions";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

type UnitsById = Record<string, MilitaryUnit>;

/** Command-capacity load a unit consumes (basePower-derived, floored at 1). */
export function unitLoad(u: MilitaryUnit): number {
  return Math.max(1, Math.round(u.basePower / 12));
}

/** Sum of a command's assigned-unit loads (resolved against the units map). */
export function forceLoad(c: MilitaryCommand, unitsById: UnitsById): number {
  return c.unitIds.reduce((a, id) => a + (unitsById[id] ? unitLoad(unitsById[id]) : 0), 0);
}

/** Points a command is over its force capacity, floored at 0 (mockup overBy). */
export function overBy(c: MilitaryCommand, unitsById: UnitsById): number {
  return Math.max(0, forceLoad(c, unitsById) - c.cap);
}

/** Command effectiveness (mockup effOf): base − no-commander − over-capacity, floored. */
export function effectiveness(c: MilitaryCommand, unitsById: UnitsById): number {
  let e = c.base;
  if (!c.commanderIds.length) e -= CAPACITY.noCommanderPenalty;
  e -= overBy(c, unitsById) * CAPACITY.overCapacityFactor;
  return Math.max(CAPACITY.effFloor, Math.round(e));
}

/**
 * Best Logistics-command coverage by region, as effectiveness 0..1.
 *
 * A region is meant to have one command of each type. If stale data overlaps two
 * Logistics commands, use the strongest instead of stacking them into free supply.
 * Command effectiveness makes commanders and capacity matter to the advertised bonus.
 *
 * Coverage rather than throughput: what the command is WORTH depends on the size of
 * the force drawing on it, which only the battle math knows (`supplyState`,
 * `FRONT_SUPPLY.logisticsCommandShare`). A flat figure here was +20 against a
 * coalition front's deficit of ~1,160.
 */
export function logisticsCoverageByRegion(
  commands: readonly MilitaryCommand[],
  unitsById: UnitsById
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const command of commands) {
    if (command.type !== "LOGISTICS") continue;
    const coverage = effectiveness(command, unitsById) / 100;
    for (const region of command.regionIds) {
      result[region] = Math.max(result[region] ?? 0, coverage);
    }
  }
  return result;
}

/** Effectiveness with an explained positive/negative factor breakdown. */
export function effectivenessBreakdown(c: MilitaryCommand, unitsById: UnitsById): CalcBreakdown {
  const positives: string[] = [`Base command rating ${c.base}`];
  const negatives: string[] = [];
  if (!c.commanderIds.length) {
    negatives.push(`No commander (−${CAPACITY.noCommanderPenalty})`);
  }
  const ob = overBy(c, unitsById);
  if (ob > 0) {
    negatives.push(
      `Over force capacity by ${ob} (−${Math.round(ob * CAPACITY.overCapacityFactor)})`
    );
  }
  return { finalValue: effectiveness(c, unitsById), positives, negatives };
}

/** Commands responsible for a given region. */
export function commandsOfRegion(state: MilitaryState, rid: string): MilitaryCommand[] {
  return state.commands.filter((c) => c.regionIds.includes(rid));
}

/** Regions with no responsible command (mockup uncovered). */
export function uncoveredRegions(state: MilitaryState): StrategicRegion[] {
  return STRATEGIC_REGIONS.filter((r) => commandsOfRegion(state, r.id).length === 0);
}

/**
 * Whether a region's owners contain a role conflict: two or more commands of the
 * SAME type. Commands of different types sharing a region is supported and useful
 * (a Regional command holds the ground, a Logistics command sustains it), so only a
 * repeated type counts.
 *
 * The single home for that rule. It used to be written out by hand in three places,
 * and the bug this consolidates was two of those copies disagreeing: coverageStatus
 * treated "not an overlap" as "not covered either" and reported the recommended
 * pairing as UNASSIGNED. One definition means the next edit cannot split them again.
 */
export function hasSameTypeOverlap(owners: readonly MilitaryCommand[]): boolean {
  const types = owners.map((o) => o.type);
  return new Set(types).size < types.length;
}

/** Regions covered by two or more commands of the same type (role conflict). */
export function overlappingRegions(state: MilitaryState): StrategicRegion[] {
  return STRATEGIC_REGIONS.filter((r) => hasSameTypeOverlap(commandsOfRegion(state, r.id)));
}

/** Average command effectiveness across the nation (mockup globalEff). */
export function globalEffectiveness(state: MilitaryState, unitsById: UnitsById): number {
  const cs = state.commands;
  if (!cs.length) return 0;
  return Math.round(cs.reduce((a, c) => a + effectiveness(c, unitsById), 0) / cs.length);
}

/** Coverage precedence: overlap > active conflict > assigned > unassigned. */
export function coverageStatus(
  state: MilitaryState,
  rid: string,
  ops: MilitaryOperation[]
): CoverageStatus {
  const owners = commandsOfRegion(state, rid);
  if (hasSameTypeOverlap(owners)) return "OVERLAPPING";
  if (ops.some((o) => o.region === rid)) return "ACTIVE_CONFLICT";
  // Any owner means covered. Requiring exactly one contradicted the overlap rule
  // directly above it, which only treats a duplicate TYPE as a conflict: a region held
  // by a Regional and a Logistics command passed both branches and fell through to
  // UNASSIGNED. That is the recommended overseas setup, so the builder's default
  // coverage view flagged the correct structure as a gap.
  if (owners.length >= 1) return "ASSIGNED";
  return "UNASSIGNED";
}

/** Map an effectiveness value to an AHD status intent (mockup effColor). */
export function effIntent(v: number): "success" | "warn" | "error" {
  return v >= EFF_THRESHOLDS.good ? "success" : v >= EFF_THRESHOLDS.ok ? "warn" : "error";
}

/** Player-facing over-capacity penalty lines, empty when within capacity. */
export function overCapacityPenalties(c: MilitaryCommand, unitsById: UnitsById): string[] {
  if (overBy(c, unitsById) <= 0) return [];
  return [
    "− reduced command efficiency",
    "− slower crisis reaction",
    "− weaker logistics coordination",
    "− higher operational failure risk",
  ];
}

/** Projected effectiveness for a create-command draft (mockup draftEff). */
export function draftEffectiveness(draft: { commanderIds: string[]; regionIds: string[] }): number {
  let e = 70;
  if (!draft.commanderIds.length) e -= 10;
  if (draft.regionIds.length > 4) e -= (draft.regionIds.length - 4) * 4;
  return Math.max(30, Math.min(95, e));
}
