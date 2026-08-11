"use client";

import { useState } from "react";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { useRouter } from "next/navigation";

interface StateOption {
  id: string;
  name: string;
  actionCost: number;
}

interface PrimaryCampaignControlsProps {
  electionId: string;
  currentCampaignState: string | null;
  currentTicks: number;
  tickCap: number;
  homeState: string | null;
  surgeUsed: boolean;
  playerActions: number;
  playerFunds: number;
  surgeCostFunds: number;
  surgeCostActions: number;
  surgeBoost: number;
  states: StateOption[];
}

export function PrimaryCampaignControls({
  electionId,
  currentCampaignState,
  currentTicks,
  tickCap,
  homeState,
  surgeUsed,
  playerActions,
  playerFunds,
  surgeCostFunds,
  surgeCostActions,
  surgeBoost,
  states,
}: PrimaryCampaignControlsProps) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [stateSearch, setStateSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const filtered = stateSearch
    ? states.filter(
        (s) =>
          s.name.toLowerCase().includes(stateSearch.toLowerCase()) ||
          s.id.includes(stateSearch.toUpperCase())
      )
    : states;

  const selectState = async (stateId: string) => {
    setBusy("camp");
    setMessage("");
    try {
      trackAction("election.primary-campaign", { electionId, stateId });
      const res = await fetch(`/api/elections/${electionId}/primary-campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✓ ${data.message}`);
        setPickerOpen(false);
        setStateSearch("");
        router.refresh();
      } else {
        setMessage(`✗ ${data.error}`);
      }
    } catch {
      setMessage("✗ Network error");
    } finally {
      setBusy(null);
    }
  };

  const triggerSurge = async () => {
    if (
      !confirm(
        `Surge your home state (${homeState})? Cost: $${surgeCostFunds.toLocaleString("en-US")} + ${surgeCostActions} actions. Bumps state party org by +${surgeBoost} for the rest of this primary. One-time per cycle.`
      )
    )
      return;
    setBusy("surge");
    setMessage("");
    try {
      trackAction("election.home-state-surge", { electionId });
      const res = await fetch(`/api/elections/${electionId}/home-state-surge`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✓ ${data.message}`);
        router.refresh();
      } else {
        setMessage(`✗ ${data.error}`);
      }
    } catch {
      setMessage("✗ Network error");
    } finally {
      setBusy(null);
    }
  };

  const tickBar = Array.from({ length: tickCap }, (_, i) => i < currentTicks);
  const canSurge = !surgeUsed && playerFunds >= surgeCostFunds && playerActions >= surgeCostActions;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Your Primary Campaign</h3>
          <p className="text-xs text-muted mt-0.5">
            Camp in a state to boost your projection there. Ticks accrue each turn while camped (cap
            +{tickCap}). Ticks reset on state change.
          </p>
        </div>
      </div>

      {/* Campaign-in-state badge + action */}
      <div className="flex items-center flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="text-[10px] uppercase tracking-wider text-muted">Campaigning in</div>
          {currentCampaignState ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-sm font-semibold text-amber-400">
                📍 {currentCampaignState}
              </span>
              <div
                className="flex items-center gap-0.5"
                title={`Ticks: ${currentTicks}/${tickCap}`}
              >
                {tickBar.map((filled, i) => (
                  <span
                    key={i}
                    className={`h-2 w-3 rounded-sm ${filled ? "bg-amber-400" : "bg-card-border"}`}
                  />
                ))}
              </div>
              <span className="text-xs text-muted">
                {currentTicks}/{tickCap} ticks
              </span>
            </div>
          ) : (
            <div className="text-sm text-muted mt-1">No state selected</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition-colors"
        >
          {currentCampaignState ? "Change state" : "Pick state"}
        </button>
      </div>

      {/* Surge action */}
      {homeState && (
        <div className="flex items-center flex-wrap gap-3 border-t border-card-border pt-3">
          <div className="flex-1 min-w-[200px]">
            <div className="text-[10px] uppercase tracking-wider text-muted">Home-state surge</div>
            <div className="text-sm text-foreground mt-1">
              {surgeUsed ? (
                <span className="text-muted">Used this cycle ✓</span>
              ) : (
                <>
                  Boost <span className="font-semibold">{homeState}</span> party org by +
                  {surgeBoost} — ${surgeCostFunds.toLocaleString("en-US")} + {surgeCostActions}{" "}
                  actions
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={!canSurge || busy !== null}
            onClick={triggerSurge}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              surgeUsed
                ? "Already used this primary cycle"
                : !canSurge
                  ? "Not enough funds or actions"
                  : `Surge ${homeState}`
            }
          >
            {busy === "surge" ? "…" : "Surge home state"}
          </button>
        </div>
      )}

      {message && (
        <div
          className={`rounded-md px-2.5 py-1.5 text-xs ${
            message.startsWith("✓") ? "bg-success/10 text-success" : "bg-error/10 text-error"
          }`}
        >
          {message}
        </div>
      )}

      {/* State picker modal */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="rounded-xl border border-card-border bg-card max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
              <h3 className="font-semibold">Pick a state to campaign in</h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPickerOpen(false)}
                className="text-muted hover:text-foreground p-1"
              >
                ✕
              </button>
            </div>
            <div className="px-4 py-2 border-b border-card-border">
              <input
                type="text"
                value={stateSearch}
                onChange={(e) => setStateSearch(e.target.value)}
                placeholder="Search by name or code…"
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-muted mt-1">
                Cost scales by state EV: 3 (small) → 10 actions (large).
              </p>
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {filtered.map((s) => {
                const canAfford = playerActions >= s.actionCost;
                const isCurrent = s.id === currentCampaignState;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!canAfford || isCurrent || busy !== null}
                    onClick={() => selectState(s.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                      isCurrent
                        ? "border-amber-500/50 bg-amber-500/20 text-amber-400"
                        : canAfford
                          ? "border-card-border hover:bg-background"
                          : "border-card-border/40 opacity-40"
                    }`}
                  >
                    <span className="font-medium">
                      {s.name} <span className="text-muted text-xs">({s.id})</span>
                    </span>
                    <span className="text-xs text-muted tabular-nums">
                      {isCurrent ? "current" : `${s.actionCost} actions`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
