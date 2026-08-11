// Simplified NPP economy panel for the NPP Management tab.
// The full-featured version with per-NPP CRUD, country breakdown, AP histogram,
// and party filters lives in components/admin/economy/NppEconomyAdminPanel.tsx
// (Economy tab → NPP Economy sub-tab).
"use client";

import { useState, useEffect, useCallback } from "react";

interface NppEconomyStats {
  enabled: boolean;
  currentTurn: number;
  nextProcessingTurn: number;
  stats: {
    totalNpps: number;
    nppsWithFunds: number;
    totalFunds: number;
    totalActionPoints: number;
    avgDonorBaseLevel: number;
  };
}

function formatFunds(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toLocaleString()}`;
}

export function NppEconomyPanel() {
  const [data, setData] = useState<NppEconomyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/npp/economy");
      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? "Failed to load NPP economy stats");
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (enable: boolean) => {
    setToggling(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/npp/economy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enable }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? "Failed to update NPP economy status");
        return;
      }
      await fetchData();
    } catch {
      setError("Network error");
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading NPP economy stats...</span>
        </div>
      </div>
    );
  }

  const isEnabled = data?.enabled ?? false;

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">NPP Action Economy</h3>
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            background: isEnabled ? "rgba(34, 197, 94, 0.15)" : "rgba(107, 107, 122, 0.15)",
            color: isEnabled ? "var(--success)" : "var(--muted)",
          }}
        >
          {isEnabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      {/* Toggle buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => handleToggle(false)}
          disabled={toggling || !isEnabled}
          className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-40"
        >
          {toggling && !isEnabled ? "Updating..." : "Disable"}
        </button>
        <button
          onClick={() => handleToggle(true)}
          disabled={toggling || isEnabled}
          className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs font-medium text-success transition-colors hover:bg-success/20 disabled:opacity-40"
        >
          {toggling && isEnabled ? "Updating..." : "Enable"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
          {error}
        </div>
      )}

      {/* Key Stats */}
      {data && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">Key Stats</p>
          <div className="rounded-lg border border-card-border bg-background divide-y divide-card-border/50">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted">Total NPPs</span>
              <span className="text-xs font-medium tabular-nums">
                {data.stats.totalNpps.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted">NPPs with Funds</span>
              <span className="text-xs font-medium tabular-nums">
                {data.stats.nppsWithFunds.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted">Total NPP Funds</span>
              <span className="text-xs font-medium tabular-nums">
                {formatFunds(data.stats.totalFunds)}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted">Action Points Pooled</span>
              <span className="text-xs font-medium tabular-nums">
                {data.stats.totalActionPoints.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted">Avg Donor Base Level</span>
              <span className="text-xs font-medium tabular-nums">
                {data.stats.avgDonorBaseLevel.toFixed(1)}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted">Next Action Processing</span>
              <span className="text-xs font-medium tabular-nums">
                Turn {data.nextProcessingTurn}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
