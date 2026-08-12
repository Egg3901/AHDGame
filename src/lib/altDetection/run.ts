// Alt-detection compute runner (forensics/alt-detection rework plan §3.2,
// Phase 6 T6.1). Invoked from the HOURLY CRON (`src/lib/cron.ts`), NOT a
// turn phase — an owner decision to keep the alt-scoring compute cost off
// the turn loop (see plan §7 open question 3). Best-effort: gated on
// `isAltScoringEnabled()`, and the whole entry point is wrapped so a throw
// here never propagates to the caller.
//
// Pipeline: select a bounded candidate `users` set (never a full scan) →
// assemble each candidate's `AltCandidateFacet` from `users`/`activityLog`/
// `financialTxLog`/`actionAuditLog` → `buildAltLinks` (Phase 5 `signals.ts`
// registry + noisy-OR scorer) → `buildAltClusters` (connected components) →
// UPSERT `altLinks`/`altClusters`, preserving any existing cluster's
// moderator-set `status`/`reviewedBy`/`reviewNote` across recomputes.

import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import type { Character } from "@/lib/db/types/character";
import type { User } from "@/lib/db/types/user";
import type { ActionLog } from "@/lib/db/types/gameState";
import type { ActionAuditCategory } from "@/lib/db/types/actionAuditLog";
import type {
  ActivityLogAuth,
  ActivityLogFundEvent,
  ActivityLogProfileEvent,
} from "@/lib/db/types/activityLog";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";
import type { AltCluster, AltLink } from "@/lib/db/types/altDetection";
import { getAltClustersCollection, getAltLinksCollection } from "@/lib/db/collections/altDetection";
import { getGameState } from "@/lib/gameState";
import { isAltScoringEnabled } from "./featureFlag";
import { resolveAltScoringConfig } from "./config";
import { buildAltLinks } from "./buildLinks";
import { buildAltClusters } from "./cluster";
import { isDegenerateFingerprint } from "@/lib/utils/degenerateFingerprints";
import type {
  AltCandidateFacet,
  AltFundingEvent,
  AltIpObservation,
  AltWireObservation,
  AltBehavioralObservation,
} from "./signals";
import { compareTargetSets } from "./behavior";
import {
  buildRunMetrics,
  LINK_ESCALATION_DELTA,
  recordAltScoringRun,
  type RunMetricsInput,
} from "./runMetrics";
import { normalizeIp } from "@/lib/utils/ipNormalize";
import {
  eligibleIdentitySignals,
  IDENTITY_SIGNAL_MAX_AGE_MS,
  type SignalEligibility,
} from "@/lib/auth/identitySignals";

// ─── Tunables ────────────────────────────────────────────────────────────

/** How far back to look for "recently active" candidate seeds. Matches
 * `suspiciousDetection.ts`'s FOURTEEN_DAYS_MS window. */
const CANDIDATE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/** Hard cap on the candidate pool. Scoring is O(n^2) pairwise (buildLinks
 * runs the full signal registry over every pair); at 800 candidates that's
 * ~320k pair evaluations, still seconds for an hourly job.
 *
 * Raised from 300 after launch: every hourly run was truncating, so accounts
 * were dropping out of the graph unscored, and the whole registered base is
 * far below this cap — the pool now fits with headroom rather than clipping. */
const MAX_CANDIDATES = 800;

/** Cap on persisted `altLinks` rows per run — guards against a pathological
 * shared-subnet blowup (e.g. a university NAT) writing tens of thousands of
 * near-zero-value rows. Weakest links are dropped first. */
const MAX_LINKS_PERSISTED = 3000;

/** Donate→party→transfer correlation window, mirrors
 * `suspiciousDetection.ts`'s `detectCoordinatedFunding` (3 days). */
const FUNDING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Window for correlating two candidates' party-bloc switches into a
 * `behavioral_similarity` observation (`alt_ring_audit` MCP precedent). */
const PARTY_SWITCH_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Minimum member-set Jaccard overlap to treat a newly computed cluster as
 * "the same ring" as an existing `altClusters` doc, so we update in place
 * (preserving `status`/`reviewedBy`/`reviewNote`) instead of inserting a
 * duplicate. Majority overlap in either direction. */
const CLUSTER_MATCH_MIN_OVERLAP = 0.5;

/** A stored match must be reproduced from current evidence within the same
 * 30-day window used by Duplicate Groups. Otherwise it is stale output, not
 * an active moderation lead. */
const STALE_MATCH_MAX_AGE_MS = IDENTITY_SIGNAL_MAX_AGE_MS;

/** Cap on `actionLogs` rows read per run for the activity timeline and
 * AP-dump target overlap. At 300 candidates over a 14-day window this is a
 * generous ceiling; hitting it degrades the behavior signals (a thinner
 * timeline) rather than breaking them. */
const MAX_ACTION_ROWS = 50_000;

/** Cap on `actionAuditLog` rows read per run. Raised from the original
 * 2,000 (which only had to cover net-identity enrichment) because the same
 * scan now also feeds the activity timeline and `common_attack_victim`. */
const MAX_AUDIT_ROWS = 25_000;

/** Audit categories where acting on a counterparty is CONTESTED, and so a
 * shared target set is meaningful. Deliberately excludes `market` (both
 * accounts trading the same stock is not coordination) and `system`. */
const ADVERSARIAL_AUDIT_CATEGORIES: ReadonlySet<ActionAuditCategory> = new Set([
  "governance",
  "election",
  "party",
  "corp",
]);

// ─── Result shape ────────────────────────────────────────────────────────

export interface AltScoringRunResult {
  /** Whether `gameConfig.altScoringEnabled` was on for this run. When
   * `false`, every other field is zero and no DB writes happened. */
  enabled: boolean;
  /** True when this run computed but did not persist anything
   * (`options.dryRun`). `*Written`/`clustersOpened` describe what WOULD
   * have been written. Used by `scripts/run-alt-scoring-once.mjs`'s
   * default preview mode — the hourly cron never passes this. */
  dryRun: boolean;
  candidateCount: number;
  linksComputed: number;
  linksWritten: number;
  clustersComputed: number;
  /** Clusters actually written this run (new inserts + reconciled updates),
   * or that would be written when `dryRun` is true. */
  clustersWritten: number;
  /** Of `clustersWritten`, how many were brand-new clusters auto-opened
   * because their confidence crossed `thresholds.cluster`. */
  clustersOpened: number;
  durationMs: number;
  /** Links whose confidence rose by at least `LINK_ESCALATION_DELTA` since
   * the previous run — the "these pairs just got a lot more suspicious"
   * count. Zero on an empty or failed run. */
  escalationCount: number;
  /** Links scored for the first time this run. */
  newLinkCount: number;
  /** Set only when the run failed partway through (best-effort — the error
   * is also reported to Sentry; callers should never throw on this). */
  error?: string;
}

