/**
 * Weekly contests: who grew the most in a round. Corporations score percent
 * market cap growth net of injected capital (splitCorpTiers, corpGrowthScore),
 * characters score National Influence gained, and governments score approval
 * points gained under the same head of government (gainScore). Referrers score
 * new players brought in that week (countWeeklyReferrals). The round winner
 * with a positive score earns contestPrizeAnchor in cash; the top three
 * referrers of an iteration earn Supporter for the next one.
 */
import { getEraNominalAmount } from "@/lib/constants/sectorSeedEra";
import { DEFAULT_ALT_SCORING_THRESHOLDS } from "@/lib/altDetection/config";
import type { ContestKind, ContestStanding } from "@/lib/db/types/contestRound";

export const CONTEST_KINDS: readonly ContestKind[] = [
  "corp_growth_small",
  "corp_growth_large",
  "influence_gain",
  "approval_gain",
  "referrals_weekly",
];

export const CORP_CONTEST_KINDS: readonly ContestKind[] = [
  "corp_growth_small",
  "corp_growth_large",
];

/** One week of real time per round. */
export const CONTEST_ROUND_MS = 7 * 24 * 60 * 60 * 1000;

/** Modern-era (2019) cash prize per weekly contest; scaled to the world's era by getEraNominalAmount. */
export const CONTEST_PRIZES_MODERN: Readonly<Record<ContestKind, number>> = {
  corp_growth_small: 7_500_000,
  corp_growth_large: 7_500_000,
  influence_gain: 7_500_000,
  approval_gain: 7_500_000,
  referrals_weekly: 10_000_000,
};

/**
 * Corporations opening below this modern-era value sit out the round. A shell
 * at the share price floor can post four-digit growth from pocket change.
 */
export const CORP_MIN_OPENING_MODERN = 250_000;

/** Stored standings per round; the page shows the top of this list. */
export const CONTEST_STANDINGS_LIMIT = 250;

export function contestPrizeAnchor(kind: ContestKind, preset?: string): number {
  return getEraNominalAmount(CONTEST_PRIZES_MODERN[kind], preset);
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

// ── Referrals ───────────────────────────────────────────────────────────────

/** Top referrers when an iteration ends earn Supporter for the whole next iteration. */
export const REFERRAL_AWARD_WINNERS = 3;

/**
 * A referee linked to their referrer at this alt-detection confidence or above
 * is treated as the same person and never counts toward a cash prize.
 */
export const REFERRAL_ALT_LINK_THRESHOLD = DEFAULT_ALT_SCORING_THRESHOLDS.strongLink;

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

export interface WeeklyReferee {
  refereeUserId: string;
  referrerUserId: string;
  refereeBanned: boolean;
}

export function altPairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Referrals that count this week, per referrer. A referee counts once, only
 * if they are not banned, the referrer is an eligible player, and the pair is
 * not a strong alt link.
 */
export function countWeeklyReferrals(
  referees: readonly WeeklyReferee[],
  eligibleReferrers: ReadonlySet<string>,
  altPairs: ReadonlySet<string>
): Map<string, number> {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const r of referees) {
    if (seen.has(r.refereeUserId)) continue;
    seen.add(r.refereeUserId);
    if (r.refereeBanned || r.refereeUserId === r.referrerUserId) continue;
    if (!eligibleReferrers.has(r.referrerUserId)) continue;
    if (altPairs.has(altPairKey(r.refereeUserId, r.referrerUserId))) continue;
    counts.set(r.referrerUserId, (counts.get(r.referrerUserId) ?? 0) + 1);
  }
  return counts;
}

export type ReferralGrantDecision = "grant" | "already_supporter";

/**
 * A paying supporter keeps their own plan untouched. Anyone else, including an
 * earlier contest winner, is granted contest Supporter with no end date; it is
 * removed when the following iteration's award runs.
 */
export function referralGrantDecision(
  current: { tier: string | null; expiresAtMs: number | null; provider: string | null },
  nowMs: number
): ReferralGrantDecision {
  const active =
    current.tier !== null && (current.expiresAtMs === null || current.expiresAtMs > nowMs);
  return active && current.provider !== "contest" ? "already_supporter" : "grant";
}

/** The iteration referral contest closes when the world moves to a new iteration. */
export function iterationChanged(
  roundIterationKey: string | undefined,
  currentIterationKey: string | undefined
): boolean {
  return (
    roundIterationKey !== undefined &&
    currentIterationKey !== undefined &&
    roundIterationKey !== currentIterationKey
  );
}
