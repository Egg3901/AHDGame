"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ActivityLogTab } from "./ActivityLogTab";
import {
  buildMatchGroups,
  NETWORK_ONLY_FLAG_TYPES,
  type SuspiciousEntry,
  type SuspiciousFlag,
  type MatchGroup,
} from "@/lib/admin/suspiciousGroups";
import { LocalTime } from "@/components/time/LocalTime";

interface Counts {
  high: number;
  medium: number;
  low: number;
  deleted: number;
  resolved: number;
  automation: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-blue-400",
};

const SEVERITY_BG: Record<string, string> = {
  high: "bg-red-500/10 border-red-500/20",
  medium: "bg-amber-500/10 border-amber-500/20",
  low: "bg-blue-500/10 border-blue-500/20",
};

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-blue-500",
};

interface DismissModalProps {
  entry: SuspiciousEntry;
  onClose: () => void;
  onDismissed: (id: string) => void;
  apiBase: string;
  isMod?: boolean;
}

interface BanModalProps {
  entry: SuspiciousEntry;
  onClose: () => void;
  onBanned: (id: string) => void;
  apiBase: string;
}

function BanModal({ entry, onClose, onBanned, apiBase }: BanModalProps) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/users/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: entry.userId,
          ban: true,
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to ban user");
      }
      onBanned(entry._id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to ban user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-card-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold text-red-400">Ban User</h3>
        <p className="mb-4 text-sm text-muted">
          Permanently ban <strong>{entry.characterName}</strong> ({entry.username})?
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for ban (optional)…"
          rows={3}
          className="w-full rounded border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="min-h-[40px] rounded border border-card-border px-4 py-2 text-sm hover:bg-card/80"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="min-h-[40px] rounded bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Banning…" : "Confirm Ban"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DismissModal({ entry, onClose, onDismissed, apiBase, isMod = false }: DismissModalProps) {
  const [note, setNote] = useState("");
  const [permanent, setPermanent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/suspicious/${entry.characterId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined, permanent }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to dismiss");
      }
      onDismissed(entry._id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to dismiss");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-card-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">Dismiss flags</h3>
        <p className="mb-4 text-sm text-muted">
          {permanent
            ? `Permanently resolve all flags for ${entry.characterName}${!isMod ? ` (${entry.username})` : ""}. This is irreversible — the character will never be re-flagged automatically.`
            : `Suppress all flags for ${entry.characterName}${!isMod ? ` (${entry.username})` : ""} for 30 days.`}
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Investigation note (optional)…"
          rows={3}
          className="w-full rounded border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
        <label className="mt-3 flex items-center gap-2 text-sm text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
            className="rounded"
          />
          Permanent — resolved, never re-flagged
        </label>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="min-h-[40px] rounded border border-card-border px-4 py-2 text-sm hover:bg-card/80"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="min-h-[40px] rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? "Working…" : permanent ? "Resolve Permanently" : "Dismiss (30 days)"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SuspiciousActivityTabProps {
  context?: "admin" | "moderator";
}

export function SuspiciousActivityTab({ context = "admin" }: SuspiciousActivityTabProps) {
  const apiBase = context === "moderator" ? "/api/moderator" : "/api/admin";
  const isModeratorContext = context === "moderator";
  const [entries, setEntries] = useState<SuspiciousEntry[]>([]);
  const [counts, setCounts] = useState<Counts>({
    high: 0,
    medium: 0,
    low: 0,
    deleted: 0,
    resolved: 0,
    automation: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // Fetch-driving filters live in one object so fetchEntries deps stay in
  // lockstep; display-only toggles (showNetworkOnly) stay separate.
  const [filters, setFilters] = useState({
    severity: "",
    showDismissed: false,
    showDeleted: false,
    showResolved: false,
    automationOnly: false,
  });
  const {
    severity: severityFilter,
    showDismissed,
    showDeleted,
    showResolved,
    automationOnly,
  } = filters;
  const [dismissTarget, setDismissTarget] = useState<SuspiciousEntry | null>(null);
  const [banTarget, setBanTarget] = useState<SuspiciousEntry | null>(null);
  const [drillCharacterId, setDrillCharacterId] = useState<string | null>(null);
  const [showNetworkOnly, setShowNetworkOnly] = useState(false);

  const fetchEntries = useCallback(
    async (cursorParam: string | null, append: boolean) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (severityFilter) params.set("severity", severityFilter);
        if (showDismissed) params.set("dismissed", "true");
        if (showDeleted) params.set("deleted", "true");
        if (showResolved) params.set("showResolved", "true");
        if (automationOnly) params.set("flagType", "automation_timing");
        if (cursorParam) params.set("cursor", cursorParam);
        params.set("limit", "25");

        const res = await fetch(`${apiBase}/suspicious?${params}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data = await res.json();

        setEntries((prev) => (append ? [...prev, ...data.entries] : data.entries));
        setCounts(data.counts);
        setCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [severityFilter, showDismissed, showDeleted, showResolved, automationOnly, apiBase]
  );

  useEffect(() => {
    fetchEntries(null, false);
  }, [fetchEntries]);

  const handleDismissed = (id: string) => {
    setEntries((prev) => prev.filter((e) => e._id !== id));
    setCounts((c) => ({ ...c })); // trigger refresh on next fetch
  };

  const handleBanned = (id: string) => {
    setEntries((prev) => prev.map((e) => (e._id === id ? { ...e, dismissed: true } : e)));
  };

  const allGroups = useMemo(() => buildMatchGroups(entries), [entries]);
  const primaryGroups = useMemo(() => allGroups.filter((g) => !g.isNetworkOnly), [allGroups]);
  const networkOnlyGroups = useMemo(() => allGroups.filter((g) => g.isNetworkOnly), [allGroups]);
  const networkOnlyAccountCount = useMemo(
    () => networkOnlyGroups.reduce((sum, g) => sum + g.members.length, 0),
    [networkOnlyGroups]
  );

  if (drillCharacterId) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setDrillCharacterId(null)}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Suspicious Activity
        </button>
        <ActivityLogTab initialCharacterId={drillCharacterId} context={context} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {dismissTarget && (
        <DismissModal
          entry={dismissTarget}
          onClose={() => setDismissTarget(null)}
          onDismissed={handleDismissed}
          apiBase={apiBase}
          isMod={isModeratorContext}
        />
      )}

      {banTarget && (
        <BanModal
          entry={banTarget}
          onClose={() => setBanTarget(null)}
          onBanned={handleBanned}
          apiBase={apiBase}
        />
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold sm:text-lg">Suspicious Activity</h2>
        <button
          onClick={() => fetchEntries(null, false)}
          disabled={loading}
          className="min-h-[40px] rounded border border-card-border px-3 py-2 text-sm hover:bg-card/80 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {/* Severity counts header */}
      <div className="flex flex-wrap gap-2">
        {(["high", "medium", "low"] as const).map((sev) => (
          <button
            key={sev}
            onClick={() => setFilters((f) => ({ ...f, severity: f.severity === sev ? "" : sev }))}
            className={`min-h-[40px] rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              severityFilter === sev
                ? `${SEVERITY_BG[sev]} ${SEVERITY_COLORS[sev]}`
                : "border-card-border text-muted hover:text-foreground"
            }`}
          >
            <span className="capitalize">{sev}</span>{" "}
            <span className="font-bold">({counts[sev]})</span>
          </button>
        ))}
        <button
          onClick={() => setFilters((f) => ({ ...f, automationOnly: !f.automationOnly }))}
          className={`min-h-[40px] rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            automationOnly
              ? "border-red-500/40 bg-red-500/15 text-red-400"
              : "border-card-border text-muted hover:text-foreground"
          }`}
        >
          Automation <span className="font-bold">({counts.automation})</span>
        </button>
        <button
          onClick={() => setFilters((f) => ({ ...f, showDeleted: !f.showDeleted }))}
          className={`min-h-[40px] rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            showDeleted
              ? "border-gray-400/40 bg-gray-500/15 text-gray-300"
              : "border-card-border text-muted hover:text-foreground"
          }`}
        >
          Deleted Accounts <span className="font-bold">({counts.deleted})</span>
        </button>
        <button
          onClick={() => setFilters((f) => ({ ...f, showResolved: !f.showResolved }))}
          className={`min-h-[40px] rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            showResolved
              ? "border-green-500/40 bg-green-500/15 text-green-400"
              : "border-card-border text-muted hover:text-foreground"
          }`}
        >
          Resolved <span className="font-bold">({counts.resolved})</span>
        </button>
        <label className="flex items-center gap-2 min-h-[40px] px-3 text-sm text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setFilters((f) => ({ ...f, showDismissed: e.target.checked }))}
            className="rounded"
          />
          Show dismissed
        </label>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Entry list */}
      <div className="space-y-3">
        {!loading && entries.length === 0 && (
          <div className="rounded-xl border border-card-border bg-card px-4 py-8 text-center text-sm text-muted">
            {showResolved
              ? "No permanently resolved characters."
              : "No suspicious characters detected."}
          </div>
        )}

        {primaryGroups.map((group) => (
          <MatchGroupCard
            key={group.key}
            group={group}
            isModeratorContext={isModeratorContext}
            onDrill={(characterId) => setDrillCharacterId(characterId)}
            onDismiss={(entry) => setDismissTarget(entry)}
            onBan={(entry) => setBanTarget(entry)}
          />
        ))}

        {networkOnlyGroups.length > 0 && (
          <div className="rounded-xl border border-card-border bg-card/50">
            <button
              onClick={() => setShowNetworkOnly((p) => !p)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm"
            >
              <svg
                className={`h-3.5 w-3.5 flex-shrink-0 text-muted transition-transform ${showNetworkOnly ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <span className="font-medium text-muted">
                {networkOnlyAccountCount} account{networkOnlyAccountCount === 1 ? "" : "s"} in{" "}
                {networkOnlyGroups.length} IP-only match{networkOnlyGroups.length === 1 ? "" : "es"}
              </span>
              <span className="text-xs text-muted">
                — shared IP with no device or session match; commonly CGNAT, VPNs, or shared
                networks
              </span>
            </button>
            {showNetworkOnly && (
              <div className="space-y-3 px-4 pb-4">
                {networkOnlyGroups.map((group) => (
                  <MatchGroupCard
                    key={group.key}
                    group={group}
                    isModeratorContext={isModeratorContext}
                    onDrill={(characterId) => setDrillCharacterId(characterId)}
                    onDismiss={(entry) => setDismissTarget(entry)}
                    onBan={(entry) => setBanTarget(entry)}
                    muted
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {hasMore && !loading && (
        <button
          onClick={() => fetchEntries(cursor, true)}
          className="min-h-[40px] w-full rounded border border-card-border py-2 text-sm hover:bg-card/80"
        >
          Load more
        </button>
      )}
    </div>
  );
}

function FlagList({ flags, muted }: { flags: SuspiciousFlag[]; muted: boolean }) {
  return (
    <div className="space-y-1">
      {flags.map((flag, i) => {
        const events =
          flag.type === "automation_timing" && Array.isArray(flag.evidence?.events)
            ? (flag.evidence!.events as Array<{
                actionType: string;
                time: string;
                offsetSec?: number;
              }>)
            : null;
        // De-emphasize IP-only evidence when it's riding alongside a stronger
        // signal, so the eye lands on the corroborating (device/session)
        // evidence first.
        const isWeakFlag = NETWORK_ONLY_FLAG_TYPES.has(flag.type);
        return (
          <div key={i} className={`space-y-1 text-sm ${isWeakFlag && !muted ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-2">
              <span className="text-muted">▸</span>
              <span>
                <span className="font-mono text-xs font-medium">{flag.type}</span>
                {" — "}
                <span className="text-muted">{flag.detail}</span>
              </span>
            </div>
            {events && events.length > 0 && (
              <details className="ml-5">
                <summary className="cursor-pointer text-xs text-muted hover:text-foreground">
                  {events.length} flagging actions
                </summary>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted">
                  {events.map((ev, j) => (
                    <li key={j}>
                      <LocalTime value={ev.time} /> · {ev.actionType}
                      {ev.offsetSec != null ? ` · +${ev.offsetSec}s` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface SuspiciousEntryCardProps {
  entry: SuspiciousEntry;
  isModeratorContext: boolean;
  onDrill: () => void;
  onDismiss: () => void;
  onBan: () => void;
  /** Render at reduced visual weight — used inside the collapsed IP-only section. */
  muted?: boolean;
}

function SuspiciousEntryCard({
  entry,
  isModeratorContext,
  onDrill,
  onDismiss,
  onBan,
  muted = false,
}: SuspiciousEntryCardProps) {
  const isResolved = entry.pool === "resolved";
  return (
    <div
      className={`rounded-xl border bg-card p-4 space-y-2 ${
        isResolved
          ? "border-green-500/15 bg-green-500/5"
          : muted
            ? "border-card-border"
            : SEVERITY_BG[entry.highestSeverity]
      }`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
            isResolved
              ? "bg-green-500"
              : muted
                ? "bg-gray-500"
                : SEVERITY_DOT[entry.highestSeverity]
          }`}
        />
        <span
          className={`text-xs font-bold uppercase tracking-wider ${
            isResolved
              ? "text-green-400"
              : muted
                ? "text-muted"
                : SEVERITY_COLORS[entry.highestSeverity]
          }`}
        >
          {isResolved ? "Resolved" : muted ? "IP only" : entry.highestSeverity}
        </span>
        <span className="font-semibold">
          {isModeratorContext ? entry.characterName : `${entry.username} / ${entry.characterName}`}
        </span>
        <span className="text-xs text-muted">({entry.countryId})</span>
        {entry.accountDeleted && (
          <span className="rounded bg-gray-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-300">
            Deleted account
          </span>
        )}
        <span className="ml-auto text-xs text-muted">
          Updated <LocalTime value={entry.lastUpdated} />
        </span>
      </div>

      {/* Flags - show "none" for resolved */}
      {!isResolved && entry.flags.length > 0 && <FlagList flags={entry.flags} muted={muted} />}
      {isResolved && (
        <div className="text-xs text-muted italic">No active flags — permanently resolved.</div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={onDrill}
          className="min-h-[36px] rounded border border-card-border px-3 py-1.5 text-xs font-medium hover:bg-card/80 transition-colors"
        >
          View Activity Log
        </button>
        <button
          onClick={onDismiss}
          className="min-h-[36px] rounded border border-card-border px-3 py-1.5 text-xs font-medium hover:bg-card/80 transition-colors"
        >
          Dismiss
        </button>
        <button
          onClick={onBan}
          className="min-h-[36px] rounded border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
        >
          Ban User
        </button>
      </div>
    </div>
  );
}

interface MatchGroupCardProps {
  group: MatchGroup;
  isModeratorContext: boolean;
  onDrill: (characterId: string) => void;
  onDismiss: (entry: SuspiciousEntry) => void;
  onBan: (entry: SuspiciousEntry) => void;
  /** Render at reduced visual weight — used inside the collapsed IP-only section. */
  muted?: boolean;
}

/**
 * A cluster of accounts linked by shared evidence. Single-account groups fall
 * back to the plain entry card; multi-account groups render as one card with
 * a compact per-account table instead of N nearly-identical cards repeating
 * the same evidence in prose.
 */
function MatchGroupCard({
  group,
  isModeratorContext,
  onDrill,
  onDismiss,
  onBan,
  muted = false,
}: MatchGroupCardProps) {
  if (group.members.length === 1) {
    const entry = group.members[0];
    return (
      <SuspiciousEntryCard
        entry={entry}
        isModeratorContext={isModeratorContext}
        onDrill={() => onDrill(entry.characterId)}
        onDismiss={() => onDismiss(entry)}
        onBan={() => onBan(entry)}
        muted={muted}
      />
    );
  }

  return (
    <div
      className={`rounded-xl border bg-card p-4 space-y-3 ${
        muted ? "border-card-border" : SEVERITY_BG[group.highestSeverity]
      }`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
            muted ? "bg-gray-500" : SEVERITY_DOT[group.highestSeverity]
          }`}
        />
        <span
          className={`text-xs font-bold uppercase tracking-wider ${
            muted ? "text-muted" : SEVERITY_COLORS[group.highestSeverity]
          }`}
        >
          {muted ? "IP only" : group.highestSeverity}
        </span>
        <span className="font-semibold">{group.members.length} linked accounts</span>
        <div className="flex flex-wrap gap-1">
          {group.flagTypes.map((type) => (
            <span
              key={type}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                NETWORK_ONLY_FLAG_TYPES.has(type)
                  ? "bg-gray-500/15 text-muted"
                  : "bg-primary/15 text-primary"
              }`}
            >
              {type}
            </span>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">
          Updated <LocalTime value={group.lastUpdated} />
        </span>
      </div>

      {/* Member table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-left text-xs text-muted">
              <th className="py-1.5 pr-3 font-medium">Account</th>
              {!isModeratorContext && <th className="py-1.5 pr-3 font-medium">Country</th>}
              <th className="py-1.5 pr-3 font-medium">Severity</th>
              <th className="py-1.5 pr-3 font-medium">Evidence</th>
              <th className="py-1.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {group.members.map((entry) => (
              <MemberRow
                key={entry._id}
                entry={entry}
                isModeratorContext={isModeratorContext}
                onDrill={() => onDrill(entry.characterId)}
                onDismiss={() => onDismiss(entry)}
                onBan={() => onBan(entry)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface MemberRowProps {
  entry: SuspiciousEntry;
  isModeratorContext: boolean;
  onDrill: () => void;
  onDismiss: () => void;
  onBan: () => void;
}

function MemberRow({ entry, isModeratorContext, onDrill, onDismiss, onBan }: MemberRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isResolved = entry.pool === "resolved";

  return (
    <>
      <tr className="border-b border-card-border/50 align-top last:border-0">
        <td className="py-2 pr-3">
          <div className="font-medium">
            {isModeratorContext
              ? entry.characterName
              : `${entry.username} / ${entry.characterName}`}
          </div>
          {entry.accountDeleted && (
            <span className="rounded bg-gray-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-300">
              Deleted
            </span>
          )}
        </td>
        {!isModeratorContext && <td className="py-2 pr-3 text-muted">{entry.countryId}</td>}
        <td className="py-2 pr-3">
          <span
            className={`text-xs font-bold uppercase ${
              isResolved ? "text-green-400" : SEVERITY_COLORS[entry.highestSeverity]
            }`}
          >
            {isResolved ? "Resolved" : entry.highestSeverity}
          </span>
        </td>
        <td className="py-2 pr-3">
          {isResolved || entry.flags.length === 0 ? (
            <span className="text-xs italic text-muted">none</span>
          ) : (
            <button
              onClick={() => setExpanded((p) => !p)}
              className="text-xs text-muted underline hover:text-foreground"
            >
              {entry.flags.length} flag{entry.flags.length === 1 ? "" : "s"} {expanded ? "▲" : "▼"}
            </button>
          )}
        </td>
        <td className="py-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={onDrill}
              className="rounded border border-card-border px-2 py-1 text-[11px] font-medium hover:bg-card/80 transition-colors"
            >
              Log
            </button>
            <button
              onClick={onDismiss}
              className="rounded border border-card-border px-2 py-1 text-[11px] font-medium hover:bg-card/80 transition-colors"
            >
              Dismiss
            </button>
            <button
              onClick={onBan}
              className="rounded border border-red-500/30 px-2 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Ban
            </button>
          </div>
        </td>
      </tr>
      {expanded && !isResolved && entry.flags.length > 0 && (
        <tr className="border-b border-card-border/50 last:border-0">
          <td colSpan={isModeratorContext ? 4 : 5} className="pb-2">
            <FlagList flags={entry.flags} muted={false} />
          </td>
        </tr>
      )}
    </>
  );
}
