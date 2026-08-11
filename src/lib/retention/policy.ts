/**
 * Data-retention policy for the fast-growing history/log collections.
 *
 * The live Mongo DB accumulates per-turn history forever. This policy keeps a
 * bounded granular window live and archives everything older to Cloudflare R2
 * (recoverable), then either deletes it or thins it (downsample). Windows are
 * expressed in TURNS (turns are hourly).
 *
 * Safety classification (why each collection is where it is) is documented per
 * entry. The two GUARD modes protect rows that other systems depend on:
 *   - corporationHistory: each corp's LATEST row feeds live balance/tax math.
 *   - portfolioHistory:   each character's EARLIEST row is the capital-gains
 *                         cost-basis baseline.
 * Deleting a guard row would corrupt derived state, so it is never removed.
 */

export enum RetentionMode {
  /** Archive old rows to R2, then delete them. No reader depends on them. */
  ARCHIVE_DELETE = "ARCHIVE_DELETE",
  /** Like ARCHIVE_DELETE but never delete the per-group guard row. */
  ARCHIVE_DELETE_GUARD = "ARCHIVE_DELETE_GUARD",
  /** Archive old rows, then keep only ~1/K of them (thin the chart series). */
  DOWNSAMPLE = "DOWNSAMPLE",
  /** Archive a copy to R2 but DELETE NOTHING (event-sourced; needs a stored
   *  counter before old rows can be safely removed). */
  ARCHIVE_ONLY_NO_DELETE = "ARCHIVE_ONLY_NO_DELETE",
}

export type GuardKind = "MAX_PER_GROUP" | "MIN_PER_GROUP";

export interface RetentionPolicy {
  collection: string;
  /** Field holding the turn number the row belongs to. */
  timeKey: string;
  /** Turns of granular history to KEEP live. */
  windowTurns: number;
  mode: RetentionMode;
  /** For *_GUARD modes: the row to protect per group. */
  guard?: { groupField: string; kind: GuardKind };
  /** For DOWNSAMPLE: keep ~1/keepEveryK of rows older than the window. */
  keepEveryK?: number;
  /**
   * When the timeKey is frequently null, also treat a row as old if it has no
   * turn AND its timestamp predates the window. Pass `true` for `createdAt`, or
   * a field name (e.g. `"ts"`) for a custom timestamp column.
   */
  createdAtFallback?: boolean | string;
  note?: string;
}

export const DEFAULT_KEEP_EVERY_K = 6;

export const RETENTION_POLICIES: RetentionPolicy[] = [
  // ── Money / audit LOGS — no chart or display reads these ──────────────────
  {
    collection: "financialTxLog",
    timeKey: "turn",
    windowTurns: 168,
    mode: RetentionMode.ARCHIVE_DELETE,
    note: "Forensic money trail. Already TTL'd at 168 turns; archive-before-expire.",
  },
  {
    collection: "treasuryTransactions",
    timeKey: "turn",
    windowTurns: 168,
    mode: RetentionMode.ARCHIVE_DELETE,
    note: "Party-treasury audit log. Balance lives on the treasury doc, not summed here.",
  },
  {
    collection: "indexFundTransactions",
    timeKey: "turn",
    windowTurns: 168,
    mode: RetentionMode.ARCHIVE_DELETE,
    createdAtFallback: true,
    note: "Fund tx ledger (turn often null → createdAt fallback). Holdings live on position docs.",
  },
  {
    collection: "actionAuditLog",
    timeKey: "turn",
    windowTurns: 336,
    mode: RetentionMode.ARCHIVE_DELETE,
    createdAtFallback: "ts",
    note: "Unified forensics/alt-detection audit spine. TTL backstop on expiresAt; archive-before-delete.",
  },
  // ── Archive + delete WITH a protected guard row ───────────────────────────
  {
    collection: "corporationHistory",
    timeKey: "turn",
    windowTurns: 168,
    mode: RetentionMode.ARCHIVE_DELETE_GUARD,
    guard: { groupField: "corporationId", kind: "MAX_PER_GROUP" },
    note: "Per-corp latest row feeds live IMF-cap/dividend/tax math — never delete it.",
  },
  {
    collection: "portfolioHistory",
    timeKey: "turn",
    windowTurns: 168,
    mode: RetentionMode.ARCHIVE_DELETE_GUARD,
    guard: { groupField: "characterId", kind: "MIN_PER_GROUP" },
    note: "Per-character earliest row is the capital-gains cost-basis baseline.",
  },
  // ── Downsample chart series (keep ~1/K of old points) ─────────────────────
  {
    collection: "corporationPortfolioHistory",
    timeKey: "turn",
    windowTurns: 168,
    mode: RetentionMode.DOWNSAMPLE,
    keepEveryK: DEFAULT_KEEP_EVERY_K,
    note: "Corp net-worth recomputed live; charts + 168-turn reconcile window.",
  },
  {
    collection: "wealthListHistory",
    timeKey: "turn",
    windowTurns: 72,
    mode: RetentionMode.DOWNSAMPLE,
    keepEveryK: DEFAULT_KEEP_EVERY_K,
    note: "Leaderboard 24h-delta lookback is inside the window; older points chart-only.",
  },
  {
    collection: "indexFundSnapshots",
    timeKey: "turn",
    windowTurns: 72,
    mode: RetentionMode.DOWNSAMPLE,
    keepEveryK: DEFAULT_KEEP_EVERY_K,
    note: "NAV time-series (navChange1/24/48 within window); snapshot is output not input.",
  },
  {
    collection: "orgRegLedger",
    timeKey: "turn",
    windowTurns: 72,
    mode: RetentionMode.DOWNSAMPLE,
    keepEveryK: DEFAULT_KEEP_EVERY_K,
    note: "Only a 24-turn sparkline is read; current Reg lives on statePartyOrg.",
  },
  {
    collection: "partyPoliticalStrengthLedger",
    timeKey: "turn",
    windowTurns: 72,
    mode: RetentionMode.DOWNSAMPLE,
    keepEveryK: DEFAULT_KEEP_EVERY_K,
    note: "Audit-redundant; PS balance lives on politicalParties.politicalStrength.",
  },
  // ── Archive only — event-sourced, cannot delete yet ───────────────────────
  {
    collection: "actionLogs",
    timeKey: "turn",
    windowTurns: 168,
    mode: RetentionMode.ARCHIVE_ONLY_NO_DELETE,
    note: "Achievements + abuse detection count cumulatively from this. Needs a stored counter before any delete.",
  },
  // NOTE: siteTrafficPageviews is intentionally omitted (already TTL'd at 180d).
  // NOTE: primarySnapshots keys on `recordedAt` (no `turn`) — deferred until a
  //       date-based policy is added.
];
