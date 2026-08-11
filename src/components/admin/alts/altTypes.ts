// Shared types, signal metadata, and pure helpers for the Alt-Detection
// Moderator/Admin view (forensics/alt-detection rework plan §4.8, Phase 8
// UI-2). Consumes the frozen §4.9 API contracts verbatim.
//
// This module holds NO React — it is the single source of truth for the
// response shapes the `/api/admin/alts/*` routes return, the human-facing
// signal metadata (labels, tiers, false-positive guards), and the pure
// scoring maths mirrored from `src/lib/altDetection/{score,cluster,config}.ts`
// so the admin ScoringConfigPanel can live-preview a cluster's % without a
// server round-trip.

import type { AltSignal } from "@/lib/db/types/altDetection";

export type { AltSignal };

export type AltContext = "admin" | "moderator";
export type AltClusterStatus = "open" | "reviewed" | "confirmed" | "dismissed";
export type AltMemberRole = "operator" | "burner" | "associate";

// ─── API response shapes (frozen contract §4.9) ────────────────────────────

export interface ClusterMemberPreview {
  userId: string;
  name: string | null;
  banned: boolean;
}

export interface ClusterListItem {
  id: string;
  confidence: number;
  size: number;
  roles: { operator?: string; burners: string[]; associates: string[] };
  topSignal: AltSignal | null;
  status: AltClusterStatus;
  memberPreview: ClusterMemberPreview[];
  /** Optional forensic-freshness fields — rendered in the stale-compute
   * banner when the backend projects them (the `AltCluster` doc carries both;
   * consumed defensively so the UI works with or without them). */
  turn?: number;
  updatedAt?: string;
}

export interface ClustersResponse {
  clusters: ClusterListItem[];
  nextCursor?: string;
}

export interface SignalContribution {
  type: AltSignal;
  weight: number;
  contribution: number;
  evidence: string;
}

export interface ClusterMember {
  userId: string;
  name: string | null;
  banned: boolean;
  role: AltMemberRole;
}

export interface ClusterLink {
  userA: string;
  userB: string;
  confidence: number;
  signals: SignalContribution[];
}

export interface SignalSummaryItem {
  type: AltSignal;
  count: number;
  maxContribution: number;
}

export interface ClusterDetail {
  id: string;
  confidence: number;
  size: number;
  status: AltClusterStatus;
  members: ClusterMember[];
  signalSummary: SignalSummaryItem[];
  contributions: SignalContribution[];
  links: ClusterLink[];
  topEvidence: string[];
  turn?: number;
  updatedAt?: string;
}

export interface AltScoringThresholds {
  link: number;
  strongLink: number;
  cluster: number;
}

export type AltSignalWeights = Record<AltSignal, number>;

export interface AltConfig {
  weights: AltSignalWeights;
  thresholds: AltScoringThresholds;
}

// ─── Detection-health response shapes (forensics-v2 Wave 3) ───────────────
//
// Mirrors of `GET /api/admin/alts/calibration` (src/lib/altDetection/
// calibration.ts) and `GET /api/admin/alts/metrics` (src/lib/altDetection/
// runMetrics.ts). Dates arrive as ISO strings over the wire, so the fields
// that are `Date` server-side are typed `string` here.

export interface CalibrationBin {
  lower: number;
  upper: number;
  count: number;
  confirmedCount: number;
  meanPredicted: number;
  observedRate: number;
  gap: number;
  lowSample: boolean;
}

