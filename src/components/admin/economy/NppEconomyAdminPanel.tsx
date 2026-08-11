"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { NppV1ReadinessPanel } from "./NppV1ReadinessPanel";

type NppRow = {
  id: string;
  name: string;
  countryId: string;
  party: string;
  homeState: string;
  currentOffice: string | null;
  funds: number;
  actionPoints: number;
  donorBaseLevel: number;
  lastActionProcessedTurn?: number;
};

type ConfirmAction = {
  type: "resetActions" | "drain" | "delete";
  nppId: string;
  nppName: string;
} | null;

type GrantFundsState = { nppId: string; amount: string } | null;

interface NppEconomyStats {
  totalNpps: number;
  nppsWithFunds: number;
  totalFunds: number;
  totalActionPoints: number;
  avgDonorBaseLevel: number;
}

interface EconomyStatus {
  enabled: boolean;
  currentTurn: number;
  nextProcessingTurn: number;
  stats: NppEconomyStats;
}

// All registered countries — NPPs now staff every non-player country, so the
// admin view is no longer limited to the original four player nations.
const COUNTRY_PILLS = ["All", ...COUNTRY_ORDER];

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const PAGE_SIZE = 25;

export function NppEconomyAdminPanel() {
  const [status, setStatus] = useState<EconomyStatus | null>(null);
  const [npps, setNpps] = useState<NppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [countryFilter, setCountryFilter] = useState("All");
  const [partyFilter, setPartyFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [grantFunds, setGrantFunds] = useState<GrantFundsState>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, nppsRes] = await Promise.all([
        fetch("/api/admin/npp/economy"),
        fetch("/api/admin/economy/npps"),
      ]);
      if (!statusRes.ok) throw new Error(`Status HTTP ${statusRes.status}`);
      if (!nppsRes.ok) throw new Error(`NPPs HTTP ${nppsRes.status}`);
      const statusJson = (await statusRes.json()) as EconomyStatus;
      const nppsJson = (await nppsRes.json()) as { npps: NppRow[] };
      setStatus(statusJson);
      setNpps(nppsJson.npps);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/npp/economy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setToggling(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    setActionLoading(confirm.nppId);
    setActionError(null);
    try {
      let url = "";
      let method = "POST";
      if (confirm.type === "resetActions") {
        url = `/api/admin/npps/${confirm.nppId}/actions`;
        method = "DELETE";
      } else if (confirm.type === "drain") {
        url = `/api/admin/npps/${confirm.nppId}/drain`;
      } else {
        url = `/api/admin/npps/${confirm.nppId}`;
        method = "DELETE";
      }
      const res = await fetch(url, { method });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirm(null);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleGrantFunds = async () => {
    if (!grantFunds || !grantFunds.amount) return;
    const amount = parseFloat(grantFunds.amount);
    if (isNaN(amount) || amount <= 0) {
      setActionError("Enter a positive number for grant amount");
      return;
    }
    setActionLoading(grantFunds.nppId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/npps/${grantFunds.nppId}/funds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGrantFunds(null);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Client-side filtering
  const filtered = npps.filter((npp) => {
    if (countryFilter !== "All" && npp.countryId !== countryFilter) return false;
    if (partyFilter !== "all" && npp.party !== partyFilter) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Per-country breakdown — every registered country.
  const countryBreakdown = COUNTRY_ORDER.map((cId) => {
    const cNpps = npps.filter((n) => n.countryId === cId);
    return {
      countryId: cId,
      count: cNpps.length,
      totalFunds: cNpps.reduce((s, n) => s + n.funds, 0),
      avgAP: cNpps.length > 0 ? cNpps.reduce((s, n) => s + n.actionPoints, 0) / cNpps.length : 0,
    };
  });

  // AP histogram buckets
  const apBuckets = [
    { label: "0–20", min: 0, max: 20 },
    { label: "21–40", min: 21, max: 40 },
    { label: "41–60", min: 41, max: 60 },
    { label: "61–80", min: 61, max: 80 },
    { label: "81–100", min: 81, max: 100 },
  ].map((b) => ({
    ...b,
    count: npps.filter((n) => n.actionPoints >= b.min && n.actionPoints <= b.max).length,
  }));
  const maxBucketCount = Math.max(...apBuckets.map((b) => b.count), 1);

  // Derive party pills dynamically from fetched NPP data
  const partyPills = useMemo(() => {
    if (countryFilter === "All") return [];
    const parties = new Set<string>();
    for (const npp of npps) {
      if (npp.countryId === countryFilter) parties.add(npp.party);
    }
    return [...parties].sort();
  }, [npps, countryFilter]);

  return (
    <div className="space-y-6">
      {/* Feature flag banner */}
      {status && (
        <div
          className={`rounded-xl border p-4 flex items-center justify-between gap-4 flex-wrap ${
            status.enabled ? "border-success/30 bg-success/5" : "border-error/30 bg-error/5"
          }`}
        >
          <div>
            <p
              className={`text-sm font-semibold ${status.enabled ? "text-success" : "text-error"}`}
            >
              NPP Economy: {status.enabled ? "ON" : "OFF"}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {status.enabled
                ? `Fund generation runs each turn. Next action processing: turn ${status.nextProcessingTurn}.`
                : "Fund generation and action processing are paused."}
            </p>
          </div>
          <button
            onClick={() => handleToggle(!status.enabled)}
            disabled={toggling}
            className={`text-xs px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 ${
              status.enabled
                ? "bg-error/20 text-error hover:bg-error/30"
                : "bg-success/20 text-success hover:bg-success/30"
            }`}
          >
            {toggling ? "…" : status.enabled ? "Disable" : "Enable"}
          </button>
        </div>
      )}

      {/* Aggregate stat cards */}
      {status && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Active NPPs", value: String(status.stats.totalNpps) },
            { label: "NPPs With Funds", value: String(status.stats.nppsWithFunds) },
            { label: "Total Funds", value: fmt(status.stats.totalFunds) },
            {
              label: "Avg Donor Level",
              value: status.stats.avgDonorBaseLevel.toFixed(1),
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-card-border bg-card p-4 space-y-1"
            >
              <p className="text-xs text-muted uppercase tracking-wider">{card.label}</p>
              <p className="text-lg font-semibold">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* V1 autonomy seeded-readiness diagnostic */}
      <NppV1ReadinessPanel />

      {error && <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{error}</p>}
      {actionError && (
        <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{actionError}</p>
      )}

      {loading && <div className="text-muted text-sm py-8 text-center">Loading…</div>}

      {!loading && npps.length > 0 && (
        <>
          {/* Per-country breakdown */}
          <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr>
                  {["Country", "NPP Count", "Total Funds", "Avg Action Points"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {countryBreakdown.map((row) => (
                  <tr key={row.countryId} className="hover:bg-background/40 transition-colors">
                    <td className="px-4 py-3 font-medium">{row.countryId}</td>
                    <td className="px-4 py-3">{row.count}</td>
                    <td className="px-4 py-3">{fmt(row.totalFunds)}</td>
                    <td className="px-4 py-3">{row.avgAP.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* AP histogram */}
          <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
            <p className="text-sm font-medium">Action Points Distribution</p>
            <div className="space-y-2">
              {apBuckets.map((b) => (
                <div key={b.label} className="flex items-center gap-3 text-xs">
                  <span className="w-14 text-muted text-right">{b.label}</span>
                  <div className="flex-1 h-5 bg-muted/10 rounded overflow-hidden">
                    <div
                      className={`h-full ${
                        b.min >= 81 ? "bg-success/60" : "bg-primary/50"
                      } transition-all`}
                      style={{ width: `${(b.count / maxBucketCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 text-muted">{b.count}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">
              {npps.filter((n) => n.actionPoints >= 100).length} at cap (100)
            </p>
          </div>

          {/* Filter row */}
          <div className="flex flex-wrap gap-2">
            {COUNTRY_PILLS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setCountryFilter(c);
                  setPartyFilter("all");
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  countryFilter === c
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-card-border text-muted hover:text-foreground"
                }`}
              >
                {c}
              </button>
            ))}
            {partyPills.length > 0 && (
              <>
                <span className="text-muted text-xs self-center">·</span>
                {partyPills.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setPartyFilter(partyFilter === p ? "all" : p);
                      setPage(1);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      partyFilter === p
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border border-card-border text-muted hover:text-foreground"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </>
            )}
          </div>

          {/* NPP table */}
          <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-background/50">
                  <tr>
                    {[
                      "Name",
                      "Party",
                      "State",
                      "Funds",
                      "AP",
                      "Donor Lvl",
                      "Last Gen",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {paginated.map((npp) => (
                    <React.Fragment key={npp.id}>
                      <tr className="hover:bg-background/40 transition-colors duration-150">
                        <td className="px-4 py-3">
                          <div className="font-medium">{npp.name}</div>
                          <div className="text-xs text-muted">
                            {npp.countryId}
                            {npp.currentOffice ? ` · ${npp.currentOffice}` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">{npp.party}</td>
                        <td className="px-4 py-3 text-xs">{npp.homeState}</td>
                        <td className="px-4 py-3">{fmt(npp.funds)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={npp.actionPoints >= 100 ? "text-success font-semibold" : ""}
                          >
                            {npp.actionPoints}
                            {npp.actionPoints >= 100 ? " ★" : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3">{npp.donorBaseLevel}</td>
                        <td className="px-4 py-3 text-xs text-muted">
                          {npp.lastActionProcessedTurn != null
                            ? `T${npp.lastActionProcessedTurn}`
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {grantFunds?.nppId === npp.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                step="1000"
                                value={grantFunds.amount}
                                onChange={(e) =>
                                  setGrantFunds({ nppId: npp.id, amount: e.target.value })
                                }
                                className="w-24 rounded border border-card-border bg-background px-2 py-1 text-xs"
                                placeholder="Amount"
                              />
                              <button
                                onClick={handleGrantFunds}
                                disabled={actionLoading === npp.id || !grantFunds.amount}
                                className="text-xs px-2 py-1 rounded bg-success/20 text-success hover:bg-success/30 disabled:opacity-40"
                              >
                                Grant
                              </button>
                              <button
                                onClick={() => setGrantFunds(null)}
                                className="text-xs text-muted hover:text-foreground"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1 flex-wrap">
                              <button
                                onClick={() => setGrantFunds({ nppId: npp.id, amount: "" })}
                                className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
                              >
                                + Funds
                              </button>
                              <button
                                onClick={() =>
                                  setConfirm({
                                    type: "resetActions",
                                    nppId: npp.id,
                                    nppName: npp.name,
                                  })
                                }
                                className="text-xs px-2 py-1 rounded border border-warning/40 text-warning hover:bg-warning/10 transition-colors"
                              >
                                Reset AP
                              </button>
                              <button
                                onClick={() =>
                                  setConfirm({
                                    type: "drain",
                                    nppId: npp.id,
                                    nppName: npp.name,
                                  })
                                }
                                className="text-xs px-2 py-1 rounded border border-warning/40 text-warning hover:bg-warning/10 transition-colors"
                              >
                                Drain
                              </button>
                              <button
                                onClick={() =>
                                  setConfirm({
                                    type: "delete",
                                    nppId: npp.id,
                                    nppName: npp.name,
                                  })
                                }
                                className="text-xs px-2 py-1 rounded border border-error/40 text-error hover:bg-error/10 transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>

                      {/* Confirm strip */}
                      {confirm?.nppId === npp.id && (
                        <tr>
                          <td
                            colSpan={8}
                            className={`px-4 py-3 border-t ${
                              confirm.type === "delete"
                                ? "bg-error/5 border-error/20"
                                : "bg-warning/5 border-warning/20"
                            }`}
                          >
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-sm">
                                {confirm.type === "delete" ? (
                                  <>
                                    Permanently delete <strong>{confirm.nppName}</strong>? This
                                    removes the NPP, their office record, and any active election
                                    candidacy. This cannot be undone.
                                  </>
                                ) : confirm.type === "drain" ? (
                                  <>
                                    Drain all funds from <strong>{confirm.nppName}</strong>?
                                  </>
                                ) : (
                                  <>
                                    Reset action points for <strong>{confirm.nppName}</strong> to 0?
                                  </>
                                )}
                              </span>
                              <button
                                onClick={handleConfirm}
                                disabled={actionLoading === npp.id}
                                className={`text-xs px-3 py-1 rounded font-medium disabled:opacity-50 ${
                                  confirm.type === "delete"
                                    ? "bg-error text-error-foreground hover:opacity-90"
                                    : "bg-warning text-warning-foreground hover:opacity-90"
                                }`}
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirm(null)}
                                className="text-xs text-muted hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {paginated.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted">
                        No NPPs match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="border-t border-card-border bg-background/30 px-4 py-2 flex items-center gap-3 text-xs text-muted">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="hover:text-foreground disabled:opacity-40"
                >
                  ← Prev
                </button>
                <span>
                  Page {page} of {totalPages} ({filtered.length} NPPs)
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="hover:text-foreground disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
