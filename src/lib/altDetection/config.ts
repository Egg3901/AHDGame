import type { AltSignal } from "@/lib/db/types/altDetection";

/**
 * Alt-detection weights + thresholds (forensics/alt-detection rework plan
 * §3.2, Phase 5 T5.4). Admin-editable via `gameConfig.altScoring`
 * (`GET/PUT /api/admin/alts/config`, Phase 6/7 — not built here); this
 * module only owns the fail-closed defaults and the pure merge function.
 *
 * Master on/off is the separate `gameConfig.altScoringEnabled` flag
 * (`src/lib/altDetection/featureFlag.ts`, Phase 0). This file's defaults are
 * what apply when no admin override exists, or when an override is partial
 * (only some signals/thresholds tuned).
 */

export type AltSignalWeights = Record<AltSignal, number>;

export interface AltScoringThresholds {
  /** Minimum pairwise link confidence to include an edge when clustering
   * (plan §3.2 "link threshold"). */
  link: number;
  /** Minimum edge confidence to count as a "strong" edge for role
   * annotation and ring-confidence computation (`cluster.ts`). */
  strongLink: number;
  /** Minimum cluster confidence to auto-surface as `status:"open"` for
   * review (plan §7 open question 6). Below it, computed but hidden from
   * the default ranked list. */
  cluster: number;
}

export interface AltScoringConfig {
  weights: AltSignalWeights;
  thresholds: AltScoringThresholds;
}

/** Conservative defaults. Durable exact identifiers can surface alone;
 * coarse device/network/behavior clues require corroboration. */
export const DEFAULT_ALT_SCORING_WEIGHTS: AltSignalWeights = {
  oauth_shared: 0.97,
  device_fingerprint_exact: 0.95,
  deviceKey_exact: 0.93,
  trackingId_exact: 0.9,
  // Hardware anchors collide across common handset/browser builds. This is
  // corroboration, not enough to create a reviewable pair on its own.
  device_fingerprint_fuzzy: 0.2,
  coordinated_funding: 0.6,
  wire_graph_link: 0.35,
  ip_exact_nonCF: 0.35,
  coordinated_login_timing: 0.35,
  login_time_cluster: 0.3,
  behavioral_similarity: 0.3,
  email_pattern_family: 0.3,
  referral_link: 0.15,
  "subnet_/24_share": 0.15,
  // forensics-v2 Wave 1 additions (src/lib/altDetection/signals.ts):
  payment_correlation: 0.92, // near-definitive: same Patreon/Stripe customer id
  email_alias_match: 0.85, // near-definitive: same inbox after gmail dot/plus normalization
  impossible_travel: 0.5, // SCAFFOLD — inert until per-observation geo lands, see signals.ts
  ip_intelligence: 0.2, // weaker than ip_exact_nonCF: same hosting/VPN ASN, different IP
  // forensics-v2 Part A addition (server-side Cloudflare fingerprint):
  // JA4/JA3 identifies a browser/OS build, not a person. It survives cookie
  // clears but is shared by unrelated users, so it is corroboration only.
  cf_tls_fingerprint: 0.25,
  // forensics-v2 Wave 3 additions (behavior tracking, src/lib/altDetection/behavior.ts):
  session_handoff: 0.45, // tight session alternation with zero concurrent online time —
  // strong for a behavior-only signal (it defeats device/IP hygiene), but not
  // definitive: shift-working housemates on one machine can produce it.
  activity_rhythm: 0.25, // deliberately weak — a matching schedule corroborates,
  // it never carries a link on its own. Guarded to concentrated profiles only.
};

export const DEFAULT_ALT_SCORING_THRESHOLDS: AltScoringThresholds = {
  link: 0.3,
  strongLink: 0.8,
  cluster: 0.75,
};

export const DEFAULT_ALT_SCORING_CONFIG: AltScoringConfig = {
  weights: DEFAULT_ALT_SCORING_WEIGHTS,
  thresholds: DEFAULT_ALT_SCORING_THRESHOLDS,
};

function isValidUnitWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Merge a (possibly partial, possibly admin-supplied and therefore
 * untrusted) override onto the fail-closed defaults. Defensive: any
 * out-of-range or malformed value is dropped rather than applied, so a bad
 * `PUT /api/admin/alts/config` can't zero out or explode a signal's
 * contribution. Unknown keys are ignored.
 */
export function resolveAltScoringConfig(
  override?: Partial<{
    weights: Partial<Record<string, unknown>>;
    thresholds: Partial<Record<string, unknown>>;
  }> | null
): AltScoringConfig {
  const weights: AltSignalWeights = { ...DEFAULT_ALT_SCORING_WEIGHTS };
  if (override?.weights) {
    for (const key of Object.keys(DEFAULT_ALT_SCORING_WEIGHTS) as AltSignal[]) {
      const value = override.weights[key];
      if (isValidUnitWeight(value)) weights[key] = value;
    }
  }

  const thresholds: AltScoringThresholds = { ...DEFAULT_ALT_SCORING_THRESHOLDS };
  if (override?.thresholds) {
    for (const key of Object.keys(DEFAULT_ALT_SCORING_THRESHOLDS) as Array<
      keyof AltScoringThresholds
    >) {
      const value = override.thresholds[key];
      if (isValidUnitWeight(value)) thresholds[key] = value;
    }
  }

  return { weights, thresholds };
}
