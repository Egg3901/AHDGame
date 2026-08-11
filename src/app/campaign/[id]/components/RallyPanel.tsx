"use client";

import { useState } from "react";

interface RallyPanelProps {
  campaignId: string;
  ownSupport: {
    support: number;
    pendingDripTotal: number;
    rallyTourActive: boolean;
    rallyFiredThisTurn: boolean;
    rallyFullValue: number;
    rallyOneShotActionCost: number;
    rallyTourTickActionCost: number;
  };
  campaignActions: number | null;
  isEnded: boolean;
  onRefresh: () => void;
}

/**
 * Phase B rally surface. Renders:
 *   - Current Support score (own-candidate; fog-of-war hides opponents)
 *   - Pending Support drip total (sum of queued accruals)
 *   - One-shot rally button (throttled to once per turn via lastRallyTurn)
 *   - Rally-tour toggle (per-turn auto-rally while active)
 */
export function RallyPanel({
  campaignId,
  ownSupport,
  campaignActions,
  isEnded,
  onRefresh,
}: RallyPanelProps) {
  const [firing, setFiring] = useState(false);
  const [togglingTour, setTogglingTour] = useState(false);
  const [error, setError] = useState("");

  const canFireOneShot =
    !isEnded &&
    !firing &&
    !ownSupport.rallyFiredThisTurn &&
    campaignActions != null &&
    campaignActions >= ownSupport.rallyOneShotActionCost;

  const canToggleTour = !isEnded && !togglingTour;

  async function handleFireOneShot() {
    setFiring(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/rally`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Rally failed");
        return;
      }
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setFiring(false);
    }
  }

  async function handleToggleTour() {
    setTogglingTour(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/rally-tour`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !ownSupport.rallyTourActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Tour toggle failed");
        return;
      }
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setTogglingTour(false);
    }
  }

  const immediateBumpPreview = (ownSupport.rallyFullValue * 0.6).toFixed(1);
  const dripPerTurnPreview = ((ownSupport.rallyFullValue * 0.4) / 4).toFixed(2);

  return (
    <div className="rounded-lg border border-card-border bg-card p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Rally Support</h2>
        <div className="text-xs text-muted">
          One-shot or ongoing tour — fog-of-war hides opponent Support.
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Current Support
          </div>
          <div className="text-2xl font-bold tabular-nums">{ownSupport.support.toFixed(1)}</div>
          <div className="text-[11px] text-muted">(50 = neutral, decays 0.5/turn toward 50)</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Pending Drip
          </div>
          <div className="text-2xl font-bold tabular-nums text-blue-400">
            +{ownSupport.pendingDripTotal.toFixed(2)}
          </div>
          <div className="text-[11px] text-muted">queued from prior rallies</div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-md border border-card-border/40 bg-background/30 p-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <div className="text-sm font-semibold">One-shot rally</div>
            <div className="text-xs text-muted tabular-nums">
              {ownSupport.rallyOneShotActionCost} actions
            </div>
          </div>
          <div className="mb-3 text-xs text-muted">
            +{immediateBumpPreview} Support immediately; +{dripPerTurnPreview}/turn for 4 more
            turns.
          </div>
          <button
            onClick={handleFireOneShot}
            disabled={!canFireOneShot}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {firing
              ? "Firing…"
              : ownSupport.rallyFiredThisTurn
                ? "Already fired this turn"
                : "Fire rally"}
          </button>
        </div>

        <div className="rounded-md border border-card-border/40 bg-background/30 p-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <div className="text-sm font-semibold">Rally tour</div>
            <div className="text-xs text-muted tabular-nums">
              {ownSupport.rallyTourTickActionCost} actions/turn
            </div>
          </div>
          <div className="mb-3 text-xs text-muted">
            Auto-fires a rally every turn while active. Steady state delivers ~
            {ownSupport.rallyFullValue.toFixed(1)} Support per turn.
          </div>
          <button
            onClick={handleToggleTour}
            disabled={!canToggleTour}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 ${
              ownSupport.rallyTourActive ? "bg-error" : "bg-primary"
            }`}
          >
            {togglingTour ? "Updating…" : ownSupport.rallyTourActive ? "Stop tour" : "Start tour"}
          </button>
        </div>
      </div>

      {error && <div className="mt-3 text-sm text-error">{error}</div>}
    </div>
  );
}
