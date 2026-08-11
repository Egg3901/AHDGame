import type { ObjectId } from "mongodb";

/**
 * Alt-detection weighted-evidence confidence model (forensics/alt-detection
 * rework plan §3.2). Replaces the current binary severity flags
 * (`suspiciousCharacters`) with a transparent noisy-OR confidence score,
 * explainable per-signal, computed pairwise (`altLinks`) and rolled up into
 * connected-component rings (`altClusters`).
 *
 * Report-only doctrine: nothing here auto-bans or auto-throttles. These
 * collections are read by the `alt_ring_audit`/`alt_rank` MCP tools and the
 * game-admin Alts view; a human moderator/admin always takes the action.
 */

/** One signal type in the registry — see plan §3.2's weight table.
 *
 * `ip_intelligence` / `impossible_travel` / `email_alias_match` /
 * `payment_correlation` are forensics-v2 Wave 1 additions (deeper
 * tracking); see `src/lib/altDetection/signals.ts` for evaluator detail and
 * which of these are fully wired vs. scaffolded pending an external
 * dataset. `cf_tls_fingerprint` is a forensics-v2 Part A addition (server-side
 * Cloudflare edge fingerprint): a shared JA4/JA3 TLS fingerprint across two
 * accounts, which survives cookie clears/incognito.
 *
 * `activity_rhythm` / `session_handoff` are forensics-v2 Wave 3 (behavior
 * tracking) additions — they read the SHAPE of when an account is active
 * rather than any identity token, so they survive a fresh browser, a new
 * device, and a VPN. See `src/lib/altDetection/behavior.ts` for the
 * histogram/session maths and the concentration/overlap guards that keep
 * "everyone plays in the evening" from firing them.
 *
 * NOTE for consumers with
 * an exhaustive `Record<AltSignal, ...>` (e.g.
 * `src/components/admin/alts/altTypes.ts`'s `SIGNAL_META`): every new member
 * needs a matching entry added there too. */
export type AltSignal =
  | "oauth_shared"
  | "device_fingerprint_exact"
  | "deviceKey_exact"
  | "trackingId_exact"
  | "device_fingerprint_fuzzy"
  | "coordinated_funding"
  | "wire_graph_link"
  | "ip_exact_nonCF"
  | "ip_intelligence"
  | "impossible_travel"
  | "coordinated_login_timing"
  | "login_time_cluster"
  | "behavioral_similarity"
  | "email_pattern_family"
  | "email_alias_match"
  | "payment_correlation"
  | "referral_link"
  | "subnet_/24_share"
  | "cf_tls_fingerprint"
  | "activity_rhythm"
  | "session_handoff";

/** Per-signal evidence contributing to one pairwise link's confidence. */
export interface AltLinkSignal {
  type: AltSignal;
  /** Configured weight applied for this signal (`gameConfig.altScoring`). */
  weight: number;
  /** Marginal contribution to the aggregate confidence: P - P_without_i. */
  contribution: number;
  /** Human-readable, PII-masked evidence (e.g. matched fingerprint prefix,
   * masked shared IP, coordinated funding chain step). */
  evidence: string;
  detectedAt: Date;
}

/**
 * `altLinks` — pairwise (userA, userB) confidence edge. Unique on the
 * sorted pair; upserted by `src/lib/altDetection/run.ts`.
 *
 * The `firstDetectedAt`/`peakConfidence`/`previousConfidence`/
 * `observationCount`/`escalatedAt` fields are longitudinal tracking
 * (forensics-v2 Wave 3): each hourly run overwrites `confidence` with the
 * current read, so without them a link that climbed from 0.20 to 0.95
 * overnight is indistinguishable from one that has sat at 0.95 for a month.
 * All five are OPTIONAL — links written before Wave 3 landed don't carry
 * them, and every consumer must tolerate their absence rather than backfill.
 */