/** Minimal shape of the `gameConfig` doc's `altScoring` override field, for
 * the projected `findOne` in {@link runAltScoring}. */
interface AltScoringConfigDoc {
  _id: string;
  altScoring?: {
    weights?: Partial<Record<string, unknown>>;
    thresholds?: Partial<Record<string, unknown>>;
  };
}

function emptyResult(
  enabled: boolean,
  durationMs: number,
  dryRun = false,
  error?: string
): AltScoringRunResult {
  return {
    enabled,
    dryRun,
    candidateCount: 0,
    linksComputed: 0,
    linksWritten: 0,
    clustersComputed: 0,
    clustersWritten: 0,
    clustersOpened: 0,
    durationMs,
    escalationCount: 0,
    newLinkCount: 0,
    ...(error ? { error } : {}),
  };
}

// ─── Candidate selection (never a full scan) ────────────────────────────

/**
 * Bounded candidate user set: seeded from (a) users who logged in recently,
 * (b) users with recent `actionLogs` activity (catches headless/automation
 * actors that never hit the login route), (c) users behind an
 * already-flagged `suspiciousCharacters` entry, then (d) expanded once to
 * any OTHER user sharing a fingerprint/trackingId/deviceKey with a seed —
 * the same "expand pool to shared-signal accounts" step
 * `suspiciousDetection.ts` uses for its fingerprint pool. Mirrors that
 * module's narrowing so alt-scoring never touches the full `users`
 * collection.
 */
async function selectCandidateUserIds(
  db: Db,
  now: Date
): Promise<{ userIds: ObjectId[]; truncated: boolean }> {
  const since = new Date(now.getTime() - CANDIDATE_LOOKBACK_MS);

  const [recentLogins, recentTurnSummaryUserIds, actionActiveUserIds, flaggedCharacters] =
    await Promise.all([
      db
        .collection<ActivityLogAuth>("activityLog")
        .find({ type: "login", timestamp: { $gte: since } }, { projection: { userId: 1 } })
        .toArray(),
      db
        .collection("activityLog")
        .distinct("userId", { type: "turn_summary", timestamp: { $gte: since } }),
      db.collection("actionLogs").distinct("userId", {
        createdAt: { $gte: since },
      }),
      db
        .collection<{ userId: ObjectId }>("suspiciousCharacters")
        .find({}, { projection: { userId: 1 } })
        .toArray(),
    ]);

  const seedIds = new Set<string>();
  for (const doc of recentLogins) seedIds.add(doc.userId.toString());
  for (const id of recentTurnSummaryUserIds as ObjectId[]) seedIds.add(id.toString());
  for (const id of actionActiveUserIds as ObjectId[]) seedIds.add(id.toString());
  for (const doc of flaggedCharacters) seedIds.add(doc.userId.toString());

  if (seedIds.size === 0) return { userIds: [], truncated: false };

  const seedUserIds = [...seedIds].map((id) => new ObjectId(id));

  // Expand once to any other user sharing a fingerprint/trackingId/deviceKey
  // with a seed — this is how a burner with no independent activity signal
  // (never logs in during the window, no actionLogs) still enters the pool
  // when its operator does.
  const seedUsers = await db
    .collection<User>("users")
    .find(
      { _id: { $in: seedUserIds } },
      {
        projection: {
          registrationFingerprint: 1,
          registrationFingerprintAt: 1,
          lastFingerprint: 1,
          lastFingerprintAt: 1,
          trackingId: 1,
          trackingIdAt: 1,
          deviceKey: 1,
          deviceKeyAt: 1,
          registrationIp: 1,
          lastKnownIp: 1,
          lastKnownIpAt: 1,
          createdAt: 1,
          lastLogin: 1,
        },
      }
    )
    .toArray();

  const fingerprints = new Set<string>();
  const trackingIds = new Set<string>();
  const deviceKeys = new Set<string>();
  for (const u of seedUsers) {
    const eligibility = eligibleIdentitySignals(u, now);
    for (const fp of [
      eligibility.registrationFingerprint.eligible ? u.registrationFingerprint : undefined,
      eligibility.lastFingerprint.eligible ? u.lastFingerprint : undefined,
    ]) {
      if (fp && !isDegenerateFingerprint(fp)) fingerprints.add(fp);
    }
    if (eligibility.trackingId.eligible && u.trackingId) trackingIds.add(u.trackingId);
    if (eligibility.deviceKey.eligible && u.deviceKey) deviceKeys.add(u.deviceKey);
  }

  const orClauses: Record<string, unknown>[] = [];
  if (fingerprints.size > 0) {
    const fpList = [...fingerprints];
    orClauses.push(
      { registrationFingerprint: { $in: fpList } },
      { lastFingerprint: { $in: fpList } }
    );
  }
  if (trackingIds.size > 0) orClauses.push({ trackingId: { $in: [...trackingIds] } });
  if (deviceKeys.size > 0) orClauses.push({ deviceKey: { $in: [...deviceKeys] } });

  if (orClauses.length > 0) {
    const expansionMatches = await db
      .collection<User>("users")
      .find({ $or: orClauses }, { projection: { _id: 1 } })
      .limit(MAX_CANDIDATES)
      .toArray();
    for (const doc of expansionMatches) seedIds.add(doc._id.toString());
  }

  // Drop the playtest harness before scoring, not after.
  //
  // A synthetic account shares an IP, a device and a tracking id with whatever
  // drove it, which is the exact signature the ring scorer is built to find —
  // so left in, the harness would be reported as an alt ring, repeatedly, and
  // the only way to tell it from a real one is to already know. Excluding here
  // rather than at link-building keeps it out of the graph entirely, so it can
  // neither be flagged nor drag a real user into a cluster by sitting between
  // them.
  if (seedIds.size > 0) {
    const syntheticUserIds = await db.collection<Character>("characters").distinct("userId", {
      isSynthetic: true,
      userId: { $in: [...seedIds].map((id) => new ObjectId(id)) },
    });
    for (const id of syntheticUserIds) seedIds.delete(id.toString());
  }

  const all = [...seedIds];
  const truncated = all.length > MAX_CANDIDATES;
  if (truncated) {
    Sentry.captureMessage("altDetection: candidate pool exceeded MAX_CANDIDATES, truncating", {
      level: "warning",
      tags: { component: "altDetection", op: "selectCandidateUserIds" },
      extra: { total: all.length, cap: MAX_CANDIDATES },
    });
  }
  return {
    userIds: all.slice(0, MAX_CANDIDATES).map((id) => new ObjectId(id)),
    // Surfaced in the run record (`runMetrics.ts`) so a pool that silently
    // truncates every hour — meaning some pairs are NEVER scored against
    // each other — is visible as a trend rather than only as a Sentry
    // breadcrumb nobody reads.
    truncated,
  };
}

