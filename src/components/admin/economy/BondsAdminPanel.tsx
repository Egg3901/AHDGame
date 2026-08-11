"use client";

import React, { useState, useEffect, useCallback } from "react";

interface BondRow {
  id: string;
  issuerName: string;
  countryId: string | null;
  /**
   * Canonical bond denomination (`bond.currencyCode`, post-Task-18B). Used to
   * render per-row `faceValue` with the right currency symbol — pre-fix the
   * admin panel slapped `$` on every value regardless of actual denomination.
   */
  currencyCode: string | null;
  issuerType: string;
  faceValue: number;
  marketPrice: number;
  couponRate: number;
  publicFloat: number;
  holderCount: number;
  turnsToMaturity: number;
  matured: boolean;
  defaulted: boolean;
}

interface Summary {
  activeBonds: number;
  sovereignCount: number;
  corporateCount: number;
  /** `totalOutstanding` + `annualCouponBurden` are now anchor-normalized (₳) per A18. */
  totalOutstanding: number;
  annualCouponBurden: number;
  maturingNext12t: number;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  GBP: "£",
  JPY: "¥",
  CAD: "C$",
  EUR: "€",
};

/**
 * Scale + format a numeric value with an explicit currency prefix. Accepts the
 * currency code so per-bond rows (LOCAL in `bond.currencyCode`) and ₳-normalized
 * aggregates (summary cards) both render correctly. Pre-fix this helper was
 * hardcoded to `$` — JPY ¥22M bonds were displayed as "$22,000,000" in the UI.
 */
function fmt(n: number, code?: string | null): string {
  const prefix = code ? (CURRENCY_SYMBOL[code] ?? `${code} `) : "₳";
  if (Math.abs(n) >= 1_000_000_000) return `${prefix}${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${prefix}${(n / 1_000).toFixed(1)}K`;
  return `${prefix}${n.toFixed(2)}`;
}

const COUNTRY_PILLS = [
  { id: "", label: "All" },
  { id: "US", label: "US" },
  { id: "UK", label: "UK" },
  { id: "JP", label: "JP" },
  { id: "DE", label: "DE" },
];

