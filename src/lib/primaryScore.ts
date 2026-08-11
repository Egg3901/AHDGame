/**
 * Primary score calculation for elections.
 *
 * Standard (state-level) formula — see {@link calcPrimaryScore} JSDoc:
 *   - Alignment (state + party): 0–40 pts (split 25/15 when state lean available; 40 party-only fallback)
 *   - Favorability: 0–35 pts
 *   - Political influence (in-state): 0–25 pts (sqrt curve via normalizeNPI)
 *   - Infamy multiplier applied at the end (1.0 → 0.95 at infamy=100)
 *
 * Presidential (national) formula — see {@link calcPresidentPrimaryScore} JSDoc:
 *   - Party alignment (policy): 0–40 pts
 *   - Party influence (candidate's own accumulated party clout): 0–30 pts
 *   - National reach (diminishing via normalizeNationalReachPresidentialPrimary): 0–20 pts
 *   - Favorability: 0–10 pts
 *   - Infamy multiplier applied at the end
 */

import {
  normalizeNPI,
  normalizeNationalReachPresidentialPrimary,
  normalizePartyInfluencePresidentialPrimary,
} from "@/lib/utils/normalizeNPI";
import { infamyPenaltyMultiplier } from "@/lib/utils/infamy";
import type { CountryId } from "@/lib/constants/countries";