// ─── Facet assembly ──────────────────────────────────────────────────────

function pushIp(
  ipsByUser: Map<string, Map<string, AltIpObservation>>,
  userIdStr: string,
  rawIp: string | undefined | null,
  at: Date,
  isDatacenterOrCgnat?: boolean,
  asn?: string
  // `geo` (lat/lon) is intentionally not a param here — no caller has it to
  // pass. See AltIpObservation's doc comment in signals.ts for the dataset
  // gap (`impossible_travel` TODO).
): void {
  const ip = rawIp ? normalizeIp(rawIp) : null;
  if (!ip) return;
  const byIp = ipsByUser.get(userIdStr) ?? new Map<string, AltIpObservation>();
  const existing = byIp.get(ip);
  if (!existing || existing.at < at) {
    byIp.set(ip, {
      ip,
      at,
      isDatacenterOrCgnat: isDatacenterOrCgnat || existing?.isDatacenterOrCgnat,
      asn: asn ?? existing?.asn,
    });
  }
  ipsByUser.set(userIdStr, byIp);
}

/** Recover the observation timestamp from the eligibility helper's age. The
 * helper is the single authority for legacy fallbacks and malformed dates. */
function observedAt(eligibility: SignalEligibility, now: Date): Date | null {
  if (!eligibility.eligible || eligibility.ageMs === undefined) return null;
  return new Date(now.getTime() - eligibility.ageMs);
}

function usableDate(value: unknown): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

function latestDate(a: unknown, b: unknown): Date | null {
  const usableA = usableDate(a);
  const usableB = usableDate(b);
  if (!usableA) return usableB;
  if (!usableB) return usableA;
  return usableA.getTime() > usableB.getTime() ? usableA : usableB;
}

function isFreshObservationAt(value: unknown, now: Date): boolean {
  const at = usableDate(value);
  if (!at) return false;
  const ageMs = now.getTime() - at.getTime();
  return ageMs <= IDENTITY_SIGNAL_MAX_AGE_MS;
}

/**
 * Assemble `AltCandidateFacet`s for the given candidate users from
 * `users`/`characters`/`activityLog`/`financialTxLog`/`actionAuditLog`.
 * Every query is scoped to `candidateUserIds` (or the character ids derived
 * from them) — no full-collection scans.
 */
