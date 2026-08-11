"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface UserApiKeyRow {
  _id: string;
  name: string;
  scope: "public" | "private";
  prefix: string;
  requestCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  userId: string;
  username: string;
  characterName: string | null;
}

type SortField = "createdAt" | "username" | "scope" | "requestCount" | "lastUsedAt";
type SortDir = "asc" | "desc";

export function UserApiKeysTab() {
  const [keys, setKeys] = useState<UserApiKeyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "public" | "private">("all");
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (scopeFilter !== "all") params.set("scope", scopeFilter);
      if (search) params.set("search", search);
      if (includeRevoked) params.set("includeRevoked", "true");
      params.set("limit", "500");

      const res = await fetch(`/api/admin/user-api-keys?${params}`);
      if (!res.ok) {
        setError("Failed to load API keys");
        return;
      }
      const data = await res.json();
      setKeys(data.keys ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, search, includeRevoked]);

  useEffect(() => {
    setLoading(true);
    void fetchKeys();
  }, [fetchKeys]);

  const sortedKeys = useMemo(() => {
    return [...keys].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "username":
          cmp = a.username.localeCompare(b.username);
          break;
        case "scope":
          cmp = a.scope.localeCompare(b.scope);
          break;
        case "requestCount":
          cmp = a.requestCount - b.requestCount;
          break;
        case "lastUsedAt":
          cmp = (a.lastUsedAt ?? "").localeCompare(b.lastUsedAt ?? "");
          break;
        case "createdAt":
        default:
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [keys, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const handleRevoke = async (keyId: string, keyName: string) => {
    if (!confirm(`Revoke API key "${keyName}"? This cannot be undone.`)) return;
    setRevoking(keyId);
    try {
      const res = await fetch(`/api/admin/user-api-keys?keyId=${keyId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Failed to revoke key");
        return;
      }
      await fetchKeys();
    } catch {
      setError("Failed to revoke key");
    } finally {
      setRevoking(null);
    }
  };

  const sortIcon = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const scopeLabel = (scope: "public" | "private") =>
    scope === "public" ? "🔓 Public" : "🔐 Private";

  if (loading) {
    return <div className="text-muted py-8 text-center">Loading API keys...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">User API Keys</h2>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Search user or key name</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by username or key name..."
            className="rounded border border-card-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Scope</label>
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as "all" | "public" | "private")}
            className="rounded border border-card-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeRevoked}
            onChange={(e) => setIncludeRevoked(e.target.checked)}
            className="rounded border-card-border"
          />
          Show revoked
        </label>
      </div>

      <p className="text-xs text-muted">
        {total} key{total !== 1 ? "s" : ""} total
        {search ? ` matching "${search}"` : ""}
        {!includeRevoked ? " (active only)" : ""}
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-card-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-card">
              <th
                className="cursor-pointer px-3 py-2 text-left font-medium text-muted hover:text-foreground"
                onClick={() => toggleSort("username")}
              >
                User{sortIcon("username")}
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted">Key Name</th>
              <th
                className="cursor-pointer px-3 py-2 text-left font-medium text-muted hover:text-foreground"
                onClick={() => toggleSort("scope")}
              >
                Scope{sortIcon("scope")}
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted">Prefix</th>
              <th
                className="cursor-pointer px-3 py-2 text-right font-medium text-muted hover:text-foreground"
                onClick={() => toggleSort("requestCount")}
              >
                Requests{sortIcon("requestCount")}
              </th>
              <th
                className="cursor-pointer px-3 py-2 text-left font-medium text-muted hover:text-foreground"
                onClick={() => toggleSort("lastUsedAt")}
              >
                Last Used{sortIcon("lastUsedAt")}
              </th>
              <th
                className="cursor-pointer px-3 py-2 text-left font-medium text-muted hover:text-foreground"
                onClick={() => toggleSort("createdAt")}
              >
                Created{sortIcon("createdAt")}
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
              <th className="px-3 py-2 text-right font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedKeys.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted">
                  No API keys found
                </td>
              </tr>
            )}
            {sortedKeys.map((key) => (
              <tr
                key={key._id}
                className={`border-b border-card-border ${
                  key.revokedAt ? "opacity-50" : "hover:bg-white/[0.02]"
                }`}
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{key.username}</div>
                  {key.characterName && (
                    <div className="text-xs text-muted">{key.characterName}</div>
                  )}
                </td>
                <td className="px-3 py-2">{key.name}</td>
                <td className="px-3 py-2">{scopeLabel(key.scope)}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted">{key.prefix}</td>
                <td className="px-3 py-2 text-right tabular-nums">{key.requestCount}</td>
                <td className="px-3 py-2 text-xs text-muted">
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString("en-US") : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted">
                  {new Date(key.createdAt).toLocaleDateString("en-US")}
                </td>
                <td className="px-3 py-2">
                  {key.revokedAt ? (
                    <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-medium text-red-400">
                      Revoked
                    </span>
                  ) : (
                    <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-xs font-medium text-green-400">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {!key.revokedAt && (
                    <button
                      onClick={() => handleRevoke(key._id, key.name)}
                      disabled={revoking === key._id}
                      className="rounded px-2 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {revoking === key._id ? "Revoking..." : "Revoke"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
