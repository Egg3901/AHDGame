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

/** Supply throughput delivered by a perfectly effective Logistics command. */
export const LOGISTICS_COMMAND_THROUGHPUT = 20;

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
 * Best Logistics-command coverage by region.
 *
 * A region is meant to have one command of each type. If stale data overlaps two
 * Logistics commands, use the strongest instead of stacking them into free supply.
 * Command effectiveness makes commanders and capacity matter to the advertised bonus.
 */
export function logisticsSupplyByRegion(
  commands: readonly MilitaryCommand[],
  unitsById: UnitsById
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const command of commands) {
    if (command.type !== "LOGISTICS") continue;
    const throughput = Math.round(
      LOGISTICS_COMMAND_THROUGHPUT * (effectiveness(command, unitsById) / 100)
    );
    for (const region of command.regionIds) {
      result[region] = Math.max(result[region] ?? 0, throughput);
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

/** Regions covered by two or more commands of the same type (role conflict). */
export function overlappingRegions(state: MilitaryState): StrategicRegion[] {
  return STRATEGIC_REGIONS.filter((r) => {
    const cmds = commandsOfRegion(state, r.id);
    if (cmds.length < 2) return false;
    const types = cmds.map((c) => c.type);
    return new Set(types).size < types.length;
  });
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
  if (owners.length > 1 && new Set(owners.map((o) => o.type)).size < owners.length)
    return "OVERLAPPING";
  if (ops.some((o) => o.region === rid)) return "ACTIVE_CONFLICT";
  if (owners.length === 1) return "ASSIGNED";
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
