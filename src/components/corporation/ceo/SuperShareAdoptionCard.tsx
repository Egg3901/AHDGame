"use client";

import { useState } from "react";
import {
  SUPERSHARE_MIN_MULTIPLIER,
  SUPERSHARE_MAX_MULTIPLIER,
} from "@/lib/corporations/superShares";
import type { CorporationDetail } from "../CorporationPageTypes";

/**
 * CEO card to propose adopting a dual-class supershare structure (S#33) via
 * shareholder vote. Once adopted, shows the active multiplier instead.
 */
export function SuperShareAdoptionCard({
  corporation,
  corpId,
  onRefresh,
}: {
  corporation: CorporationDetail;
  corpId: string;
  onRefresh: () => void;
}) {
  const [multiplier, setMultiplier] = useState<number>(SUPERSHARE_MAX_MULTIPLIER);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const adopted = (corporation.superShareMultiplier ?? 0) >= SUPERSHARE_MIN_MULTIPLIER;

  async function handlePropose() {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "adopt_supershares", superShareMultiplier: multiplier }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Failed to open vote");
        return;
      }
      setSuccess("Supershare vote opened. Shareholders will be notified.");
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="text-lg font-bold text-foreground mb-2">Dual-Class Supershares</h2>
      {adopted ? (
        <p className="text-sm text-muted">
          This corporation has a dual-class structure: each of your founder supershares carries{" "}
          <strong>{corporation.superShareMultiplier}× votes</strong> in shareholder votes
          {corporation.superSharesAdoptedAtTurn != null
            ? ` (adopted on turn ${corporation.superSharesAdoptedAtTurn})`
            : ""}
          . Supershares convert to common stock when sold; dividends and payouts are unaffected.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted mb-4">
            Propose a shareholder vote to designate your current shares as supershares, each
            carrying multiple votes. This preserves your control of governance votes even as you
            sell more of the company. Supershares convert to common stock when sold; dividends and
            payouts are unaffected.
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
          <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
            Votes per supershare ({multiplier}×)
          </label>
          <input
            type="range"
            min={SUPERSHARE_MIN_MULTIPLIER}
            max={SUPERSHARE_MAX_MULTIPLIER}
            step={1}
            value={multiplier}
            onChange={(e) => setMultiplier(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted mb-4">
            <span>{SUPERSHARE_MIN_MULTIPLIER}×</span>
            <span>{SUPERSHARE_MAX_MULTIPLIER}×</span>
          </div>
          <button
            onClick={handlePropose}
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Proposing…" : "Propose Supershares (shareholder vote)"}
          </button>
        </>
      )}
    </div>
  );
}
