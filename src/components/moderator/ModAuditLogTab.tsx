"use client";

import { useState, useEffect, useCallback } from "react";

interface AuditEntry {
  id: string;
  moderatorName: string;
  action: string;
  targetUsername: string | null;
  details: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  ban_user: "Banned user",
  unban_user: "Unbanned user",
  add_mod_note: "Added mod note",
  grant_resources: "Granted resources",
  grant_achievement: "Granted achievement",
  update_character_state: "Updated character state",
  update_character_country: "Updated character country",
  set_patreon_status: "Set Patreon status",
  dismiss_suspicious: "Dismissed suspicious flags",
  resolved_suspicious: "Permanently resolved suspicious flags",
  delete_player_ad: "Deleted player ad",
  toggle_player_ad: "Toggled player ad",
  approve_wiki_page: "Approved wiki page",
  reject_wiki_page: "Rejected wiki page",
  view_private_corporation: "Unlocked private corporation view",
  view_party_mod_view: "Unlocked party mod view",
};

interface ModAuditLogTabProps {
  apiBase?: string;
}

export function ModAuditLogTab({ apiBase = "/api/admin/moderators" }: ModAuditLogTabProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filterAction, setFilterAction] = useState("");

  const fetchEntries = useCallback(
    async (appendCursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (filterAction) params.set("action", filterAction);
        if (appendCursor) params.set("cursor", appendCursor);
        params.set("limit", "50");

        const endpoint = apiBase.endsWith("moderators")
          ? `${apiBase}/audit-log`
          : `${apiBase}/audit-log`;
        const res = await fetch(`${endpoint}?${params}`);
        if (!res.ok) throw new Error("Failed to fetch audit log");
        const data = await res.json();

        if (appendCursor) {
          setEntries((prev) => [...prev, ...data.entries]);
        } else {
          setEntries(data.entries);
        }
        setCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch {
        setError("Failed to load the audit log. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [filterAction, apiBase]
  );

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-card-border bg-card">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : error && entries.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-error">{error}</p>
            <button
              onClick={() => fetchEntries()}
              className="mt-3 rounded-lg border border-card-border bg-background px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-card-hover"
            >
              Retry
            </button>
          </div>
        ) : entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No audit log entries</p>
        ) : (
          <div className="divide-y divide-card-border">
            {entries.map((entry) => (
              <div key={entry.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-info">{entry.moderatorName}</span>
                    <span className="text-sm text-muted">
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                    {entry.targetUsername && (
                      <span className="text-sm">
                        &rarr; <span className="font-medium">{entry.targetUsername}</span>
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted">
                    {new Date(entry.createdAt).toLocaleString("en-US")}
                  </span>
                </div>
                {entry.details && <p className="mt-1 text-xs text-muted">{entry.details}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && entries.length > 0 && <p className="text-center text-sm text-error">{error}</p>}

      {hasMore && (
        <button
          onClick={() => cursor && fetchEntries(cursor)}
          disabled={loading}
          className="w-full rounded-lg border border-card-border bg-card px-4 py-2 text-sm text-muted transition-colors hover:bg-card-hover"
        >
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
