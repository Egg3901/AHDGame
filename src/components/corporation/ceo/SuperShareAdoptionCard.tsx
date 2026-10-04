"use client";

import { useState } from "react";
import {
  SUPERSHARE_MIN_MULTIPLIER,
  SUPERSHARE_MAX_MULTIPLIER,
} from "@/lib/corporations/superShares";
import type { CorporationDetail } from "../CorporationPageTypes";
import { InlineStatus, SmallButton } from "../dense/DenseKit";
import { GovernanceRow } from "./GovernanceRow";

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

  if (adopted) {
    return (
      <GovernanceRow
        label="Dual-class shares"
        summary={`Adopted: founder shares carry ${corporation.superShareMultiplier}x votes${
          corporation.superSharesAdoptedAtTurn != null
            ? ` since turn ${corporation.superSharesAdoptedAtTurn}`
            : ""
        }. They convert to common stock when sold.`}
      />
    );
  }

  return (
    <GovernanceRow label="Dual-class shares" summary="Not adopted" actionLabel="Propose">
      <div className="space-y-1.5">
        <p className="text-xs text-muted">
          A shareholder vote to make your current shares supershares, each with several votes. You
          keep control of governance votes while selling more of the company. Supershares convert to
          common stock when sold; dividends and payouts are unchanged.
        </p>
        <label className="flex items-center gap-2 text-xs text-muted">
          Votes per share
          <input
            type="range"
            min={SUPERSHARE_MIN_MULTIPLIER}
            max={SUPERSHARE_MAX_MULTIPLIER}
            step={1}
            value={multiplier}
            onChange={(e) => setMultiplier(Number(e.target.value))}
            className="w-40"
          />
          <span className="w-8 tabular-nums text-foreground">{multiplier}x</span>
        </label>
        <SmallButton tone="primary" onClick={handlePropose} disabled={submitting}>
          {submitting ? "Proposing" : "Propose supershares vote"}
        </SmallButton>
        <InlineStatus message={error} tone="error" />
        <InlineStatus message={success} tone="success" />
      </div>
    </GovernanceRow>
  );
}
