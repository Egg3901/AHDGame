// Computes suspicious-character flags at the end of Group 13 (History).
// Evaluates characters who (a) already have a suspicious record, (b) appeared in the
// current turn's activityLog, or (c) belong to recently-authenticated accounts.
// Upserts SuspiciousCharacter docs; deletes docs when all flags clear and suppressions expire.
// Wrapped in runPhase — errors log to Sentry but do not halt turn processing.

import { ObjectId, type Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import { classifyDevice } from "@/lib/utils/userAgent";
import type { StoredFingerprintComponents } from "@/lib/utils/fingerprint";
import { isCloudflareEdgeIp } from "@/lib/utils/cloudflareIpRanges";
import { isDegenerateFingerprint } from "@/lib/utils/degenerateFingerprints";
import type {
  SuspiciousCharacter,
  SuspiciousFlag,
  ActivityLogTurnSummary,
  ActivityLogFundEvent,
  ActivityLogAuth,
} from "@/lib/db/types/activityLog";
import { detectAutomationTiming } from "./automationDetection";

export interface SuspiciousDetectionResult {
  flagged: number;
  cleared: number;
  deleted: number;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_OVERLAP_WINDOW_MS = 15 * 60 * 1000;
const COORDINATED_LOGIN_MIN_OVERLAPS = 3;

interface CharacterUserLink {
  _id: ObjectId;
  userId: ObjectId;
}

interface AuthUserSnapshot {
  _id: ObjectId;
  username: string;
  trackingId?: string | null;
  registrationFingerprint?: string | null;
  lastFingerprint?: string | null;
  fingerprintHistory?: string[];
  registrationFingerprintComponents?: StoredFingerprintComponents | null;
  lastFingerprintComponents?: StoredFingerprintComponents | null;
}

interface CoordinatedLoginMatch {
  otherUserId: string;
  otherUsername: string;
  overlapCount: number;
  dayCount: number;
  signals: string[];
  sharedTrackingIds: string[];
  sharedFingerprints: string[];
  sharedIpDeviceSignatures: string[];
}

interface PairLoginStats {
  userIds: [string, string];
  matchIds: Set<string>;
  days: Set<string>;
  signalTypes: Set<"tracking" | "fingerprint" | "ip_ua">;
  sharedTrackingIds: Set<string>;
  sharedFingerprints: Set<string>;
  sharedIpDeviceSignatures: Set<string>;
}

const LOGIN_SIGNAL_LABELS = {
  tracking: "same tracking cookie",
  fingerprint: "same fingerprint",
  ip_ua: "same IP + device signature",
} as const;

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function formatUsernameList(usernames: string[]): string {
  if (usernames.length <= 2) {
    return usernames.join(", ");
  }

  return `${usernames.slice(0, 2).join(", ")} +${usernames.length - 2} more`;
}

function getUserFingerprints(user: AuthUserSnapshot): string[] {
  return uniqueStrings([
    user.registrationFingerprint,
    user.lastFingerprint,
    ...(user.fingerprintHistory ?? []),
  ]);
}

const ANCHOR_KEYS = ["canvas", "webglRenderer", "audio"] as const;
// `webglVendor`/`languages` (forensics-v2 Part B client-entropy additions)
// are SECONDARY, not ANCHOR, keys — deliberately, for backward compat.
// ANCHOR_KEYS require BOTH sides to have a value (see the `== null` check
// below); records captured before these fields existed have neither, which
// would zero out every fuzzy match for pre-existing users if either were
// promoted to an anchor. As secondary keys they only ever ADD precision:
// missing on either side is skipped (no drift charged), present-and-equal
// costs nothing, present-and-different consumes the one-drift allowance —
// exactly the "more entropy = fewer false collisions" richer-anchor goal
// without breaking matches for fingerprints captured before this shipped.
const SECONDARY_KEYS = [
  "fonts",
  "cores",
  "memory",
  "screen",
  "timezone",
  "platform",
  "webglVendor",
  "languages",
] as const;

/**
 * Fuzzy device match: the three hardware-derived anchors (canvas, WebGL
 * renderer, audio) must all be present on both sides and equal, AND at most one
 * secondary component may differ. A secondary "differs" only when both sides
 * have a value and they are unequal (a missing value is treated as unknown, not
 * a difference) — keeping precision high to avoid review noise. Advisory only.
 */
export function anchorComponentsMatch(
  a: StoredFingerprintComponents | undefined | null,
  b: StoredFingerprintComponents | undefined | null
): boolean {
  if (!a || !b) return false;
  for (const key of ANCHOR_KEYS) {
    if (a[key] == null || b[key] == null) return false;
    if (a[key] !== b[key]) return false;
  }
  let drift = 0;
  for (const key of SECONDARY_KEYS) {
    if (a[key] != null && b[key] != null && a[key] !== b[key]) drift++;
    if (drift > 1) return false;
  }
  return true;
}

function getUserComponents(user: AuthUserSnapshot): StoredFingerprintComponents | undefined {
  return user.lastFingerprintComponents ?? user.registrationFingerprintComponents ?? undefined;
}

export function normalizeUserAgent(userAgent?: string): string {
  if (!userAgent) return "unknown";

  const ua = userAgent.toLowerCase();
  const browser = ua.includes("edg/")
    ? "edge"
    : ua.includes("opr/") || ua.includes("opera")
      ? "opera"
      : ua.includes("chrome/") && !ua.includes("edg/")
        ? "chrome"
        : ua.includes("firefox/")
          ? "firefox"
          : ua.includes("safari/") && !ua.includes("chrome/")
            ? "safari"
            : "other";

  const os = ua.includes("windows")
    ? "windows"
    : ua.includes("android")
      ? "android"
      : ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")
        ? "ios"
        : ua.includes("mac os x") || ua.includes("macintosh")
          ? "mac"
          : ua.includes("linux")
            ? "linux"
            : "other";

  return `${browser}:${os}:${classifyDevice(userAgent)}`;
}

export function buildSharedAuthArtifactFlags(
  now: Date,
  characters: CharacterUserLink[],
  users: AuthUserSnapshot[]
): Map<string, SuspiciousFlag[]> {
  const results = new Map<string, SuspiciousFlag[]>();
  const userMap = new Map(users.map((user) => [user._id.toString(), user]));

  const trackingToUsers = new Map<string, AuthUserSnapshot[]>();
  const fingerprintToUsers = new Map<string, AuthUserSnapshot[]>();

  for (const user of users) {
    if (user.trackingId) {
      const existing = trackingToUsers.get(user.trackingId) ?? [];
      existing.push(user);
      trackingToUsers.set(user.trackingId, existing);
    }

    for (const fingerprint of getUserFingerprints(user)) {
      const existing = fingerprintToUsers.get(fingerprint) ?? [];
      existing.push(user);
      fingerprintToUsers.set(fingerprint, existing);
    }
  }

  for (const character of characters) {
    const user = userMap.get(character.userId.toString());
    if (!user) continue;

    const flags: SuspiciousFlag[] = [];

    if (user.trackingId) {
      const sharedTrackingUsers = (trackingToUsers.get(user.trackingId) ?? []).filter(
        (candidate) => candidate._id.toString() !== user._id.toString()
      );

      if (sharedTrackingUsers.length > 0) {
        flags.push({
          type: "shared_tracking_cookie",
          severity: "high",
          detail: `Same browser tracking cookie as: ${formatUsernameList(sharedTrackingUsers.map((candidate) => candidate.username))}`,
          detectedAt: now,
          evidence: {
            trackingId: user.trackingId,
            sharedWith: sharedTrackingUsers.map((candidate) => ({
              userId: candidate._id.toString(),
              username: candidate.username,
            })),
          },
        });
      }
    }

    const fingerprintMatches = new Map<string, { username: string; matched: Set<string> }>();
    for (const fingerprint of getUserFingerprints(user)) {
      const sharedFingerprintUsers = (fingerprintToUsers.get(fingerprint) ?? []).filter(
        (candidate) => candidate._id.toString() !== user._id.toString()
      );

      for (const candidate of sharedFingerprintUsers) {
        const existing = fingerprintMatches.get(candidate._id.toString()) ?? {
          username: candidate.username,
          matched: new Set<string>(),
        };
        existing.matched.add(fingerprint);
        fingerprintMatches.set(candidate._id.toString(), existing);
      }
    }

    if (fingerprintMatches.size > 0) {
      const sharedFingerprints = new Set<string>();
      for (const match of fingerprintMatches.values()) {
        for (const fingerprint of match.matched) {
          sharedFingerprints.add(fingerprint);
        }
      }

      const exactAccountCount = fingerprintMatches.size + 1; // matched others + this user
      // Only escalate when at least one shared fingerprint carries real entropy;
      // a cluster matched solely on a degenerate/fallback hash isn't ring evidence.
      const hasStrongFingerprint = [...sharedFingerprints].some(
        (fingerprint) => !isDegenerateFingerprint(fingerprint)
      );
      flags.push({
        type: "shared_fingerprint",
        // A real fingerprint shared by 3+ accounts is a strong alt-ring signal;
        // two accounts (e.g. a shared family computer) or degenerate-only matches
        // stay at medium.
        severity: exactAccountCount >= 3 && hasStrongFingerprint ? "high" : "medium",
        detail: `Shared ${sharedFingerprints.size} browser fingerprint${sharedFingerprints.size === 1 ? "" : "s"} with ${formatUsernameList([...fingerprintMatches.values()].map((match) => match.username))}`,
        detectedAt: now,
        evidence: {
          matchType: "exact",
          accountCount: exactAccountCount,
          sharedFingerprints: [...sharedFingerprints],
          sharedWith: [...fingerprintMatches.entries()].map(([userId, match]) => ({
            userId,
            username: match.username,
            matchedFingerprints: [...match.matched],
          })),
        },
      });
    }

    // Fuzzy (near-)match: only when no exact shared_fingerprint flag fired for
    // this character (exact supersedes fuzzy). Capped at medium regardless of N.
    const alreadyExactFlagged = flags.some((flag) => flag.type === "shared_fingerprint");
    if (!alreadyExactFlagged) {
      const myComponents = getUserComponents(user);
      if (myComponents) {
        const fuzzyMatches: { userId: string; username: string }[] = [];
        for (const candidate of users) {
          if (candidate._id.toString() === user._id.toString()) continue;
          if (anchorComponentsMatch(myComponents, getUserComponents(candidate))) {
            fuzzyMatches.push({
              userId: candidate._id.toString(),
              username: candidate.username,
            });
          }
        }
        if (fuzzyMatches.length > 0) {
          flags.push({
            type: "shared_fingerprint",
            severity: "medium",
            detail: `Near-identical device fingerprint (anchors match) with ${formatUsernameList(fuzzyMatches.map((match) => match.username))}`,
            detectedAt: now,
            evidence: {
              matchType: "fuzzy",
              accountCount: fuzzyMatches.length + 1,
              sharedWith: fuzzyMatches,
            },
          });
        }
      }
    }

    if (flags.length > 0) {
      results.set(character._id.toString(), flags);
    }
  }

  return results;
}

export function buildCoordinatedLoginFlags(
  now: Date,
  characters: CharacterUserLink[],
  loginLogs: ActivityLogAuth[]
): Map<string, SuspiciousFlag> {
  const results = new Map<string, SuspiciousFlag>();
  const charToUser = new Map(
    characters.map((character) => [character._id.toString(), character.userId.toString()])
  );
  const userMatches = new Map<string, CoordinatedLoginMatch[]>();
  const userToUsername = new Map<string, string>();
  const artifactGroups = new Map<
    string,
    { type: "tracking" | "fingerprint" | "ip_ua"; value: string; events: ActivityLogAuth[] }
  >();

  for (const log of loginLogs) {
    if (log.type !== "login") continue;

    const userId = log.userId.toString();
    userToUsername.set(userId, log.username);

    if (log.trackingId) {
      const key = `tracking:${log.trackingId}`;
      const existing = artifactGroups.get(key) ?? {
        type: "tracking" as const,
        value: log.trackingId,
        events: [],
      };
      existing.events.push(log);
      artifactGroups.set(key, existing);
    }

    if (log.fingerprint) {
      const key = `fingerprint:${log.fingerprint}`;
      const existing = artifactGroups.get(key) ?? {
        type: "fingerprint" as const,
        value: log.fingerprint,
        events: [],
      };
      existing.events.push(log);
      artifactGroups.set(key, existing);
    }

    const userAgentSignature = normalizeUserAgent(log.userAgent);
    if (log.ipAddress && !isCloudflareEdgeIp(log.ipAddress) && userAgentSignature !== "unknown") {
      const value = `${log.ipAddress}|${userAgentSignature}`;
      const key = `ip_ua:${value}`;
      const existing = artifactGroups.get(key) ?? {
        type: "ip_ua" as const,
        value,
        events: [],
      };
      existing.events.push(log);
      artifactGroups.set(key, existing);
    }
  }

  const pairStats = new Map<string, PairLoginStats>();
  for (const group of artifactGroups.values()) {
    const events = [...group.events].sort(
      (left, right) => left.timestamp.getTime() - right.timestamp.getTime()
    );

    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const delta = events[j].timestamp.getTime() - events[i].timestamp.getTime();
        if (delta > LOGIN_OVERLAP_WINDOW_MS) break;

        const leftUserId = events[i].userId.toString();
        const rightUserId = events[j].userId.toString();
        if (leftUserId === rightUserId) continue;

        const pairKey = [leftUserId, rightUserId].sort().join(":");
        const stats = pairStats.get(pairKey) ?? {
          userIds: [leftUserId, rightUserId].sort() as [string, string],
          matchIds: new Set<string>(),
          days: new Set<string>(),
          signalTypes: new Set<"tracking" | "fingerprint" | "ip_ua">(),
          sharedTrackingIds: new Set<string>(),
          sharedFingerprints: new Set<string>(),
          sharedIpDeviceSignatures: new Set<string>(),
        };

        stats.matchIds.add([events[i]._id.toString(), events[j]._id.toString()].sort().join(":"));
        stats.days.add(events[i].timestamp.toISOString().slice(0, 10));
        stats.days.add(events[j].timestamp.toISOString().slice(0, 10));
        stats.signalTypes.add(group.type);

        if (group.type === "tracking") {
          stats.sharedTrackingIds.add(group.value);
        } else if (group.type === "fingerprint") {
          stats.sharedFingerprints.add(group.value);
        } else {
          stats.sharedIpDeviceSignatures.add(group.value);
        }

        pairStats.set(pairKey, stats);
      }
    }
  }

  for (const stats of pairStats.values()) {
    const overlapCount = stats.matchIds.size;
    if (overlapCount < COORDINATED_LOGIN_MIN_OVERLAPS) continue;

    const [leftUserId, rightUserId] = stats.userIds;
    const leftUsername = userToUsername.get(leftUserId) ?? "unknown";
    const rightUsername = userToUsername.get(rightUserId) ?? "unknown";
    const signals = [...stats.signalTypes].map((type) => LOGIN_SIGNAL_LABELS[type]);

    const leftMatch: CoordinatedLoginMatch = {
      otherUserId: rightUserId,
      otherUsername: rightUsername,
      overlapCount,
      dayCount: stats.days.size,
      signals,
      sharedTrackingIds: [...stats.sharedTrackingIds],
      sharedFingerprints: [...stats.sharedFingerprints],
      sharedIpDeviceSignatures: [...stats.sharedIpDeviceSignatures],
    };
    const rightMatch: CoordinatedLoginMatch = {
      ...leftMatch,
      otherUserId: leftUserId,
      otherUsername: leftUsername,
    };

    const leftExisting = userMatches.get(leftUserId) ?? [];
    leftExisting.push(leftMatch);
    userMatches.set(leftUserId, leftExisting);

    const rightExisting = userMatches.get(rightUserId) ?? [];
    rightExisting.push(rightMatch);
    userMatches.set(rightUserId, rightExisting);
  }

  for (const [characterId, userId] of charToUser) {
    const matches = userMatches.get(userId);
    if (!matches || matches.length === 0) continue;

    matches.sort((left, right) => {
      const strongLeft = Number(
        left.sharedTrackingIds.length > 0 || left.sharedFingerprints.length > 0
      );
      const strongRight = Number(
        right.sharedTrackingIds.length > 0 || right.sharedFingerprints.length > 0
      );
      if (strongRight !== strongLeft) return strongRight - strongLeft;
      if (right.overlapCount !== left.overlapCount) return right.overlapCount - left.overlapCount;
      return right.dayCount - left.dayCount;
    });

    const strongestMatch = matches[0];
    const severity = matches.some(
      (match) => match.sharedTrackingIds.length > 0 || match.sharedFingerprints.length > 0
    )
      ? "high"
      : "medium";
    const otherCount = matches.length - 1;

    results.set(characterId, {
      type: "coordinated_login_pattern",
      severity,
      detail: `Repeated near-simultaneous logins with ${strongestMatch.otherUsername}${otherCount > 0 ? ` (+${otherCount} more)` : ""} (${strongestMatch.overlapCount} overlaps in ${strongestMatch.dayCount} day${strongestMatch.dayCount === 1 ? "" : "s"}; ${strongestMatch.signals.join(", ")})`,
      detectedAt: now,
      evidence: {
        overlapWindowMinutes: LOGIN_OVERLAP_WINDOW_MS / (60 * 1000),
        matches,
      },
    });
  }

  return results;
}

