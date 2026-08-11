/**
 * API abuse detection over the `apiAccessLog` rows produced by `logApiAccess`.
 *
 * This is the analysis layer on top of Phase-1 instrumentation. It only
 * REPORTS — it does not throttle or block. The intent is to surface scraping
 * patterns for a human to review, deliberately erring toward not flagging the
 * moderator who keeps refreshing election results.
 *
 * The detector is a pure function over plain rows so it is trivially testable;
 * `scanApiAbuse` is the thin DB wrapper that feeds it from Mongo.
 */
import type { Db } from "mongodb";

export interface AccessRow {
  path: string;
  method: string;
  ip: string;
  userId?: string | null;
  keyId?: string | null;
  timestamp: Date;
}

export type AbuseSignal =
  | { type: "high_volume"; requestCount: number; threshold: number }
  | {
      type: "fixed_interval_polling";
      samples: number;
      intervalMs: number;
      coefficientOfVariation: number;
    }
  | { type: "id_enumeration"; template: string; distinctIds: number; threshold: number };

export interface AbuseFinding {
  /** The actor the requests were attributed to. */
  actor: string;
  actorType: "user" | "key" | "ip";
  requestCount: number;
  windowMs: number;
  signals: AbuseSignal[];
}

export const ABUSE_THRESHOLDS = {
  /** Total requests by one actor in the window. */
  highVolume: 600,
  /** Minimum samples before we trust a polling-cadence verdict. */
  pollingMinSamples: 20,
  /** Inter-arrival coefficient of variation at/under which cadence looks scripted. */
  pollingMaxCv: 0.1,
  /** Distinct ids hit under one endpoint template before it reads as enumeration. */
  enumerationMinDistinctIds: 30,
  /** Default look-back window. */
  windowMs: 60 * 60 * 1000,
} as const;

/** Prefer the most specific identity available: account > key > IP. */
export function actorOf(row: AccessRow): { actor: string; actorType: AbuseFinding["actorType"] } {
  if (row.userId) return { actor: row.userId, actorType: "user" };
  if (row.keyId) return { actor: row.keyId, actorType: "key" };
  return { actor: row.ip || "unknown", actorType: "ip" };
}

function isIdSegment(seg: string): boolean {
  return /^[0-9a-f]{24}$/i.test(seg) || /^\d+$/.test(seg);
}

/** Collapse numeric / ObjectId path segments to `:id` so we can group by endpoint shape. */
export function templatizePath(path: string): string {
  return path
    .split("/")
    .map((seg) => (isIdSegment(seg) ? ":id" : seg))
    .join("/");
}

/** Fixed-interval polling: many requests spaced at a near-constant cadence. */
export function detectPolling(
  timestamps: number[],
  minSamples: number = ABUSE_THRESHOLDS.pollingMinSamples,
  maxCv: number = ABUSE_THRESHOLDS.pollingMaxCv
): Extract<AbuseSignal, { type: "fixed_interval_polling" }> | null {
  if (timestamps.length < minSamples) return null;
  const sorted = [...timestamps].sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) deltas.push(sorted[i] - sorted[i - 1]);

  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  if (mean <= 0) return null; // simultaneous bursts are caught by high_volume, not polling
  const variance = deltas.reduce((a, d) => a + (d - mean) ** 2, 0) / deltas.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv > maxCv) return null;

  return {
    type: "fixed_interval_polling",
    samples: timestamps.length,
    intervalMs: Math.round(mean),
    coefficientOfVariation: Number(cv.toFixed(3)),
  };
}

/** Sequential-id enumeration: many distinct ids hit under one endpoint template. */
export function detectEnumeration(
  rows: AccessRow[],
  minDistinct: number = ABUSE_THRESHOLDS.enumerationMinDistinctIds
): Extract<AbuseSignal, { type: "id_enumeration" }>[] {
  const byTemplate = new Map<string, Set<string>>();
  for (const row of rows) {
    const template = templatizePath(row.path);
    if (!template.includes(":id")) continue;
    let set = byTemplate.get(template);
    if (!set) {
      set = new Set();
      byTemplate.set(template, set);
    }
    set.add(row.path);
  }

  const signals: Extract<AbuseSignal, { type: "id_enumeration" }>[] = [];
  for (const [template, ids] of byTemplate) {
    if (ids.size >= minDistinct) {
      signals.push({
        type: "id_enumeration",
        template,
        distinctIds: ids.size,
        threshold: minDistinct,
      });
    }
  }
  return signals;
}

