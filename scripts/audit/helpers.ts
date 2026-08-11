/**
 * Shared helpers for the election audit script.
 * Imported by all suite modules and index.ts.
 *
 * Terminology:
 *   PI  = politicalInfluence — state-level stat, capped at 100. Used in state/Senate/House elections.
 *   NPI = nationalInfluence  — national stat, uncapped. Used in presidential elections only.
 */

import { demographicCategories } from "../../src/lib/seeds/demographicCategories";
import { stateDemographics } from "../../src/lib/seeds/stateDemographics";
import {
  calcStateTurnout,
  distributeVotesByGroupLevelAllocation,
} from "../../src/lib/electionEngine";
import type { EnrichedCandidate } from "../../src/lib/electionEngine";
import type { StateDemographics } from "../../src/lib/db/types/demographics";

export { normalizeNPI } from "../../src/lib/utils/normalizeNPI";
export { calcAppeal, approvalScalar, MAX_APPEAL } from "../../src/lib/utils/demographicAppeal";

/**
 * Retired production formula (2026-06-18 D3) — the legacy 1.0–1.6× party-Org
 * soft scalar. Kept here ONLY as a historical/comparative reference for the
 * offline audit report generators (suites 7 and 20–24). Production elections
 * and polls now use `normalizedOrgShare`; the live head-to-head audit tables
 * already exercise the real engine, so this only feeds the descriptive
 * "scalar values" reference tables.
 */
export const partyOrgScalar = (organization: number | undefined): number => {
  if (organization == null || isNaN(organization)) return 1.0;
  return 1.0 + (Math.min(Math.max(organization, 0), 100) / 100) * 0.6;
};
export { calcPrimaryScore, calcPresidentPrimaryScore } from "../../src/lib/primaryScore";
export { ELECTION_2020_MARGIN, marginToLean } from "../../src/lib/data/2020ElectionResults";
export { calculateStateLean } from "../../src/lib/utils/demographics";

export const categories = demographicCategories;

export const STATE_DEMOGRAPHICS: Record<string, StateDemographics> = {};
for (const sd of stateDemographics) {
  STATE_DEMOGRAPHICS[sd._id] = sd;
}

// ── Representative states ──────────────────────────────────────────────────

export const REPRESENTATIVE_STATES: Array<[string, string]> = [
  ["TX", "Deep Red"],
  ["GA", "Lean Red"],
  ["PA", "Purple"],
  ["MI", "Lean Blue"],
  ["CA", "Deep Blue"],
];

// PI (politicalInfluence) is capped at 100 in the game.
// NPI (nationalInfluence) is uncapped — presidential only.
export const PI_LEVELS = [5, 10, 25, 50, 75, 100] as const;
export const NPI_LEVELS = [10, 50, 100, 200, 300, 500, 750, 1000] as const;

// ── Candidate factories ────────────────────────────────────────────────────

/**
 * State / Senate / House candidate.
 * pi = politicalInfluence (reach only, capped at 100).
 */
export function makeCandidate(
  id: string,
  name: string,
  econ: number,
  social: number,
  pi: number,
  favorability: number,
  party: string = "democrat"
): EnrichedCandidate {
  return {
    candidateId: id,
    characterId: id,
    characterName: name,
    party,
    isNPP: false,
    charEP: econ,
    charSP: social,
    favorability,
    politicalInfluence: pi,
    nationalInfluence: pi, // type compatibility; not used in state races
  };
}

/**
 * Presidential candidate.
 * npi = nationalInfluence (drives reach + adds to appeal).
 * politicalInfluence is clamped to 100 (state cap; unused in presidential engine).
 */
export function makePresidentialCandidate(
  id: string,
  name: string,
  econ: number,
  social: number,
  npi: number,
  favorability: number,
  party: string = "democrat"
): EnrichedCandidate {
  return {
    candidateId: id,
    characterId: id,
    characterName: name,
    party,
    isNPP: false,
    charEP: econ,
    charSP: social,
    favorability,
    politicalInfluence: Math.min(100, npi),
    nationalInfluence: npi,
  };
}

// ── Race runners ───────────────────────────────────────────────────────────

/**
 * State / Senate / House general election.
 * politicalInfluence is reach only — not included in appeal.
 */
export function runRace(
  candidates: EnrichedCandidate[],
  stateId: string,
  partyOrgMap: Map<string, number> = new Map()
): Record<string, number> {
  const demographics = STATE_DEMOGRAPHICS[stateId];
  if (!demographics) throw new Error(`No demographics for state: ${stateId}`);

  const population = 1_000_000;
  const totalPool = calcStateTurnout(population, demographics, categories);

  const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
    candidates,
    totalPool,
    totalPool,
    population,
    demographics,
    categories,
    partyOrgMap,
    { includeInfluenceInAppeal: false, useNationalInfluenceForReach: false }
  );

  const total = Object.values(votesPerCandidate).reduce((s, v) => s + v, 0);
  const out: Record<string, number> = {};
  for (const [id, votes] of Object.entries(votesPerCandidate)) {
    out[id] = total > 0 ? Math.round((votes / total) * 1000) / 10 : 0;
  }
  return out;
}

/**
 * Presidential general election.
 * nationalInfluence drives reach AND adds to appeal.
 */
export function runPresidentialRace(
  candidates: EnrichedCandidate[],
  stateId: string,
  partyOrgMap: Map<string, number> = new Map()
): Record<string, number> {
  const demographics = STATE_DEMOGRAPHICS[stateId];
  if (!demographics) throw new Error(`No demographics for state: ${stateId}`);

  const population = 1_000_000;
  const totalPool = calcStateTurnout(population, demographics, categories);

  const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
    candidates,
    totalPool,
    totalPool,
    population,
    demographics,
    categories,
    partyOrgMap,
    {
      includeInfluenceInAppeal: true,
      useNationalInfluenceForReach: true,
      usePresidentialPartyOrg: true,
    }
  );

  const total = Object.values(votesPerCandidate).reduce((s, v) => s + v, 0);
  const out: Record<string, number> = {};
  for (const [id, votes] of Object.entries(votesPerCandidate)) {
    out[id] = total > 0 ? Math.round((votes / total) * 1000) / 10 : 0;
  }
  return out;
}

// ── Report helpers ─────────────────────────────────────────────────────────

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const sep = widths.map((w) => "-".repeat(w)).join(" | ");
  const head = headers.map((h, i) => h.padEnd(widths[i])).join(" | ");
  const body = rows.map((r) => r.map((c, i) => (c ?? "").padEnd(widths[i])).join(" | ")).join("\n");
  return `| ${head} |\n| ${sep} |\n${body
    .split("\n")
    .map((l) => `| ${l} |`)
    .join("\n")}`;
}

export function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

// ── Global flag collector ──────────────────────────────────────────────────

export const globalFlags: string[] = [];

export function flag(suiteNum: number, suiteName: string, message: string): void {
  globalFlags.push(`Suite ${suiteNum} (${suiteName}): ${message}`);
}
