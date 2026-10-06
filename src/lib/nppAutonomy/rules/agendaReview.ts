/**
 * Governing agenda review cadence. Routine reviews use the game calendar; material
 * changes can prompt an earlier strategic re-plan without advancing the annual
 * accountability report card.
 */

import type { ConditionsSignal } from "@/lib/nppAutonomy/selectNppBill";
import type { CrisisAgendaIntake } from "./crisisAgendaSignals";
import type { GoverningAgenda, GoverningAgendaReviewSnapshot } from "../governingAgenda";

export const MATERIAL_DOMAIN_URGENCY_DELTA = 0.25;
export const MATERIAL_INFLATION_DELTA_PERCENT_POINTS = 2;

export function annualPerformanceReviewDue(
  agenda: GoverningAgenda | null | undefined,
  currentTurn: number,
  annualIntervalTurns: number
) {
  if (!agenda) return false;
  const lastReviewTurn = agenda.performanceReviewedTurn ?? agenda.computedTurn;
  return currentTurn - lastReviewTurn >= annualIntervalTurns;
}

export function agendaReviewSnapshot(
  conditions: ConditionsSignal,
  crisis: CrisisAgendaIntake
): GoverningAgendaReviewSnapshot {
  return {
    weakDomains: sortedNumericRecord(conditions.weakDomains ?? {}),
    strongDomains: sortedNumericRecord(conditions.strongDomains ?? {}),
    inflationRate: finiteOrNull(conditions.inflationRate),
    crisisSignals: sortedNumericRecord(crisis.signals),
    crisisEffectFingerprintByDomain: sortedStringRecord(crisis.effectFingerprintByDomain),
  };
}

export function shouldRecomputeGoverningAgenda(params: {
  agenda: GoverningAgenda | null | undefined;
  currentTurn: number;
  intervalTurns: number;
  conditions: ConditionsSignal;
  crisis: CrisisAgendaIntake;
  /** A new governing party brings a new electoral mandate (#2321). */
  governmentChanged?: boolean;
}): boolean {
  const { agenda, currentTurn, intervalTurns, conditions, crisis, governmentChanged } = params;
  if (!agenda) return true;
  if (governmentChanged) return true;
  // Existing persisted agendas have no baseline. Recompute once to establish it.
  if (!agenda.reviewSnapshot) return true;
  if (annualPerformanceReviewDue(agenda, currentTurn, intervalTurns)) return true;
  if (currentTurn - agenda.computedTurn >= intervalTurns) return true;
  if (crisis.latestStartTurn > agenda.computedTurn) return true;

  const previous = agenda.reviewSnapshot;
  const next = agendaReviewSnapshot(conditions, crisis);
  if (hasMaterialDomainChange(previous.weakDomains, next.weakDomains)) return true;
  if (hasMaterialDomainChange(previous.strongDomains, next.strongDomains)) return true;
  if (hasMaterialInflationChange(previous.inflationRate, next.inflationRate)) return true;
  if (!sameNumericRecord(previous.crisisSignals, next.crisisSignals)) return true;
  return !sameStringRecord(
    previous.crisisEffectFingerprintByDomain,
    next.crisisEffectFingerprintByDomain
  );
}

function hasMaterialDomainChange(before: Record<string, number>, after: Record<string, number>) {
  const domains = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const domain of domains) {
    const beforeValue = before[domain] ?? 0;
    const afterValue = after[domain] ?? 0;
    if (Math.abs(afterValue - beforeValue) >= MATERIAL_DOMAIN_URGENCY_DELTA) return true;
  }
  return false;
}

function hasMaterialInflationChange(before: number | null, after: number | null) {
  if (before === null || after === null) return before !== after;
  return Math.abs(after - before) >= MATERIAL_INFLATION_DELTA_PERCENT_POINTS;
}

function sortedNumericRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function sortedStringRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

function finiteOrNull(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sameNumericRecord(left: Record<string, number>, right: Record<string, number>) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.is(left[key], right[key]))
  );
}

function sameStringRecord(left: Record<string, string>, right: Record<string, string>) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}
