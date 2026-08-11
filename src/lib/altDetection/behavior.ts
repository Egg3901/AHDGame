/**
 * Behavioral profiling primitives (forensics-v2 Wave 3, "behavior tracking").
 *
 * Every other signal in `signals.ts` correlates an IDENTITY TOKEN — a
 * fingerprint, a cookie, an IP, an OAuth id, an email. All of them are
 * defeatable by an operator who is willing to be careful: fresh browser
 * profile, fresh device, a VPN, a distinct inbox. What is much harder to
 * fake is WHEN a human is at the keyboard. This module derives that shape
 * from timestamps alone, so the two signals it backs (`activity_rhythm` and
 * `session_handoff`) keep working against an otherwise clean operator.
 *
 * Everything here is PURE — no DB, no clock reads beyond what the caller
 * passes in. `run.ts` assembles the timestamp arrays; `signals.ts` consumes
 * the comparison functions.
 *
 * ## False positives are the whole design problem
 * Two unrelated players in the same timezone with the same day job have
 * genuinely similar activity histograms. A naive cosine similarity over
 * hour-of-day fires on half the playerbase. Both signals therefore carry
 * explicit guards, and both are weighted as corroborating evidence rather
 * than proof:
 *
 *  - `activity_rhythm` requires BOTH profiles to be CONCENTRATED (low
 *    normalized entropy) before it will compare them. A player active in a
 *    narrow 3-hour window every day carries real information; a player
 *    scattered evenly across all 24 hours matches everyone and is excluded.
 *  - `session_handoff` requires near-zero CONCURRENT activity. Two accounts
 *    that are frequently online at the same time cannot be one person at
 *    one keyboard, no matter how neatly their sessions interleave — that
 *    check is what separates "one operator alternating accounts" from
 *    "two friends who play together".
 */

// ─── Activity rhythm: hour-of-day + day-of-week histograms ────────────────

export interface ActivityRhythm {
  /** 24 buckets, index = UTC hour. Raw counts, not normalized. */
  hours: number[];
  /** 7 buckets, index = UTC day of week (0 = Sunday). Raw counts. */
  days: number[];
  /** Total events folded in — the sample size behind both histograms. */
  total: number;
}

/** Minimum events per side before a rhythm comparison means anything. Below
 * this, a histogram is mostly noise and two sparse profiles can align by
 * coincidence. */
export const MIN_RHYTHM_EVENTS = 25;

/**
 * Maximum normalized entropy (0 = all activity in one bucket, 1 = perfectly
 * uniform across all 24) for an hour histogram to be considered
 * CONCENTRATED enough to carry identifying information.
 *
 * 0.82 is deliberately strict: a player spread across a typical ~10-hour
 * waking window sits around 0.85-0.92 and is excluded, while one clustered
 * into a few consistent hours lands below it.
 */
export const MAX_RHYTHM_ENTROPY = 0.82;

/** Minimum combined similarity for `activity_rhythm` to fire. High because
 * concentrated profiles are compared — near-identical, not merely similar. */
export const MIN_RHYTHM_SIMILARITY = 0.9;

/** Hour-of-day carries far more signal than day-of-week (a player's sleep
 * cycle is more distinctive than which weekdays they log on), so the
 * combined score is weighted toward it. */
const HOUR_SIMILARITY_WEIGHT = 0.8;

export function buildActivityRhythm(timestamps: Date[]): ActivityRhythm {
  const hours = new Array<number>(24).fill(0);
  const days = new Array<number>(7).fill(0);
  let total = 0;
  for (const ts of timestamps) {
    const ms = ts.getTime();
    if (!Number.isFinite(ms)) continue;
    hours[ts.getUTCHours()] += 1;
    days[ts.getUTCDay()] += 1;
    total += 1;
  }
  return { hours, days, total };
}

/** Cosine similarity of two equal-length non-negative vectors, in [0,1].
 * Returns 0 when either vector is all-zero (no information to compare). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Shannon entropy of a count vector, normalized to [0,1] against the
 * maximum entropy for that many buckets (log2(n)). 0 = every event in one
 * bucket, 1 = perfectly uniform.
 */
export function normalizedEntropy(counts: number[]): number {
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total <= 0 || counts.length <= 1) return 0;
  let entropy = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    entropy -= p * Math.log2(p);
  }
  const max = Math.log2(counts.length);
  return max === 0 ? 0 : entropy / max;
}

export interface RhythmComparison {
  hourSimilarity: number;
  daySimilarity: number;
  /** `HOUR_SIMILARITY_WEIGHT`-weighted blend of the two. */
  combined: number;
  entropyA: number;
  entropyB: number;
  /** True when both sides clear `MIN_RHYTHM_EVENTS` and both hour
   * histograms are concentrated enough (<= `MAX_RHYTHM_ENTROPY`). When
   * false, `combined` is still reported for debugging but MUST NOT be
   * treated as evidence. */
  comparable: boolean;
  /** Why `comparable` is false, for evidence strings and tests. */
  reason?: "insufficient_events" | "diffuse_activity";
}

