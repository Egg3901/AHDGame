import { ObjectId, type Db, type Filter } from "mongodb";
import { getActionAuditLogCollection } from "@/lib/db/collections/actionAuditLog";
import type {
  ActionAuditCategory,
  ActionAuditOutcome,
  ActionAuditRecord,
} from "@/lib/db/types/actionAuditLog";

/**
 * Shared query building/gating for the audit-spine read API
 * (`src/app/api/admin/audit/*`, forensics/alt-detection rework plan §3.1
 * "Read side" + §4.9 frozen contract). Mirrors the shape of
 * `src/lib/financialTxLog/queryLogs.ts`.
 *
 * Role gating (plan §4.6): moderators may query `actionAuditLog`, but the
 * server MUST strip `category:"admin"` rows and raw `meta`/`net` unless the
 * caller is an admin. Every read path (list, trace, single-record, export)
 * routes through `buildAuditLogFilter`/`auditProjectionFor` here so the rule
 * is enforced once, not re-implemented per route.
 */

export const MAX_AUDIT_LOG_LIMIT = 200;
export const DEFAULT_AUDIT_LOG_LIMIT = 50;
/** Hard cap on trace-timeline rows — a single trace should be a handful of
 * envelopes, but never trust that unconditionally (plan: "never return
 * unbounded results"). */
export const MAX_TRACE_ROWS = 1000;
/** Hard cap on the related-record lookups surfaced by `GET /audit/:id`. */
export const RELATED_ROWS_LIMIT = 10;
export const MAX_AUDIT_EXPORT_ROWS = 50_000;

const VALID_CATEGORIES = new Set<ActionAuditCategory>([
  "money",
  "market",
  "governance",
  "corp",
  "party",
  "election",
  "auth",
  "admin",
  "character",
  "system",
]);

const VALID_OUTCOMES = new Set<ActionAuditOutcome>(["ok", "rejected", "error"]);

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

export type AuditFilter = Filter<ActionAuditRecord> & Record<string, unknown>;

export type BuildAuditFilterResult =
  { ok: true; filter: AuditFilter; limit: number } | { ok: false; error: string };

/**
 * Build the Mongo filter for `GET /api/admin/audit` (and reused, minus
 * cursor/limit, by the export route) from the frozen query-param contract:
 * `actorUserId, actorCharacterId, subjectType, subjectId, action, category,
 * turnFrom, turnTo, tsFrom, tsTo, outcome, flag, flaggedOnly, limit, cursor`.
 *
 * `isAdmin=false` additionally forces `category != "admin"` regardless of
 * what the caller asked for — if a moderator explicitly filters on
 * `category=admin` the filter becomes self-contradictory and simply returns
 * zero rows, which is the correct "stripped" behavior without a special case.
 */