export interface ThresholdPoint {
  threshold: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface SignalPrecision {
  signal: AltSignal;
  occurrences: number;
  confirmedCount: number;
  precision: number;
  lift: number;
  lowConfidence: boolean;
}

export interface CalibrationReport {
  generatedAt: string;
  sampleSize: number;
  confirmedTotal: number;
  dismissedTotal: number;
  baseRate: number;
  brierScore: number;
  brierScoreBaseline: number;
  skillScore: number;
  expectedCalibrationError: number;
  maxCalibrationError: number;
  calibrationBias: number;
  bins: CalibrationBin[];
  thresholdSweep: ThresholdPoint[];
  recommendedClusterThreshold: number | null;
  currentClusterThreshold: number;
  signalPrecision: SignalPrecision[];
  lowConfidence: boolean;
  verdict: string;
  method: string;
}

export interface RunSignalStat {
  type: AltSignal;
  firedCount: number;
  guardedZeroCount: number;
  meanWeight: number;
  meanContribution: number;
}

export interface ScoringRunRecord {
  at: string;
  turn: number;
  enabled: boolean;
  dryRun: boolean;
  candidateCount: number;
  candidatePoolTruncated: boolean;
  linksComputed: number;
  linksWritten: number;
  clustersComputed: number;
  clustersWritten: number;
  clustersOpened: number;
  durationMs: number;
  confidenceHistogram: number[];
  meanLinkConfidence: number;
  p95LinkConfidence: number;
  escalationCount: number;
  newLinkCount: number;
  signalStats: RunSignalStat[];
  error?: string;
}

export interface SignalTrendPoint {
  type: AltSignal;
  recentMeanFired: number;
  priorMeanFired: number;
  delta: number;
  wentSilent: boolean;
}

export interface MetricsReport {
  generatedAt: string;
  runs: ScoringRunRecord[];
  windowSize: number;
  latestRun: ScoringRunRecord | null;
  erroredRuns: number;
  truncatedRuns: number;
  signalTrends: SignalTrendPoint[];
  warnings: string[];
}

// ─── Signal metadata (human-facing labels + false-positive guards) ─────────

export type SignalTier = "definitive" | "strong" | "corroborating" | "weak";

export interface SignalMeta {
  label: string;
  tier: SignalTier;
  /** One-line plain-English blurb. */
  blurb: string;
  /** If set, the false-positive guard applied to this signal — surfaced in
   * the UI so moderators can see the score can't be inflated by it. */
  guard?: string;
}

/** Order also defines the ScoringConfigPanel row order (strongest first). */
export const SIGNAL_META: Record<AltSignal, SignalMeta> = {
  oauth_shared: {
    label: "Shared OAuth account",
    tier: "definitive",
    blurb: "Same Discord or Google account is linked to both users.",
  },
  device_fingerprint_exact: {
    label: "Exact device fingerprint",
    tier: "definitive",
    blurb: "Identical browser fingerprint hash (canvas + WebGL + audio).",
    guard:
      "Degenerate / fallback fingerprints are scored 0 — they collide across unrelated browsers.",
  },
  deviceKey_exact: {
    label: "Same device key",
    tier: "definitive",
    blurb: "Shared localStorage device key (survives cookie clears).",
  },
  trackingId_exact: {
    label: "Same browser cookie",
    tier: "definitive",
    blurb: "Shared browser tracking cookie.",
  },
  device_fingerprint_fuzzy: {
    label: "Near-identical fingerprint",
    tier: "strong",
    blurb: "Hardware anchors (canvas/WebGL/audio) match with ≤1 secondary drift.",
  },
  coordinated_funding: {
    label: "Coordinated funding",
    tier: "strong",
    blurb: "Donate → party → transfer between the two accounts inside a 3-day window.",
  },
  wire_graph_link: {
    label: "Direct money flow",
    tier: "corroborating",
    blurb: "Direct wire/transfer flow between the pair.",
  },
  ip_exact_nonCF: {
    label: "Shared IP",
    tier: "corroborating",
    blurb: "Shared non-Cloudflare-edge IP address.",
    guard: "Cloudflare-edge IPs are scored 0; datacenter / CGNAT IPs are capped at 0.15.",
  },
  coordinated_login_timing: {
    label: "Coordinated logins",
    tier: "corroborating",
    blurb: "3+ logins within 15 minutes of each other.",
  },
  login_time_cluster: {
    label: "Login time cluster",
    tier: "corroborating",
    blurb: "Logins within 30 min on 5+ days over a week (survives IP change).",
  },
  behavioral_similarity: {
    label: "Behavioral overlap",
    tier: "corroborating",
    blurb: "Common attack victims, party-bloc switches, or AP-dump target overlap.",
  },
  email_pattern_family: {
    label: "Related emails",
    tier: "corroborating",
    blurb: "Email local-parts in the same family (edit-distance / prefix), same domain.",
  },
  referral_link: {
    label: "Referral link",
    tier: "weak",
    blurb: "One account was referred by the other. Escalated inside a banned burner cluster.",
  },
  "subnet_/24_share": {
    label: "Shared /24 subnet",
    tier: "weak",
    blurb: "Shared IPv4 /24 subnet (only when no exact IP match already fired).",
  },
  payment_correlation: {
    label: "Shared payment account",
    tier: "definitive",
    blurb: "Same Patreon (or Stripe) customer backs both accounts.",
  },
  email_alias_match: {
    label: "Same email (aliased)",
    tier: "strong",
    blurb:
      "Emails normalize to the same address (Gmail dot/plus aliases), or a disposable-mail domain.",
  },
  impossible_travel: {
    label: "Impossible travel",
    tier: "corroborating",
    blurb: "Logins from locations too far apart to travel between in the elapsed time.",
    guard: "Needs per-login geo-IP; scored 0 until that enrichment is populated.",
  },
  ip_intelligence: {
    label: "Shared VPN / hosting ASN",
    tier: "weak",
    blurb: "Distinct IPs on the same VPN/datacenter network (ASN), when neither is residential.",
    guard: "Cloudflare-edge IPs are excluded; residential ASNs do not count.",
  },
  cf_tls_fingerprint: {
    label: "Shared TLS fingerprint",
    tier: "strong",
    blurb:
      "Same Cloudflare edge JA4/JA3 TLS fingerprint on both accounts — survives cookie clears and incognito.",
    guard:
      "Coarser than an exact device fingerprint: many unrelated users on the same browser/OS build share a JA4. Only present on Cloudflare Bot Management plans.",
  },
  session_handoff: {
    label: "Session handoff",
    tier: "strong",
    blurb:
      "Sessions alternate tightly — one account logs off, the other starts within minutes — and the two are never online at the same time.",
    guard:
      "Requires 4+ sessions and 4+ handoffs per side, and is ruled out entirely if the accounts were ever meaningfully online concurrently. Behavior-only: unaffected by a new device, browser, or VPN.",
  },
  activity_rhythm: {
    label: "Matching activity rhythm",
    tier: "weak",
    blurb: "Near-identical hour-of-day and day-of-week activity histograms.",
    guard:
      "Only compared when both accounts have 25+ events AND both play in a narrow, concentrated window — a player active across the whole day matches everyone and is excluded.",
  },
};

export function signalMeta(type: AltSignal): SignalMeta {
  return (
    SIGNAL_META[type] ?? {
      label: type,
      tier: "corroborating",
      blurb: "",
    }
  );
}

export const ROLE_LABEL: Record<AltMemberRole, string> = {
  operator: "Operator",
  burner: "Burner",
  associate: "Associate",
};

export const STATUS_LABEL: Record<AltClusterStatus, string> = {
  open: "Open",
  reviewed: "Reviewed",
  confirmed: "Confirmed",
  dismissed: "Dismissed",
};

// ─── Color scales ──────────────────────────────────────────────────────────
//
// Ordinal severity scale (400-series accents tuned for the dark admin
// surface; CVD-validated pairwise vs #1d1d2a — worst adjacent ΔE 14+). Color
// is NEVER the only channel: every use rides with the % figure, the band
// word, a tier label, or a legend entry. Red is reserved for danger
// (critical confidence / banned); roles use violet/orange/slate so a banned
// outline never collides with a role fill.

/** Confidence → hex, for SVG fills where a Tailwind class can't reach. */
export function confidenceHex(v: number): string {
  if (v >= 0.8) return "#f87171"; // critical (red-400)
  if (v >= 0.6) return "#fb923c"; // elevated (orange-400)
  if (v >= 0.4) return "#facc15"; // moderate (yellow-400)
  return "#60a5fa"; // low (blue-400)
}

/** Confidence → Tailwind text class (kept in lockstep with confidenceHex). */
export function confidenceTextClass(v: number): string {
  if (v >= 0.8) return "text-red-400";
  if (v >= 0.6) return "text-orange-400";
  if (v >= 0.4) return "text-yellow-400";
  return "text-blue-400";
}

export function confidenceLabel(v: number): string {
  if (v >= 0.8) return "Very high";
  if (v >= 0.6) return "High";
  if (v >= 0.4) return "Moderate";
  return "Low";
}

export const TIER_HEX: Record<SignalTier, string> = {
  definitive: "#f87171",
  strong: "#fb923c",
  corroborating: "#38bdf8",
  weak: "#94a3b8",
};

export const TIER_LABEL: Record<SignalTier, string> = {
  definitive: "Definitive",
  strong: "Strong",
  corroborating: "Corroborating",
  weak: "Weak",
};

export const ROLE_HEX: Record<AltMemberRole, string> = {
  operator: "#a78bfa", // violet — the privileged hub; red stays reserved for "banned"
  burner: "#fb923c", // orange — disposable accounts
  associate: "#94a3b8", // slate — peripheral, deliberately muted
};

// ─── Formatting + pure scoring maths ───────────────────────────────────────

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function formatPct(v: number): string {
  return `${Math.round(clamp01(v) * 100)}%`;
}

/** One-decimal percent, for small marginal contributions. */
export function formatPctPrecise(v: number): string {
  const p = clamp01(v) * 100;
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/** Masked display name for a member: username if present, else a short id. */
export function memberDisplayName(name: string | null, userId: string): string {
  if (name && name.trim()) return name;
  return `user·${userId.slice(-6)}`;
}

/** `1 - Π(1 - w_i)` — noisy-OR, mirrors `src/lib/altDetection/score.ts`. */
export function noisyOr(weights: number[]): number {
  const survival = weights.reduce((product, w) => product * (1 - clamp01(w)), 1);
  return 1 - survival;
}

/**
 * Live-preview recompute of a cluster's ring confidence under edited weights
 * and thresholds, faithful to `src/lib/altDetection/cluster.ts`:
 *   - each link's confidence = noisy-OR over its firing signals;
 *   - a signal already guarded to 0 STAYS 0 (guards are not editable — this is
 *     what keeps CF-edge IPs / degenerate fingerprints from ever inflating the
 *     score, and the preview must reflect that);
 *   - other signals scale proportionally from their stored effective weight by
 *     the ratio of edited-to-baseline config weight (so caps like the 0.15
 *     datacenter ceiling scale rather than snap to the raw weight);
 *   - ring confidence = mean of edges ≥ strongLink, else the strongest edge.
 */
export function previewClusterConfidence(
  links: ClusterLink[],
  baselineWeights: AltSignalWeights,
  editedWeights: AltSignalWeights,
  strongLink: number
): number {
  if (links.length === 0) return 0;
  const edgeConfidences = links.map((link) => {
    const weights = link.signals.map((s) => {
      if (s.weight <= 0) return 0; // guarded — immovable
      const base = baselineWeights[s.type];
      if (!base || base <= 0) return clamp01(s.weight);
      return clamp01(s.weight * (editedWeights[s.type] / base));
    });
    return noisyOr(weights);
  });
  const strong = edgeConfidences.filter((c) => c >= strongLink);
  if (strong.length > 0) {
    return strong.reduce((a, b) => a + b, 0) / strong.length;
  }
  return Math.max(...edgeConfidences);
}

/** Stable key for a member pair, order-independent (matches the sorted
 * `(userA,userB)` unique index the API keys links on). */
export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}_${b}` : `${b}_${a}`;
}