function clampPercentStat(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Temperature for {@link primarySharePctSoftmax}. Lower = more decisive (the
 * leader pulls away harder); higher = closer to the raw linear share. 8 spreads
 * a ~2-pt score lead into a visible ~15-pt polling gap without over-collapsing
 * the trailing field (#934).
 */
export const PRIMARY_SHARE_SOFTMAX_TEMPERATURE = 8;

/**
 * Convert a party's primary scores into display `sharePct` (0–100, 1 decimal)
 * via a softmax rather than a linear `score / Σscore`.
 *
 * Primary scores cluster in a narrow high band (national reach saturates, policy
 * alignment is tight among serious candidates), so the linear mapping squashed a
 * 3-way race to ~33/33/33 and hid real leads (#934). Softmax decompresses that.
 * It is **monotonic**: it never reorders candidates or changes the winner, which
 * is selected from raw score (top-N), not share — this only affects the number
 * players see. Returns percentages index-aligned with `scores`; `[]`→`[]`,
 * singletons→`[100]`, and an all-zero/degenerate field falls back to an even split.
 */
export function primarySharePctSoftmax(
  scores: number[],
  temperature = PRIMARY_SHARE_SOFTMAX_TEMPERATURE
): number[] {
  const n = scores.length;
  if (n === 0) return [];
  if (n === 1) return [100];
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const total = exps.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return scores.map(() => Math.round(10000 / n) / 100);
  return exps.map((e) => Math.round((e / total) * 1000) / 10);
}

/**
 * Standard primary score for state-level elections (Senate, House, Governor, State Senate).
 *
 * Components total 100 pts:
 *   - Alignment (state + party):    0–40 pts
 *       split: 25 state + 15 party when state cached lean is available
 *       fallback: 40 party-only when state lean is missing (preserves pre-rework math)
 *   - Favorability:                  0–35 pts
 *   - Political influence:           0–25 pts (sqrt curve via normalizeNPI)
 *
 * Then multiplied by `infamyPenaltyMultiplier(infamy)` (1.0..0.95).
 *
 * @param stateEconLean    candidate's state cached economic lean (-5..+5), or null/undefined
 * @param stateSocialLean  candidate's state cached social   lean (-5..+5), or null/undefined
 *                         BOTH must be present (numbers) to enter the split-alignment path.
 *                         Otherwise the formula falls back to the legacy 40-pt party-only alignment.
 */
export function calcPrimaryScore(
  candidateEcon: number,
  candidateSocial: number,
  partyEcon: number,
  partySocial: number,
  favorability: number,
  politicalInfluence: number,
  infamy?: number | null,
  stateEconLean?: number | null,
  stateSocialLean?: number | null
): number {
  const clampedFavorability = clampPercentStat(favorability);
  const clampedPoliticalInfluence = clampPercentStat(politicalInfluence);

  const econDiffParty = Math.abs(candidateEcon - partyEcon);
  const socialDiffParty = Math.abs(candidateSocial - partySocial);

  const hasStateLean =
    typeof stateEconLean === "number" &&
    typeof stateSocialLean === "number" &&
    Number.isFinite(stateEconLean) &&
    Number.isFinite(stateSocialLean);

  let alignment: number;
  if (hasStateLean) {
    const econDiffState = Math.abs(candidateEcon - stateEconLean);
    const socialDiffState = Math.abs(candidateSocial - stateSocialLean);
    const alignmentState = Math.max(0, 25 - (econDiffState + socialDiffState) * 1.25);
    const alignmentParty = Math.max(0, 15 - (econDiffParty + socialDiffParty) * 0.75);
    alignment = alignmentState + alignmentParty;
  } else {
    alignment = Math.max(0, 40 - (econDiffParty + socialDiffParty) * 2.0);
  }

  const favScore = (clampedFavorability / 100) * 35;
  const infScore = normalizeNPI(clampedPoliticalInfluence) * 25;
  const raw = alignment + favScore + infScore;
  const penalized = raw * infamyPenaltyMultiplier(infamy);
  return Math.round(penalized * 10) / 10;
}

/**
 * Presidential primary component weights (sum = 100).
 * Party influence is weighted above national reach so party standing — and the
 * chair / leadership path that accumulates it — meaningfully moves primary
 * performance (#934 follow-up).
 */
export const PRESIDENT_PRIMARY_ALIGNMENT_WEIGHT = 40;
export const PRESIDENT_PRIMARY_PARTY_INFLUENCE_WEIGHT = 30;
export const PRESIDENT_PRIMARY_NATIONAL_REACH_WEIGHT = 20;
export const PRESIDENT_PRIMARY_FAVORABILITY_WEIGHT = 10;

export type PartyChairPrimaryRole = "national" | "state" | null;

export interface PartyChairPrimaryContext {
  /** State being scored in the per-state primary loop. Omit for national snapshot. */
  currentStateId?: string | null;
  /** State id(s) the candidate chairs (state-party org rows). */
  chairStateIds?: readonly string[] | null;
  /** Country for adjacency lookup. Defaults to US. */
  countryId?: CountryId;
}

/**
 * Party influence fed into presidential-primary math.
 *
 * Chairs no longer receive an inherent presidential-primary multiplier: the
 * national +25% / state +15%-in-state-and-adjacent chair boost was removed so a
 * party chair does not get a structural advantage in the presidential primary
 * (reverted per design discussion 2026-07-11). Party influence still counts —
 * it feeds the snapshot party-influence weight and the per-state vote
 * multiplier — but it does so from the candidate's raw accumulated influence,
 * not an amplified chair value. Chairs come out ahead only insofar as the
 * leadership path accrues party influence faster over time.
 *
 * The `role` / `context` args are retained for call-site compatibility and for
 * a planned home-state-influence regional model; they are currently inert.
 */
export function effectivePartyInfluenceForPresidentialPrimary(
  partyInfluence: number,
  _role: PartyChairPrimaryRole,
  _context?: PartyChairPrimaryContext
): number {
  return Math.max(0, partyInfluence);
}

export interface PartyChairMaps {
  nationalChairIds: Set<string>;
  /** characterId → state ids they chair */
  stateChairStatesByCharacterId: Map<string, string[]>;
}

/**
 * Build national / state chair lookups for presidential-primary chair boosts.
 * If a character is both national and state chair, callers should prefer
 * `"national"` via {@link resolvePartyChairPrimaryRole}.
 */
export function buildPartyChairMaps(
  parties: Array<{ chairId?: { toString(): string } | null | undefined }>,
  statePartyOrgs?: Array<{
    chairId?: { toString(): string } | null | undefined;
    stateId?: string | null | undefined;
  }>
): PartyChairMaps {
  const nationalChairIds = new Set<string>();
  for (const p of parties) {
    if (p.chairId) nationalChairIds.add(p.chairId.toString());
  }
  const stateChairStatesByCharacterId = new Map<string, string[]>();
  for (const spo of statePartyOrgs ?? []) {
    if (!spo.chairId || !spo.stateId) continue;
    const id = spo.chairId.toString();
    const list = stateChairStatesByCharacterId.get(id) ?? [];
    if (!list.includes(spo.stateId)) list.push(spo.stateId);
    stateChairStatesByCharacterId.set(id, list);
  }
  return { nationalChairIds, stateChairStatesByCharacterId };
}

export function resolvePartyChairPrimaryRole(
  characterId: string,
  maps: PartyChairMaps
): PartyChairPrimaryRole {
  if (maps.nationalChairIds.has(characterId)) return "national";
  if (maps.stateChairStatesByCharacterId.has(characterId)) return "state";
  return null;
}

/**
 * @deprecated Prefer {@link buildPartyChairMaps}. Returns the union of national
 * and state chair character ids (no role distinction).
 */
export function buildPartyChairIdSet(
  parties: Array<{ chairId?: { toString(): string } | null | undefined }>,
  statePartyOrgs?: Array<{ chairId?: { toString(): string } | null | undefined }>
): Set<string> {
  const maps = buildPartyChairMaps(parties, statePartyOrgs);
  const ids = new Set(maps.nationalChairIds);
  for (const id of maps.stateChairStatesByCharacterId.keys()) ids.add(id);
  // Also include state-chair rows that lack stateId (legacy callers).
  for (const spo of statePartyOrgs ?? []) {
    if (spo.chairId) ids.add(spo.chairId.toString());
  }
  return ids;
}

/**
 * Presidential primary score — national recognition, heavier policy and party clout.
 * Uses nationalInfluence for characters; NPPs use politicalInfluence as proxy.
 *
 * `partyInfluence` is the candidate's own accumulated party clout
 * (`character.partyInfluence`, 0..unbounded — no in-game ceiling). It replaced
 * home-state party organization, which was near-constant across same-party
 * rivals and so never differentiated candidates in a primary (see #934). NPPs
 * have no `partyInfluence` and are passed 0 by callers. The normalization is
 * linear + uncapped, so this component exceeds its nominal weight for candidates
 * above the reference scale (partyInfluence 150).
 *
 * Multiplied by `infamyPenaltyMultiplier(infamy)` at the end.
 */
export function calcPresidentPrimaryScore(
  candidateEcon: number,
  candidateSocial: number,
  partyEcon: number,
  partySocial: number,
  favorability: number,
  nationalOrPoliticalInfluence: number, // nationalInfluence for chars, politicalInfluence for NPPs
  partyInfluence: number, // candidate.partyInfluence (0..unbounded); NPPs pass 0
  infamy?: number | null
): number {
  const econDiff = Math.abs(candidateEcon - partyEcon);
  const socialDiff = Math.abs(candidateSocial - partySocial);
  const clampedFavorability = clampPercentStat(favorability);
  const alignment = Math.max(0, PRESIDENT_PRIMARY_ALIGNMENT_WEIGHT - (econDiff + socialDiff) * 2.0); // 0-40
  const partyInfluenceScore =
    normalizePartyInfluencePresidentialPrimary(partyInfluence) *
    PRESIDENT_PRIMARY_PARTY_INFLUENCE_WEIGHT; // 0-30 at reference scale (PI 150); uncapped above
  const influenceScore =
    normalizeNationalReachPresidentialPrimary(nationalOrPoliticalInfluence) *
    PRESIDENT_PRIMARY_NATIONAL_REACH_WEIGHT; // 0-20
  const favScore = (clampedFavorability / 100) * PRESIDENT_PRIMARY_FAVORABILITY_WEIGHT; // 0-10
  const raw = alignment + partyInfluenceScore + influenceScore + favScore;
  const penalized = raw * infamyPenaltyMultiplier(infamy);
  return Math.round(penalized * 10) / 10;
}
