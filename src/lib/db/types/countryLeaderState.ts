import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Per-country leader state for country-specific leader mechanics.
 *
 * Designed to be generic enough for reuse across countries, but initially
 * created for China's CPC confidence model. Other countries can opt in by
 * writing to this collection.
 */

export interface LeaderConfidenceHistoryEntry {
  /** Turn number when the change occurred */
  turn: number;
  /** Previous confidence value */
  previous: number;
  /** New confidence value */
  next: number;
  /** Delta applied (next - previous) */
  delta: number;
  /** Human-readable reason for the change */
  reason: string;
  /** ISO timestamp */
  at: Date;
}

export interface CountryLeaderState {
  /** Composite key: `${countryId}_${leaderCharacterId}` */
  _id: string;
  countryId: CountryId;
  /** Character ID of the current leader */
  leaderCharacterId: ObjectId;
  /** Office type the leader holds (e.g. "premier", "primeMinister", "president") */
  leaderOfficeType: string;
  /** Party sequential ID of the governing party */
  governingPartyId: string | null;

  // ── CPC Confidence (China-specific) ─────────────────────────────────────
  /** Internal party confidence, 0–100. Distinct from public approval. */
  partyConfidence: number;
  /** Turn when the current leader started their first mandate */
  startedAtTurn: number;
  /** Turn of the last leadership renewal (re-election, confirmation, etc.) */
  lastRenewedAtTurn: number | null;
  /** How many times this leader has renewed their mandate */
  renewalCount: number;

  // ── Audit trail ─────────────────────────────────────────────────────────
  /** Bounded history of confidence changes (most recent first). Max 50 entries. */
  confidenceHistory: LeaderConfidenceHistoryEntry[];

  // ── Popular legitimacy (one-party-state public-mood scalar) ──────────────
  /**
   * Public mood / regime legitimacy scalar, 0–100. Distinct from
   * `partyConfidence` which measures intra-party stability. Populated
   * only when the country's `hasLeaderConfidenceModel` is true.
   * Initialised to 75 (`INITIAL_POPULAR_LEGITIMACY`) on leader install.
   *
   * Optional on the type so existing leader-state docs created before
   * Phase 2 don't fail type-narrowing; runtime code reads with a fallback
   * to the initial value.
   */
  popularLegitimacy?: number;
  /**
   * Bounded history of popular-legitimacy changes (most recent first).
   * Max 50 entries. Mirrors `confidenceHistory` shape so both scalars
   * use the same audit-trail record type.
   */
  popularLegitimacyHistory?: LeaderConfidenceHistoryEntry[];
  /**
   * Sliding-window dwell counters per escalation stage. Updated each
   * turn by the regime-escalation driver (Phase 3). Reserved here so
   * the type is complete from the outset, even though Phase 2 only
   * writes `popularLegitimacy` itself.
   *
   * - stage1: turns currently below `popularLegitimacy ≤ 60`.
   * - stage2: sustained turns below 35 + cumulative-in-168 count.
   * - stage4: sustained turns below 15 (frozen during convention).
   *
   * Stage 3 dwell is tracked off `partyConfidence`, not popular —
   * lives on the regimeEscalation state collection (Phase 3), not here.
   */
  popularDwellCounters?: {
    stage1: number;
    stage2: { sustained: number; cumulativeIn168: number };
    stage4: number;
  };

  createdAt: Date;
  updatedAt: Date;
}
