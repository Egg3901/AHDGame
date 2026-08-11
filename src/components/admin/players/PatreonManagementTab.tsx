"use client";

import { useState } from "react";
import { PlayerSelector } from "@/components/PlayerSelector";

interface SearchResult {
  userId: string;
  username: string;
  characterName: string | null;
  patreonTier: "supporter" | "supporter-plus" | "supporter-plus-plus" | null;
  patreonExpiresAt: string | null;
  patreonUserId: string | null;
}

interface PatreonManagementTabProps {
  context?: "admin" | "moderator";
}

export function PatreonManagementTab({ context = "admin" }: PatreonManagementTabProps) {
  const apiBase = context === "moderator" ? "/api/moderator" : "/api/admin";
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [tier, setTier] = useState<"supporter" | "supporter-plus" | "supporter-plus-plus" | "">("");
  const [patreonUserId, setPatreonUserId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function runSearch(query: string) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${apiBase}/patreon/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Search failed");
        setSelected(null);
        return;
      }
      const users = (data.users ?? []) as SearchResult[];
      if (users.length === 0) {
        setError("No users found");
        setSelected(null);
        return;
      }
      // Auto-select the first result when using PlayerSelector
      const first = users[0];
      setSelected(first);
      setTier(first.patreonTier ?? "");
      setPatreonUserId(first.patreonUserId ?? "");
      setReason("");
    } catch {
      setError("Search failed");
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  async function saveStatus(
    nextTier: "supporter" | "supporter-plus" | "supporter-plus-plus" | null
  ) {
    if (!selected) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${apiBase}/patreon/set-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selected.userId,
          tier: nextTier,
          patreonUserId: patreonUserId || undefined,
          reason: reason || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update Patreon status");
        return;
      }
      setMessage(nextTier ? `Set Patreon tier to ${nextTier}.` : "Cleared Patreon status.");
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              patreonTier: nextTier,
              patreonUserId: data.patreonUserId,
              patreonExpiresAt: data.expiresAt,
            }
          : prev
      );
    } catch {
      setError("Failed to update Patreon status");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-card-border bg-card p-5 shadow-card">
        <h3 className="text-sm font-semibold text-foreground">Patreon Management</h3>
        <p className="mt-1 text-sm text-muted">
          Search for a player account, link a Patreon user ID, and set or clear supporter status.
        </p>

        <div className="mt-4">
          <label className="block text-xs font-medium text-muted mb-1.5">Player</label>
          {selected ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-xl border border-success/40 bg-success/10 px-3 py-2.5 text-sm">
                <span className="font-medium">{selected.username}</span>
                {selected.characterName && (
                  <span className="ml-2 text-muted">({selected.characterName})</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setTier("");
                  setPatreonUserId("");
                  setReason("");
                  setMessage("");
                  setError("");
                }}
                className="rounded-md border border-card-border bg-card px-3 py-2 text-xs text-muted hover:text-foreground"
              >
                Clear
              </button>
            </div>
          ) : (
            <PlayerSelector
              onSelect={(char) => {
                void runSearch(char.name);
              }}
              placeholder="Search for a player…"
            />
          )}
        </div>
      </div>

      {selected && (
        <div className="rounded-2xl border border-card-border bg-card p-5 shadow-card">
          <h4 className="text-sm font-semibold text-foreground">Set Status</h4>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-muted">Tier</span>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as typeof tier)}
                className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm"
              >
                <option value="">None</option>
                <option value="supporter">Supporter</option>
                <option value="supporter-plus">Supporter+</option>
                <option value="supporter-plus-plus">Supporter++</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs font-medium text-muted">Patreon User ID</span>
              <input
                value={patreonUserId}
                onChange={(e) => setPatreonUserId(e.target.value)}
                className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm"
                placeholder="Optional webhook link"
              />
            </label>
          </div>
          <label className="mt-4 block space-y-1">
            <span className="block text-xs font-medium text-muted">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm"
              placeholder="Optional admin note"
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void saveStatus(tier || null)}
              disabled={loading}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => void saveStatus(null)}
              disabled={loading}
              className="rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm font-medium text-foreground disabled:opacity-60"
            >
              Clear
            </button>
          </div>
          {(error || message) && (
            <p className={`mt-4 text-sm ${error ? "text-error" : "text-success"}`}>
              {error || message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