async function buildCandidateFacets(
  db: Db,
  candidateUserIds: ObjectId[],
  now: Date
): Promise<AltCandidateFacet[]> {
  const since = new Date(now.getTime() - CANDIDATE_LOOKBACK_MS);

  const [users, characters] = await Promise.all([
    db
      .collection<User>("users")
      .find({ _id: { $in: candidateUserIds } })
      .toArray(),
    db
      .collection<Character>("characters")
      .find({ userId: { $in: candidateUserIds } }, { projection: { _id: 1, userId: 1 } })
      .toArray(),
  ]);

  const charToUser = new Map<string, string>();
  const userToCharIds = new Map<string, ObjectId[]>();
  for (const c of characters) {
    const uid = c.userId.toString();
    charToUser.set(c._id.toString(), uid);
    const arr = userToCharIds.get(uid) ?? [];
    arr.push(c._id);
    userToCharIds.set(uid, arr);
  }
  const candidateCharacterIds = characters.map((c) => c._id);

  // ── ips / fingerprints / login timestamps ────────────────────────────
  const ipsByUser = new Map<string, Map<string, AltIpObservation>>();
  const fingerprintsByUser = new Map<string, Set<string>>();
  const cfTlsByUser = new Map<string, Set<string>>();
  const loginTimestampsByUser = new Map<string, Date[]>();

  for (const u of users) {
    const uid = u._id.toString();
    const eligibility = eligibleIdentitySignals(u, now);
    const fpSet = fingerprintsByUser.get(uid) ?? new Set<string>();
    for (const fp of [
      eligibility.registrationFingerprint.eligible ? u.registrationFingerprint : undefined,
      eligibility.lastFingerprint.eligible ? u.lastFingerprint : undefined,
    ]) {
      if (fp) fpSet.add(fp);
    }
    fingerprintsByUser.set(uid, fpSet);

    // Cloudflare edge JA4/JA3 TLS fingerprints, for `cf_tls_fingerprint`
    // (src/lib/utils/cfFingerprint.ts). Absent on most local-dev/non-Bot-
    // Management-plan users — that's an empty set, not an error.
    const cfSet = cfTlsByUser.get(uid) ?? new Set<string>();
    const registrationCfFresh = isFreshObservationAt(u.createdAt, now);
    const lastCfAt = usableDate(u.lastFingerprintAt) ?? latestDate(u.lastLogin, u.createdAt);
    const lastCfFresh = isFreshObservationAt(lastCfAt, now);
    for (const ja4 of [
      registrationCfFresh ? u.registrationCf?.ja4 : undefined,
      lastCfFresh ? u.lastCf?.ja4 : undefined,
    ]) {
      if (ja4) cfSet.add(ja4);
    }
    cfTlsByUser.set(uid, cfSet);

    const ipDetailsIp = u.ipDetails?.ip ? normalizeIp(u.ipDetails.ip) : null;
    const isKnownDatacenter =
      Boolean(u.ipDetails?.isHosting) ||
      Boolean(u.ipDetails?.isProxy) ||
      Boolean(u.ipDetails?.isVpn);
    for (const [raw, signal] of [
      [u.registrationIp, eligibility.registrationIp],
      [u.lastKnownIp, eligibility.lastKnownIp],
    ] as const) {
      const at = observedAt(signal, now);
      if (!raw || !at) continue;
      const normalized = normalizeIp(raw);
      const ipMatchesDetails = Boolean(normalized && ipDetailsIp === normalized);
      const isDatacenter = ipMatchesDetails && isKnownDatacenter;
      // ASN/org string, for `ip_intelligence` (signals.ts) — only available
      // for this single cached `ipDetails` lookup, not per-login IPs below
      // (no live geoip/ASN call per login; rate-limited third-party API).
      const asn = ipMatchesDetails ? (u.ipDetails?.as ?? undefined) : undefined;
      pushIp(ipsByUser, uid, raw, at, isDatacenter, asn);
    }
  }

  if (candidateUserIds.length > 0) {
    const loginLogs = await db
      .collection<ActivityLogAuth>("activityLog")
      .find({
        type: "login",
        userId: { $in: candidateUserIds },
        timestamp: { $gte: since },
      })
      .toArray();
    for (const log of loginLogs) {
      const uid = log.userId.toString();
      pushIp(ipsByUser, uid, log.ipAddress, log.timestamp);
      if (log.fingerprint) {
        const fpSet = fingerprintsByUser.get(uid) ?? new Set<string>();
        fpSet.add(log.fingerprint);
        fingerprintsByUser.set(uid, fpSet);
      }
      const arr = loginTimestampsByUser.get(uid) ?? [];
      arr.push(log.timestamp);
      loginTimestampsByUser.set(uid, arr);
    }
  }

  // ── funding events: donate→party→transfer correlation ────────────────
  // Mirrors `suspiciousDetection.ts`'s `detectCoordinatedFunding`, but
  // instead of producing a flag, emits a paired `AltFundingEvent` on BOTH
  // sides so `signals.ts`'s `coordinated_funding` evaluator (which needs
  // each side's `counterpartUserId` to already resolve to the other) can
  // find the match.
  const fundingEventsByUser = new Map<string, AltFundingEvent[]>();
  if (candidateCharacterIds.length > 0) {
    const [donations, transfers] = await Promise.all([
      db
        .collection<ActivityLogFundEvent>("activityLog")
        .find({
          type: "fund_event",
          fundEventType: "party_donation",
          timestamp: { $gte: since },
          fromId: { $in: candidateCharacterIds },
          fromType: "character",
        })
        .toArray(),
      db
        .collection<ActivityLogFundEvent>("activityLog")
        .find({
          type: "fund_event",
          fundEventType: "party_transfer",
          timestamp: { $gte: since },
          toId: { $in: candidateCharacterIds },
          toType: "character",
        })
        .toArray(),
    ]);

    const donationsByParty = new Map<string, ActivityLogFundEvent[]>();
    for (const d of donations) {
      const arr = donationsByParty.get(d.toId.toString()) ?? [];
      arr.push(d);
      donationsByParty.set(d.toId.toString(), arr);
    }

    for (const t of transfers) {
      const partyId = t.fromId.toString();
      const partyDonations = donationsByParty.get(partyId);
      if (!partyDonations) continue;
      const recipientCharId = t.toId.toString();
      const recipientUserId = charToUser.get(recipientCharId) ?? t.userId.toString();
      if (recipientUserId === undefined) continue;
      for (const d of partyDonations) {
        const donorCharId = d.fromId.toString();
        const donorUserId = charToUser.get(donorCharId) ?? d.userId.toString();
        if (donorUserId === recipientUserId) continue; // same person, not a pair
        const delta = Math.abs(d.timestamp.getTime() - t.timestamp.getTime());
        if (delta > FUNDING_WINDOW_MS) continue;

        const donorEvents = fundingEventsByUser.get(donorUserId) ?? [];
        donorEvents.push({
          role: "donor",
          counterpartUserId: new ObjectId(recipientUserId),
          partyId,
          amount: d.amount,
          at: d.timestamp,
        });
        fundingEventsByUser.set(donorUserId, donorEvents);

        const recipientEvents = fundingEventsByUser.get(recipientUserId) ?? [];
        recipientEvents.push({
          role: "recipient",
          counterpartUserId: new ObjectId(donorUserId),
          partyId,
          amount: t.amount,
          at: t.timestamp,
        });
        fundingEventsByUser.set(recipientUserId, recipientEvents);
      }
    }
  }

  // ── wire edges: direct character-to-character money flow ─────────────
  const wireEdgesByUser = new Map<string, Map<string, AltWireObservation>>();
  if (candidateCharacterIds.length > 0) {
    const wireRows = await db
      .collection<FinancialTxLogEntry>("financialTxLog")
      .find({
        type: { $in: ["wire_transfer_in", "wire_transfer_out"] },
        subjectType: "character",
        subjectId: { $in: candidateCharacterIds },
        counterpartyType: "character",
      })
      .toArray();

    const unresolvedCounterpartyIds = new Set<string>();
    for (const row of wireRows) {
      const cpId = row.counterpartyId?.toString();
      if (cpId && !charToUser.has(cpId)) unresolvedCounterpartyIds.add(cpId);
    }
    if (unresolvedCounterpartyIds.size > 0) {
      const extraChars = await db
        .collection<Character>("characters")
        .find(
          { _id: { $in: [...unresolvedCounterpartyIds].map((id) => new ObjectId(id)) } },
          { projection: { _id: 1, userId: 1 } }
        )
        .toArray();
      for (const c of extraChars) charToUser.set(c._id.toString(), c.userId.toString());
    }

    for (const row of wireRows) {
      if (!row.subjectId || !row.counterpartyId) continue;
      const subjectUserId = charToUser.get(row.subjectId.toString());
      const counterpartyUserId = charToUser.get(row.counterpartyId.toString());
      if (!subjectUserId || !counterpartyUserId || subjectUserId === counterpartyUserId) continue;

      const byCounterpart =
        wireEdgesByUser.get(subjectUserId) ?? new Map<string, AltWireObservation>();
      const existing = byCounterpart.get(counterpartyUserId);
      const amount = Math.abs(row.amount);
      if (existing) {
        existing.count += 1;
        existing.totalAmount += amount;
        if (row.createdAt > existing.lastAt) existing.lastAt = row.createdAt;
      } else {
        byCounterpart.set(counterpartyUserId, {
          counterpartUserId: new ObjectId(counterpartyUserId),
          count: 1,
          totalAmount: amount,
          lastAt: row.createdAt,
        });
      }
      wireEdgesByUser.set(subjectUserId, byCounterpart);
    }
  }

  // ── behavioral: party-bloc switches within a 48h window ───────────────
  // One of three `behavioral_similarity` sources; the other two
  // (`ap_dump_overlap`, `common_attack_victim`) are assembled further down.
  // Party-bloc switching is directly observable via
  // `ActivityLogProfileEvent` and matches the existing `alt_ring_audit` MCP
  // tool's coordination check.
  const behavioralByUser = new Map<string, AltBehavioralObservation[]>();
  const pushBehavioral = (
    aUserId: ObjectId,
    bUserId: ObjectId,
    kind: AltBehavioralObservation["kind"],
    detail: string,
    at?: Date
  ): void => {
    const aUid = aUserId.toString();
    const bUid = bUserId.toString();
    if (aUid === bUid) return;
    // Emitted on BOTH sides: `signals.ts`'s evaluator only inspects
    // `a.behavioral` for entries pointing at `b`, and pair order is not
    // guaranteed.
    const aObs = behavioralByUser.get(aUid) ?? [];
    aObs.push({ counterpartUserId: bUserId, kind, detail, at });
    behavioralByUser.set(aUid, aObs);
    const bObs = behavioralByUser.get(bUid) ?? [];
    bObs.push({ counterpartUserId: aUserId, kind, detail, at });
    behavioralByUser.set(bUid, bObs);
  };

  if (candidateUserIds.length > 0) {
    const switches = await db
      .collection<ActivityLogProfileEvent>("activityLog")
      .find({
        type: "party_change",
        userId: { $in: candidateUserIds },
        timestamp: { $gte: since },
      })
      .toArray();
    for (let i = 0; i < switches.length; i++) {
      for (let j = i + 1; j < switches.length; j++) {
        const a = switches[i];
        const b = switches[j];
        const aUid = a.userId.toString();
        const bUid = b.userId.toString();
        if (aUid === bUid) continue;
        const delta = Math.abs(a.timestamp.getTime() - b.timestamp.getTime());
        if (delta > PARTY_SWITCH_WINDOW_MS) continue;
        const detail = `Both switched party within ${Math.max(1, Math.round(delta / 3_600_000))}h of each other`;
        pushBehavioral(
          a.userId,
          b.userId,
          "party_bloc_switch",
          detail,
          a.timestamp > b.timestamp ? a.timestamp : b.timestamp
        );
      }
    }
  }

  // ── activity timeline + AP-dump target overlap (from actionLogs) ──────
  //
  // `actionLogs` is the dense per-action record (one row per action point
  // spent) and is the right substrate for two things the login log cannot
  // support:
  //
  //  1. `activityTimestamps` — the behavior signals (`activity_rhythm`,
  //     `session_handoff`) need a timeline with enough resolution to build
  //     hour histograms and sessions from. An account that logs in once and
  //     stays logged in for a week yields ONE login timestamp but hundreds
  //     of actions.
  //  2. `ap_dump_overlap` — the `behavioral_similarity` kind that was
  //     previously declared but never populated. Two accounts pouring their
  //     action points into the same set of target states is the coordination
  //     pattern the `alt_ring_audit` MCP tool looks for by hand.
  const activityByUser = new Map<string, Date[]>();
  const apTargetsByUser = new Map<string, Set<string>>();
  for (const [uid, timestamps] of loginTimestampsByUser) {
    activityByUser.set(uid, [...timestamps]);
  }

  if (candidateUserIds.length > 0) {
    const actionRows = await db
      .collection<ActionLog>("actionLogs")
      .find(
        { userId: { $in: candidateUserIds }, createdAt: { $gte: since } },
        { projection: { userId: 1, createdAt: 1, targetState: 1 }, limit: MAX_ACTION_ROWS }
      )
      .toArray();

    for (const row of actionRows) {
      const uid = row.userId.toString();
      const arr = activityByUser.get(uid) ?? [];
      arr.push(row.createdAt);
      activityByUser.set(uid, arr);
      if (row.targetState) {
        const targets = apTargetsByUser.get(uid) ?? new Set<string>();
        targets.add(row.targetState);
        apTargetsByUser.set(uid, targets);
      }
    }

    const targetEntries = [...apTargetsByUser.entries()];
    for (let i = 0; i < targetEntries.length; i++) {
      for (let j = i + 1; j < targetEntries.length; j++) {
        const [aUid, aTargets] = targetEntries[i];
        const [bUid, bTargets] = targetEntries[j];
        const overlap = compareTargetSets(aTargets, bTargets);
        if (!overlap.qualifies) continue;
        pushBehavioral(
          new ObjectId(aUid),
          new ObjectId(bUid),
          "ap_dump_overlap",
          `Both spent action points on the same ${overlap.shared.length} states (${overlap.shared.slice(0, 4).join(", ")}${overlap.shared.length > 4 ? ", …" : ""}) — ${Math.round(overlap.jaccard * 100)}% target overlap`,
          now
        );
      }
    }
  }

  // ── actionAuditLog: supplementary net-identity enrichment (best-effort) ──
  // `net` is only populated for `source:"api"` rows and only where Phase 2
  // instrumentation has landed, so this is a bonus signal, not a primary
  // source — reads/merges opaque pass-through identifiers (fingerprint /
  // trackingId / deviceKey are already non-PII client-generated ids, see
  // `ActionAuditNet` doc comment) into the facet when the user-doc fields
  // are missing. `ipMasked`/`ipHash` are NOT used here: they're masked at
  // write time and can't feed the CF-edge/subnet checks that need a raw IP.
  try {
    if (candidateUserIds.length > 0) {
      const auditRows = await db
        .collection<ActionAuditRecord>("actionAuditLog")
        .find(
          {
            source: "api",
            "actor.userId": { $in: candidateUserIds },
            ts: { $gte: since },
          },
          {
            projection: { "actor.userId": 1, net: 1, ts: 1, counterparty: 1, category: 1 },
            limit: MAX_AUDIT_ROWS,
          }
        )
        .toArray();

      // Adversarial-action counterparties, keyed per user. This is the
      // `common_attack_victim` source: the set of OTHER entities each
      // account acted against. Scoped to the categories where acting on a
      // counterparty is contested rather than routine — a shared market
      // counterparty is just "both traded the same stock", which is not
      // evidence of anything.
      const victimsByUser = new Map<string, Set<string>>();

      for (const row of auditRows) {
        const uid = row.actor.userId?.toString();
        if (!uid) continue;

        // Timeline enrichment: audited API calls are activity too, and they
        // cover routes that never produce an `actionLogs` row.
        const arr = activityByUser.get(uid) ?? [];
        arr.push(row.ts);
        activityByUser.set(uid, arr);

        if (row.net?.fingerprint) {
          const fpSet = fingerprintsByUser.get(uid) ?? new Set<string>();
          fpSet.add(row.net.fingerprint);
          fingerprintsByUser.set(uid, fpSet);
        }

        const counterpartyId = row.counterparty?.id?.toString();
        if (counterpartyId && ADVERSARIAL_AUDIT_CATEGORIES.has(row.category)) {
          const victims = victimsByUser.get(uid) ?? new Set<string>();
          victims.add(`${row.counterparty?.type ?? "?"}:${counterpartyId}`);
          victimsByUser.set(uid, victims);
        }
      }

      const victimEntries = [...victimsByUser.entries()];
      for (let i = 0; i < victimEntries.length; i++) {
        for (let j = i + 1; j < victimEntries.length; j++) {
          const [aUid, aVictims] = victimEntries[i];
          const [bUid, bVictims] = victimEntries[j];
          const overlap = compareTargetSets(aVictims, bVictims);
          if (!overlap.qualifies) continue;
          pushBehavioral(
            new ObjectId(aUid),
            new ObjectId(bUid),
            "common_attack_victim",
            `Both accounts acted against the same ${overlap.shared.length} targets in contested categories — ${Math.round(overlap.jaccard * 100)}% overlap`,
            now
          );
        }
      }
    }
  } catch (error) {
    // Best-effort enrichment inside a best-effort run — never let a missing
    // or misbehaving `actionAuditLog` collection block core scoring.
    Sentry.captureException(error, {
      tags: { component: "altDetection", op: "auditNetEnrichment" },
      level: "warning",
    });
  }

  return users.map((u): AltCandidateFacet => {
    const uid = u._id.toString();
    const eligibility = eligibleIdentitySignals(u, now);
    return {
      userId: u._id,
      username: u.username,
      isBanned: u.isBanned,
      discordId: u.discordId,
      googleId: u.googleId,
      googleEmail: u.googleEmail,
      deviceKey: eligibility.deviceKey.eligible ? u.deviceKey : undefined,
      trackingId: eligibility.trackingId.eligible ? u.trackingId : undefined,
      fingerprints: [...(fingerprintsByUser.get(uid) ?? [])],
      fingerprintComponents: eligibility.lastFingerprint.eligible
        ? u.lastFingerprintComponents
        : eligibility.registrationFingerprint.eligible
          ? u.registrationFingerprintComponents
          : undefined,
      cfTlsFingerprints: [...(cfTlsByUser.get(uid) ?? [])],
      email: u.email,
      referredBy: u.referredBy,
      patreonUserId: u.patreonUserId,
      // stripeCustomerId: intentionally omitted — no such field exists on
      // `User` yet. See AltCandidateFacet's doc comment in signals.ts
      // (`payment_correlation` TODO) for what schema work would unblock it.
      ips: [...(ipsByUser.get(uid)?.values() ?? [])],
      loginTimestamps: loginTimestampsByUser.get(uid) ?? [],
      activityTimestamps: activityByUser.get(uid) ?? [],
      fundingEvents: fundingEventsByUser.get(uid) ?? [],
      wireEdges: [...(wireEdgesByUser.get(uid)?.values() ?? [])],
      behavioral: behavioralByUser.get(uid) ?? [],
    };
  });
}