export function BondsAdminPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [bonds, setBonds] = useState<BondRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"" | "sovereign" | "corporate">("");
  const [countryFilter, setCountryFilter] = useState("");
  const [currentTurn, setCurrentTurn] = useState(0);

  // Per-row rate override state
  const [rateEdit, setRateEdit] = useState<{
    id: string;
    step: "input" | "confirm";
    value: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Reconcile state
  const [reconcileCountry, setReconcileCountry] = useState("US");
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<{
    success: boolean;
    gap: number;
    totalIssued: number;
    budgetInterestDelta: number;
    newPrincipal: number;
    newDebtInterest: number;
    newSurplus: number;
    newCreditRating: string;
    tranches: Array<{
      maturityTurns: number;
      issueAmount: number;
      couponRate: number;
      annualCouponCost: number;
    }>;
    message: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (typeFilter) qs.set("type", typeFilter);
      if (countryFilter) qs.set("countryId", countryFilter);
      const res = await fetch(`/api/admin/bonds?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSummary(json.summary);
      setBonds(json.bonds);
      setCurrentTurn(json.currentTurn);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, countryFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRateConfirm = async (bondId: string, rate: number) => {
    setActionLoading(bondId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/bonds/${bondId}/rate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ couponRate: rate }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRateEdit(null);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReconcile = async () => {
    setReconcileLoading(true);
    setActionError(null);
    setReconcileResult(null);
    try {
      const res = await fetch("/api/admin/bonds/reconcile-sovereign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryId: reconcileCountry }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setReconcileResult(json);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Reconcile failed");
    } finally {
      setReconcileLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Bonds</h2>
        <div className="flex flex-wrap gap-2">
          {(["", "sovereign", "corporate"] as const).map((t) => (
            <button
              key={t || "all"}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                typeFilter === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-card-border text-muted hover:text-foreground"
              }`}
            >
              {t === "" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          <span className="text-muted text-xs self-center">·</span>
          {COUNTRY_PILLS.map((pill) => (
            <button
              key={pill.id || "all-c"}
              onClick={() => setCountryFilter(pill.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                countryFilter === pill.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-card-border text-muted hover:text-foreground"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reconcile sovereign debt */}
      <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">Reconcile Sovereign Debt</span>
            <select
              value={reconcileCountry}
              onChange={(e) => setReconcileCountry(e.target.value)}
              className="rounded border border-card-border bg-background px-2 py-1 text-sm"
            >
              {COUNTRY_PILLS.filter((c) => c.id).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleReconcile}
            disabled={reconcileLoading}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {reconcileLoading ? "Reconciling…" : "Reconcile"}
          </button>
        </div>
        {reconcileResult && (
          <div className="space-y-2">
            <p
              className={`text-sm ${reconcileResult.totalIssued > 0 ? "text-success" : "text-muted"}`}
            >
              {reconcileResult.message}
            </p>
            {reconcileResult.totalIssued > 0 && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  {[
                    { label: "Gap", value: fmt(reconcileResult.gap) },
                    { label: "Issued", value: fmt(reconcileResult.totalIssued) },
                    { label: "New Interest", value: fmt(reconcileResult.budgetInterestDelta) },
                    { label: "New Principal", value: fmt(reconcileResult.newPrincipal) },
                  ].map((c) => (
                    <div
                      key={c.label}
                      className="rounded-lg border border-card-border bg-background/60 p-2"
                    >
                      <p className="text-[10px] text-muted uppercase tracking-wider">{c.label}</p>
                      <p className="font-semibold text-foreground">{c.value}</p>
                    </div>
                  ))}
                </div>
                <div className="text-sm space-y-1">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                    Tranches
                  </p>
                  <div className="grid gap-2">
                    {reconcileResult.tranches.map((t) => (
                      <div
                        key={t.maturityTurns}
                        className="flex items-center justify-between rounded border border-card-border bg-background/60 px-3 py-2"
                      >
                        <span className="text-muted">{t.maturityTurns}t maturity</span>
                        <span className="font-medium">
                          {fmt(t.issueAmount)} @ {t.couponRate.toFixed(2)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              label: "Active Bonds",
              value: `${summary.activeBonds} (${summary.sovereignCount}S / ${summary.corporateCount}C)`,
            },
            // Aggregates are anchor-normalized (₳) — omit the currency code
            // so fmt() prefixes ₳ rather than a native-currency symbol.
            { label: "Total Outstanding (₳)", value: fmt(summary.totalOutstanding) },
            { label: "Annual Coupon Burden (₳)", value: fmt(summary.annualCouponBurden) },
            {
              label: "Maturing Next 12t",
              value: String(summary.maturingNext12t),
              highlight: summary.maturingNext12t > 0,
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-card-border bg-card p-4 space-y-1"
            >
              <p className="text-xs text-muted uppercase tracking-wider">{card.label}</p>
              <p
                className={`text-lg font-semibold ${card.highlight ? "text-warning" : "text-foreground"}`}
              >
                {card.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{error}</p>}
      {actionError && (
        <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{actionError}</p>
      )}

      {loading ? (
        <div className="text-muted text-sm py-8 text-center">Loading…</div>
      ) : (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr>
                  {[
                    "Issuer",
                    "Type",
                    "Face Value",
                    "Market Price",
                    "Coupon %",
                    "Float",
                    "Holders",
                    "Turns to Maturity",
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
                {bonds.map((row) => (
                  <React.Fragment key={row.id}>
                    <tr className="hover:bg-background/40 transition-colors duration-150">
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.issuerName}</div>
                        {row.countryId && <div className="text-xs text-muted">{row.countryId}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            row.issuerType === "sovereign"
                              ? "bg-primary/20 text-primary"
                              : "bg-muted/20 text-muted"
                          }`}
                        >
                          {row.issuerType}
                        </span>
                      </td>
                      <td className="px-4 py-3">{fmt(row.faceValue, row.currencyCode)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            row.marketPrice >= 1.0
                              ? "text-primary"
                              : row.marketPrice < 0.85
                                ? "text-error"
                                : "text-warning"
                          }
                        >
                          {row.marketPrice.toFixed(3)}
                        </span>
                      </td>
                      <td className="px-4 py-3">{row.couponRate.toFixed(2)}%</td>
                      <td className="px-4 py-3">{row.publicFloat.toLocaleString("en-US")}</td>
                      <td className="px-4 py-3">{row.holderCount}</td>
                      <td className="px-4 py-3">
                        {row.matured ? (
                          <span className="text-[10px] font-semibold bg-error/20 text-error px-1.5 py-0.5 rounded">
                            Matured
                          </span>
                        ) : (
                          <span
                            className={row.turnsToMaturity <= 12 ? "text-warning font-medium" : ""}
                          >
                            {row.turnsToMaturity}t
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() =>
                            setRateEdit(
                              rateEdit?.id === row.id
                                ? null
                                : { id: row.id, step: "input", value: String(row.couponRate) }
                            )
                          }
                          className="text-xs px-2 py-1 rounded border border-warning/40 text-warning hover:bg-warning/10 transition-colors"
                        >
                          Override Rate
                        </button>
                      </td>
                    </tr>

                    {/* Inline rate override */}
                    {rateEdit?.id === row.id && (
                      <tr key={`${row.id}-rate`}>
                        <td
                          colSpan={9}
                          className="px-4 py-3 bg-warning/5 border-t border-warning/20"
                        >
                          {rateEdit.step === "input" ? (
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-xs text-muted">New coupon rate (%):</span>
                              <input
                                type="number"
                                step="0.1"
                                min={0}
                                max={100}
                                value={rateEdit.value}
                                onChange={(e) =>
                                  setRateEdit({ ...rateEdit, value: e.target.value })
                                }
                                className="w-24 rounded border border-card-border bg-background px-2 py-1 text-sm"
                              />
                              <button
                                onClick={() => setRateEdit({ ...rateEdit, step: "confirm" })}
                                className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground hover:opacity-90"
                              >
                                Review
                              </button>
                              <button
                                onClick={() => setRateEdit(null)}
                                className="text-xs text-muted hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-sm">
                                Set coupon rate for <strong>{row.issuerName}</strong> to{" "}
                                <strong>{rateEdit.value}%</strong>? This is permanent.
                              </span>
                              <button
                                onClick={() =>
                                  handleRateConfirm(row.id, parseFloat(rateEdit.value))
                                }
                                disabled={actionLoading === row.id}
                                className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground font-medium hover:opacity-90"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setRateEdit({ ...rateEdit, step: "input" })}
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
                ))}
                {bonds.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted">
                      No bonds found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {currentTurn > 0 && (
            <div className="border-t border-card-border bg-background/30 px-4 py-2 text-xs text-muted">
              Current turn: {currentTurn}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