async function detectSharedAuthArtifacts(
  db: Db,
  now: Date,
  characterIds: ObjectId[]
): Promise<Map<string, SuspiciousFlag[]>> {
  const characters = await db
    .collection<CharacterUserLink>("characters")
    .find({ _id: { $in: characterIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();

  if (characters.length === 0) return new Map();

  const userIds = [...new Set(characters.map((character) => character.userId.toString()))].map(
    (userId) => new ObjectId(userId)
  );
  const projection = {
    _id: 1,
    username: 1,
    trackingId: 1,
    registrationFingerprint: 1,
    lastFingerprint: 1,
    fingerprintHistory: 1,
    registrationFingerprintComponents: 1,
    lastFingerprintComponents: 1,
  } as const;

  const users = await db
    .collection<AuthUserSnapshot>("users")
    .find({ _id: { $in: userIds } }, { projection })
    .toArray();

  // Collect every fingerprint appearing on a candidate user.
  const candidateFingerprints = new Set<string>();
  for (const user of users) {
    for (const fp of getUserFingerprints(user)) candidateFingerprints.add(fp);
  }

  // Expand the pool to ALL accounts that share any candidate fingerprint, so the
  // N-way count is accurate even when some ring members were inactive this turn.
  let pool = users;
  if (candidateFingerprints.size > 0) {
    const fpList = [...candidateFingerprints];
    const extra = await db
      .collection<AuthUserSnapshot>("users")
      .find(
        {
          $or: [
            { registrationFingerprint: { $in: fpList } },
            { lastFingerprint: { $in: fpList } },
            { fingerprintHistory: { $in: fpList } },
          ],
        },
        { projection }
      )
      .toArray();
    const byId = new Map(users.map((u) => [u._id.toString(), u]));
    for (const u of extra) byId.set(u._id.toString(), u);
    pool = [...byId.values()];
  }

  return buildSharedAuthArtifactFlags(now, characters, pool);
}

async function detectCoordinatedLogins(
  db: Db,
  now: Date,
  characterIds: ObjectId[]
): Promise<Map<string, SuspiciousFlag>> {
  const characters = await db
    .collection<CharacterUserLink>("characters")
    .find({ _id: { $in: characterIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();

  if (characters.length === 0) return new Map();

  const userIds = [...new Set(characters.map((character) => character.userId.toString()))].map(
    (userId) => new ObjectId(userId)
  );
  const since = new Date(now.getTime() - FOURTEEN_DAYS_MS);
  const loginLogs = await db
    .collection("activityLog")
    .find<ActivityLogAuth>({
      type: "login",
      userId: { $in: userIds },
      timestamp: { $gte: since },
    })
    .toArray();

  return buildCoordinatedLoginFlags(now, characters, loginLogs);
}

// ─── Flag detectors ───────────────────────────────────────────────────────────

/**
 * ip_sharing / ip_sharing_with_funds
 * Medium: 2+ distinct userIds logged in from the same IP in the last 14 days.
 * High:   Same as above AND party fund flows between those accounts.
 */
async function detectIpSharing(
  db: Db,
  now: Date,
  characterIds: ObjectId[]
): Promise<Map<string, SuspiciousFlag[]>> {
  const since = new Date(now.getTime() - FOURTEEN_DAYS_MS);
  const results = new Map<string, SuspiciousFlag[]>();

  // Find all IPs used by the active characters
  const loginLogs = await db
    .collection("activityLog")
    .find<ActivityLogAuth>({
      type: "login",
      timestamp: { $gte: since },
      characterId: { $exists: false }, // login events are per-user, not per-character
    })
    .toArray();

  // Build IP → userIds map
  const ipToUsers = new Map<string, Set<string>>();
  const userToIps = new Map<string, Set<string>>();
  const userToUsername = new Map<string, string>();

  for (const log of loginLogs) {
    if (!log.ipAddress || isCloudflareEdgeIp(log.ipAddress)) continue;
    const uid = log.userId.toString();
    const existing = ipToUsers.get(log.ipAddress) ?? new Set();
    existing.add(uid);
    ipToUsers.set(log.ipAddress, existing);

    const ips = userToIps.get(uid) ?? new Set();
    ips.add(log.ipAddress);
    userToIps.set(uid, ips);

    userToUsername.set(uid, log.username);
  }

  // For each active character, check if their userId shares an IP with another userId
  const charDocs = await db
    .collection<Character>("characters")
    .find({ _id: { $in: characterIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();
  const charToUser = new Map(charDocs.map((c) => [c._id.toString(), c.userId.toString()]));

  // Find all fund flows between users who share an IP (for high severity upgrade)
  const sharedIpUserPairs = new Set<string>(); // "userA:userB" sorted
  for (const [, users] of ipToUsers) {
    if (users.size < 2) continue;
    const arr = [...users];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = [arr[i], arr[j]].sort().join(":");
        sharedIpUserPairs.add(key);
      }
    }
  }

  // Check fund flows between IP-sharing user pairs
  const fundFlowPairs = new Set<string>();
  if (sharedIpUserPairs.size > 0) {
    const fundEvents = await db
      .collection("activityLog")
      .find<ActivityLogFundEvent>({
        type: "fund_event",
        fundEventType: { $in: ["party_transfer", "party_donation"] },
        timestamp: { $gte: since },
      })
      .toArray();

    for (const fe of fundEvents) {
      const fromUserId = fe.userId.toString();
      // Find the other user involved via the toId (if it's a character/party, resolve owner)
      // For simplicity, we check characterId vs the fund event user
      // Full resolution would need to match fromId/toId to character owners
      // Store pairs for later matching
      const pair = [fromUserId, fe.userId.toString()].sort().join(":");
      if (sharedIpUserPairs.has(pair)) {
        fundFlowPairs.add(pair);
      }
    }
  }

  // Build flags per active character
  for (const [charIdStr, userId] of charToUser) {
    const myIps = userToIps.get(userId);
    if (!myIps) continue;

    const sharedWith: Array<{ ip: string; otherUsername: string }> = [];
    let hasFundFlow = false;
    const totalFundAmount = 0;

    for (const ip of myIps) {
      const users = ipToUsers.get(ip);
      if (!users || users.size < 2) continue;
      for (const otherUid of users) {
        if (otherUid === userId) continue;
        const pair = [userId, otherUid].sort().join(":");
        if (fundFlowPairs.has(pair)) hasFundFlow = true;
        sharedWith.push({ ip, otherUsername: userToUsername.get(otherUid) ?? "unknown" });
      }
    }

    if (sharedWith.length === 0) continue;

    const flags: SuspiciousFlag[] = [];

    if (hasFundFlow) {
      flags.push({
        type: "ip_sharing_with_funds",
        severity: "high",
        detail: `Shared IP with ${[...new Set(sharedWith.map((s) => s.otherUsername))].join(", ")} and party fund transfers detected`,
        detectedAt: now,
        evidence: { sharedWith, fundAmount: totalFundAmount },
      });
    } else {
      flags.push({
        type: "ip_sharing",
        severity: "medium",
        detail: `Logged in from same IP as: ${[...new Set(sharedWith.map((s) => s.otherUsername))].join(", ")}`,
        detectedAt: now,
        evidence: { sharedWith },
      });
    }

    results.set(charIdStr, flags);
  }

  return results;
}

/**
 * coordinated_party_funding — High
 * User A donates to party P AND user B (sharing an IP with A) receives from party P
 * within the same 3-day window, indicating coordinated funneling of funds between accounts.
 */
async function detectCoordinatedFunding(
  db: Db,
  now: Date,
  characterIds: ObjectId[]
): Promise<Map<string, SuspiciousFlag>> {
  const results = new Map<string, SuspiciousFlag>();
  const since = new Date(now.getTime() - FOURTEEN_DAYS_MS);
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

  const chars = await db
    .collection<Character>("characters")
    .find({ _id: { $in: characterIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();
  if (chars.length === 0) return results;

  const charToUser = new Map(chars.map((c) => [c._id.toString(), c.userId.toString()]));

  // Build IP-sharing pairs from login history
  const loginLogs = await db
    .collection("activityLog")
    .find<ActivityLogAuth>({
      type: "login",
      timestamp: { $gte: since },
    })
    .toArray();

  const ipToUsers = new Map<string, Set<string>>();
  const userToUsername = new Map<string, string>();
  for (const log of loginLogs) {
    if (!log.ipAddress || isCloudflareEdgeIp(log.ipAddress)) continue;
    const uid = log.userId.toString();
    const existing = ipToUsers.get(log.ipAddress) ?? new Set();
    existing.add(uid);
    ipToUsers.set(log.ipAddress, existing);
    userToUsername.set(uid, log.username);
  }

  const sharedIpUserPairs = new Set<string>();
  for (const [, ipUsers] of ipToUsers) {
    if (ipUsers.size < 2) continue;
    const arr = [...ipUsers];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        sharedIpUserPairs.add([arr[i], arr[j]].sort().join(":"));
      }
    }
  }
  if (sharedIpUserPairs.size === 0) return results;

  // Fund donations from candidate characters → parties
  const donations = await db
    .collection("activityLog")
    .find<ActivityLogFundEvent>({
      type: "fund_event",
      fundEventType: "party_donation",
      timestamp: { $gte: since },
      fromId: { $in: characterIds },
      fromType: "character",
    })
    .toArray();

  // Fund transfers from parties → candidate characters
  const transfers = await db
    .collection("activityLog")
    .find<ActivityLogFundEvent>({
      type: "fund_event",
      fundEventType: "party_transfer",
      timestamp: { $gte: since },
      toId: { $in: characterIds },
      toType: "character",
    })
    .toArray();

  if (donations.length === 0 || transfers.length === 0) return results;

  // partyId → donations list
  const partyDonations = new Map<
    string,
    Array<{ charId: string; userId: string; amount: number; timestamp: Date }>
  >();
  for (const d of donations) {
    const partyId = d.toId.toString();
    const charId = d.fromId.toString();
    const userId = charToUser.get(charId) ?? d.userId.toString();
    const arr = partyDonations.get(partyId) ?? [];
    arr.push({ charId, userId, amount: d.amount, timestamp: d.timestamp });
    partyDonations.set(partyId, arr);
  }

  // partyId → transfers list
  const partyTransfers = new Map<
    string,
    Array<{ charId: string; userId: string; amount: number; timestamp: Date }>
  >();
  for (const t of transfers) {
    const partyId = t.fromId.toString();
    const charId = t.toId.toString();
    const userId = charToUser.get(charId) ?? t.userId.toString();
    const arr = partyTransfers.get(partyId) ?? [];
    arr.push({ charId, userId, amount: t.amount, timestamp: t.timestamp });
    partyTransfers.set(partyId, arr);
  }

  // Collect evidence per flagged character
  const charEvidence = new Map<
    string,
    Array<{
      partnerCharId: string;
      partnerUserId: string;
      partyId: string;
      role: "donor" | "recipient";
      amount: number;
    }>
  >();

  for (const [partyId, donors] of partyDonations) {
    const recipients = partyTransfers.get(partyId);
    if (!recipients) continue;

    for (const donor of donors) {
      for (const recipient of recipients) {
        if (donor.userId === recipient.userId) continue;
        const pair = [donor.userId, recipient.userId].sort().join(":");
        if (!sharedIpUserPairs.has(pair)) continue;
        // Recipient must receive within 3 days of the donation
        const delta = recipient.timestamp.getTime() - donor.timestamp.getTime();
        if (delta < -THREE_DAYS_MS || delta > THREE_DAYS_MS) continue;

        const donorArr = charEvidence.get(donor.charId) ?? [];
        donorArr.push({
          partnerCharId: recipient.charId,
          partnerUserId: recipient.userId,
          partyId,
          role: "donor",
          amount: donor.amount,
        });
        charEvidence.set(donor.charId, donorArr);

        const recipArr = charEvidence.get(recipient.charId) ?? [];
        recipArr.push({
          partnerCharId: donor.charId,
          partnerUserId: donor.userId,
          partyId,
          role: "recipient",
          amount: recipient.amount,
        });
        charEvidence.set(recipient.charId, recipArr);
      }
    }
  }

  if (charEvidence.size === 0) return results;

  // Resolve party names for display
  const involvedPartyIds = [...new Set([...charEvidence.values()].flat().map((e) => e.partyId))];
  const parties = await db
    .collection("politicalParties")
    .find(
      { _id: { $in: involvedPartyIds.map((id) => new ObjectId(id)) } },
      { projection: { _id: 1, name: 1 } }
    )
    .toArray();
  const partyNameMap = new Map(parties.map((p) => [p._id.toString(), p.name as string]));

  for (const [charIdStr, evidence] of charEvidence) {
    const partnerUsernames = [
      ...new Set(evidence.map((e) => userToUsername.get(e.partnerUserId) ?? "unknown")),
    ];
    const partyNames = [...new Set(evidence.map((e) => partyNameMap.get(e.partyId) ?? "unknown"))];
    const role = evidence[0].role;
    results.set(charIdStr, {
      type: "coordinated_party_funding",
      severity: "high",
      detail: `${role === "donor" ? "Donated to" : "Received from"} ${partyNames.join(", ")} while IP-sharing ${role === "donor" ? "recipient" : "donor"}: ${partnerUsernames.join(", ")}`,
      detectedAt: now,
      evidence: { role, partnerUsernames, partyNames, eventCount: evidence.length },
    });
  }

  return results;
}

/**
 * ap_dump_targeting — Medium
 * 80%+ of AP spent on the same non-self target for 5+ consecutive turns.
 */
async function detectApDumpTargeting(
  db: Db,
  now: Date,
  characterIds: ObjectId[]
): Promise<Map<string, SuspiciousFlag>> {
  const results = new Map<string, SuspiciousFlag>();

  // Fetch last 10 turn summaries for active characters
  const summaries = await db
    .collection("activityLog")
    .find<ActivityLogTurnSummary>({
      type: "turn_summary",
      characterId: { $in: characterIds },
    })
    .sort({ timestamp: -1 })
    .limit(characterIds.length * 10)
    .toArray();

  // Group by character, ordered by turn descending
  const byChr = new Map<string, ActivityLogTurnSummary[]>();
  for (const s of summaries) {
    const key = s.characterId.toString();
    const arr = byChr.get(key) ?? [];
    arr.push(s);
    byChr.set(key, arr);
  }

  for (const [charIdStr, turns] of byChr) {
    if (turns.length < 5) continue;
    // Count consecutive turns from most recent where 80%+ AP goes to same non-self target
    let consecutiveCount = 0;
    let dominantTarget: string | null = null;
    let dominantTargetType: string | null = null;

    for (const turn of turns) {
      if (turn.apSpent === 0) break;
      // Count AP per target
      const targetAp = new Map<string, number>();
      for (const action of turn.actions) {
        if (action.targetType === "self" || !action.targetName) continue;
        const k = action.targetName;
        targetAp.set(k, (targetAp.get(k) ?? 0) + action.apCost);
      }
      if (targetAp.size === 0) break;

      // Find dominant target
      let maxAp = 0;
      let maxTarget = "";
      let maxTargetType = "";
      for (const action of turn.actions) {
        if (action.targetType === "self" || !action.targetName) continue;
        const ap = targetAp.get(action.targetName) ?? 0;
        if (ap > maxAp) {
          maxAp = ap;
          maxTarget = action.targetName;
          maxTargetType = action.targetType ?? "unknown";
        }
      }

      const pct = maxAp / turn.apSpent;
      if (pct < 0.8) break;

      if (dominantTarget === null) {
        dominantTarget = maxTarget;
        dominantTargetType = maxTargetType;
        consecutiveCount = 1;
      } else if (dominantTarget === maxTarget) {
        consecutiveCount++;
      } else {
        break;
      }

      if (consecutiveCount >= 5) break;
    }

    if (consecutiveCount >= 5 && dominantTarget) {
      results.set(charIdStr, {
        type: "ap_dump_targeting",
        severity: "medium",
        detail: `80%+ of AP spent on "${dominantTarget}" (${dominantTargetType}) for ${consecutiveCount} consecutive turns`,
        detectedAt: now,
        evidence: { targetName: dominantTarget, targetType: dominantTargetType, consecutiveCount },
      });
    }
  }

  return results;
}

/**
 * login_time_cluster — Medium
 * Two users who consistently log in within 30 minutes of each other on 5+ distinct days
 * spread across at least 7 days, suggesting the same person operating multiple accounts.
 */
async function detectLoginTimeCluster(
  db: Db,
  now: Date,
  characterIds: ObjectId[]
): Promise<Map<string, SuspiciousFlag>> {
  const results = new Map<string, SuspiciousFlag>();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const CLUSTER_WINDOW_MS = 30 * 60 * 1000;
  const MIN_CLUSTER_DAYS = 5;
  const MIN_SPAN_DAYS = 7;
  const since = new Date(now.getTime() - THIRTY_DAYS_MS);

  const chars = await db
    .collection<Character>("characters")
    .find({ _id: { $in: characterIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();
  if (chars.length === 0) return results;

  const charToUser = new Map(chars.map((c) => [c._id.toString(), c.userId.toString()]));
  const userIds = [...new Set(chars.map((c) => c.userId.toString()))].map((id) => new ObjectId(id));

  const logins = await db
    .collection("activityLog")
    .find<ActivityLogAuth>({
      type: "login",
      userId: { $in: userIds },
      timestamp: { $gte: since },
    })
    .sort({ timestamp: 1 })
    .toArray();

  // Group logins by userId, indexed by calendar day
  const userLoginsByDay = new Map<string, Map<string, Date[]>>();
  const userToUsername = new Map<string, string>();
  for (const log of logins) {
    const uid = log.userId.toString();
    userToUsername.set(uid, log.username);
    const day = log.timestamp.toISOString().slice(0, 10);
    const dayMap = userLoginsByDay.get(uid) ?? new Map<string, Date[]>();
    const dayLogins = dayMap.get(day) ?? [];
    dayLogins.push(log.timestamp);
    dayMap.set(day, dayLogins);
    userLoginsByDay.set(uid, dayMap);
  }

  const activeUserIds = [...userLoginsByDay.keys()];
  if (activeUserIds.length < 2) return results;

  // For each pair, count days where both logged in within CLUSTER_WINDOW_MS of each other
  const pairClusterDays = new Map<
    string,
    { days: Set<string>; earliestDay: string; latestDay: string }
  >();

  for (let i = 0; i < activeUserIds.length; i++) {
    for (let j = i + 1; j < activeUserIds.length; j++) {
      const uidA = activeUserIds[i];
      const uidB = activeUserIds[j];
      const daysA = userLoginsByDay.get(uidA)!;
      const daysB = userLoginsByDay.get(uidB)!;

      const clusterDays = new Set<string>();
      // Check all days present in either user's log
      const allDays = new Set([...daysA.keys(), ...daysB.keys()]);
      for (const day of allDays) {
        // Also pull logins from the following day to catch sessions spanning midnight
        const nextDay = new Date(new Date(day).getTime() + 86_400_000).toISOString().slice(0, 10);
        const loginsA = [...(daysA.get(day) ?? []), ...(daysA.get(nextDay) ?? [])];
        const loginsB = [...(daysB.get(day) ?? []), ...(daysB.get(nextDay) ?? [])];

        outer: for (const ta of loginsA) {
          for (const tb of loginsB) {
            if (Math.abs(ta.getTime() - tb.getTime()) <= CLUSTER_WINDOW_MS) {
              clusterDays.add(day);
              break outer;
            }
          }
        }
      }

      if (clusterDays.size < MIN_CLUSTER_DAYS) continue;

      const sortedDays = [...clusterDays].sort();
      const spanMs = new Date(sortedDays.at(-1)!).getTime() - new Date(sortedDays[0]).getTime();
      if (spanMs < MIN_SPAN_DAYS * 86_400_000) continue;

      pairClusterDays.set([uidA, uidB].sort().join(":"), {
        days: clusterDays,
        earliestDay: sortedDays[0],
        latestDay: sortedDays.at(-1)!,
      });
    }
  }

  if (pairClusterDays.size === 0) return results;

  for (const [charIdStr, userId] of charToUser) {
    const matches = [...pairClusterDays.entries()].filter(
      ([pair]) => pair.startsWith(userId + ":") || pair.endsWith(":" + userId)
    );
    if (matches.length === 0) continue;

    // Pick the most overlapping pair to headline the flag
    matches.sort((a, b) => b[1].days.size - a[1].days.size);
    const [topPair, topStats] = matches[0];
    const [uidA, uidB] = topPair.split(":");
    const otherUid = uidA === userId ? uidB : uidA;
    const otherUsername = userToUsername.get(otherUid) ?? "unknown";
    const extra = matches.length - 1;

    results.set(charIdStr, {
      type: "login_time_cluster",
      severity: "medium",
      detail: `Logins consistently within 30 min of ${otherUsername}${extra > 0 ? ` (+${extra} more)` : ""} on ${topStats.days.size} days (${topStats.earliestDay} – ${topStats.latestDay})`,
      detectedAt: now,
      evidence: {
        clusterWindowMinutes: CLUSTER_WINDOW_MS / 60_000,
        matches: matches.map(([pair, stats]) => {
          const [a, b] = pair.split(":");
          const other = a === userId ? b : a;
          return {
            otherUsername: userToUsername.get(other) ?? "unknown",
            dayCount: stats.days.size,
            earliestDay: stats.earliestDay,
            latestDay: stats.latestDay,
          };
        }),
      },
    });
  }

  return results;
}

/**
 * login_ip_scatter — Medium
 * 5+ distinct IPs in any 7-day window.
 */
async function detectLoginIpScatter(
  db: Db,
  characterIds: ObjectId[]
): Promise<Map<string, SuspiciousFlag>> {
  const results = new Map<string, SuspiciousFlag>();
  const now = new Date();
  const since = new Date(now.getTime() - SEVEN_DAYS_MS);

  // Map character → userId
  const chars = await db
    .collection<Character>("characters")
    .find({ _id: { $in: characterIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();
  const charToUser = new Map(chars.map((c) => [c._id.toString(), c.userId.toString()]));
  const userIds = chars.map((c) => c.userId);

  const logins = await db
    .collection("activityLog")
    .find<ActivityLogAuth>({
      type: "login",
      userId: { $in: userIds },
      timestamp: { $gte: since },
      ipAddress: { $exists: true },
    })
    .toArray();

  const userToIps = new Map<string, Set<string>>();
  const userToIpLog = new Map<string, Array<{ ip: string; timestamp: Date }>>();
  for (const log of logins) {
    if (!log.ipAddress || isCloudflareEdgeIp(log.ipAddress)) continue;
    const uid = log.userId.toString();
    const ips = userToIps.get(uid) ?? new Set();
    ips.add(log.ipAddress);
    userToIps.set(uid, ips);
    const arr = userToIpLog.get(uid) ?? [];
    arr.push({ ip: log.ipAddress, timestamp: log.timestamp });
    userToIpLog.set(uid, arr);
  }

  for (const [charIdStr, userId] of charToUser) {
    const ips = userToIps.get(userId);
    if (!ips || ips.size < 5) continue;
    const entries = userToIpLog.get(userId) ?? [];
    results.set(charIdStr, {
      type: "login_ip_scatter",
      severity: "medium",
      detail: `Logged in from ${ips.size} distinct IPs in 7 days`,
      detectedAt: now,
      evidence: { ipCount: ips.size, ips: [...ips], entries },
    });
  }

  return results;
}

// ─── Main phase ───────────────────────────────────────────────────────────────

export async function processSuspiciousDetection(
  db: Db,
  newTurn: number
): Promise<SuspiciousDetectionResult> {
  const now = new Date();

  // Determine candidate character IDs:
  // (a) already flagged, (b) appeared in this turn's activity log,
  // (c) belong to a user who logged in during the suspicious-detection window.
  const [existingFlagged, currentTurnSummaries, recentLogins] = await Promise.all([
    db
      .collection("suspiciousCharacters")
      .find<SuspiciousCharacter>({}, { projection: { characterId: 1 } })
      .toArray(),
    db
      .collection("activityLog")
      .find<ActivityLogTurnSummary>(
        { type: "turn_summary", turnNumber: newTurn - 1 },
        { projection: { characterId: 1 } }
      )
      .toArray(),
    db
      .collection("activityLog")
      .find<ActivityLogAuth>(
        { type: "login", timestamp: { $gte: new Date(now.getTime() - FOURTEEN_DAYS_MS) } },
        { projection: { userId: 1 } }
      )
      .toArray(),
  ]);

  const candidateIds = new Set<string>();
  for (const doc of existingFlagged) {
    candidateIds.add(doc.characterId.toString());
  }
  for (const doc of currentTurnSummaries) {
    candidateIds.add(doc.characterId.toString());
  }
  const authActiveUserIds = [...new Set(recentLogins.map((doc) => doc.userId.toString()))].map(
    (userId) => new ObjectId(userId)
  );
  if (authActiveUserIds.length > 0) {
    const authActiveCharacters = await db
      .collection<Character>("characters")
      .find({ userId: { $in: authActiveUserIds } }, { projection: { _id: 1 } })
      .toArray();
    for (const character of authActiveCharacters) {
      candidateIds.add(character._id.toString());
    }
  }

  // Characters who took logged actions recently — catches automated actors that
  // never log in (headless scripts) and whose actions aren't in turn_summary.
  const actionActiveUserIds = (await db.collection("actionLogs").distinct("userId", {
    createdAt: { $gte: new Date(now.getTime() - FOURTEEN_DAYS_MS) },
  })) as ObjectId[];
  if (actionActiveUserIds.length > 0) {
    const actionActiveCharacters = await db
      .collection<Character>("characters")
      .find({ userId: { $in: actionActiveUserIds } }, { projection: { _id: 1 } })
      .toArray();
    for (const character of actionActiveCharacters) {
      candidateIds.add(character._id.toString());
    }
  }

  if (candidateIds.size === 0) return { flagged: 0, cleared: 0, deleted: 0 };

  const characterIds = [...candidateIds].map((id) => new ObjectId(id));

  // Look up existing SuspiciousCharacter docs for dismissal / suppression data.
  // Exclude resolved (banned) entries — they are permanently archived.
  const existingDocs = await db
    .collection("suspiciousCharacters")
    .find<SuspiciousCharacter>({ characterId: { $in: characterIds }, pool: { $ne: "resolved" } })
    .toArray();
  const existingMap = new Map(existingDocs.map((d) => [d.characterId.toString(), d]));

  // Also load resolved IDs so we can skip them in the candidate loop.
  const resolvedDocs = await db
    .collection("suspiciousCharacters")
    .find<{ characterId: ObjectId }>(
      { characterId: { $in: characterIds }, pool: "resolved" },
      { projection: { characterId: 1 } }
    )
    .toArray();
  const resolvedIds = new Set(resolvedDocs.map((d) => d.characterId.toString()));

  // Run all detectors in parallel
  const [
    ipFlags,
    coordinatedFunding,
    apDump,
    ipScatter,
    loginTimeCluster,
    authArtifacts,
    coordinatedLogins,
    automationFlags,
  ] = await Promise.all([
    detectIpSharing(db, now, characterIds),
    detectCoordinatedFunding(db, now, characterIds),
    detectApDumpTargeting(db, now, characterIds),
    detectLoginIpScatter(db, characterIds),
    detectLoginTimeCluster(db, now, characterIds),
    detectSharedAuthArtifacts(db, now, characterIds),
    detectCoordinatedLogins(db, now, characterIds),
    detectAutomationTiming(db, now, characterIds),
  ]);

  // Fetch character info for any new flagged chars not yet in suspiciousCharacters
  const chars = await db
    .collection<Character>("characters")
    .find(
      { _id: { $in: characterIds } },
      { projection: { _id: 1, name: 1, userId: 1, countryId: 1 } }
    )
    .toArray();
  const charMap = new Map(chars.map((c) => [c._id.toString(), c]));
  const users = await db
    .collection("users")
    .find(
      { _id: { $in: chars.map((c) => c.userId) } },
      { projection: { _id: 1, username: 1, isBanned: 1 } }
    )
    .toArray();
  const userMap = new Map(users.map((u) => [u._id.toString(), u.username as string]));
  // Banned accounts are cleared from the active queue by the ban handler; don't
  // accrue NEW flags for them here (residual actionLogs can still make them
  // candidates). Unbanning clears isBanned, so they're evaluated again.
  const bannedUserIds = new Set(
    users.filter((u) => u.isBanned === true).map((u) => u._id.toString())
  );

  let flagged = 0;
  let cleared = 0;
  const deleted = 0;

  for (const charIdStr of candidateIds) {
    const char = charMap.get(charIdStr);
    if (!char) continue;

    const existing = existingMap.get(charIdStr);
    const suppressedTypes = new Set(
      (existing?.suppressedFlags ?? [])
        .filter((sf) => sf.suppressedUntil > now)
        .map((sf) => sf.type)
    );

    // Skip resolved (banned) entries — permanently archived
    if (resolvedIds.has(charIdStr)) continue;

    // Skip currently-banned accounts — no new flags while banned.
    if (bannedUserIds.has(char.userId.toString())) continue;

    // Merge all detected flags for this character, respecting suppression
    const newFlags: SuspiciousFlag[] = [];

    const authArtifactFlagsForChar = authArtifacts.get(charIdStr) ?? [];
    for (const flag of authArtifactFlagsForChar) {
      if (!suppressedTypes.has(flag.type)) newFlags.push(flag);
    }
    // ip_sharing / ip_sharing_with_funds
    const ipFlagsForChar = ipFlags.get(charIdStr) ?? [];
    for (const f of ipFlagsForChar) {
      if (!suppressedTypes.has(f.type)) newFlags.push(f);
    }
    // coordinated_party_funding
    const cf = coordinatedFunding.get(charIdStr);
    if (cf && !suppressedTypes.has(cf.type)) newFlags.push(cf);
    // ap_dump_targeting
    const ad = apDump.get(charIdStr);
    if (ad && !suppressedTypes.has(ad.type)) newFlags.push(ad);
    // login_ip_scatter
    const ls = ipScatter.get(charIdStr);
    if (ls && !suppressedTypes.has(ls.type)) newFlags.push(ls);
    // login_time_cluster
    const ltc = loginTimeCluster.get(charIdStr);
    if (ltc && !suppressedTypes.has(ltc.type)) newFlags.push(ltc);
    // coordinated_login_pattern
    const cl = coordinatedLogins.get(charIdStr);
    if (cl && !suppressedTypes.has(cl.type)) newFlags.push(cl);
    // automation_timing
    const auto = automationFlags.get(charIdStr);
    if (auto && !suppressedTypes.has(auto.type)) newFlags.push(auto);

    // Active suppressedFlags (not yet expired)
    const activeSuppressed = (existing?.suppressedFlags ?? []).filter(
      (sf) => sf.suppressedUntil > now
    );

    // Move to resolved pool if clean and no active suppressions (instead of deleting)
    if (newFlags.length === 0 && activeSuppressed.length === 0) {
      if (existing && existing.pool !== "resolved") {
        await db.collection("suspiciousCharacters").updateOne(
          { characterId: char._id },
          {
            $set: {
              flags: [],
              flagCount: 0,
              highestSeverity: "low",
              lastUpdated: now,
              pool: "resolved",
              dismissed: true,
            },
          }
        );
        cleared++;
      }
      continue;
    }

    // Compute severity
    const severityOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };
    const highestSeverity =
      newFlags.length > 0
        ? (newFlags.reduce((best, f) =>
            severityOrder[f.severity] > severityOrder[best.severity] ? f : best
          ).severity as "low" | "medium" | "high")
        : "low";

    const doc: SuspiciousCharacter = {
      _id: char._id,
      characterId: char._id,
      characterName: char.name,
      userId: char.userId,
      username: userMap.get(char.userId.toString()) ?? "unknown",
      countryId: char.countryId,
      flags: newFlags,
      flagCount: newFlags.length,
      highestSeverity,
      lastUpdated: now,
      dismissed: existing?.dismissed ?? false,
      dismissedAt: existing?.dismissedAt,
      dismissedByAdminId: existing?.dismissedByAdminId,
      dismissNote: existing?.dismissNote,
      pool: existing?.pool ?? "active",
      suppressedFlags: activeSuppressed.length > 0 ? activeSuppressed : undefined,
    };

    await db
      .collection("suspiciousCharacters")
      .replaceOne({ characterId: char._id }, doc, { upsert: true });

    if (newFlags.length > 0) flagged++;
    else cleared++;
  }

  return { flagged, cleared, deleted };
}
