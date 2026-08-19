"use client";

import { useCallback, useEffect, useState } from "react";
import { COMMODITY_TYPES, COMMODITY_LABELS, type CommodityType } from "@/lib/constants/commodities";
import { SUPPLY_AGREEMENT_PRICE_BAND } from "@/lib/db/types/supplyAgreement";
import { useToast } from "@/contexts/ToastContext";

interface SupplyAgreement {
  _id: string;
  supplierCorpId: string;
  buyerCorpId: string;
  commodity: CommodityType;
  volumeCap: number;
  pricePremium: number;
  status: "pending" | "active" | "cancelled";
  proposedByCorpId: string;
}

interface CorpSearchResult {
  id: string;
  name: string;
  ticker: string | null;
  /** Home country of the buyer — shown so foreign counterparties are legible. */
  countryId: string | null;
}

const BAND_PCT = Math.round(SUPPLY_AGREEMENT_PRICE_BAND * 100);

/** Fraction premium → signed percent string, e.g. 0.2 → "+20%", -0.1 → "−10%". */
function fmtPremium(fraction: number): string {
  const pct = Math.round(fraction * 100);
  if (pct === 0) return "at market";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

const STATUS_STYLES: Record<SupplyAgreement["status"], string> = {
  pending: "border-warning/40 bg-warning/10 text-warning",
  active: "border-success/40 bg-success/10 text-success",
  cancelled: "border-card-border bg-card-elevated text-muted",
};

/**
 * CEO-only panel for private supply agreements — bilateral off-market commodity
 * contracts. Lists the corp's agreements grouped by role (as supplier / as
 * buyer) and lets the supplier CEO propose a new one. Gated upstream on
 * `supplyAgreementsEnabled`; only mounted for the corp's CEO.
 */
export default function SupplyAgreementsSection({
  corpId,
}: {
  corpId: string;
  /**
   * Home country of the corp. Retained for call-site compatibility; the buyer
   * search is now global (any player-run corp), so it no longer scopes search.
   */
  countryId?: string;
}) {
  const { showToast } = useToast();
  const [agreements, setAgreements] = useState<SupplyAgreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  // Propose form state
  const [buyerQuery, setBuyerQuery] = useState("");
  const [buyerResults, setBuyerResults] = useState<CorpSearchResult[]>([]);
  const [selectedBuyer, setSelectedBuyer] = useState<CorpSearchResult | null>(null);
  const [commodity, setCommodity] = useState<CommodityType>(COMMODITY_TYPES[0]);
  const [volumeCap, setVolumeCap] = useState("");
  const [premiumPct, setPremiumPct] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/corporations/${corpId}/supply-agreements`);
      if (res.ok) {
        const data = (await res.json()) as { agreements: SupplyAgreement[] };
        setAgreements(data.agreements ?? []);
      }
    } catch {
      // ignore — render empty state
    } finally {
      setLoading(false);
    }
  }, [corpId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced buyer search — player-run private corps across all countries, so
  // the supplier can contract with a foreign player-owned corp (#106).
  useEffect(() => {
    if (selectedBuyer || buyerQuery.trim().length < 2) {
      setBuyerResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/corporations/buyer-search?q=${encodeURIComponent(buyerQuery.trim())}&exclude=${corpId}`
        );
        if (res.ok) {
          const data = (await res.json()) as { results: CorpSearchResult[] };
          setBuyerResults((data.results ?? []).filter((r) => r.id !== corpId));
        }
      } catch {
        // ignore
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [buyerQuery, selectedBuyer, corpId]);

  async function handleAction(agreementId: string, action: "accept" | "cancel") {
    setBusyId(agreementId);
    try {
      const res = await fetch(`/api/corporations/${corpId}/supply-agreements/${agreementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(action === "accept" ? "Agreement accepted" : "Agreement cancelled", "success");
        await load();
      } else {
        showToast(data.error || "Action failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBuyer) {
      showToast("Select a buyer corporation", "error");
      return;
    }
    const cap = Number(volumeCap);
    if (!(cap > 0)) {
      showToast("Volume cap must be a positive number", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/corporations/${corpId}/supply-agreements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerCorpId: selectedBuyer.id,
          commodity,
          volumeCap: cap,
          pricePremium: premiumPct / 100,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast("Agreement proposed", "success");
        // Reset form
        setBuyerQuery("");
        setSelectedBuyer(null);
        setVolumeCap("");
        setPremiumPct(0);
        setShowForm(false);
        await load();
      } else {
        showToast(data.error || "Failed to propose agreement", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setSubmitting(false);
    }
  }

  // Cancelled agreements are kept in the record but hidden from the default view
  // so a rejected/expired deal doesn't permanently clutter the panel. A toggle
  // reveals them when the CEO wants the history.
  const cancelledCount = agreements.filter((a) => a.status === "cancelled").length;
  const visible = showCancelled ? agreements : agreements.filter((a) => a.status !== "cancelled");
  const asSupplier = visible.filter((a) => a.supplierCorpId === corpId);
  const asBuyer = visible.filter((a) => a.buyerCorpId === corpId);

  function renderAgreement(a: SupplyAgreement, role: "supplier" | "buyer") {
    const canAccept = role === "buyer" && a.status === "pending";
    const canCancel = a.status === "pending" || a.status === "active";
    return (
      <div key={a._id} className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{COMMODITY_LABELS[a.commodity]}</p>
            <p className="text-xs text-muted">
              {role === "supplier" ? "Supplying to buyer" : "Buying from supplier"}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[a.status]}`}
          >
            {a.status}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            Volume cap:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {a.volumeCap.toLocaleString("en-US")}/turn
            </span>
          </span>
          <span>
            Price: <span className="font-medium text-foreground">{fmtPremium(a.pricePremium)}</span>
          </span>
        </div>

        {(canAccept || canCancel) && (
          <div className="flex flex-wrap gap-2 border-t border-card-border pt-3">
            {canAccept && (
              <button
                type="button"
                disabled={busyId === a._id}
                onClick={() => handleAction(a._id, "accept")}
                className="rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-success/90 disabled:opacity-50"
              >
                {busyId === a._id ? "Working…" : "Accept"}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                disabled={busyId === a._id}
                onClick={() => handleAction(a._id, "cancel")}
                className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
              >
                {busyId === a._id ? "Working…" : "Cancel"}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card-elevated p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted">
            Supply Agreements
          </h2>
          <p className="mt-1 text-xs text-muted max-w-lg">
            Private off-market commodity contracts. As supplier, propose a deal; the buyer&apos;s
            CEO must accept. Either party can cancel.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
        >
          {showForm ? "Close" : "Propose agreement"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handlePropose}
          className="rounded-xl border border-card-border bg-card p-4 space-y-4"
        >
          {/* Buyer picker */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Buyer corporation</label>
            {selectedBuyer ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-card-elevated px-3 py-2">
                <span className="text-sm text-foreground truncate">
                  {selectedBuyer.name}
                  {selectedBuyer.countryId ? ` · ${selectedBuyer.countryId}` : ""}
                  {selectedBuyer.ticker ? ` (${selectedBuyer.ticker})` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBuyer(null);
                    setBuyerQuery("");
                  }}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={buyerQuery}
                  onChange={(e) => setBuyerQuery(e.target.value)}
                  placeholder="Search corporations by name…"
                  className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
                />
                {buyerResults.length > 0 && (
                  <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-card-border bg-card">
                    {buyerResults.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBuyer(r);
                            setBuyerResults([]);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-card-elevated"
                        >
                          <span className="truncate">{r.name}</span>
                          <span className="shrink-0 text-xs text-muted">
                            {[r.countryId, r.ticker].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted">
                  Any player-run corporation, including foreign ones, can be a counterparty.
                </p>
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Commodity */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Commodity</label>
              <select
                value={commodity}
                onChange={(e) => setCommodity(e.target.value as CommodityType)}
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {COMMODITY_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {COMMODITY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            {/* Volume cap */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Volume cap (per turn)</label>
              <input
                type="number"
                min={1}
                value={volumeCap}
                onChange={(e) => setVolumeCap(e.target.value)}
                placeholder="e.g. 5000"
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
              />
              <p className="text-[11px] text-muted">
                Units/day reserved for the buyer. Anything your sectors make above this still sells
                on the open market as normal.
              </p>
            </div>
          </div>

          {/* Price premium */}
          <div className="space-y-1">
            <label className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span>Contract price</span>
              <span className="tabular-nums text-primary">{fmtPremium(premiumPct / 100)}</span>
            </label>
            <input
              type="range"
              min={-BAND_PCT}
              max={BAND_PCT}
              step={1}
              value={premiumPct}
              onChange={(e) => setPremiumPct(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-[11px] text-muted">
              At most ±{BAND_PCT}% of market price. Positive favours the supplier; negative favours
              the buyer.
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Proposing…" : "Propose agreement"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading agreements…</p>
      ) : agreements.length === 0 ? (
        <p className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
          No supply agreements yet. Propose one to lock in an off-market commodity deal.
        </p>
      ) : (
        <div className="space-y-6">
          {asSupplier.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">As supplier</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {asSupplier.map((a) => renderAgreement(a, "supplier"))}
              </div>
            </div>
          )}
          {asBuyer.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">As buyer</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {asBuyer.map((a) => renderAgreement(a, "buyer"))}
              </div>
            </div>
          )}
          {asSupplier.length === 0 && asBuyer.length === 0 && (
            <p className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
              No active agreements. {cancelledCount > 0 && "Cancelled deals are hidden."}
            </p>
          )}
          {cancelledCount > 0 && (
            <button
              type="button"
              onClick={() => setShowCancelled((v) => !v)}
              className="text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              {showCancelled ? "Hide cancelled" : `Show cancelled (${cancelledCount})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