export function compareActivityRhythm(a: ActivityRhythm, b: ActivityRhythm): RhythmComparison {
  const hourSimilarity = cosineSimilarity(a.hours, b.hours);
  const daySimilarity = cosineSimilarity(a.days, b.days);
  const combined =
    HOUR_SIMILARITY_WEIGHT * hourSimilarity + (1 - HOUR_SIMILARITY_WEIGHT) * daySimilarity;
  const entropyA = normalizedEntropy(a.hours);
  const entropyB = normalizedEntropy(b.hours);

  if (a.total < MIN_RHYTHM_EVENTS || b.total < MIN_RHYTHM_EVENTS) {
    return {
      hourSimilarity,
      daySimilarity,
      combined,
      entropyA,
      entropyB,
      comparable: false,
      reason: "insufficient_events",
    };
  }
  if (entropyA > MAX_RHYTHM_ENTROPY || entropyB > MAX_RHYTHM_ENTROPY) {
    return {
      hourSimilarity,
      daySimilarity,
      combined,
      entropyA,
      entropyB,
      comparable: false,
      reason: "diffuse_activity",
    };
  }
  return { hourSimilarity, daySimilarity, combined, entropyA, entropyB, comparable: true };
}

// ─── Sessions + handoff detection ──────────────────────────────────────────

export interface ActivitySession {
  start: Date;
  end: Date;
}

/** Idle gap that ends a session. 30 minutes matches the `login_time_cluster`
 * window in `signals.ts` — long enough to survive a player reading a page
 * without clicking, short enough that a lunch break splits sessions. */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Maximum gap between one account's last event and the other's first for
 * the transition to count as a handoff. Ten minutes is about how long it
 * takes to log out, switch accounts, and log back in. */
export const HANDOFF_MAX_GAP_MS = 10 * 60 * 1000;

/** Minimum handoff transitions before the pattern is treated as evidence.
 * Two accounts will alternate by chance occasionally; four times without a
 * single concurrent session is a pattern. */
export const MIN_HANDOFFS = 4;

/** Minimum sessions per side. A pair with two sessions each can hit four
 * handoffs trivially. */
export const MIN_SESSIONS_PER_SIDE = 4;

/**
 * Maximum share of the shorter account's online time that may overlap with
 * the other's before the handoff reading is abandoned. Not exactly zero:
 * a single stray event (a background tab firing a request, a page left
 * open) shouldn't erase an otherwise clean alternation pattern.
 */
export const MAX_CONCURRENT_OVERLAP_RATIO = 0.02;

/**
 * Collapse a timestamp list into sessions, splitting on gaps larger than
 * `gapMs`. Input need not be sorted. A lone event becomes a zero-length
 * session (start === end), which contributes no overlap minutes but still
 * anchors a handoff — correct, since a single action is exactly what a
 * burner account logging in to cast one vote looks like.
 */
export function buildSessions(
  timestamps: Date[],
  gapMs: number = SESSION_GAP_MS
): ActivitySession[] {
  const sorted = timestamps
    .map((t) => t.getTime())
    .filter((t) => Number.isFinite(t))
    .sort((x, y) => x - y);
  if (sorted.length === 0) return [];

  const sessions: ActivitySession[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - previous > gapMs) {
      sessions.push({ start: new Date(start), end: new Date(previous) });
      start = sorted[i];
    }
    previous = sorted[i];
  }
  sessions.push({ start: new Date(start), end: new Date(previous) });
  return sessions;
}

export interface SessionInterleave {
  /** Total minutes during which BOTH accounts had an open session. */
  overlapMinutes: number;
  /** `overlapMinutes` as a share of the shorter account's total online
   * minutes. 0 when either side has no measurable online time. */
  overlapRatio: number;
  /** Transitions where one account's session ended and the other's began
   * within `HANDOFF_MAX_GAP_MS`. */
  handoffs: number;
  /** Longest run of strictly alternating sessions (A,B,A,B…) across the
   * merged timeline — reported as colour for the evidence string. */
  longestAlternation: number;
  sessionsA: number;
  sessionsB: number;
  /** True when the pattern clears every guard and may be used as evidence. */
  qualifies: boolean;
  reason?: "too_few_sessions" | "too_few_handoffs" | "concurrent_activity";
}

function totalMinutes(sessions: ActivitySession[]): number {
  return sessions.reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()) / 60000, 0);
}

/** Summed minutes of pairwise intersection between two session lists. Both
 * lists are assumed non-overlapping internally (guaranteed by
 * `buildSessions`), so a simple double loop is exact. */
