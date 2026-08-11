// Shared types + pure helpers for the Forensic / Audit-Log Explorer (UI-1).
//
// The record shape mirrors the `actionAuditLog` envelope defined in the
// implementation plan (§3.1) and the frozen API contracts (§4.9). Keeping the
// pure formatting/derivation helpers here (framework-free) makes them unit
// testable without mounting React.

import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";

export type AuditCategory =
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

export type AuditSource = "api" | "turn" | "cron" | "admin" | "system";
export type AuditOutcome = "ok" | "rejected" | "error";
export type ActorKind = "player" | "npp" | "system" | "admin";

export interface AuditActor {
  kind: ActorKind;
  userId?: string;
  characterId?: string;
  name?: string;
  role?: string;
}

export interface AuditParty {
  type: string;
  id?: string;
  name?: string;
}

export interface AuditDelta {
  field: string;
  before: unknown;
  after: unknown;
}

export interface AuditRefs {
  financialTxLogId?: string;
  actionLogId?: string;
  ledgerEntryId?: string;
  adminLogId?: string;
  modAuditLogId?: string;
  billId?: string;
  electionId?: string;
  corporationId?: string;
  partyId?: string;
}

export interface AuditNet {
  ipMasked?: string;
  ipHash?: string;
  fingerprint?: string;
  trackingId?: string;
  deviceKey?: string;
  uaClass?: string;
}

export interface ActionAuditRecord {
  _id: string;
  ts: string; // ISO timestamp
  turn: number;
  traceId: string;
  seq?: number;
  source: AuditSource;
  phase?: string;
  action: string;
  category: AuditCategory;
  actor: AuditActor;
  subject: AuditParty;
  counterparty?: AuditParty;
  delta?: AuditDelta[];
  amount?: number;
  currencyCode?: CurrencyCode;
  anchorAmount?: number;
  refs?: AuditRefs;
  net?: AuditNet;
  outcome: AuditOutcome;
  reason?: string;
  flags?: string[];
  meta?: Record<string, unknown>;
  /** Present when the server has already resolved the actor into an alt cluster. */
  clusterId?: string;
}

/** GET /api/admin/audit */
export interface AuditQueryResponse {
  rows: ActionAuditRecord[];
  nextCursor?: string | null;
  truncated: boolean;
}

/** GET /api/admin/audit/trace/:traceId */
export interface AuditTraceResponse {
  traceId: string;
  rows: ActionAuditRecord[];
}

/** GET /api/admin/audit/:id */
export interface AuditRecordResponse {
  record: ActionAuditRecord;
  related: {
    actorRecent?: ActionAuditRecord[];
    subjectHistory?: ActionAuditRecord[];
    counterpartyRecent?: ActionAuditRecord[];
    [k: string]: unknown;
  };
}

export interface AuditFilterState {
  actorUserId: string;
  actorCharacterId: string;
  /** Display label for the resolved actor (autocomplete). UI-only, not sent. */
  actorLabel: string;
  subjectType: string;
  subjectId: string;
  action: string;
  category: string;
  turnFrom: string;
  turnTo: string;
  tsFrom: string;
  tsTo: string;
  outcome: string;
  flag: string;
  flaggedOnly: boolean;
}

export const EMPTY_FILTERS: AuditFilterState = {
  actorUserId: "",
  actorCharacterId: "",
  actorLabel: "",
  subjectType: "",
  subjectId: "",
  action: "",
  category: "",
  turnFrom: "",
  turnTo: "",
  tsFrom: "",
  tsTo: "",
  outcome: "",
  flag: "",
  flaggedOnly: false,
};

// ---------------------------------------------------------------------------
// Display metadata
// ---------------------------------------------------------------------------

export interface CategoryMeta {
  label: string;
  /** badge (bg + text) */
  badge: string;
  /** solid dot color for the left rail */
  dot: string;
}

export const CATEGORY_META: Record<AuditCategory, CategoryMeta> = {
  money: { label: "Money", badge: "bg-amber-500/10 text-amber-400", dot: "bg-amber-500" },
  market: { label: "Market", badge: "bg-teal-500/10 text-teal-400", dot: "bg-teal-500" },
  governance: {
    label: "Governance",
    badge: "bg-violet-500/10 text-violet-400",
    dot: "bg-violet-500",
  },
  corp: { label: "Corp", badge: "bg-cyan-500/10 text-cyan-400", dot: "bg-cyan-500" },
  party: { label: "Party", badge: "bg-indigo-500/10 text-indigo-400", dot: "bg-indigo-500" },
  election: { label: "Election", badge: "bg-blue-500/10 text-blue-400", dot: "bg-blue-500" },
  auth: { label: "Auth", badge: "bg-green-500/10 text-green-400", dot: "bg-green-500" },
  admin: { label: "Admin", badge: "bg-rose-500/10 text-rose-400", dot: "bg-rose-500" },
  character: {
    label: "Character",
    badge: "bg-fuchsia-500/10 text-fuchsia-400",
    dot: "bg-fuchsia-500",
  },
  system: { label: "System", badge: "bg-gray-500/10 text-gray-400", dot: "bg-gray-500" },
};

