import { ObjectId } from "mongodb";
import type { AltLink, AltLinkSignal, AltSignal } from "@/lib/db/types/altDetection";
import {
  ALT_SIGNAL_REGISTRY,
  type AltCandidateFacet,
  type SignalContext,
  type SignalMatch,
} from "./signals";
import { scoreLink, type ScorableSignal } from "./score";
import { DEFAULT_ALT_SCORING_WEIGHTS, type AltSignalWeights } from "./config";

/**
 * Pairwise link builder (forensics/alt-detection rework plan §3.2, Phase 5
 * T5.2). Over a candidate user set, runs every registered signal against
 * every pair and emits an `AltLink`-shaped edge with per-signal evidence and
 * a noisy-OR confidence.
 *
 * Pure: takes an in-memory candidate list, returns in-memory links. Phase 6
 * (`src/lib/altDetection/run.ts`, a later agent) assembles the candidate
 * facets from live collections and upserts the result into `altLinks`.
 */

export interface BuildLinksOptions {
  /** Weight overrides, merged onto the plan §3.2 defaults (see `config.ts`). */
  weights?: Partial<AltSignalWeights>;
  /** Wall-clock reference for signals without a natural evidence timestamp
   * (identity matches like `oauth_shared`). Defaults to `new Date()`. */
  now?: Date;
  /** Stamped onto every emitted link. Defaults to `0` — Phase 6 passes the
   * current turn number. */
  turn?: number;
  /** Stable active-iteration key stamped onto materialized matches. */
  iterationKey?: string;
  /** Drop links whose aggregate confidence is at or below this floor.
   * Defaults to `0` (keep any link with at least one non-zero signal). */
  minConfidence?: number;
}

const STRONG_CORROBORATING_TYPES: ReadonlySet<AltSignal> = new Set([
  "device_fingerprint_exact",
  "deviceKey_exact",
  "ip_exact_nonCF",
]);

/** `wire_graph_link` boost when corroborated by a device/IP signal on the same
 * pair (plan §3.2 note: "↑ w/ device/ip"). Capped so it never outweighs a
 * definitive identity signal. */
const WIRE_CORROBORATION_BOOST = 0.15;
const WIRE_CORROBORATION_CAP = 0.5;

/** `referral_link` escalation ceiling inside a burner cluster with a banned
 * sibling (plan §3.2: "↑ to 0.45 inside burner cluster w/ banned siblings"). */
const REFERRAL_BURNER_ESCALATION_WEIGHT = 0.45;

function sortPair(a: ObjectId, b: ObjectId): [ObjectId, ObjectId] {
  return a.toString() <= b.toString() ? [a, b] : [b, a];
}

function toScorable(type: AltSignal, match: SignalMatch): ScorableSignal {
  return { type, weight: match.weight, evidence: match.evidence, detectedAt: match.detectedAt };
}

/**
 * `wire_graph_link` corroboration: boost the weight when the same pair also
 * matched a strong device/IP signal. Mutates in place (the array is a local
 * scratch buffer per pair, not shared state).
 */
function applyWireCorroboration(pairSignals: ScorableSignal[]): void {
  const wireIdx = pairSignals.findIndex((s) => s.type === "wire_graph_link");
  if (wireIdx === -1) return;
  const corroborated = pairSignals.some(
    (s) => s.weight > 0 && STRONG_CORROBORATING_TYPES.has(s.type)
  );
  if (!corroborated) return;
  const boosted = Math.min(
    WIRE_CORROBORATION_CAP,
    pairSignals[wireIdx].weight + WIRE_CORROBORATION_BOOST
  );
  pairSignals[wireIdx] = {
    ...pairSignals[wireIdx],
    weight: boosted,
    evidence: `${pairSignals[wireIdx].evidence}; corroborated by a shared device/IP signal`,
  };
}

/**
 * `referral_link` escalation: needs visibility into the whole candidate set
 * (is there a banned sibling referred by the same referrer?), so it runs
 * here in `buildLinks` rather than in the pure per-pair `signals.ts`
 * evaluator, which only sees the two facets in the pair.
 */
function applyReferralEscalation(
  pairSignals: ScorableSignal[],
  a: AltCandidateFacet,
  b: AltCandidateFacet,
  all: AltCandidateFacet[]
): void {
  const idx = pairSignals.findIndex((s) => s.type === "referral_link");
  if (idx === -1) return;

  const referrerId = a.referredBy?.equals(b.userId)
    ? b.userId
    : b.referredBy?.equals(a.userId)
      ? a.userId
      : undefined;
  if (!referrerId) return;

  const referrer = all.find((c) => c.userId.equals(referrerId));
  const siblings = all.filter((c) => c.referredBy?.equals(referrerId));
  const hasBannedSibling = Boolean(referrer?.isBanned) || siblings.some((c) => c.isBanned);
  if (!hasBannedSibling) return;

  const escalated = Math.max(pairSignals[idx].weight, REFERRAL_BURNER_ESCALATION_WEIGHT);
  pairSignals[idx] = {
    ...pairSignals[idx],
    weight: escalated,
    evidence: `${pairSignals[idx].evidence}; escalated: referral chain includes a banned sibling account`,
  };
}

export function buildAltLinks(
  candidates: AltCandidateFacet[],
  options: BuildLinksOptions = {}
): AltLink[] {
  const weights: AltSignalWeights = { ...DEFAULT_ALT_SCORING_WEIGHTS, ...options.weights };
  const now = options.now ?? new Date();
  const turn = options.turn ?? 0;
  const minConfidence = options.minConfidence ?? 0;

  // Corpus-level context. A fingerprint shared by most of the playerbase (mobile
  // handsets collide readily) identifies nobody, so signals need to know how
  // common a value is before treating it as evidence.
  const fingerprintCounts = new Map<string, number>();
  for (const c of candidates) {
    for (const fp of new Set(c.fingerprints)) {
      fingerprintCounts.set(fp, (fingerprintCounts.get(fp) ?? 0) + 1);
    }
  }
  const ctx: SignalContext = { fingerprintCounts };

  const links: AltLink[] = [];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];

      const pairSignals: ScorableSignal[] = [];
      for (const def of ALT_SIGNAL_REGISTRY) {
        const weight = weights[def.type] ?? def.defaultWeight;
        const match = def.evaluate(a, b, weight, now, ctx);
        if (match) pairSignals.push(toScorable(def.type, match));
      }
      if (pairSignals.length === 0) continue;

      applyWireCorroboration(pairSignals);
      applyReferralEscalation(pairSignals, a, b, candidates);

      const { confidence, contributions } = scoreLink(pairSignals);
      if (confidence <= minConfidence) continue;

      const [userA, userB] = sortPair(a.userId, b.userId);
      links.push({
        _id: new ObjectId(),
        userA,
        userB,
        confidence,
        signals: contributions satisfies AltLinkSignal[],
        updatedAt: now,
        turn,
        ...(options.iterationKey ? { iterationKey: options.iterationKey } : {}),
      });
    }
  }

  return links;
}
