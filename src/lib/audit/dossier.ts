import { ObjectId, type Db } from "mongodb";
import { maskEmail, maskFingerprint, maskIp } from "@/lib/altDetection/signals";
import { redactEvidenceForRole, memberRole } from "@/lib/altDetection/evidenceRedaction";
import { auditProjectionFor, categoryGuardFor } from "@/lib/audit/queryAuditLog";
import { getActionAuditLogCollection } from "@/lib/db/collections/actionAuditLog";
import { getAltClustersCollection, getAltLinksCollection } from "@/lib/db/collections";
import { getSuspiciousCharactersCollection } from "@/lib/db/collections/suspiciousCharacters";
import type { User } from "@/lib/db/types/user";
import type { ActivityLog, ActivityLogAuth, SuspiciousCharacter } from "@/lib/db/types/activityLog";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";
import type { AltCluster, AltLink } from "@/lib/db/types/altDetection";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

export const DOSSIER_MAX_SESSIONS = 25;
export const DOSSIER_MAX_FINANCIAL_ROWS = 50;
export const DOSSIER_MAX_ACTIONS = 50;
export const DOSSIER_MAX_LINKS = 50;
export const DOSSIER_MAX_CLUSTERS = 20;
export const DOSSIER_MAX_DEVICE_IP_ROWS = 50;
export const DOSSIER_MAX_FLAGGED_ACTIONS = 25;

export interface DossierDeviceIpRow {
  ip: string | null;
  fingerprint: string | null;
  trackingId: string | null;
  source: string;
  lastSeen: string;
}

export interface DossierSessionRow {
  id: string;
  type: "login" | "logout";
  timestamp: string;
  ipAddress: string | null;
  fingerprint: string | null;
  trackingId: string | null;
  userAgent?: string;
}

export interface DossierMoneyTotals {
  creditsIn: number;
  debitsOut: number;
  net: number;
}

export interface DossierFinancialRow {
  id: string;
  type: string;
  turn: number;
  createdAt: string;
  subjectType: string;
  subjectId?: string;
  subjectName: string;
  amount: number;
  currencyCode: string;
  anchorAmount?: number;
  counterpartyName?: string;
  flagged: boolean;
}

export interface DossierAltLinkRow {
  otherUserId: string;
  otherUsername: string | null;
  confidence: number;
  signalCount: number;
  topSignal: string | null;
}

export interface DossierClusterRow {
  id: string;
  confidence: number;
  size: number;
  status: string;
  role: "operator" | "burner" | "associate";
  topEvidence: string[];
}

export interface DossierIdentity {
  userId: string;
  username: string;
  email: string | null;
  displayName: string;
  role: string;
  oauth: {
    discordId: string | null;
    discordUsername: string | null;
    googleId: string | null;
    googleEmail: string | null;
    googleName: string | null;
    patreonUserId: string | null;
  };
  registrationIp: string | null;
  lastKnownIp: string | null;
  registrationFingerprint: string | null;
  lastFingerprint: string | null;
  fingerprintHistory: string[];
  deviceKey: string | null;
  trackingId: string | null;
  referredBy: string | null;
  referralCount: number;
  ban: {
    isBanned: boolean;
    banReason: string | null;
    bannedAt: string | null;
  };
  createdAt: string;
  lastLogin: string | null;
  lastLogout: string | null;
  lastActivity: string | null;
  lastDevice: User["lastDevice"] | null;
  ipDetails: User["ipDetails"] | null;
}

export interface DossierResponse {
  userId: string;
  identity: DossierIdentity;
  devicesAndIps: DossierDeviceIpRow[];
  sessions: DossierSessionRow[];
  money: {
    totals: DossierMoneyTotals;
    recent: DossierFinancialRow[];
  };
  linkedAccounts: {
    links: DossierAltLinkRow[];
    clusters: DossierClusterRow[];
  };
  recentActions: ActionAuditRecord[];
  flags: {
    suspiciousCharacters: SuspiciousCharacter[];
    flaggedAuditRows: ActionAuditRecord[];
  };
}

function maskOptional(
  value: string | undefined | null,
  masker: (v: string) => string,
  isAdmin: boolean
): string | null {
  if (!value) return null;
  return isAdmin ? value : masker(value);
}