export const CATEGORY_OPTIONS: { value: AuditCategory; label: string }[] = (
  Object.keys(CATEGORY_META) as AuditCategory[]
).map((c) => ({ value: c, label: CATEGORY_META[c].label }));

export const OUTCOME_META: Record<AuditOutcome, { label: string; badge: string }> = {
  ok: { label: "OK", badge: "bg-green-500/10 text-green-400" },
  rejected: { label: "Rejected", badge: "bg-amber-500/10 text-amber-400" },
  error: { label: "Error", badge: "bg-red-500/10 text-red-400" },
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category as AuditCategory] ?? CATEGORY_META.system;
}

// ---------------------------------------------------------------------------
// Pure formatting helpers (unit tested)
// ---------------------------------------------------------------------------

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** "wire.send" -> "Wire send" — a human label alongside the mono verb chip. */
export function humanizeAction(action: string): string {
  const parts = action.split(/[._]/).filter(Boolean);
  if (parts.length === 0) return action;
  const joined = parts.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

export function currencySymbol(code?: string): string {
  if (!code) return "₳";
  return CURRENCY_SYMBOLS[code as CurrencyCode] ?? code;
}

/** Signed money string, e.g. "-$1,250" / "+₳500". */
export function formatAmount(amount: number, currencyCode?: string, explicitSign = true): string {
  const symbol = currencySymbol(currencyCode);
  const sign = amount < 0 ? "-" : explicitSign ? "+" : "";
  return `${sign}${symbol}${Math.abs(amount).toLocaleString("en-US")}`;
}

export function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-US");
}

/** Compact relative time, e.g. "3m ago", "2h ago", "5d ago". */
export function formatRelative(ts: string, now: number = Date.now()): string {
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** Short human label for an actor/subject/counterparty node. */
export function describeParty(p: AuditParty | undefined): string {
  if (!p) return "—";
  if (p.name) return p.name;
  if (p.type && p.id) return `${p.type} ${shortId(p.id)}`;
  if (p.type) return p.type;
  return "—";
}

export function describeActor(actor: AuditActor | undefined): string {
  if (!actor) return "—";
  if (actor.name) return actor.name;
  if (actor.kind === "system") return "System";
  if (actor.kind === "npp") return "NPP";
  if (actor.kind === "admin") return "Admin";
  if (actor.characterId) return `Character ${shortId(actor.characterId)}`;
  if (actor.userId) return `User ${shortId(actor.userId)}`;
  return "Unknown actor";
}

/** Last 6 chars of an id, for compact display. */
export function shortId(id: string): string {
  if (!id) return "";
  return id.length <= 8 ? id : `…${id.slice(-6)}`;
}

/**
 * Render an arbitrary before/after value for the DeltaView without dumping raw
 * JSON at the moderator. Scalars pass through; objects/arrays collapse to a
 * compact one-line preview.
 */
export function formatDeltaValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? "" : "s"}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>);
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
  }
  return String(v);
}

/** Signed numeric diff between before/after when both are numbers. */
export function numericDelta(delta: AuditDelta): number | null {
  if (isFiniteNumber(delta.before) && isFiniteNumber(delta.after)) {
    return delta.after - delta.before;
  }
  return null;
}

/**
 * A compact, domain-aware one-line summary of a record — the thing a moderator
 * reads instead of raw JSON. Money/market rows lead with the signed amount,
 * governance/admin rows read as sentences.
 */
export function summarizeRecord(r: ActionAuditRecord): string {
  const actor = describeActor(r.actor);
  const subject = describeParty(r.subject);
  const verb = humanizeAction(r.action).toLowerCase();

  if ((r.category === "money" || r.category === "market") && isFiniteNumber(r.amount)) {
    const amt = formatAmount(r.amount, r.currencyCode);
    const cp = r.counterparty ? ` → ${describeParty(r.counterparty)}` : "";
    return `${actor} ${verb} ${amt}${cp}`;
  }
  if (r.category === "election" || r.category === "governance") {
    return `${actor} ${verb} · ${subject}`;
  }
  if (r.category === "auth") {
    return `${actor} — ${verb}`;
  }
  if (r.category === "admin") {
    return `${actor} ${verb} ${subject}`;
  }
  return `${actor} ${verb}${subject !== "—" ? ` · ${subject}` : ""}`;
}

/** Which linked domain-log pivots a record exposes, given its refs. */
export function refPivots(refs: AuditRefs | undefined): { key: keyof AuditRefs; label: string }[] {
  if (!refs) return [];
  const map: { key: keyof AuditRefs; label: string }[] = [
    { key: "financialTxLogId", label: "Financial tx" },
    { key: "ledgerEntryId", label: "Ledger entry" },
    { key: "actionLogId", label: "Action log" },
    { key: "adminLogId", label: "Admin log" },
    { key: "modAuditLogId", label: "Mod audit" },
    { key: "billId", label: "Bill" },
    { key: "electionId", label: "Election" },
    { key: "corporationId", label: "Corporation" },
    { key: "partyId", label: "Party" },
  ];
  return map.filter((m) => Boolean(refs[m.key]));
}