// ─── Upsert: altLinks ────────────────────────────────────────────────────

function pairKey(userA: ObjectId, userB: ObjectId): string {
  return `${userA.toString()}_${userB.toString()}`;
}

interface LinkUpsertSummary {
  written: number;
  /** Links whose confidence rose by >= `LINK_ESCALATION_DELTA` this run. */
  escalations: number;
  /** Links scored for the first time. */
  newLinks: number;
}

/**
 * Upsert links, maintaining the longitudinal tracking fields
 * (`firstDetectedAt`/`peakConfidence`/`previousConfidence`/
 * `observationCount`/`escalatedAt`).
 *
 * This needs the PRIOR value of each pair, so it reads the existing rows
 * for the candidate set first. That read is bounded by the same candidate
 * pool the rest of the run is (indexed on `userA`/`userB`) — it is not a
 * scan. Without it, `confidence` is overwritten every hour and a link that
 * climbed from 0.20 to 0.95 overnight is indistinguishable from one that
 * has sat at 0.95 for a month, which is exactly the distinction a
 * moderator triaging a ranked list needs.
 *
 * Escalation/new-link counts are returned rather than logged so the run
 * record can carry them (`runMetrics.ts`).
 */
async function upsertLinks(
  db: Db,
  links: AltLink[],
  candidateUserIds: ObjectId[],
  now: Date,
  dryRun: boolean
): Promise<LinkUpsertSummary> {
  if (links.length === 0) return { written: 0, escalations: 0, newLinks: 0 };
  const toPersist = [...links]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_LINKS_PERSISTED);

  const collection = await getAltLinksCollection(db);
  const existingRows =
    candidateUserIds.length > 0
      ? await collection
          .find(
            { $or: [{ userA: { $in: candidateUserIds } }, { userB: { $in: candidateUserIds } }] },
            { projection: { userA: 1, userB: 1, confidence: 1, peakConfidence: 1 } }
          )
          .toArray()
      : [];
  const existingByPair = new Map(existingRows.map((row) => [pairKey(row.userA, row.userB), row]));

  let escalations = 0;
  let newLinks = 0;
  const ops: AnyBulkWriteOperation<AltLink>[] = [];

  for (const link of toPersist) {
    const existing = existingByPair.get(pairKey(link.userA, link.userB));
    const escalated =
      existing !== undefined && link.confidence - existing.confidence >= LINK_ESCALATION_DELTA;
    if (escalated) escalations += 1;
    if (!existing) newLinks += 1;

    ops.push({
      updateOne: {
        filter: { userA: link.userA, userB: link.userB },
        update: {
          $set: {
            confidence: link.confidence,
            signals: link.signals,
            updatedAt: link.updatedAt,
            turn: link.turn,
            peakConfidence: Math.max(
              link.confidence,
              existing?.peakConfidence ?? existing?.confidence ?? 0
            ),
            // Absent on a first sighting: there is no previous value, and
            // writing the current one would falsely read as "no change".
            ...(existing ? { previousConfidence: existing.confidence } : {}),
            ...(escalated ? { escalatedAt: now } : {}),
            ...(link.iterationKey ? { iterationKey: link.iterationKey } : {}),
          },
          $setOnInsert: {
            _id: link._id,
            userA: link.userA,
            userB: link.userB,
            firstDetectedAt: now,
          },
          $inc: { observationCount: 1 },
        },
        upsert: true,
      },
    });
  }

  if (dryRun) return { written: toPersist.length, escalations, newLinks };

  const result = await collection.bulkWrite(ops, { ordered: false });

  // A link can fall below the persistence cap during a noisy run while still
  // being reproduced by current evidence. Touch any such existing row without
  // upserting or incrementing its observation count so the stale sweep does not
  // mistake "not in the top N" for "not observed".
  const persistedPairs = new Set(toPersist.map((link) => pairKey(link.userA, link.userB)));
  const touchOps: AnyBulkWriteOperation<AltLink>[] = links
    .filter((link) => {
      const key = pairKey(link.userA, link.userB);
      return existingByPair.has(key) && !persistedPairs.has(key);
    })
    .map((link) => ({
      updateOne: {
        filter: { userA: link.userA, userB: link.userB },
        update: { $set: { updatedAt: now } },
        upsert: false,
      },
    }));
  if (touchOps.length > 0) await collection.bulkWrite(touchOps, { ordered: false });

  return {
    written: (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0) + (result.matchedCount ?? 0),
    escalations,
    newLinks,
  };
}

