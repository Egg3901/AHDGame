// Shared types + pure helpers for the per-account forensic DOSSIER cockpit
// (forensics v2 plan, Wave 2 "dossier UI"). Client-side mirror of the
// `GET /api/admin/players/[userId]/dossier` response
// (`src/lib/audit/dossier.ts` — Dates arrive as ISO strings, ObjectIds as
// hex strings over JSON) and the `GET /api/admin/players/money-graph`
// response (`src/lib/audit/moneyGraph.ts`).
//
// This module holds NO React — pure shapes, formatting, and the money-graph
// layout maths (hop assignment, flow ranking) so they stay unit-testable
// without mounting components. Sibling of `../alts/altTypes.ts` /
// `../../forensics/types.ts` and reuses their conventions (severity color
// scale, masked-display rules, tabular formatting).

import type { ActionAuditRecord } from "@/components/admin/forensics/types";
import { currencySymbol } from "@/components/admin/forensics/types";

export type DossierContext = "admin" | "moderator";

// ─── Dossier response (JSON shapes of src/lib/audit/dossier.ts) ────────────

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

export interface DossierIpDetails {
  checkedAt: string;
  ip: string;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  isp: string | null;
  org: string | null;
  as: string | null;
  isVpn: boolean;
  isProxy: boolean;
  isHosting: boolean;
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
  /** Admin-only — served as `null` to moderators. */
  deviceKey: string | null;
  /** Admin-only — served as `null` to moderators. */
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
  lastDevice: "mobile" | "tablet" | "desktop" | null;
  ipDetails: DossierIpDetails | null;
}

export type SuspiciousSeverity = "low" | "medium" | "high";

export interface DossierSuspiciousFlag {
  type: string;
  severity: SuspiciousSeverity;
  detail: string;
  detectedAt: string;
}

export interface DossierSuspiciousCharacter {
  characterId: string;
  characterName: string;
  countryId: string;
  flags: DossierSuspiciousFlag[];
  flagCount: number;
  highestSeverity: SuspiciousSeverity;
  lastUpdated: string;
  dismissed: boolean;
  pool: "active" | "resolved";
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
    suspiciousCharacters: DossierSuspiciousCharacter[];
    flaggedAuditRows: ActionAuditRecord[];
  };
}

// ─── Money-graph response (JSON shape of the money-graph route) ────────────

export interface MoneyGraphNode {
  id: string;
  name: string | null;
  banned: boolean;
}

export interface MoneyGraphEdge {
  from: string;
  to: string;
  totalAmount: number;
  txCount: number;
  currencyCode: string;
}

export interface MoneyGraphResponse {
  nodes: MoneyGraphNode[];
  edges: MoneyGraphEdge[];
  truncated: boolean;
  depth: number;
  turnMin: number;
  currentTurn: number;
}

// ─── Severity / risk scales (lockstep with altTypes.ts severity colors) ────

export const SEVERITY_HEX: Record<SuspiciousSeverity, string> = {
  high: "#f87171", // red-400 — danger, same reservation as altTypes
  medium: "#facc15", // yellow-400
  low: "#60a5fa", // blue-400
};

export const SEVERITY_BADGE: Record<SuspiciousSeverity, string> = {
  high: "border border-red-400/25 bg-red-500/10 text-red-400",
  medium: "border border-yellow-400/25 bg-yellow-500/10 text-yellow-400",
  low: "border border-blue-400/25 bg-blue-500/10 text-blue-400",
};

/** The header's one-number risk figure: the strongest alt-link or cluster
 * confidence attached to this account (0 when the account is clean). */
export function strongestAltConfidence(linked: DossierResponse["linkedAccounts"]): number {
  let max = 0;
  for (const link of linked.links) max = Math.max(max, link.confidence);
  for (const cluster of linked.clusters) max = Math.max(max, cluster.confidence);
  return max;
}

/** Total suspicious-flag count across this user's characters (active pool). */
export function activeFlagCount(flags: DossierResponse["flags"]): number {
  return flags.suspiciousCharacters
    .filter((c) => c.pool === "active" && !c.dismissed)
    .reduce((sum, c) => sum + c.flagCount, 0);
}

// ─── Formatting ────────────────────────────────────────────────────────────

