"use client";

import { useState } from "react";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { useRouter } from "next/navigation";
import { StatePickerModal } from "./StatePickerModal";

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
  /**
   * Called after an action lands, for a host that keeps this panel's data in
   * client state. `router.refresh()` alone only re-runs the server render, so a
   * screen that fetched its campaign state itself would keep showing the state
   * from before the action.
   */
  onChanged?: () => void;
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
  onChanged,
}: PrimaryCampaignControlsProps) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

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
        router.refresh();
        onChanged?.();
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
        `Surge your home state (${homeState})? Cost: $${surgeCostFunds.toLocaleString("en-US")} + ${surgeCostActions} actions. Adds +${surgeBoost}% to your own vote there for the rest of this primary. One-time per cycle.`
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
        onChanged?.();
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
                  Add +{surgeBoost}% to your vote in{" "}
                  <span className="font-semibold">{homeState}</span> for $
                  {surgeCostFunds.toLocaleString("en-US")} + {surgeCostActions} actions
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

      {pickerOpen && (
        <StatePickerModal
          title="Pick a state to campaign in"
          states={states}
          currentStateId={currentCampaignState}
          playerActions={playerActions}
          busy={busy !== null}
          onPick={selectState}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