interface DetectOptions {
  windowMs?: number;
  highVolume?: number;
  pollingMinSamples?: number;
  pollingMaxCv?: number;
  enumerationMinDistinctIds?: number;
}

/** Run every signal against a single actor's rows. Returns null if nothing fires. */
export function analyzeActor(rows: AccessRow[], opts: DetectOptions = {}): AbuseFinding | null {
  if (rows.length === 0) return null;
  const { actor, actorType } = actorOf(rows[0]);
  const signals: AbuseSignal[] = [];

  const highVolume = opts.highVolume ?? ABUSE_THRESHOLDS.highVolume;
  if (rows.length >= highVolume) {
    signals.push({ type: "high_volume", requestCount: rows.length, threshold: highVolume });
  }

  const polling = detectPolling(
    rows.map((r) => r.timestamp.getTime()),
    opts.pollingMinSamples,
    opts.pollingMaxCv
  );
  if (polling) signals.push(polling);

  signals.push(...detectEnumeration(rows, opts.enumerationMinDistinctIds));

  if (signals.length === 0) return null;
  return {
    actor,
    actorType,
    requestCount: rows.length,
    windowMs: opts.windowMs ?? ABUSE_THRESHOLDS.windowMs,
    signals,
  };
}

/** Group rows by actor and analyze each. Pure — no DB. */
export function detectAbuse(rows: AccessRow[], opts: DetectOptions = {}): AbuseFinding[] {
  const byActor = new Map<string, AccessRow[]>();
  for (const row of rows) {
    const { actor, actorType } = actorOf(row);
    const key = `${actorType}:${actor}`;
    const group = byActor.get(key);
    if (group) group.push(row);
    else byActor.set(key, [row]);
  }

  const findings: AbuseFinding[] = [];
  for (const group of byActor.values()) {
    const finding = analyzeActor(group, opts);
    if (finding) findings.push(finding);
  }
  // Most active actors first.
  return findings.sort((a, b) => b.requestCount - a.requestCount);
}

/** DB wrapper: pull the recent access log and run the detector over it. */
export async function scanApiAbuse(
  db: Db,
  opts: DetectOptions = {}
): Promise<{ windowMs: number; scannedRows: number; findings: AbuseFinding[] }> {
  const windowMs = opts.windowMs ?? ABUSE_THRESHOLDS.windowMs;
  const since = new Date(Date.now() - windowMs);

  const docs = await db
    .collection("apiAccessLog")
    .find({ timestamp: { $gte: since } })
    .project({ path: 1, method: 1, ip: 1, userId: 1, keyId: 1, timestamp: 1 })
    .toArray();

  const rows: AccessRow[] = docs.map((d) => ({
    path: String(d.path ?? ""),
    method: String(d.method ?? ""),
    ip: String(d.ip ?? "unknown"),
    userId: d.userId ? String(d.userId) : null,
    keyId: d.keyId ? String(d.keyId) : null,
    timestamp: d.timestamp instanceof Date ? d.timestamp : new Date(d.timestamp),
  }));

  return { windowMs, scannedRows: rows.length, findings: detectAbuse(rows, { ...opts, windowMs }) };
}

export interface ApiAbuseScan {
  detectedAt: Date;
  windowMs: number;
  scannedRows: number;
  flaggedActors: number;
  findings: AbuseFinding[];
}

/** Run a scan and persist the result to `apiAbuseScans` (TTL-bounded). */
export async function persistApiAbuseScan(db: Db, opts: DetectOptions = {}): Promise<ApiAbuseScan> {
  const result = await scanApiAbuse(db, opts);
  const scan: ApiAbuseScan = {
    detectedAt: new Date(),
    windowMs: result.windowMs,
    scannedRows: result.scannedRows,
    flaggedActors: result.findings.length,
    findings: result.findings,
  };
  await db.collection("apiAbuseScans").insertOne(scan);
  return scan;
}

/** Most recent persisted scan, or null if none has run yet. */
export async function getLatestApiAbuseScan(db: Db): Promise<ApiAbuseScan | null> {
  const doc = await db
    .collection("apiAbuseScans")
    .find({})
    .sort({ detectedAt: -1 })
    .limit(1)
    .next();
  if (!doc) return null;
  return {
    detectedAt: doc.detectedAt instanceof Date ? doc.detectedAt : new Date(doc.detectedAt),
    windowMs: Number(doc.windowMs ?? 0),
    scannedRows: Number(doc.scannedRows ?? 0),
    flaggedActors: Number(doc.flaggedActors ?? 0),
    findings: Array.isArray(doc.findings) ? (doc.findings as AbuseFinding[]) : [],
  };
}