function overlapMinutes(a: ActivitySession[], b: ActivitySession[]): number {
  let total = 0;
  for (const sa of a) {
    for (const sb of b) {
      const start = Math.max(sa.start.getTime(), sb.start.getTime());
      const end = Math.min(sa.end.getTime(), sb.end.getTime());
      if (end > start) total += (end - start) / 60000;
    }
  }
  return total;
}

function countHandoffs(a: ActivitySession[], b: ActivitySession[]): number {
  let count = 0;
  for (const sa of a) {
    for (const sb of b) {
      const aThenB = sb.start.getTime() - sa.end.getTime();
      const bThenA = sa.start.getTime() - sb.end.getTime();
      if (
        (aThenB >= 0 && aThenB <= HANDOFF_MAX_GAP_MS) ||
        (bThenA >= 0 && bThenA <= HANDOFF_MAX_GAP_MS)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** Longest strictly-alternating run over the two session lists merged by
 * start time. */
function longestAlternation(a: ActivitySession[], b: ActivitySession[]): number {
  const merged = [
    ...a.map((s) => ({ start: s.start.getTime(), owner: "a" as const })),
    ...b.map((s) => ({ start: s.start.getTime(), owner: "b" as const })),
  ].sort((x, y) => x.start - y.start);
  if (merged.length === 0) return 0;

  let best = 1;
  let current = 1;
  for (let i = 1; i < merged.length; i++) {
    if (merged[i].owner !== merged[i - 1].owner) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 1;
    }
  }
  return best;
}

/**
 * Measure how two accounts' sessions interleave. The evidence we are after
 * is the signature of ONE person alternating between two logins: sessions
 * that hand off tightly and never run concurrently. Two genuinely separate
 * players who happen to play at similar times will show concurrent overlap,
 * which is what `overlapRatio` catches.
 */
export function analyzeSessionInterleave(
  a: ActivitySession[],
  b: ActivitySession[]
): SessionInterleave {
  const overlap = overlapMinutes(a, b);
  const minutesA = totalMinutes(a);
  const minutesB = totalMinutes(b);
  const shorter = Math.min(minutesA, minutesB);
  const overlapRatio = shorter > 0 ? overlap / shorter : 0;
  const handoffs = countHandoffs(a, b);
  const alternation = longestAlternation(a, b);

  const base = {
    overlapMinutes: overlap,
    overlapRatio,
    handoffs,
    longestAlternation: alternation,
    sessionsA: a.length,
    sessionsB: b.length,
  };

  if (a.length < MIN_SESSIONS_PER_SIDE || b.length < MIN_SESSIONS_PER_SIDE) {
    return { ...base, qualifies: false, reason: "too_few_sessions" };
  }
  if (handoffs < MIN_HANDOFFS) {
    return { ...base, qualifies: false, reason: "too_few_handoffs" };
  }
  // Overlap is only disqualifying when there IS measurable online time to
  // compare. Two accounts made entirely of single-event sessions have zero
  // duration and therefore zero overlap by construction — that's a clean
  // alternation pattern, not a missing check.
  if (shorter > 0 && overlapRatio > MAX_CONCURRENT_OVERLAP_RATIO) {
    return { ...base, qualifies: false, reason: "concurrent_activity" };
  }
  return { ...base, qualifies: true };
}

// ─── Shared-target overlap (behavioral_similarity inputs) ──────────────────

/** Jaccard overlap of two id sets, in [0,1]. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const id of a) if (b.has(id)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Minimum distinct shared targets before a target-overlap observation is
 * emitted. One shared target is a coincidence in a game where popular
 * states and prominent characters attract everybody. */
export const MIN_SHARED_TARGETS = 3;

/** Minimum Jaccard overlap alongside `MIN_SHARED_TARGETS`. Guards the case
 * where two prolific accounts share three targets out of two hundred each. */
export const MIN_TARGET_JACCARD = 0.3;

export interface TargetOverlapResult {
  shared: string[];
  jaccard: number;
  qualifies: boolean;
}

/**
 * Compare two accounts' target sets (AP-dump target states, or the
 * counterparties they acted against). Requires BOTH an absolute count floor
 * and a proportional floor, so neither a tiny-sample coincidence nor a
 * pair of high-volume accounts brushing past each other qualifies.
 */
export function compareTargetSets(a: Set<string>, b: Set<string>): TargetOverlapResult {
  const shared: string[] = [];
  for (const id of a) if (b.has(id)) shared.push(id);
  shared.sort();
  const overlap = jaccard(a, b);
  return {
    shared,
    jaccard: overlap,
    qualifies: shared.length >= MIN_SHARED_TARGETS && overlap >= MIN_TARGET_JACCARD,
  };
}