// ─── Upsert: altClusters (status-preserving reconciliation) ─────────────

/**
 * Match a freshly computed cluster against an existing `altClusters` doc by
 * member-set overlap (Jaccard >= {@link CLUSTER_MATCH_MIN_OVERLAP}). Cluster
 * `_id`s are freshly generated every run (`cluster.ts`'s own comment), so
 * this is the reconciliation key — NOT `_id` equality.
 */
function matchExistingCluster(cluster: AltCluster, existing: AltCluster[]): AltCluster | undefined {
  const newIds = new Set(cluster.memberUserIds.map((id) => id.toString()));
  let best: AltCluster | undefined;
  let bestScore = 0;
  for (const doc of existing) {
    const existingIds = new Set(doc.memberUserIds.map((id) => id.toString()));
    let intersection = 0;
    for (const id of newIds) if (existingIds.has(id)) intersection++;
    if (intersection === 0) continue;
    const union = newIds.size + existingIds.size - intersection;
    const jaccard = union === 0 ? 0 : intersection / union;
    if (jaccard > bestScore) {
      bestScore = jaccard;
      best = doc;
    }
  }
  return bestScore >= CLUSTER_MATCH_MIN_OVERLAP ? best : undefined;
}

interface ClusterUpsertSummary {
  written: number;
  opened: number;
}

