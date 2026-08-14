"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalTime } from "@/components/time/LocalTime";

interface BannedIpRow {
  _id: string;
  ip: string;
  note: string;
  bannedByAdminUsername: string;
  bannedAt: string;
  allowRegistration?: boolean;
  maxAccounts?: number;
  allowReason?: string;
  allowedByAdminUsername?: string;
  allowedAt?: string;
}

interface ListResponse {
  rows: BannedIpRow[];
  counts: Record<string, number>;
}

interface CollisionStatus {
  enabled: boolean;
}

export function IpBansTab() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [collision, setCollision] = useState<CollisionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Ban form
  const [banIp, setBanIp] = useState("");
  const [banNote, setBanNote] = useState("");
  const [banPosting, setBanPosting] = useState(false);

  // Allowance form
  const [allowIp, setAllowIp] = useState("");
  const [allowNote, setAllowNote] = useState("");
  const [allowMax, setAllowMax] = useState(2);
  const [allowPosting, setAllowPosting] = useState(false);

  const fetchAll = useCallback(async () => {
    setError("");
    try {
      const [listRes, colRes] = await Promise.all([
        fetch("/api/admin/ip-bans"),
        fetch("/api/admin/ip-collision-check"),
      ]);
      if (listRes.ok) setData(await listRes.json());
      if (colRes.ok) setCollision(await colRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const counts = data?.counts ?? {};

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => new Date(b.bannedAt).getTime() - new Date(a.bannedAt).getTime()),
    [rows]
  );

  const submitBan = async () => {
    setBanPosting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/ip-bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: banIp.trim(), note: banNote.trim() }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || "Failed to add ban");
        return;
      }
      setBanIp("");
      setBanNote("");
      await fetchAll();
    } finally {
      setBanPosting(false);
    }
  };

  const submitAllowance = async () => {
    setAllowPosting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/ip-bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip: allowIp.trim(),
          note: allowNote.trim(),
          allow: true,
          maxAccounts: allowMax,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || "Failed to add allowance");
        return;
      }
      setAllowIp("");
      setAllowNote("");
      setAllowMax(2);
      await fetchAll();
    } finally {
      setAllowPosting(false);
    }
  };

  const convertToAllowance = async (row: BannedIpRow) => {
    const maxStr = window.prompt(`Max accounts allowed for ${row.ip}?`, "2");
    if (!maxStr) return;
    const max = parseInt(maxStr, 10);
    if (!Number.isInteger(max) || max < 1) {
      setError("maxAccounts must be a positive integer.");
      return;
    }
    const reason = window.prompt(`Reason for allowing ${row.ip}?`, row.note || "");
    if (!reason) return;
    const res = await fetch(`/api/admin/ip-bans/${row._id}/allow`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allow: true, reason, maxAccounts: max }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Failed to convert to allowance");
      return;
    }
    await fetchAll();
  };

  const revokeAllowance = async (row: BannedIpRow) => {
    if (!window.confirm(`Revoke allowance for ${row.ip}? It will become a ban again.`)) return;
    const res = await fetch(`/api/admin/ip-bans/${row._id}/allow`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allow: false }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Failed to revoke allowance");
      return;
    }
    await fetchAll();
  };

  const editCap = async (row: BannedIpRow) => {
    const maxStr = window.prompt(`New cap for ${row.ip}?`, String(row.maxAccounts ?? 2));
    if (!maxStr) return;
    const max = parseInt(maxStr, 10);
    if (!Number.isInteger(max) || max < 1) {
      setError("maxAccounts must be a positive integer.");
      return;
    }
    const res = await fetch(`/api/admin/ip-bans/${row._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxAccounts: max }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Failed to edit cap");
      return;
    }
    await fetchAll();
  };

  const remove = async (row: BannedIpRow) => {
    if (!window.confirm(`Delete ${row.ip} entry?`)) return;
    const res = await fetch(`/api/admin/ip-bans/${row._id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Failed to delete");
      return;
    }
    await fetchAll();
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      {/* Read-only collision check status + link */}
      <div className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm">
        IP collision check:{" "}
        <span
          className="font-semibold"
          style={{ color: collision?.enabled ? "var(--warning)" : "var(--muted)" }}
        >
          {collision?.enabled ? "Enabled" : "Disabled"}
        </span>{" "}
        <a href="/admin?tab=dashboard" className="text-primary hover:underline">
          Manage on Dashboard →
        </a>
      </div>

      {/* Forms */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-card-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Add IP ban</h3>
          <input
            type="text"
            placeholder="IP address"
            value={banIp}
            onChange={(e) => setBanIp(e.target.value)}
            className="mb-2 w-full rounded border border-card-border bg-card px-2 py-1 text-sm"
          />
          <textarea
            placeholder="Note (admin-facing)"
            value={banNote}
            onChange={(e) => setBanNote(e.target.value)}
            className="mb-2 w-full rounded border border-card-border bg-card px-2 py-1 text-sm"
            rows={2}
          />
          <button
            type="button"
            onClick={submitBan}
            disabled={banPosting || !banIp || !banNote}
            className="rounded bg-error px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            {banPosting ? "Adding..." : "Ban IP"}
          </button>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Add IP allowance</h3>
          <input
            type="text"
            placeholder="IP address"
            value={allowIp}
            onChange={(e) => setAllowIp(e.target.value)}
            className="mb-2 w-full rounded border border-card-border bg-card px-2 py-1 text-sm"
          />
          <textarea
            placeholder="Reason (admin-facing)"
            value={allowNote}
            onChange={(e) => setAllowNote(e.target.value)}
            className="mb-2 w-full rounded border border-card-border bg-card px-2 py-1 text-sm"
            rows={2}
          />
          <label className="mb-2 block text-xs text-muted">
            Max accounts
            <input
              type="number"
              min={1}
              value={allowMax}
              onChange={(e) => setAllowMax(parseInt(e.target.value, 10) || 1)}
              className="ml-2 w-20 rounded border border-card-border bg-card px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={submitAllowance}
            disabled={allowPosting || !allowIp || !allowNote || allowMax < 1}
            className="rounded bg-success px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            {allowPosting ? "Adding..." : "Allow IP"}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/5 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 text-left">IP</th>
              <th className="px-3 py-2 text-left">Mode</th>
              <th className="px-3 py-2 text-left">Usage</th>
              <th className="px-3 py-2 text-left">Note</th>
              <th className="px-3 py-2 text-left">Created by</th>
              <th className="px-3 py-2 text-left">Created at</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-muted">
                  No entries yet.
                </td>
              </tr>
            )}
            {sortedRows.map((row) => {
              const used = counts[row.ip] ?? 0;
              const isAllowance = row.allowRegistration === true;
              const max = row.maxAccounts ?? 0;
              const atCap = isAllowance && collision?.enabled && used >= max;
              return (
                <tr key={row._id} className="border-t border-card-border align-top">
                  <td className="px-3 py-2 font-mono break-all">{row.ip}</td>
                  <td className="px-3 py-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                      style={{
                        background: isAllowance
                          ? "rgba(34, 197, 94, 0.15)"
                          : "rgba(239, 68, 68, 0.15)",
                        color: isAllowance ? "var(--success)" : "var(--error)",
                      }}
                    >
                      {isAllowance ? "Allowed" : "Banned"}
                    </span>
                  </td>
                  <td className="px-3 py-2" style={{ color: atCap ? "var(--warning)" : undefined }}>
                    {isAllowance ? `${used} / ${max}` : "—"}
                  </td>
                  <td className="px-3 py-2">{row.note}</td>
                  <td className="px-3 py-2">{row.bannedByAdminUsername}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    <LocalTime value={row.bannedAt} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {!isAllowance && (
                        <button
                          type="button"
                          onClick={() => convertToAllowance(row)}
                          className="rounded border border-card-border px-2 py-0.5 text-xs"
                        >
                          Convert to allowance
                        </button>
                      )}
                      {isAllowance && (
                        <>
                          <button
                            type="button"
                            onClick={() => editCap(row)}
                            className="rounded border border-card-border px-2 py-0.5 text-xs"
                          >
                            Edit cap
                          </button>
                          <button
                            type="button"
                            onClick={() => revokeAllowance(row)}
                            className="rounded border border-card-border px-2 py-0.5 text-xs"
                          >
                            Revoke allowance
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        className="rounded border border-error/50 px-2 py-0.5 text-xs text-error"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
