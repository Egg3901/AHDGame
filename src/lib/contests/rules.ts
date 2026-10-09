/**
 * Weekly contests: who grew the most in a round. Corporations score percent
 * market cap growth net of injected capital (splitCorpTiers, corpGrowthScore),
 * characters score National Influence gained, and governments score approval
 * points gained under the same head of government (gainScore). The round winner
 * with a positive score earns contestPrizeAnchor in cash.
 */
import { getEraNominalAmount } from "@/lib/constants/sectorSeedEra";
import type { ContestKind, ContestStanding } from "@/lib/db/types/contestRound";

export const CONTEST_KINDS: readonly ContestKind[] = [
  "corp_growth_small",
  "corp_growth_large",
  "influence_gain",
  "approval_gain",
];

export const CORP_CONTEST_KINDS: readonly ContestKind[] = [
  "corp_growth_small",
  "corp_growth_large",
];

/** One week of real time per round. */
export const CONTEST_ROUND_MS = 7 * 24 * 60 * 60 * 1000;

/** Modern-era (2019) prize; scaled to the world's era by getEraNominalAmount. */
export const CONTEST_PRIZE_MODERN = 1_000_000;

/**
 * Corporations opening below this modern-era value sit out the round. A shell
 * at the share price floor can post four-digit growth from pocket change.
 */
export const CORP_MIN_OPENING_MODERN = 250_000;

/** Stored standings per round; the page shows the top of this list. */
export const CONTEST_STANDINGS_LIMIT = 250;

export function contestPrizeAnchor(preset?: string): number {
  return getEraNominalAmount(CONTEST_PRIZE_MODERN, preset);
}

export function corpMinOpeningAnchor(preset?: string): number {
  return getEraNominalAmount(CORP_MIN_OPENING_MODERN, preset);
}

export interface CorpOpening {
  corporationId: string;
  characterId: string;
  /** Market cap in the corporation's own currency. */
  capLocal: number;
  /** Market cap in ₳, comparable across countries; used only for tiering. */
  capAnchor: number;
}

export interface CorpTierSplit {
  /** Opening ₳ value at which a corporation counts as large. */
  boundaryAnchor: number;
  small: CorpOpening[];
  large: CorpOpening[];
}

/**
 * Split eligible corporations at the median opening value so a few giants do
 * not take every week. Ties at the boundary go to the large tier.
 */
export function splitCorpTiers(openings: readonly CorpOpening[], minAnchor: number): CorpTierSplit {
  const eligible = openings
    .filter((o) => o.capLocal > 0 && Number.isFinite(o.capAnchor) && o.capAnchor >= minAnchor)
    .sort((a, b) => a.capAnchor - b.capAnchor || a.corporationId.localeCompare(b.corporationId));
  if (eligible.length === 0) return { boundaryAnchor: 0, small: [], large: [] };
  const boundaryAnchor = eligible[Math.floor(eligible.length / 2)].capAnchor;
  return {
    boundaryAnchor,
    small: eligible.filter((o) => o.capAnchor < boundaryAnchor),
    large: eligible.filter((o) => o.capAnchor >= boundaryAnchor),
  };
}

/**
 * Percent growth of a corporation's market cap over the round. Capital the
 * owner injected during the round is taken off the closing value, so a win
 * cannot be bought by moving personal cash into the company.
 */
export function corpGrowthScore(
  baseline: number,
  current: number,
  injected: number
): number | null {
  if (!(baseline > 0) || !Number.isFinite(current)) return null;
  return ((current - injected - baseline) / baseline) * 100;
}

/** Absolute gain over the round (National Influence, approval points). */
export function gainScore(baseline: number, current: number): number | null {
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) return null;
  return current - baseline;
}

/** An approval entry counts only while the opening head of government is still in office. */
export function approvalEntryEligible(
  openingCharacterId: string,
  currentHeadCharacterId: string | null
): boolean {
  return currentHeadCharacterId !== null && currentHeadCharacterId === openingCharacterId;
}

/** Highest score first; equal scores order by subject id so the ranking is stable. */
export function rankStandings(standings: readonly ContestStanding[]): ContestStanding[] {
  return [...standings]
    .sort((a, b) => b.score - a.score || a.subjectId.localeCompare(b.subjectId))
    .slice(0, CONTEST_STANDINGS_LIMIT);
}

/** The leader wins only with a positive score: a week where everyone shrank pays nothing. */
export function pickWinner(ranked: readonly ContestStanding[]): ContestStanding | null {
  const top = ranked[0];
  return top && top.score > 0 ? top : null;
}

export function roundIsDue(endsAtMs: number, nowMs: number): boolean {
  return endsAtMs <= nowMs;
}

/**
 * A world reset restarts the turn counter. A round opened at a later turn than
 * the current one belongs to the previous world and is voided, never paid.
 */
export function roundBelongsToEarlierWorld(startTurn: number, currentTurn: number): boolean {
  return currentTurn < startTurn;
}

export function contestRoundId(kind: string, roundNumber: number): string {
  return `${kind}:${roundNumber}`;
}

// ── Referral leaderboard ────────────────────────────────────────────────────

/** Top referrers when an iteration ends earn supporter benefits for the next one. */
export const REFERRAL_AWARD_WINNERS = 3;

export interface ReferralCandidate {
  userId: string;
  username: string;
  count: number;
  banned: boolean;
}

/** Most referrals first, then username, matching the admin leaderboard order. */
export function rankReferralWinners(
  candidates: readonly ReferralCandidate[],
  limit = REFERRAL_AWARD_WINNERS
): ReferralCandidate[] {
  return candidates
    .filter((c) => !c.banned && c.count > 0)
    .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username))
    .slice(0, limit);
}

export type ReferralGrantDecision = "grant" | "extend" | "already_supporter";

/**
 * A paying supporter keeps their own subscription untouched. A previous
 * contest award is extended to the new date; anyone else is granted.
 */
export function referralGrantDecision(
  current: { tier: string | null; expiresAtMs: number | null; provider: string | null },
  nowMs: number,
  untilMs: number
): ReferralGrantDecision {
  const active =
    current.tier !== null && (current.expiresAtMs === null || current.expiresAtMs > nowMs);
  if (!active) return "grant";
  if (current.provider === "contest") {
    return current.expiresAtMs !== null && current.expiresAtMs < untilMs
      ? "extend"
      : "already_supporter";
  }
  return "already_supporter";
}