export interface AltLink {
  _id: ObjectId;
  userA: ObjectId;
  userB: ObjectId;
  /** Noisy-OR aggregate confidence, P ∈ [0,1]. */
  confidence: number;
  signals: AltLinkSignal[];
  updatedAt: Date;
  turn: number;
  /** Active game iteration when this match was computed. Prevents evidence
   * materialized in one world from appearing in the next iteration. */
  iterationKey?: string;
  /** First run that ever scored this pair above the emit floor. */
  firstDetectedAt?: Date;
  /** Highest `confidence` ever observed for this pair — a link that spiked
   * and then decayed (e.g. the operator stopped sharing an IP) still shows
   * what it peaked at. */
  peakConfidence?: number;
  /** `confidence` as of the PREVIOUS run, so the delta is readable without
   * a separate history collection. */
  previousConfidence?: number;
  /** How many runs have scored this pair. A high count at a stable
   * confidence is a persistent relationship; a count of 1 at high
   * confidence is brand new and worth a look. */
  observationCount?: number;
  /** Last time `confidence` jumped by at least
   * `LINK_ESCALATION_DELTA` (`src/lib/altDetection/runMetrics.ts`) in a
   * single run — the "this pair just got a lot more suspicious" marker. */
  escalatedAt?: Date;
}

/** Ring role assignment (jbm-ring precedent: one operator/referrer, many
 * burners, and weaker circumstantial associates). */
export interface AltClusterRoles {
  operator?: ObjectId;
  burners: ObjectId[];
  associates: ObjectId[];
}

/** Per-signal-type rollup across a cluster's member links, for the
 * ranked-list "top signal" summary. */
export interface AltClusterSignalSummary {
  type: AltSignal;
  count: number;
  maxContribution: number;
}

export type AltClusterStatus = "open" | "reviewed" | "confirmed" | "dismissed";

/**
 * `altClusters` — connected component over `altLinks` edges above the
 * configured strong-link threshold. Weaker links remain pairwise evidence and
 * cannot transitively merge unrelated rings. Ring confidence =
 * strongest-path / mean of strong edges (plan §3.2).
 */
export interface AltCluster {
  _id: ObjectId;
  memberUserIds: ObjectId[];
  confidence: number;
  size: number;
  signalSummary: AltClusterSignalSummary[];
  roles: AltClusterRoles;
  /** Strongest concrete evidence strings across the cluster's links, for the
   * ranked-list preview. */
  topEvidence: string[];
  status: AltClusterStatus;
  reviewedBy?: ObjectId;
  reviewNote?: string;
  updatedAt: Date;
  turn: number;
  /** Active game iteration when this cluster was computed. */
  iterationKey?: string;
}

// ─── Run telemetry (forensics-v2 Wave 3) ──────────────────────────────────

/** Per-signal firing stats for one scoring run. `firedCount` counts links
 * where the signal contributed a NON-ZERO weight; `guardedZeroCount` counts
 * links where it matched but a false-positive guard zeroed it (CF-edge IP,
 * degenerate fingerprint). Tracking both is what makes guard behavior
 * observable over time rather than an invisible no-op. */
export interface AltRunSignalStat {
  type: AltSignal;
  firedCount: number;
  guardedZeroCount: number;
  /** Mean effective weight across the links where it fired non-zero. */
  meanWeight: number;
  /** Mean marginal contribution across those same links. */
  meanContribution: number;
}

/**
 * `altScoringRuns` — one document per `runAltScoring` pass, capped by a TTL
 * index (see `src/lib/admin/seed/indexes/altDetection.ts`).
 *
 * Exists so the detection system's own behavior is measurable: without it,
 * a signal that silently stops firing (an upstream field stops being
 * populated), a candidate pool that quietly truncates every run, or a
 * confidence distribution that drifts after a weight edit are all invisible
 * until a moderator happens to notice the ranked list looks wrong.
 *
 * Report-only, like the rest of `altDetection/` — nothing reads this to
 * change scoring behavior; it feeds `GET /api/admin/alts/metrics`.
 */
export interface AltScoringRunRecord {
  _id: ObjectId;
  at: Date;
  turn: number;
  enabled: boolean;
  dryRun: boolean;
  candidateCount: number;
  /** True when the candidate pool hit `MAX_CANDIDATES` and was truncated —
   * scoring that run was incomplete by construction. */
  candidatePoolTruncated: boolean;
  linksComputed: number;
  linksWritten: number;
  clustersComputed: number;
  clustersWritten: number;
  clustersOpened: number;
  durationMs: number;
  /** Ten fixed 0.1-wide buckets of link confidence, index 0 = [0.0,0.1). */
  confidenceHistogram: number[];
  meanLinkConfidence: number;
  p95LinkConfidence: number;
  /** Links whose confidence rose by at least `LINK_ESCALATION_DELTA` since
   * the previous run. */
  escalationCount: number;
  /** Links scored for the first time this run. */
  newLinkCount: number;
  signalStats: AltRunSignalStat[];
  error?: string;
}
