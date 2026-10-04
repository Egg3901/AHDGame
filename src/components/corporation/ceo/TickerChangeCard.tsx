"use client";

import { useState } from "react";
import type { CorporationDetail } from "../CorporationPageTypes";
import { InlineStatus, SmallButton } from "../dense/DenseKit";
import { GovernanceRow } from "./GovernanceRow";

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

  const changed = ticker !== "" && ticker !== corporation.tickerSymbol;

  return (
    <GovernanceRow
      label="Ticker"
      summary={corporation.tickerSymbol ?? "Not set"}
      actionLabel="Change"
    >
      <div className="space-y-1.5">
        <p className="text-xs text-muted">
          1 to 5 letters.{" "}
          {corporation.isPrivate
            ? "Takes effect at once."
            : "Public corporations change it by shareholder vote."}
        </p>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={ticker}
            onChange={(e) => handleTickerInput(e.target.value)}
            placeholder="e.g. ACME"
            maxLength={5}
            aria-label="New ticker"
            className="h-7 w-28 rounded-md border border-card-border bg-background px-2 text-[13px] uppercase tracking-wide text-foreground focus:border-foreground focus:outline-none"
          />
          <SmallButton
            tone="primary"
            disabled={submitting || !changed}
            onClick={corporation.isPrivate ? handleChange : handlePropose}
          >
            {submitting
              ? corporation.isPrivate
                ? "Saving"
                : "Proposing"
              : corporation.isPrivate
                ? "Change ticker"
                : "Propose vote"}
          </SmallButton>
        </div>
        <InlineStatus message={error} tone="error" />
        <InlineStatus message={success} tone="success" />
      </div>
    </GovernanceRow>
  );
}