/** Compact signed money, e.g. "+$1.2M", "-₦45.3K", "$730". */
export function formatCompactAmount(amount: number, currencyCode?: string, signed = false): string {
  const sign = amount < 0 ? "-" : signed && amount > 0 ? "+" : "";
  const abs = Math.abs(amount);
  const symbol = currencySymbol(currencyCode);
  let figure: string;
  if (abs >= 1e12) figure = `${trimTrailingZero(abs / 1e12)}T`;
  else if (abs >= 1e9) figure = `${trimTrailingZero(abs / 1e9)}B`;
  else if (abs >= 1e6) figure = `${trimTrailingZero(abs / 1e6)}M`;
  else if (abs >= 1e4) figure = `${trimTrailingZero(abs / 1e3)}K`;
  else figure = Math.round(abs).toLocaleString("en-US");
  return `${sign}${symbol}${figure}`;
}

function trimTrailingZero(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Compact "user·a1b2c3" fallback when a display name is absent/masked away. */
export function accountLabel(name: string | null | undefined, id: string): string {
  if (name && name.trim()) return name;
  return `acct·${id.slice(-6)}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Money-graph maths (layout inputs — kept pure for tests) ───────────────

/** Synthetic (non-account) node ids — `gov:US`, `sys:System` — mirror of the
 * `resolveEntity` key convention in `src/lib/audit/moneyGraph.ts`. */
export function isSyntheticNodeId(id: string): boolean {
  return id.startsWith("gov:") || id.startsWith("sys:");
}

/** BFS hop distance from the center set along edges in either direction.
 * Nodes unreachable from any center get `Infinity` (rendered on the outer
 * orbit). */
export function computeHops(edges: MoneyGraphEdge[], centerIds: Set<string>): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  const push = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const edge of edges) {
    push(edge.from, edge.to);
    push(edge.to, edge.from);
  }

  const hops = new Map<string, number>();
  const queue: string[] = [];
  for (const id of centerIds) {
    hops.set(id, 0);
    queue.push(id);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    const hop = hops.get(current)!;
    for (const next of adjacency.get(current) ?? []) {
      if (!hops.has(next)) {
        hops.set(next, hop + 1);
        queue.push(next);
      }
    }
  }
  return hops;
}

/** Total absolute flow touching each node — the ranking used to pick which
 * nodes stay when the graph is display-capped and which get labels. */
export function nodeFlowTotals(edges: MoneyGraphEdge[]): Map<string, number> {
  const totals = new Map<string, number>();
  const add = (id: string, amount: number) => {
    totals.set(id, (totals.get(id) ?? 0) + amount);
  };
  for (const edge of edges) {
    add(edge.from, edge.totalAmount);
    add(edge.to, edge.totalAmount);
  }
  return totals;
}

/**
 * Pick which nodes to actually render when the server graph is bigger than
 * the SVG can legibly hold: every center, then the highest-flow nodes up to
 * `maxNodes`. Edges between two kept nodes survive. Returns the kept
 * node-id set plus how many were hidden.
 */
export function capGraphForDisplay(
  nodes: MoneyGraphNode[],
  edges: MoneyGraphEdge[],
  centerIds: Set<string>,
  maxNodes: number
): { keep: Set<string>; hiddenCount: number; edges: MoneyGraphEdge[] } {
  if (nodes.length <= maxNodes) {
    return { keep: new Set(nodes.map((n) => n.id)), hiddenCount: 0, edges };
  }
  const flow = nodeFlowTotals(edges);
  const keep = new Set<string>();
  for (const id of centerIds) keep.add(id);
  const ranked = nodes
    .filter((n) => !keep.has(n.id))
    .sort((a, b) => (flow.get(b.id) ?? 0) - (flow.get(a.id) ?? 0));
  for (const node of ranked) {
    if (keep.size >= maxNodes) break;
    keep.add(node.id);
  }
  return {
    keep,
    hiddenCount: nodes.length - keep.size,
    edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

/** Stable key for one directed money edge. */
export function moneyEdgeKey(edge: MoneyGraphEdge): string {
  return `${edge.from}→${edge.to}·${edge.currencyCode}`;
}

// ─── Shared panel chrome (identical to ClusterDetail's) ────────────────────

export const PANEL_CLS = "rounded-xl border border-card-border bg-card p-4 shadow-card";
export const OVERLINE_CLS = "text-[11px] font-semibold uppercase tracking-[0.14em] text-muted";
