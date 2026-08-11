"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import type { CommodityType } from "@/lib/constants/commodities";

interface CommodityRow {
  commodity: string;
  globalPrice: number;
  basePrice: number;
  priceChangePct: number;
  globalSupply: number;
  globalDemand: number;
  dsRatio: number;
  nudgeActive: boolean;
  nudgePrice: number | null;
  hardPeg: number | null;
  statePegCount: number;
  stateNudgeCount: number;
  history: { turn: number; price: number }[];
}

interface Summary {
  shortageCount: number;
  balancedCount: number;
  surplusCount: number;
  worstShortage: { commodity: string; dsRatio: number } | null;
  nudgeCount: number;
  globalPegCount: number;
  totalStatePegs: number;
}

interface RegionalRow {
  commodity: string;
  price: number;
  globalPrice: number;
  changeFromGlobal: number;
  supply: number;
  demand: number;
  dsRatio: number;
  hardPegged: boolean;
  globalPegged: boolean;
  nudged: boolean;
  pegPrice: number | null;
  globalPegPrice: number | null;
  history: { turn: number; price: number }[];
}

type NudgeState = { price: string; step: "input" | "confirm" };
type PegState = { price: string; step: "input" | "confirm" };

function commodityLabel(commodity: string): string {
  return COMMODITY_LABELS[commodity as CommodityType] ?? commodity.replace(/_/g, " ");
}