/**
 * Upsert computed clusters. Two paths:
 *  - Matches an existing doc (by member overlap): refresh confidence/
 *    evidence/roles in place, but NEVER touch `status`/`reviewedBy`/
 *    `reviewNote` — a moderator's disposition on a ring is sticky across
 *    hourly recomputes.
 *  - No match (brand-new ring): only persisted if `confidence >=
 *    thresholds.cluster` (auto-open threshold, owner decision: 60%), with
 *    `status:"open"`. Below threshold, the cluster is computed but not
 *    written — this keeps low-confidence noise out of `altClusters`
 *    without overloading the fixed `AltClusterStatus` enum with a 5th
 *    "hidden" state; it will be (re-)written the moment its confidence
 *    crosses the threshold on a later run, or the moment a real match with
 *    an already-reviewed doc appears.
 */
async function upsertClusters(
  db: Db,
  clusters: AltCluster[],
  clusterThreshold: number,
  candidateUserIds: ObjectId[],
  now: Date,
  dryRun: boolean
): Promise<ClusterUpsertSummary> {
  if (clusters.length === 0) return { written: 0, opened: 0 };
  const collection = await getAltClustersCollection(db);

  const existing =
    candidateUserIds.length > 0
      ? await collection.find({ memberUserIds: { $in: candidateUserIds } }).toArray()
      : [];

  const ops: AnyBulkWriteOperation<AltCluster>[] = [];
  let opened = 0;

  for (const cluster of clusters) {
    const match = matchExistingCluster(cluster, existing);
    if (match) {
      // Weak evidence must not keep a historical cluster alive forever. Only
      // a currently actionable cluster refreshes its staleness clock.
      if (cluster.confidence < clusterThreshold) continue;
      ops.push({
        updateOne: {
          filter: { _id: match._id },
          update: {
            $set: {
              memberUserIds: cluster.memberUserIds,
              confidence: cluster.confidence,
              size: cluster.size,
              signalSummary: cluster.signalSummary,
              roles: cluster.roles,
              topEvidence: cluster.topEvidence,
              updatedAt: now,
              turn: cluster.turn,
              ...(cluster.iterationKey ? { iterationKey: cluster.iterationKey } : {}),
            },
          },
        },
      });
      continue;
    }

    if (cluster.confidence < clusterThreshold) continue;

    ops.push({
      insertOne: {
        document: { ...cluster, status: "open", updatedAt: now },
      },
    });
    opened++;
  }

  if (ops.length === 0) return { written: 0, opened: 0 };
  if (dryRun) return { written: ops.length, opened };
  await collection.bulkWrite(ops, { ordered: false });
  return { written: ops.length, opened };
}

interface PruneSummary {
  links: number;
  clusters: number;
}

/** Drop materialized output from a previous game iteration before matching or
 * upserting. Legacy rows have no iterationKey and are intentionally removed on
 * the first run after this ships. */
async function prunePriorIterationMatches(
  db: Db,
  iterationKey: string | undefined,
  dryRun: boolean
): Promise<PruneSummary> {
  if (!iterationKey || dryRun) return { links: 0, clusters: 0 };
  const priorIteration = { iterationKey: { $ne: iterationKey } };
  const [links, clusters] = await Promise.all([
    (await getAltLinksCollection(db)).deleteMany(priorIteration),
    (await getAltClustersCollection(db)).deleteMany(priorIteration),
  ]);
  return {
    links: links.deletedCount ?? 0,
    clusters: clusters.deletedCount ?? 0,
  };
}

/**
 * Remove materialized matches that have not been reproduced from current
 * evidence within the identity-evidence window. This is an in-run sweep rather
 * than a TTL index so dry runs remain strictly read-only.
 */
