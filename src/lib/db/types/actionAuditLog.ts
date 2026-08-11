import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * `actionAuditLog` — the unified action-audit spine (forensics/alt-detection
 * rework plan §3.1). A small, uniformly-indexed envelope written from a
 * handful of choke points (money emit, staff logs, auth routes, turn
 * phases) rather than every route handler. Heavy domain detail stays in the
 * existing purpose-built logs (`financialTxLog`, `actionLogs`, `adminLogs`,
 * `modAuditLog`) and is cross-referenced via `refs`; this collection exists
 * to give forensics/alt-detection one place to correlate "who did what to
 * whom, when, with what net-identity signal" across all of them.
 *
 * KEEP, do not replace, the fragmented logs above — they remain load-bearing
 * for the ledger, suspicious-activity detection, and retention. See
 * plan §2C/§6 "Duplication vs existing logs".
 */

/** Where the write originated. */
export type ActionAuditSource = "api" | "turn" | "cron" | "admin" | "system";

/** Coarse bucket used for role-gating reads (mods never see `admin` rows'
 * raw `meta`/`net`, see plan §4.9) and for the category+ts index. */
export type ActionAuditCategory =
  | "money"
  | "market"
  | "governance"
  | "corp"
  | "party"
  | "election"
  | "auth"
  | "admin"
  | "character"
  | "system";

export type ActionAuditOutcome = "ok" | "rejected" | "error";

export type ActionAuditActorKind = "player" | "npp" | "system" | "admin";

export interface ActionAuditActor {
  kind: ActionAuditActorKind;
  userId?: ObjectId;
  characterId?: ObjectId;
  name?: string;
  role?: string;
}

export interface ActionAuditSubject {
  type: string;
  id?: ObjectId | string;
  name?: string;
}

export interface ActionAuditCounterparty {
  type: string;
  id?: ObjectId | string;
  name?: string;
}

/** One field's before/after value. Keep `delta` small (<=~8 entries) — this
 * is a summary envelope, not a full document diff. */
export interface ActionAuditDelta {
  field: string;
  before: unknown;
  after: unknown;
}

/** Cross-references into the heavier domain-specific logs, when one exists
 * for this action (e.g. a money action also has a `financialTxLog` row). */
export interface ActionAuditRefs {
  financialTxLogId?: ObjectId;
  actionLogId?: ObjectId;
  ledgerEntryId?: ObjectId;
  adminLogId?: ObjectId;
  modAuditLogId?: ObjectId;
  billId?: ObjectId | string;
  electionId?: ObjectId | string;
  corporationId?: ObjectId | string;
  partyId?: ObjectId | string;
}

/**
 * Net-identity signal, populated for `source:"api"` rows only. Stored
 * hashed/masked (never raw PII) — this feeds the alt-detection wire/timing
 * signals without holding a second copy of raw identity data. See plan
 * §3.2 (`ip_exact_nonCF`, `device_fingerprint_*` signals) and the existing
 * `maskIp`/`fpx`/`emailH` masking convention used by the `alt_ring_audit`
 * MCP tool.
 */
export interface ActionAuditNet {
  ipMasked?: string;
  ipHash?: string;
  fingerprint?: string;
  trackingId?: string;
  deviceKey?: string;
  uaClass?: string;
}

export interface ActionAuditRecord {
  _id: ObjectId;
  ts: Date;
  turn: number;
  /** Correlation id — groups every envelope written for one request/turn-phase. */
  traceId: string;
  /** Order within the trace, when more than one envelope is written for it. */
  seq?: number;
  source: ActionAuditSource;
  /** Turn phase name OR API route path, depending on `source`. */
  phase?: string;
  /** Namespaced verb, e.g. "wire.send", "corp.dividends", "vote.cast",
   * "bond.buy", "party.donate", "auth.login", "admin.ban",
   * "nationalization.execute". */
  action: string;
  category: ActionAuditCategory;
  actor: ActionAuditActor;
  subject: ActionAuditSubject;
  counterparty?: ActionAuditCounterparty;
  delta?: ActionAuditDelta[];
  /** Money quick-fields — the full transaction detail lives in
   * `refs.financialTxLogId`, not duplicated here. */
  amount?: number;
  currencyCode?: CurrencyCode;
  anchorAmount?: number;
  refs?: ActionAuditRefs;
  net?: ActionAuditNet;
  outcome: ActionAuditOutcome;
  reason?: string;
  /** Anomaly tags stamped by `src/lib/audit/anomalyScan.ts` after the fact. */
  flags?: string[];
  meta?: Record<string, unknown>;
  /** TTL backstop; the retention pipeline (`ARCHIVE_DELETE`) archives to R2
   * before this fires. See plan §3.1 "Retention". */
  expiresAt: Date;
}

/** Input to the write helper (`recordAudit`/`recordAuditBulk`,
 * `src/lib/audit/recordAudit.ts`) — `_id` and `expiresAt` are computed at
 * insert time, mirroring `FinancialTxLogEntry`'s `TxInput` shape in
 * `financialTxLog/emit.ts`. `ts`, `turn`, `traceId`, `seq`, and `actor` are
 * OPTIONAL here: when omitted, `recordAudit` fills them from the request/
 * turn-phase observability context (`src/lib/observability/context.ts`) so
 * most call sites don't have to thread them through by hand. Pass them
 * explicitly to override the ambient context (e.g. a turn phase attributing
 * a row to a specific character rather than the phase's `system` actor). */
export type ActionAuditInput = Omit<
  ActionAuditRecord,
  "_id" | "expiresAt" | "ts" | "turn" | "traceId" | "seq" | "actor"
> &
  Partial<Pick<ActionAuditRecord, "ts" | "turn" | "traceId" | "seq" | "actor">>;