function iso(d: Date | undefined | null): string | null {
  if (!d) return null;
  return d.toISOString();
}

export function buildDossierIdentity(user: User, isAdmin: boolean): DossierIdentity {
  return {
    userId: user._id.toString(),
    username: user.username,
    email: maskOptional(user.email, maskEmail, isAdmin),
    displayName: user.displayName,
    role: user.role,
    oauth: {
      discordId: user.discordId ?? null,
      discordUsername: user.discordUsername ?? null,
      googleId: user.googleId ?? null,
      googleEmail: maskOptional(user.googleEmail, maskEmail, isAdmin),
      googleName: user.googleName ?? null,
      patreonUserId: user.patreonUserId ?? null,
    },
    registrationIp: maskOptional(user.registrationIp, maskIp, isAdmin),
    lastKnownIp: maskOptional(user.lastKnownIp, maskIp, isAdmin),
    registrationFingerprint: maskOptional(user.registrationFingerprint, maskFingerprint, isAdmin),
    lastFingerprint: maskOptional(user.lastFingerprint, maskFingerprint, isAdmin),
    fingerprintHistory: (user.fingerprintHistory ?? []).map((fp) =>
      isAdmin ? fp : maskFingerprint(fp)
    ),
    deviceKey: isAdmin ? (user.deviceKey ?? null) : null,
    trackingId: isAdmin ? (user.trackingId ?? null) : null,
    referredBy: user.referredBy?.toString() ?? null,
    referralCount: user.referralCount ?? 0,
    ban: {
      isBanned: user.isBanned ?? false,
      banReason: user.banReason ?? null,
      bannedAt: iso(user.bannedAt),
    },
    createdAt: user.createdAt.toISOString(),
    lastLogin: iso(user.lastLogin),
    lastLogout: iso(user.lastLogout),
    lastActivity: iso(user.lastActivity),
    lastDevice: user.lastDevice ?? null,
    ipDetails: user.ipDetails ?? null,
  };
}

