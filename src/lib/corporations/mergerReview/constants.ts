/**
 * Merger review (C3) — constants and the pure rules.
 *
 * When two corporations become ONE (an agreed whole-corp acquisition, or the
 * squeeze-out that ends a hostile takeover), the combined firm may hold a share
 * of a national industry that the state will not tolerate. Merger review is the
 * channel where that gets decided by a named officeholder rather than by the
 * engine.
 *
 * Gating is on OWNERSHIP + MARKETIZATION, never on a country list (see
 * `ahd-b4-scrutiny-rework-spec`). A deal is reviewable only when both sides are
 * privately owned and the reviewing country's corporate market is not
 * state-controlled. In a command economy the whole feature is inert — the state
 * already owns the firms, so consolidating two of them is an administrative
 * reorganisation, not a transaction anyone approves. That is the correct
 * outcome, not a gap.
 */

import type { LawCountryId } from "@/lib/politicalLegislation/types";

/**
 * The antitrust law whose 0-4 enacted level sets the trip threshold, per
 * country. Countries absent from this map have no antitrust statute and so no
 * merger review — same fail-open contract as `RESERVE_LAW_BY_COUNTRY`.
 *
 * This is each country's EXISTING competition primary, not a new statute. That
 * law already is the antitrust dial: the US "Antitrust and Fair Commerce Act"
 * promises "merger review before the fact" at level 2 and breakups at level 3,
 * and the UK "Restrictive Practices and Competition Act" runs from the
 * Monopolies Commission to divestment powers. Authoring a parallel antitrust
 * secondary would have created two competition dials that could disagree, and
 * would have needed the catalog validator's secondary-pool ceiling (40, and
 * every catalog is at exactly 40) and its 2-3 metric-touch rule loosened to fit.
 *
 * RU and DD map to their own competition primary — the tolerated private and
 * cooperative sector. Merger review is inert there anyway, because both are
 * structurally command economies, but the mapping is uniform rather than a
 * special case.
 */
export const ANTITRUST_LAW_BY_COUNTRY: Record<LawCountryId, string> = {
  US: "us.economy.competition.primary",
  UK: "uk.economy.competition.primary",
  RU: "ru.economy.competition.primary",
  DD: "dd.economy.competition.primary",
};

/**
 * The cabinet seat that decides a referral, per country. Era-gated seat NAMES
 * resolve through `resolveSeatName`; the seat ID is stable across eras.
 *
 * US: the Attorney General (antitrust is a Justice Department function).
 * UK: the Board of Trade seat, which becomes Trade and Industry and then
 *     Business — one seat id, four era names.
 * RU/DD: Internal Trade, the ministry that would referee a market that these
 *     countries only have when the command-economy dial says they do.
 */
export const MERGER_AUTHORITY_SEAT_BY_COUNTRY: Record<LawCountryId, string> = {
  US: "attorney_general",
  UK: "business_secretary",
  RU: "minister_of_internal_trade",
  DD: "minister_of_internal_trade",
};

/**
 * Does this cabinet seat hold the competition authority in this country?
 *
 * Derived from the one seat map so no second list can drift from it. Says
 * nothing about the era or the economy: those are resolved server-side by
 * `resolveMergerAuthority` and the command-economy gate.
 */
export function isMergerAuthoritySeat(countryId: string, positionId: string): boolean {
  return MERGER_AUTHORITY_SEAT_BY_COUNTRY[countryId as LawCountryId] === positionId;
}

/**
 * Combined post-merger share of a national industry, in percent, at or above
 * which the deal is referred for review. Index = enacted antitrust level.
 *
 * Level 0 is `null`, not 100: at "No Enforcement" there is no authority to
 * refer to, so the feature is off rather than set to an unreachable bar.
 */
export const MERGER_REVIEW_THRESHOLD_PERCENT: readonly (number | null)[] = [
  null, // 0 — No Antitrust Enforcement
  75, // 1 — Case-by-Case Review / Monopolies Commission
  60, // 2 — Active Enforcement ("merger review before the fact")
  50, // 3 — Structural Enforcement
  40, // 4 — Open Markets Charter
];

/**
 * Margin above the trip threshold at which an UNDECIDED review auto-resolves
 * against the acquirer. Below `REMEDY_MARGIN` it clears; at or above
 * `BLOCK_MARGIN` it is blocked outright; in between it clears on condition of
 * divesting the overlapping industry.
 *
 * These bands only bind when nobody holds the seat, or the holder lets the
 * clock run out. A seated officeholder decides whatever they like.
 */
export const MERGER_REVIEW_REMEDY_MARGIN_PERCENT = 5;
export const MERGER_REVIEW_BLOCK_MARGIN_PERCENT = 15;

/** Turns an opened review stays pending before the bands above resolve it. */
export const MERGER_REVIEW_TURNS = 6;

/** Turns after a remedied deal completes before the divestiture is overdue. */
export const MERGER_REMEDY_TURNS = 12;

/**
 * Per-turn fine while a divestiture is overdue, as a fraction of the acquirer's
 * ₳ revenue in the industry it was ordered to divest. Paid to the reviewing
 * country's treasury. An overdue acquirer also cannot open new acquisitions.
 */
export const MERGER_REMEDY_OVERDUE_FINE_RATE = 0.05;

/** The decision an authority can hand down. */
export type MergerReviewDecision = "cleared" | "clearedWithRemedy" | "blocked";

/**
 * Deterministic fallback when a review reaches its deadline undecided. Pure —
 * no RNG, so a player can read the bands off the card and predict it.
 */
export function autoResolveDecision(
  combinedSharePercent: number,
  thresholdPercent: number
): MergerReviewDecision {
  const margin = combinedSharePercent - thresholdPercent;
  if (margin >= MERGER_REVIEW_BLOCK_MARGIN_PERCENT) return "blocked";
  if (margin >= MERGER_REVIEW_REMEDY_MARGIN_PERCENT) return "clearedWithRemedy";
  return "cleared";
}

/** Trip threshold for an enacted level, or null when review is off. */
export function thresholdForLevel(level: number): number | null {
  if (!Number.isFinite(level)) return null;
  const clamped = Math.max(0, Math.min(4, Math.round(level)));
  return MERGER_REVIEW_THRESHOLD_PERCENT[clamped] ?? null;
}
