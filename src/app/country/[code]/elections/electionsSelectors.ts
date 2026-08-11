/**
 * Grouping and summary logic for the country elections list.
 *
 * Pure functions, no React, so the shape of the page is testable without
 * rendering it. The list groups by OFFICE (Senate, House, Governor, ...) with
 * region as a column, because the office is what a player picks first: they
 * decide to run for the Senate, then pick where.
 *
 * Grouping by region instead put the US at ~50 groups across 17 pages of
 * pagination, which is what this replaces.
 */

import type { ElectionDisplay } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { isCompetitiveElection } from "@/app/elections/electionsHelpers";
import {
  listCountryOffices,
  resolveOfficeKeyForElectionType,
  type ElectionOffice,
} from "@/lib/elections/officeResolution";

/** Section key for races whose office could not be resolved. */
export const OTHER_OFFICE_KEY = "__other__";

export interface ElectionsSummary {
  /** Races in scope. */
  total: number;
  /** Races with at least one declared candidate. */
  contested: number;
  /** Races where the top two are within 15 points. Needs polling, so 0 early on. */
  competitive: number;
  /**
   * Soonest turn any race in scope closes. Primary deadline while a race is in
   * its primary, otherwise the general deadline. Null when no race carries a
   * turn deadline.
   */
  nextDeadlineTurn: number | null;
}

export interface OfficeSection extends ElectionsSummary {
  key: string;
  /** Null for the catch-all section. */
  office: ElectionOffice | null;
  label: string;
  elections: ElectionDisplay[];
}

/**
 * The deadline that matters to a player looking at this race right now: filing
 * and primary voting close first, the general closes later.
 */
export function relevantDeadlineTurn(election: ElectionDisplay): number | null {
  if (election.inPrimary && election.primaryEndTurn != null) return election.primaryEndTurn;
  return election.endTurn ?? election.primaryEndTurn ?? null;
}

export function summarize(elections: ElectionDisplay[]): ElectionsSummary {
  let contested = 0;
  let competitive = 0;
  let nextDeadlineTurn: number | null = null;

  for (const e of elections) {
    if (e.candidates.length > 0) contested++;
    // Presidential races are excluded from the competitive count to match the
    // existing filter, which treats the national race separately.
    if (e.electionType !== "president" && isCompetitiveElection(e)) competitive++;
    const turn = relevantDeadlineTurn(e);
    if (turn != null && (nextDeadlineTurn === null || turn < nextDeadlineTurn)) {
      nextDeadlineTurn = turn;
    }
  }

  return { total: elections.length, contested, competitive, nextDeadlineTurn };
}

/** Region name first, then race title, so a section reads alphabetically. */
function compareForDisplay(a: ElectionDisplay, b: ElectionDisplay): number {
  const byState = a.state.localeCompare(b.state);
  if (byState !== 0) return byState;
  const aClass = a.senateClass ?? a.chamberClass ?? 0;
  const bClass = b.senateClass ?? b.chamberClass ?? 0;
  return aClass - bClass;
}

/**
 * Group races into office sections, in the country's office display order.
 *
 * Empty sections are dropped: a country lists only the offices it is actually
 * running races for right now. Anything whose office cannot be resolved lands in
 * a visible "Other races" section rather than disappearing.
 */
export function buildOfficeSections(
  countryId: CountryId,
  elections: ElectionDisplay[]
): OfficeSection[] {
  const offices = listCountryOffices(countryId);
  const byKey = new Map<string, ElectionDisplay[]>();

  for (const election of elections) {
    const key =
      resolveOfficeKeyForElectionType(countryId, election.electionType) ?? OTHER_OFFICE_KEY;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(election);
    else byKey.set(key, [election]);
  }

  const sections: OfficeSection[] = [];

  for (const office of offices) {
    const found = byKey.get(office.key);
    if (!found || found.length === 0) continue;
    const sorted = [...found].sort(compareForDisplay);
    sections.push({
      key: office.key,
      office,
      label: office.sectionLabel,
      elections: sorted,
      ...summarize(sorted),
    });
  }

  const other = byKey.get(OTHER_OFFICE_KEY);
  if (other && other.length > 0) {
    const sorted = [...other].sort(compareForDisplay);
    sections.push({
      key: OTHER_OFFICE_KEY,
      office: null,
      label: "Other races",
      elections: sorted,
      ...summarize(sorted),
    });
  }

  return sections;
}

/**
 * Which sections start expanded.
 *
 * The largest section opens so the page is never a wall of closed headers, and
 * a single-section country opens outright. When the viewer has narrowed to one
 * office, that one opens instead.
 */
export function defaultOpenSections(sections: OfficeSection[]): string[] {
  if (sections.length === 0) return [];
  if (sections.length === 1) return [sections[0].key];
  const largest = sections.reduce((best, s) => (s.total > best.total ? s : best), sections[0]);
  return [largest.key];
}
