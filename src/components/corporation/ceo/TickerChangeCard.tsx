"use client";

import { useState } from "react";
import type { CorporationDetail } from "../CorporationPageTypes";

export function TickerChangeCard({
  corporation,
  corpId,
  onRefresh,
}: {
  corporation: CorporationDetail;
  corpId: string;
  onRefresh: () => void;
}) {
  const [ticker, setTicker] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function handleTickerInput(val: string) {
    setTicker(
      val
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 5)
    );
    setError("");
    setSuccess("");
  }

  async function handleChange() {
    if (!ticker || ticker === corporation.tickerSymbol) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/ticker`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTicker: ticker }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Failed to change ticker");
        return;
      }
      setSuccess(`Ticker changed to ${(data as { tickerSymbol: string }).tickerSymbol}.`);
      setTicker("");
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePropose() {
    if (!ticker || ticker === corporation.tickerSymbol) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "ticker_change", newTicker: ticker }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Failed to open vote");
        return;
      }
      setSuccess("Ticker change vote opened. Shareholders will be notified.");
      setTicker("");
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="text-lg font-bold text-foreground mb-2">Stock Ticker</h2>
      <p className="text-sm text-muted mb-4">
        {corporation.tickerSymbol ? (
          <>
            Current ticker: <strong>{corporation.tickerSymbol}</strong>. Change it to a new 1–5
            letter symbol.
          </>
        ) : (
          "Set a 1–5 letter stock ticker symbol for this corporation."
        )}
      </p>
      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error mb-3">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success mb-3">
          {success}
        </div>
      )}
      <div className="flex items-end gap-3">
        <div className="flex-1 max-w-[160px]">
          <label className="block text-sm font-medium text-foreground mb-1">New Ticker</label>
          <input
            type="text"
            value={ticker}
            onChange={(e) => handleTickerInput(e.target.value)}
            placeholder="e.g. ACME"
            maxLength={5}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-mono uppercase tracking-widest focus:border-primary/60 focus:outline-none"
          />
        </div>
        {ticker &&
          ticker !== corporation.tickerSymbol &&
          (corporation.isPrivate ? (
            <button
              onClick={handleChange}
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Change Ticker"}
            </button>
          ) : (
            <button
              onClick={handlePropose}
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Proposing…" : "Propose Ticker Change (shareholder vote)"}
            </button>
          ))}
      </div>
    </div>
  );
}