async function pruneStaleMatches(db: Db, now: Date, dryRun: boolean): Promise<PruneSummary> {
  if (dryRun) return { links: 0, clusters: 0 };
  const cutoff = new Date(now.getTime() - STALE_MATCH_MAX_AGE_MS);
  const stale = {
    $or: [{ updatedAt: { $lt: cutoff } }, { updatedAt: { $exists: false } }],
  };
  const [links, clusters] = await Promise.all([
    (await getAltLinksCollection(db)).deleteMany(stale),
    (await getAltClustersCollection(db)).deleteMany(stale),
  ]);
  return {
    links: links.deletedCount ?? 0,
    clusters: clusters.deletedCount ?? 0,
  };
}

// ─── Run telemetry ───────────────────────────────────────────────────────

/**
 * Write one run record. A dry run is recorded too (flagged as such) so
 * `scripts/run-alt-scoring-once.mjs` previews are distinguishable from real
 * cron passes rather than invisible. Never throws — `recordAltScoringRun`
 * swallows and reports its own errors.
 */
async function writeRunRecord(db: Db, input: RunMetricsInput): Promise<void> {
  await recordAltScoringRun(db, buildRunMetrics(input));
}

// ─── Entry point ─────────────────────────────────────────────────────────

/**
 * Run one alt-scoring pass: select candidates, build facets, score links,
 * cluster, and upsert. Best-effort — gated on `isAltScoringEnabled()`,
 * wrapped in try/catch so a throw here never propagates to the hourly cron
 * (or any other caller). Errors are reported to Sentry.
 *
 * `options.dryRun` computes everything but skips the `altLinks`/
 * `altClusters` writes — the result's `*Written`/`clustersOpened` fields
 * then describe what WOULD have been written. `options.force` bypasses the
 * `isAltScoringEnabled()` gate (compute still runs even when the flag is
 * off); the returned `enabled` field always reflects the real flag value
 * regardless of `force`. Both exist for
 * `scripts/run-alt-scoring-once.mjs`'s "populate before the cron/flag
 * first fires" use case (plan §6 rollout: seed via backfill scripts before
 * flipping flags) — the hourly cron never passes either.
 */
export async function runAltScoring(
  db: Db,
  options: { turn?: number; now?: Date; dryRun?: boolean; force?: boolean } = {}
): Promise<AltScoringRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun ?? false;
  let flagEnabled = false;

  try {
    flagEnabled = await isAltScoringEnabled();
    if (!flagEnabled && !options.force) {
      return emptyResult(false, Date.now() - startedAt, dryRun);
    }

    const now = options.now ?? new Date();

    const [gameState, configDoc] = await Promise.all([
      getGameState(db).catch(() => null),
      db
        .collection<AltScoringConfigDoc>("gameConfig")
        .findOne({ _id: "default" }, { projection: { altScoring: 1 } })
        .catch(() => null),
    ]);
    const turn = options.turn ?? gameState?.currentTurn ?? 0;
    const iterationKey = gameState?.iteration
      ? `${gameState.iteration.type}:${gameState.iteration.number}`
      : undefined;
    const { weights, thresholds } = resolveAltScoringConfig(configDoc?.altScoring ?? null);

    await prunePriorIterationMatches(db, iterationKey, dryRun);
    const { userIds: candidateUserIds, truncated } = await selectCandidateUserIds(db, now);
    if (candidateUserIds.length === 0) {
      await pruneStaleMatches(db, now, dryRun);
      // Still recorded: a run that finds no candidates at all is exactly the
      // silent-failure case run telemetry exists to make visible.
      await writeRunRecord(db, {
        turn,
        enabled: flagEnabled,
        dryRun,
        candidateCount: 0,
        candidatePoolTruncated: false,
        links: [],
        linksWritten: 0,
        clustersComputed: 0,
        clustersWritten: 0,
        clustersOpened: 0,
        durationMs: Date.now() - startedAt,
        escalationCount: 0,
        newLinkCount: 0,
        at: now,
      });
      return emptyResult(flagEnabled, Date.now() - startedAt, dryRun);
    }

    const facets = await buildCandidateFacets(db, candidateUserIds, now);
    const links = buildAltLinks(facets, { weights, now, turn, iterationKey });
    const clusters = buildAltClusters(links, { thresholds, now, turn, iterationKey });

    const [linkSummary, clusterSummary] = await Promise.all([
      upsertLinks(db, links, candidateUserIds, now, dryRun),
      upsertClusters(db, clusters, thresholds.cluster, candidateUserIds, now, dryRun),
    ]);
    await pruneStaleMatches(db, now, dryRun);

    await writeRunRecord(db, {
      turn,
      enabled: flagEnabled,
      dryRun,
      candidateCount: candidateUserIds.length,
      candidatePoolTruncated: truncated,
      links,
      linksWritten: linkSummary.written,
      clustersComputed: clusters.length,
      clustersWritten: clusterSummary.written,
      clustersOpened: clusterSummary.opened,
      durationMs: Date.now() - startedAt,
      escalationCount: linkSummary.escalations,
      newLinkCount: linkSummary.newLinks,
      at: now,
    });

    return {
      enabled: flagEnabled,
      dryRun,
      candidateCount: candidateUserIds.length,
      linksComputed: links.length,
      linksWritten: linkSummary.written,
      clustersComputed: clusters.length,
      clustersWritten: clusterSummary.written,
      clustersOpened: clusterSummary.opened,
      durationMs: Date.now() - startedAt,
      escalationCount: linkSummary.escalations,
      newLinkCount: linkSummary.newLinks,
    };
  } catch (error) {
    Sentry.captureException(error, { tags: { component: "altDetection", op: "runAltScoring" } });
    const message = error instanceof Error ? error.message : String(error);
    // Record the failure too — an hour with no record at all is ambiguous
    // between "cron did not fire" and "cron fired and threw".
    await writeRunRecord(db, {
      turn: options.turn ?? 0,
      enabled: flagEnabled,
      dryRun,
      candidateCount: 0,
      candidatePoolTruncated: false,
      links: [],
      linksWritten: 0,
      clustersComputed: 0,
      clustersWritten: 0,
      clustersOpened: 0,
      durationMs: Date.now() - startedAt,
      escalationCount: 0,
      newLinkCount: 0,
      at: options.now ?? new Date(),
      error: message,
    });
    return emptyResult(flagEnabled, Date.now() - startedAt, dryRun, message);
  }
}