export function buildAuditLogFilter(
  searchParams: URLSearchParams,
  isAdmin: boolean
): BuildAuditFilterResult {
  const filter: AuditFilter = {};

  const actorUserId = searchParams.get("actorUserId");
  if (actorUserId) {
    if (!OBJECT_ID_RE.test(actorUserId)) return { ok: false, error: "Invalid actorUserId" };
    filter["actor.userId"] = new ObjectId(actorUserId);
  }

  const actorCharacterId = searchParams.get("actorCharacterId");
  if (actorCharacterId) {
    if (!OBJECT_ID_RE.test(actorCharacterId)) {
      return { ok: false, error: "Invalid actorCharacterId" };
    }
    filter["actor.characterId"] = new ObjectId(actorCharacterId);
  }

  const subjectType = searchParams.get("subjectType");
  if (subjectType?.trim()) {
    filter["subject.type"] = subjectType.trim();
  }

  const subjectId = searchParams.get("subjectId");
  if (subjectId?.trim()) {
    // `subject.id` is stored as either an ObjectId or a free-form string
    // (e.g. a synthetic key like "gov:US"), depending on the writer — match
    // either representation rather than guessing which one was used.
    filter["subject.id"] = OBJECT_ID_RE.test(subjectId)
      ? { $in: [new ObjectId(subjectId), subjectId] }
      : subjectId;
  }

  const action = searchParams.get("action");
  if (action?.trim()) {
    filter.action = action.trim();
  }

  const category = searchParams.get("category");
  if (category) {
    if (!VALID_CATEGORIES.has(category as ActionAuditCategory)) {
      return { ok: false, error: `Invalid category: ${category}` };
    }
    filter.category = category as ActionAuditCategory;
  }
  if (!isAdmin) {
    // Non-admins never see admin-category rows (plan §4.6 role matrix). A
    // specific non-"admin" category filter already excludes admin rows by
    // equality, so leave it as-is; only when no category was requested (or
    // "admin" itself was requested) do we need to add the guard. Requesting
    // category=admin as a non-admin makes the filter self-contradictory —
    // zero rows, never a 403 — which is the "stripped" behavior.
    if (!category) {
      filter.category = { $ne: "admin" };
    } else if (category === "admin") {
      filter.category = { $eq: "admin", $ne: "admin" };
    }
  }

  const turnFilter: Record<string, number> = {};
  const turnFrom = searchParams.get("turnFrom");
  if (turnFrom) {
    const v = parseInt(turnFrom, 10);
    if (!Number.isFinite(v)) return { ok: false, error: "Invalid turnFrom" };
    turnFilter.$gte = v;
  }
  const turnTo = searchParams.get("turnTo");
  if (turnTo) {
    const v = parseInt(turnTo, 10);
    if (!Number.isFinite(v)) return { ok: false, error: "Invalid turnTo" };
    turnFilter.$lte = v;
  }
  if (Object.keys(turnFilter).length > 0) filter.turn = turnFilter;

  const tsFilter: Record<string, Date> = {};
  const tsFrom = searchParams.get("tsFrom");
  if (tsFrom) {
    const d = new Date(tsFrom);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Invalid tsFrom" };
    tsFilter.$gte = d;
  }
  const tsTo = searchParams.get("tsTo");
  if (tsTo) {
    const d = new Date(tsTo);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Invalid tsTo" };
    tsFilter.$lte = d;
  }
  if (Object.keys(tsFilter).length > 0) filter.ts = tsFilter;

  const outcome = searchParams.get("outcome");
  if (outcome) {
    if (!VALID_OUTCOMES.has(outcome as ActionAuditOutcome)) {
      return { ok: false, error: `Invalid outcome: ${outcome}` };
    }
    filter.outcome = outcome as ActionAuditOutcome;
  }

  const flag = searchParams.get("flag");
  const flaggedOnly = searchParams.get("flaggedOnly");
  if (flag?.trim()) {
    filter.flags = flag.trim();
  } else if (flaggedOnly === "true") {
    filter.flags = { $exists: true, $not: { $size: 0 } };
  }

  const cursor = searchParams.get("cursor");
  if (cursor) {
    if (!OBJECT_ID_RE.test(cursor)) return { ok: false, error: "Invalid cursor" };
    filter._id = { $lt: new ObjectId(cursor) };
  }

  const limitParam = searchParams.get("limit");
  const limit = Math.min(
    MAX_AUDIT_LOG_LIMIT,
    Math.max(
      1,
      parseInt(limitParam ?? String(DEFAULT_AUDIT_LOG_LIMIT), 10) || DEFAULT_AUDIT_LOG_LIMIT
    )
  );

  return { ok: true, filter, limit };
}

/** Mongo projection that hides raw `net`/`meta` from non-admin callers
 * (plan §4.6/§4.9). `undefined` means "no projection" (admins see everything). */
export function auditProjectionFor(isAdmin: boolean): Record<string, 0> | undefined {
  return isAdmin ? undefined : { net: 0, meta: 0 };
}

/** Query filter that hides admin-category rows from non-admin callers, for
 * use on lookups that don't go through {@link buildAuditLogFilter} (single
 * record fetch, related-record lookups). */
export function categoryGuardFor(isAdmin: boolean): AuditFilter {
  return isAdmin ? {} : { category: { $ne: "admin" } };
}

export interface AuditLogPage {
  rows: ActionAuditRecord[];
  nextCursor: string | null;
  truncated: boolean;
}

/**
 * Paginated list query (`GET /api/admin/audit`). Sorts newest-first by
 * `_id` (ObjectId embeds insertion order) — same cursor convention as
 * `queryTxLog`. Always fetches one extra row to detect truncation without a
 * separate `countDocuments` round trip.
 */
export async function queryAuditLog(
  db: Db,
  filter: AuditFilter,
  limit: number,
  isAdmin: boolean
): Promise<AuditLogPage> {
  const collection = await getActionAuditLogCollection(db);
  const rows = await collection
    .find(filter, { projection: auditProjectionFor(isAdmin) })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .toArray();

  const truncated = rows.length > limit;
  if (truncated) rows.pop();

  const nextCursor = truncated ? rows[rows.length - 1]._id.toHexString() : null;

  return { rows, nextCursor, truncated };
}

/** Full trace timeline (`GET /api/admin/audit/trace/:traceId`), ordered by
 * `seq` ascending (the causal order envelopes were written in). */
export async function queryAuditTrace(
  db: Db,
  traceId: string,
  isAdmin: boolean
): Promise<ActionAuditRecord[]> {
  const collection = await getActionAuditLogCollection(db);
  return collection
    .find({ traceId, ...categoryGuardFor(isAdmin) }, { projection: auditProjectionFor(isAdmin) })
    .sort({ seq: 1, _id: 1 })
    .limit(MAX_TRACE_ROWS)
    .toArray();
}