function pushDeviceRow(
  rows: DossierDeviceIpRow[],
  seen: Set<string>,
  row: Omit<DossierDeviceIpRow, "ip" | "fingerprint" | "trackingId"> & {
    ip?: string | null;
    fingerprint?: string | null;
    trackingId?: string | null;
  },
  isAdmin: boolean
): void {
  const ip = row.ip ? (isAdmin ? row.ip : maskIp(row.ip)) : null;
  const fingerprint = row.fingerprint
    ? isAdmin
      ? row.fingerprint
      : maskFingerprint(row.fingerprint)
    : null;
  const trackingId = isAdmin ? (row.trackingId ?? null) : null;
  const key = `${ip ?? ""}|${fingerprint ?? ""}|${trackingId ?? ""}|${row.source}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ ip, fingerprint, trackingId, source: row.source, lastSeen: row.lastSeen });
}

export function buildDevicesAndIps(
  user: User,
  activityRows: ActivityLog[],
  isAdmin: boolean
): DossierDeviceIpRow[] {
  const rows: DossierDeviceIpRow[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  if (user.registrationIp) {
    pushDeviceRow(
      rows,
      seen,
      {
        ip: user.registrationIp,
        source: "user.registrationIp",
        lastSeen: iso(user.createdAt) ?? now,
      },
      isAdmin
    );
  }
  if (user.lastKnownIp) {
    pushDeviceRow(
      rows,
      seen,
      {
        ip: user.lastKnownIp,
        fingerprint: user.lastFingerprint ?? undefined,
        trackingId: user.trackingId,
        source: "user.lastKnownIp",
        lastSeen: iso(user.lastLogin ?? user.lastActivity) ?? now,
      },
      isAdmin
    );
  }
  if (user.registrationFingerprint) {
    pushDeviceRow(
      rows,
      seen,
      {
        fingerprint: user.registrationFingerprint,
        source: "user.registrationFingerprint",
        lastSeen: iso(user.createdAt) ?? now,
      },
      isAdmin
    );
  }
  if (user.deviceKey) {
    pushDeviceRow(
      rows,
      seen,
      {
        trackingId: user.deviceKey,
        source: "user.deviceKey",
        lastSeen: iso(user.lastLogin ?? user.lastActivity) ?? now,
      },
      isAdmin
    );
  }

  for (const entry of activityRows) {
    if (entry.type !== "login" && entry.type !== "logout") continue;
    const auth = entry as ActivityLogAuth;
    if (!auth.ipAddress && !auth.fingerprint && !auth.trackingId) continue;
    pushDeviceRow(
      rows,
      seen,
      {
        ip: auth.ipAddress,
        fingerprint: auth.fingerprint,
        trackingId: auth.trackingId,
        source: `activityLog.${auth.type}`,
        lastSeen: auth.timestamp.toISOString(),
      },
      isAdmin
    );
    if (rows.length >= DOSSIER_MAX_DEVICE_IP_ROWS) break;
  }

  return rows.slice(0, DOSSIER_MAX_DEVICE_IP_ROWS);
}

export function serializeFinancialRow(row: FinancialTxLogEntry): DossierFinancialRow {
  return {
    id: row._id.toString(),
    type: row.type,
    turn: row.turn,
    createdAt: row.createdAt.toISOString(),
    subjectType: row.subjectType,
    subjectId: row.subjectId?.toString(),
    subjectName: row.subjectName,
    amount: row.amount,
    currencyCode: row.currencyCode,
    anchorAmount: row.anchorAmount,
    counterpartyName: row.counterpartyName,
    flagged: row.flagged,
  };
}

export function serializeSessionRow(row: ActivityLogAuth): DossierSessionRow {
  return {
    id: row._id.toString(),
    type: row.type,
    timestamp: row.timestamp.toISOString(),
    ipAddress: row.ipAddress ?? null,
    fingerprint: row.fingerprint ?? null,
    trackingId: row.trackingId ?? null,
    userAgent: row.userAgent,
  };
}

export function maskSessionRow(row: DossierSessionRow, isAdmin: boolean): DossierSessionRow {
  if (isAdmin) return row;
  return {
    ...row,
    ipAddress: row.ipAddress ? maskIp(row.ipAddress) : null,
    fingerprint: row.fingerprint ? maskFingerprint(row.fingerprint) : null,
    trackingId: null,
  };
}

async function loadCharacterSubjectIds(db: Db, userId: ObjectId): Promise<ObjectId[]> {
  const [characters, imperial] = await Promise.all([
    db.collection("characters").find({ userId }).project({ _id: 1 }).toArray(),
    db.collection("imperialCharacters").find({ userId }).project({ _id: 1 }).toArray(),
  ]);
  return [...characters, ...imperial].map((doc) => doc._id as ObjectId);
}

export async function queryDossier(
  db: Db,
  userId: ObjectId,
  isAdmin: boolean
): Promise<DossierResponse | null> {
  const user = await db.collection<User>("users").findOne({ _id: userId });
  if (!user) return null;

  const categoryGuard = categoryGuardFor(isAdmin);
  const projection = auditProjectionFor(isAdmin);
  const userIdStr = userId.toString();

  const subjectIds = await loadCharacterSubjectIds(db, userId);

  const [
    activityAuthRows,
    altLinks,
    altClusters,
    suspiciousCharacters,
    financialRecent,
    moneyTotalsAgg,
    recentActions,
    flaggedAuditRows,
  ] = await Promise.all([
    db
      .collection<ActivityLog>("activityLog")
      .find({
        userId,
        type: { $in: ["login", "logout"] },
      })
      .sort({ timestamp: -1 })
      .limit(DOSSIER_MAX_DEVICE_IP_ROWS)
      .toArray(),
    (async () => {
      const col = await getAltLinksCollection(db);
      return col
        .find({ $or: [{ userA: userId }, { userB: userId }] })
        .sort({ confidence: -1 })
        .limit(DOSSIER_MAX_LINKS)
        .toArray();
    })(),
    (async () => {
      const col = await getAltClustersCollection(db);
      return col
        .find({ memberUserIds: userId })
        .sort({ confidence: -1 })
        .limit(DOSSIER_MAX_CLUSTERS)
        .toArray();
    })(),
    (async () => {
      const col = await getSuspiciousCharactersCollection(db);
      return col.find({ userId }).sort({ lastUpdated: -1 }).limit(50).toArray();
    })(),
    subjectIds.length
      ? db
          .collection<FinancialTxLogEntry>("financialTxLog")
          .find({ subjectType: "character", subjectId: { $in: subjectIds } })
          .sort({ _id: -1 })
          .limit(DOSSIER_MAX_FINANCIAL_ROWS)
          .toArray()
      : Promise.resolve([] as FinancialTxLogEntry[]),
    subjectIds.length
      ? db
          .collection<FinancialTxLogEntry>("financialTxLog")
          .aggregate<{ creditsIn: number; debitsOut: number }>([
            { $match: { subjectType: "character", subjectId: { $in: subjectIds } } },
            {
              $group: {
                _id: null,
                creditsIn: {
                  $sum: {
                    $cond: [
                      { $gt: [{ $ifNull: ["$anchorAmount", "$amount"] }, 0] },
                      { $ifNull: ["$anchorAmount", "$amount"] },
                      0,
                    ],
                  },
                },
                debitsOut: {
                  $sum: {
                    $cond: [
                      { $lt: [{ $ifNull: ["$anchorAmount", "$amount"] }, 0] },
                      { $abs: { $ifNull: ["$anchorAmount", "$amount"] } },
                      0,
                    ],
                  },
                },
              },
            },
          ])
          .toArray()
      : Promise.resolve([]),
    (async () => {
      const col = await getActionAuditLogCollection(db);
      return col
        .find({ "actor.userId": userId, ...categoryGuard }, { projection })
        .sort({ _id: -1 })
        .limit(DOSSIER_MAX_ACTIONS)
        .toArray();
    })(),
    (async () => {
      const col = await getActionAuditLogCollection(db);
      return col
        .find(
          {
            "actor.userId": userId,
            flags: { $exists: true, $not: { $size: 0 } },
            ...categoryGuard,
          },
          { projection }
        )
        .sort({ _id: -1 })
        .limit(DOSSIER_MAX_FLAGGED_ACTIONS)
        .toArray();
    })(),
  ]);

  const otherUserIds = new Set<string>();
  for (const link of altLinks) {
    const other = link.userA.toString() === userIdStr ? link.userB : link.userA;
    otherUserIds.add(other.toString());
  }

  const linkedUsers = otherUserIds.size
    ? await db
        .collection<User>("users")
        .find({ _id: { $in: [...otherUserIds].map((id) => new ObjectId(id)) } })
        .project({ username: 1 })
        .toArray()
    : [];
  const usernameById = new Map(linkedUsers.map((u) => [u._id.toString(), u.username]));

  const links: DossierAltLinkRow[] = altLinks.map((link: AltLink) => {
    const other = link.userA.toString() === userIdStr ? link.userB : link.userA;
    const otherStr = other.toString();
    const top = [...link.signals].sort((a, b) => b.contribution - a.contribution)[0];
    return {
      otherUserId: otherStr,
      otherUsername: usernameById.get(otherStr) ?? null,
      confidence: link.confidence,
      signalCount: link.signals.length,
      topSignal: top?.type ?? null,
    };
  });

  const clusters: DossierClusterRow[] = altClusters.map((cluster: AltCluster) => ({
    id: cluster._id.toString(),
    confidence: cluster.confidence,
    size: cluster.size,
    status: cluster.status,
    role: memberRole(userIdStr, cluster.roles),
    topEvidence: cluster.topEvidence.map((evidence) => redactEvidenceForRole(evidence, isAdmin)),
  }));

  const totalsDoc = moneyTotalsAgg[0];
  const creditsIn = totalsDoc?.creditsIn ?? 0;
  const debitsOut = totalsDoc?.debitsOut ?? 0;

  const sessions = activityAuthRows
    .filter((row): row is ActivityLogAuth => row.type === "login" || row.type === "logout")
    .slice(0, DOSSIER_MAX_SESSIONS)
    .map((row) => maskSessionRow(serializeSessionRow(row), isAdmin));

  return {
    userId: userIdStr,
    identity: buildDossierIdentity(user, isAdmin),
    devicesAndIps: buildDevicesAndIps(user, activityAuthRows, isAdmin),
    sessions,
    money: {
      totals: {
        creditsIn,
        debitsOut,
        net: creditsIn - debitsOut,
      },
      recent: financialRecent.map(serializeFinancialRow),
    },
    linkedAccounts: { links, clusters },
    recentActions,
    flags: {
      suspiciousCharacters,
      flaggedAuditRows,
    },
  };
}