/** Small inline SVG sparkline for price history. */
function PriceSparkline({ history }: { history: { turn: number; price: number }[] }) {
  if (history.length < 2) {
    return (
      <svg width={80} height={28} className="block">
        <line x1={0} y1={14} x2={80} y2={14} stroke="currentColor" strokeOpacity={0.15} />
      </svg>
    );
  }
  const prices = history.map((h) => h.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const W = 80;
  const H = 28;
  const toX = (i: number) => (i / (prices.length - 1)) * W;
  const toY = (v: number) => H - 2 - ((v - min) / range) * (H - 4);
  const points = prices.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const trending = prices[prices.length - 1] >= prices[0];
  return (
    <svg width={W} height={H} className="block">
      <polyline
        points={points}
        fill="none"
        stroke={trending ? "var(--success)" : "var(--error)"}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function dsPillClass(dsRatio: number) {
  if (dsRatio >= 1.1) return "bg-error/20 text-error";
  if (dsRatio <= 0.9) return "bg-success/20 text-success";
  return "bg-muted/20 text-muted";
}

export function CommoditiesAdminPanel() {
  const registered = useRegisteredCountries();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [commodities, setCommodities] = useState<CommodityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sortAlpha, setSortAlpha] = useState(false);
  const [nudgeState, setNudgeState] = useState<Record<string, NudgeState>>({});
  const [pegState, setPegState] = useState<Record<string, PegState>>({});
  const [activeTab, setActiveTab] = useState<"global" | "regional">("global");

  // Regional tab state
  const [regionCountry, setRegionCountry] = useState("");
  const [regionState, setRegionState] = useState("");
  const [regionStates, setRegionStates] = useState<{ id: string; name: string }[]>([]);
  const [regionalData, setRegionalData] = useState<RegionalRow[]>([]);
  const [regionalLoading, setRegionalLoading] = useState(false);
  const [regionalMode, setRegionalMode] = useState<"state" | "country" | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/commodities");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSummary(json.summary);
      setCommodities(json.commodities);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sorted = [...commodities].sort((a, b) =>
    sortAlpha ? a.commodity.localeCompare(b.commodity) : b.dsRatio - a.dsRatio
  );

  // ── Global nudge handlers (existing) ──

  const openNudge = (commodity: string) => {
    setNudgeState((prev) => {
      const existing = prev[commodity];
      if (existing) {
        const next = { ...prev };
        delete next[commodity];
        return next;
      }
      return { ...prev, [commodity]: { price: "", step: "input" } };
    });
    setPegState((prev) => {
      const next = { ...prev };
      delete next[commodity];
      return next;
    });
    setActionError(null);
  };

  const handleNudgeConfirm = async (commodity: string, price: number) => {
    setActionLoading(commodity);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/commodities/${commodity}/price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNudgeState((prev) => {
        const next = { ...prev };
        delete next[commodity];
        return next;
      });
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  // ── Global peg handlers ──

  const openPeg = (commodity: string) => {
    setPegState((prev) => {
      const existing = prev[commodity];
      if (existing) {
        const next = { ...prev };
        delete next[commodity];
        return next;
      }
      return { ...prev, [commodity]: { price: "", step: "input" } };
    });
    setNudgeState((prev) => {
      const next = { ...prev };
      delete next[commodity];
      return next;
    });
    setActionError(null);
  };

  const handlePegConfirm = async (commodity: string, price: number) => {
    setActionLoading(commodity);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/commodities/${commodity}/peg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPegState((prev) => {
        const next = { ...prev };
        delete next[commodity];
        return next;
      });
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnpeg = async (commodity: string) => {
    setActionLoading(commodity);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/commodities/${commodity}/peg`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  // ── Regional data fetching ──

  const fetchStatesForCountry = useCallback(async (countryId: string) => {
    if (!countryId) {
      setRegionStates([]);
      return;
    }
    try {
      const res = await fetch("/api/game/states");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const allStates: { _id: string; name: string; countryId?: string }[] = await res.json();
      setRegionStates(
        allStates
          .filter((s) => s.countryId === countryId)
          .map((s) => ({ id: s._id, name: s.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (e) {
      setRegionStates([]);
      setActionError(e instanceof Error ? e.message : "Failed to load states");
    }
  }, []);

  const fetchRegionalData = useCallback(async (countryId: string, stateId?: string) => {
    if (!countryId) return;
    setRegionalLoading(true);
    setActionError(null);
    try {
      const qs = stateId ? `?countryId=${countryId}&stateId=${stateId}` : `?countryId=${countryId}`;
      const res = await fetch(`/api/admin/commodities/regional${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRegionalData(json.commodities);
      setRegionalMode(json.mode ?? (stateId ? "state" : "country"));
    } catch (e) {
      setRegionalData([]);
      setRegionalMode(null);
      setActionError(e instanceof Error ? e.message : "Failed to load regional data");
    } finally {
      setRegionalLoading(false);
    }
  }, []);

  // ── Regional action handlers ──

  const handleStatePeg = async (commodity: string, stateId: string, price: number) => {
    setActionLoading(commodity);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/commodities/${commodity}/state-peg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId, price }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchRegionalData(regionCountry, regionState);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleStateUnpeg = async (commodity: string, stateId: string) => {
    setActionLoading(commodity);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/admin/commodities/${commodity}/state-peg?stateId=${encodeURIComponent(stateId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchRegionalData(regionCountry, regionState);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleStateNudge = async (commodity: string, stateId: string, price: number) => {
    setActionLoading(commodity);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/commodities/${commodity}/state-nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId, price }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchRegionalData(regionCountry, regionState);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Country-wide peg state
  const [countryPeg, setCountryPeg] = useState<{
    commodity: string;
    price: string;
    step: "input" | "confirm";
  } | null>(null);

  const handleCountryPeg = async (commodity: string, price: number) => {
    if (!regionCountry) return;
    setActionLoading(commodity);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/commodities/${commodity}/state-peg-country`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryId: regionCountry, price }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCountryPeg(null);
      await fetchRegionalData(regionCountry, regionState);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Commodities</h2>
      </div>

      {/* Active pegs banner */}
      {summary && (summary.globalPegCount > 0 || summary.totalStatePegs > 0) && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-2">
          <p className="text-sm font-semibold text-warning">
            {summary.globalPegCount > 0 &&
              `${summary.globalPegCount} global peg${summary.globalPegCount !== 1 ? "s" : ""}`}
            {summary.globalPegCount > 0 && summary.totalStatePegs > 0 && ", "}
            {summary.totalStatePegs > 0 &&
              `${summary.totalStatePegs} state peg${summary.totalStatePegs !== 1 ? "s" : ""}`}{" "}
            active
          </p>
          {summary.globalPegCount > 0 && (
            <div className="flex flex-wrap gap-2">
              {commodities
                .filter((r) => r.hardPeg != null)
                .map((r) => (
                  <span
                    key={r.commodity}
                    className="inline-flex items-center gap-1 text-xs bg-warning/10 text-warning px-2 py-1 rounded"
                  >
                    <span>{commodityLabel(r.commodity)}</span>
                    <span className="text-warning/70">@ ₳{r.hardPeg?.toFixed(2)}</span>
                    <button
                      onClick={() => handleUnpeg(r.commodity)}
                      className="ml-1 hover:text-error transition-colors"
                    >
                      ✕
                    </button>
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-card-border">
        {(["global", "regional"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab === "global" ? "Global" : "Regional"}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      {summary && activeTab === "global" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              label: "Shortage",
              value: String(summary.shortageCount),
              highlight: summary.shortageCount > 0,
            },
            { label: "Balanced", value: String(summary.balancedCount) },
            { label: "Surplus", value: String(summary.surplusCount) },
            {
              label: "Worst Raw Shortage",
              value: summary.worstShortage
                ? `${commodityLabel(summary.worstShortage.commodity)} (${summary.worstShortage.dsRatio.toFixed(2)})`
                : "None",
              highlight: !!summary.worstShortage,
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-card-border bg-card p-4 space-y-1"
            >
              <p className="text-xs text-muted uppercase tracking-wider">{card.label}</p>
              <p
                className={`text-lg font-semibold ${card.highlight ? "text-error" : "text-foreground"}`}
              >
                {card.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {summary && summary.nudgeCount > 0 && activeTab === "global" && (
        <p className="text-xs text-warning bg-warning/10 rounded-lg px-4 py-2">
          {summary.nudgeCount} price override{summary.nudgeCount !== 1 ? "s" : ""} active this turn
        </p>
      )}

      {error && <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{error}</p>}
      {actionError && (
        <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{actionError}</p>
      )}

      {/* ── Global tab ── */}
      {activeTab === "global" && (
        <>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <button
              onClick={() => setSortAlpha((v) => !v)}
              className="text-xs px-3 py-1.5 rounded border border-card-border hover:bg-background/60 transition-colors"
            >
              {sortAlpha ? "Sort: Alphabetical" : "Sort: Worst Shortage First"}
            </button>
          </div>

          {loading ? (
            <div className="text-muted text-sm py-8 text-center">Loading…</div>
          ) : (
            <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-background/50">
                    <tr>
                      {[
                        "Commodity",
                        "Base Price",
                        "Global Price",
                        "Change",
                        "Trend",
                        "Supply",
                        "Demand",
                        "Raw D/S",
                        "Actions",
                      ].map((h) => (
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
                    {sorted.map((row) => {
                      const ns = nudgeState[row.commodity];
                      const ps = pegState[row.commodity];
                      return (
                        <React.Fragment key={row.commodity}>
                          <tr className="hover:bg-background/40 transition-colors duration-150">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{commodityLabel(row.commodity)}</span>
                                {row.nudgeActive && (
                                  <span className="text-[10px] font-semibold bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                                    Override
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted">₳{row.basePrice.toFixed(2)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span>₳{(row.globalPrice ?? 0).toFixed(2)}</span>
                                {row.hardPeg != null && (
                                  <span className="text-[10px] font-semibold uppercase bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                                    Pegged
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={
                                  row.priceChangePct > 0
                                    ? "text-success"
                                    : row.priceChangePct < 0
                                      ? "text-error"
                                      : "text-muted"
                                }
                              >
                                {row.priceChangePct > 0 ? "+" : ""}
                                {row.priceChangePct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <PriceSparkline history={row.history} />
                            </td>
                            <td className="px-4 py-3">
                              {row.globalSupply.toLocaleString("en-US")}
                            </td>
                            <td className="px-4 py-3">
                              {row.globalDemand.toLocaleString("en-US")}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded ${dsPillClass(row.dsRatio)}`}
                                title="Raw demand/supply ratio. Prices and margin effects use a softened effective pressure above 3x."
                              >
                                {row.dsRatio.toFixed(2)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1">
                                <button
                                  onClick={() => openNudge(row.commodity)}
                                  className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
                                >
                                  {ns ? "Close" : "Nudge"}
                                </button>
                                {row.hardPeg != null ? (
                                  <button
                                    onClick={() => handleUnpeg(row.commodity)}
                                    disabled={actionLoading === row.commodity}
                                    className="text-xs px-2 py-1 rounded border border-error/40 text-error hover:bg-error/10 transition-colors"
                                  >
                                    Unpeg
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => openPeg(row.commodity)}
                                    className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
                                  >
                                    {ps ? "Close" : "Peg"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Inline nudge panel */}
                          {ns && (
                            <tr>
                              <td
                                colSpan={9}
                                className="px-4 py-3 bg-warning/5 border-t border-warning/20"
                              >
                                {ns.step === "input" ? (
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <span className="text-xs text-muted">
                                      Nudge global price to:
                                    </span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      value={ns.price}
                                      onChange={(e) =>
                                        setNudgeState((prev) => ({
                                          ...prev,
                                          [row.commodity]: {
                                            ...prev[row.commodity],
                                            price: e.target.value,
                                          },
                                        }))
                                      }
                                      placeholder={(row.globalPrice ?? 0).toFixed(2)}
                                      className="w-32 rounded border border-card-border bg-background px-2 py-1 text-sm"
                                    />
                                    <button
                                      onClick={() =>
                                        setNudgeState((prev) => ({
                                          ...prev,
                                          [row.commodity]: {
                                            ...prev[row.commodity],
                                            step: "confirm",
                                          },
                                        }))
                                      }
                                      disabled={!ns.price}
                                      className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground hover:opacity-90 disabled:opacity-40"
                                    >
                                      Review
                                    </button>
                                    <button
                                      onClick={() => openNudge(row.commodity)}
                                      className="text-xs text-muted hover:text-foreground"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-xs text-warning">
                                      Nudge sets the price once. Subsequent turns drift gradually
                                      back toward supply/demand equilibrium (~48 turns to converge).
                                    </p>
                                    <div className="flex items-center gap-3">
                                      <span className="text-sm">
                                        Nudge <strong>{commodityLabel(row.commodity)}</strong> to{" "}
                                        <strong>₳{ns.price}</strong>?
                                      </span>
                                      <button
                                        onClick={() =>
                                          handleNudgeConfirm(row.commodity, parseFloat(ns.price))
                                        }
                                        disabled={actionLoading === row.commodity}
                                        className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground font-medium hover:opacity-90"
                                      >
                                        Confirm
                                      </button>
                                      <button
                                        onClick={() =>
                                          setNudgeState((prev) => ({
                                            ...prev,
                                            [row.commodity]: {
                                              ...prev[row.commodity],
                                              step: "input",
                                            },
                                          }))
                                        }
                                        className="text-xs text-muted hover:text-foreground"
                                      >
                                        Back
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}

                          {/* Inline peg panel */}
                          {ps && (
                            <tr>
                              <td
                                colSpan={9}
                                className="px-4 py-3 bg-warning/5 border-t border-warning/20"
                              >
                                {ps.step === "input" ? (
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <span className="text-xs text-muted">Peg global price at:</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      value={ps.price}
                                      onChange={(e) =>
                                        setPegState((prev) => ({
                                          ...prev,
                                          [row.commodity]: {
                                            ...prev[row.commodity],
                                            price: e.target.value,
                                          },
                                        }))
                                      }
                                      placeholder={(row.globalPrice ?? 0).toFixed(2)}
                                      className="w-32 rounded border border-card-border bg-background px-2 py-1 text-sm"
                                    />
                                    <button
                                      onClick={() =>
                                        setPegState((prev) => ({
                                          ...prev,
                                          [row.commodity]: {
                                            ...prev[row.commodity],
                                            step: "confirm",
                                          },
                                        }))
                                      }
                                      disabled={!ps.price}
                                      className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground hover:opacity-90 disabled:opacity-40"
                                    >
                                      Review
                                    </button>
                                    <button
                                      onClick={() => openPeg(row.commodity)}
                                      className="text-xs text-muted hover:text-foreground"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-xs text-warning">
                                      Hard peg locks the price permanently until removed.
                                      Supply/demand drift is completely bypassed. When removed, the
                                      price drifts gradually back toward equilibrium (~48 turns).
                                    </p>
                                    <div className="flex items-center gap-3">
                                      <span className="text-sm">
                                        Peg <strong>{commodityLabel(row.commodity)}</strong> at{" "}
                                        <strong>₳{ps.price}</strong>?
                                      </span>
                                      <button
                                        onClick={() =>
                                          handlePegConfirm(row.commodity, parseFloat(ps.price))
                                        }
                                        disabled={actionLoading === row.commodity}
                                        className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground font-medium hover:opacity-90"
                                      >
                                        Confirm Peg
                                      </button>
                                      <button
                                        onClick={() =>
                                          setPegState((prev) => ({
                                            ...prev,
                                            [row.commodity]: {
                                              ...prev[row.commodity],
                                              step: "input",
                                            },
                                          }))
                                        }
                                        className="text-xs text-muted hover:text-foreground"
                                      >
                                        Back
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-muted">
                          No commodity data found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Regional tab ── */}
      {activeTab === "regional" && (
        <>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-muted mb-1">Country</label>
              <select
                value={regionCountry}
                onChange={(e) => {
                  const c = e.target.value;
                  setRegionCountry(c);
                  setRegionState("");
                  setRegionalData([]);
                  setRegionalMode(null);
                  fetchStatesForCountry(c);
                  if (c) fetchRegionalData(c);
                }}
                className="rounded border border-card-border bg-background px-3 py-1.5 text-sm"
              >
                <option value="">Select country</option>
                {registered.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">State / Region</label>
              <select
                value={regionState}
                onChange={(e) => {
                  setRegionState(e.target.value);
                  if (e.target.value) {
                    fetchRegionalData(regionCountry, e.target.value);
                  } else if (regionCountry) {
                    fetchRegionalData(regionCountry);
                  }
                }}
                disabled={!regionCountry}
                className="rounded border border-card-border bg-background px-3 py-1.5 text-sm disabled:opacity-40"
              >
                <option value="">Select state</option>
                {regionStates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Peg All in Country inline panel */}
          {regionCountry && (
            <div className="flex items-center gap-2 flex-wrap">
              {!countryPeg ? (
                <button
                  onClick={() => setCountryPeg({ commodity: "", price: "", step: "input" })}
                  className="text-xs px-3 py-1.5 rounded border border-warning/40 text-warning hover:bg-warning/10 transition-colors"
                >
                  Peg All in {regionCountry}
                </button>
              ) : countryPeg.step === "input" ? (
                <div className="flex items-center gap-3 flex-wrap rounded-lg bg-warning/5 border border-warning/20 px-4 py-3">
                  <span className="text-xs text-muted">Commodity:</span>
                  <select
                    value={countryPeg.commodity}
                    onChange={(e) => setCountryPeg({ ...countryPeg, commodity: e.target.value })}
                    className="rounded border border-card-border bg-background px-2 py-1 text-sm"
                  >
                    <option value="">Select</option>
                    {(regionalData.length > 0 ? regionalData : commodities).map((r) => (
                      <option key={r.commodity} value={r.commodity}>
                        {commodityLabel(r.commodity)}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted">Price:</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={countryPeg.price}
                    onChange={(e) => setCountryPeg({ ...countryPeg, price: e.target.value })}
                    placeholder="e.g. 500"
                    className="w-28 rounded border border-card-border bg-background px-2 py-1 text-sm"
                  />
                  <button
                    onClick={() => setCountryPeg({ ...countryPeg, step: "confirm" })}
                    disabled={!countryPeg.commodity || !countryPeg.price}
                    className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground hover:opacity-90 disabled:opacity-40"
                  >
                    Review
                  </button>
                  <button
                    onClick={() => setCountryPeg(null)}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-wrap rounded-lg bg-warning/5 border border-warning/20 px-4 py-3">
                  <span className="text-sm">
                    Peg <strong>{commodityLabel(countryPeg.commodity)}</strong> at{" "}
                    <strong>₳{countryPeg.price}</strong> for all states in{" "}
                    <strong>{regionCountry}</strong>? This locks every state&apos;s price until
                    individually removed.
                  </span>
                  <button
                    onClick={() =>
                      handleCountryPeg(countryPeg.commodity, parseFloat(countryPeg.price))
                    }
                    disabled={actionLoading === countryPeg.commodity}
                    className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground font-medium hover:opacity-90"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setCountryPeg({ ...countryPeg, step: "input" })}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    Back
                  </button>
                </div>
              )}
            </div>
          )}

          {regionalLoading && <div className="text-muted text-sm py-8 text-center">Loading…</div>}

          {!regionalLoading && regionalData.length > 0 && (
            <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
              {regionalMode === "country" && (
                <div className="px-5 py-2.5 border-b border-card-border bg-background/30">
                  <p className="text-xs text-muted">
                    Showing averages across all regions in <strong>{regionCountry}</strong>. Select
                    a state for per-region detail.
                  </p>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-background/50">
                    <tr>
                      {[
                        "Commodity",
                        regionalMode === "country" ? "Avg Price" : "State Price",
                        "Global Price",
                        "Change",
                        "Trend",
                        "Supply",
                        "Demand",
                        "Raw D/S",
                        ...(regionalMode === "state" ? ["Actions"] : []),
                      ].map((h) => (
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
                    {regionalData.map((row) =>
                      regionalMode === "state" ? (
                        <RegionalCommodityRow
                          key={row.commodity}
                          row={row}
                          actionLoading={actionLoading}
                          onPeg={(price) => handleStatePeg(row.commodity, regionState, price)}
                          onUnpeg={() => handleStateUnpeg(row.commodity, regionState)}
                          onNudge={(price) => handleStateNudge(row.commodity, regionState, price)}
                        />
                      ) : (
                        <tr
                          key={row.commodity}
                          className="hover:bg-background/40 transition-colors duration-150"
                        >
                          <td className="px-4 py-3">
                            <span className="font-medium">{commodityLabel(row.commodity)}</span>
                          </td>
                          <td className="px-4 py-3">₳{row.price.toFixed(2)}</td>
                          <td className="px-4 py-3 text-muted">
                            ₳{(row.globalPrice ?? 0).toFixed(2)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={
                                row.changeFromGlobal > 0.5
                                  ? "text-success"
                                  : row.changeFromGlobal < -0.5
                                    ? "text-error"
                                    : "text-muted"
                              }
                            >
                              {row.changeFromGlobal > 0 ? "+" : ""}
                              {row.changeFromGlobal.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <PriceSparkline history={row.history} />
                          </td>
                          <td className="px-4 py-3">{row.supply.toLocaleString("en-US")}</td>
                          <td className="px-4 py-3">{row.demand.toLocaleString("en-US")}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-xs font-semibold px-2 py-0.5 rounded ${dsPillClass(row.dsRatio)}`}
                              title="Raw demand/supply ratio. Prices and margin effects use a softened effective pressure above 3x."
                            >
                              {row.dsRatio.toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!regionalLoading && regionalData.length === 0 && regionCountry && (
            <div className="text-muted text-sm py-8 text-center">
              No commodity data for this selection.
            </div>
          )}

          {!regionCountry && (
            <div className="text-muted text-sm py-8 text-center">
              Select a country to view regional commodity prices.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Regional row sub-component ──

function RegionalCommodityRow({
  row,
  actionLoading,
  onPeg,
  onUnpeg,
  onNudge,
}: {
  row: RegionalRow;
  actionLoading: string | null;
  onPeg: (price: number) => void;
  onUnpeg: () => void;
  onNudge: (price: number) => void;
}) {
  const [panel, setPanel] = useState<"nudge" | "peg" | null>(null);
  const [inputPrice, setInputPrice] = useState("");
  const [step, setStep] = useState<"input" | "confirm">("input");

  const isPegged = row.hardPegged;
  const hasGlobalPeg = row.globalPegged;

  return (
    <React.Fragment>
      <tr className="hover:bg-background/40 transition-colors duration-150">
        <td className="px-4 py-3">
          <span className="font-medium">{commodityLabel(row.commodity)}</span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span>₳{row.price.toFixed(2)}</span>
            {isPegged && (
              <span className="text-[10px] font-semibold uppercase bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                Pegged
              </span>
            )}
            {!isPegged && hasGlobalPeg && (
              <span className="text-[10px] font-semibold uppercase bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                Global Peg
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-muted">₳{(row.globalPrice ?? 0).toFixed(2)}</td>
        <td className="px-4 py-3">
          <span
            className={
              row.changeFromGlobal > 0.5
                ? "text-success"
                : row.changeFromGlobal < -0.5
                  ? "text-error"
                  : "text-muted"
            }
          >
            {row.changeFromGlobal > 0 ? "+" : ""}
            {row.changeFromGlobal.toFixed(1)}%
          </span>
        </td>
        <td className="px-4 py-3">
          <PriceSparkline history={row.history} />
        </td>
        <td className="px-4 py-3">{row.supply.toLocaleString("en-US")}</td>
        <td className="px-4 py-3">{row.demand.toLocaleString("en-US")}</td>
        <td className="px-4 py-3">
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded ${dsPillClass(row.dsRatio)}`}
            title="Raw demand/supply ratio. Prices and margin effects use a softened effective pressure above 3x."
          >
            {row.dsRatio.toFixed(2)}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-1">
            <button
              onClick={() => {
                setPanel(panel === "nudge" ? null : "nudge");
                setStep("input");
                setInputPrice("");
              }}
              className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
            >
              Nudge
            </button>
            {isPegged ? (
              <button
                onClick={onUnpeg}
                disabled={actionLoading === row.commodity}
                className="text-xs px-2 py-1 rounded border border-error/40 text-error hover:bg-error/10 transition-colors"
              >
                Unpeg
              </button>
            ) : (
              <button
                onClick={() => {
                  setPanel(panel === "peg" ? null : "peg");
                  setStep("input");
                  setInputPrice("");
                }}
                className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
              >
                Peg
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Inline nudge/peg panel */}
      {panel && (
        <tr>
          <td colSpan={9} className="px-4 py-3 bg-warning/5 border-t border-warning/20">
            {hasGlobalPeg && panel === "peg" && (
              <p className="text-xs text-warning mb-2">
                A global peg is active for {commodityLabel(row.commodity)} at ₳
                {row.globalPegPrice?.toFixed(2)}. Setting a state peg will override it for this
                state.
              </p>
            )}
            {step === "input" ? (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-muted">
                  {panel === "nudge" ? "Nudge state price to:" : "Peg state price at:"}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={inputPrice}
                  onChange={(e) => setInputPrice(e.target.value)}
                  placeholder={row.price.toFixed(2)}
                  className="w-32 rounded border border-card-border bg-background px-2 py-1 text-sm"
                />
                <button
                  onClick={() => setStep("confirm")}
                  disabled={!inputPrice}
                  className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground hover:opacity-90 disabled:opacity-40"
                >
                  Review
                </button>
                <button
                  onClick={() => setPanel(null)}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm">
                  {panel === "nudge" ? "Nudge" : "Peg"}{" "}
                  <strong>{commodityLabel(row.commodity)}</strong> in this state to{" "}
                  <strong>₳{inputPrice}</strong>?{panel === "nudge" && " Drift resumes next turn."}
                  {panel === "peg" && " Locked until removed."}
                </span>
                <button
                  onClick={() => {
                    const price = parseFloat(inputPrice);
                    if (panel === "nudge") onNudge(price);
                    else onPeg(price);
                    setPanel(null);
                  }}
                  disabled={actionLoading === row.commodity}
                  className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground font-medium hover:opacity-90"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setStep("input")}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Back
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}
