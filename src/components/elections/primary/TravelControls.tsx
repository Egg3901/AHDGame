"use client";

import { useState } from "react";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { useRouter } from "next/navigation";
import { StatePickerModal } from "./StatePickerModal";
import type { StateTravelOption } from "@/lib/elections/dto/campaignStatePresence";

interface TravelControlsProps {
  electionId: string;
  /** Where the candidate is now, or null before their first move. */
  currentStateId: string | null;
  currentStateName: string | null;
  playerActions: number;
  states: StateTravelOption[];
  /** For a host that keeps this data in client state, as the Blend screens do. */
  onChanged?: () => void;
}

/**
 * Travel to a state during the general election.
 *
 * The route and its turn-engine effect already existed: `travelState` earns a
 * per-turn presence bonus in `campaignTurn` and is what unlocks canvassing
 * there. Nothing in the UI had ever called it, so the action was unreachable
 * and canvassing outside your home state was permanently blocked behind a
 * "travel to a state" message with no way to travel.
 */
export function TravelControls({
  electionId,
  currentStateId,
  currentStateName,
  playerActions,
  states,
  onChanged,
}: TravelControlsProps) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const travelTo = async (stateId: string) => {
    setBusy(true);
    setMessage("");
    try {
      trackAction("election.travel", { electionId, stateId });
      const res = await fetch(`/api/elections/${electionId}/travel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✓ ${data.message ?? `Now campaigning in ${stateId}.`}`);
        setPickerOpen(false);
        router.refresh();
        onChanged?.();
      } else {
        setMessage(`✗ ${data.error}`);
      }
    } catch {
      setMessage("✗ Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Where you are campaigning</h3>
        <p className="text-xs text-muted mt-0.5">
          Travelling earns a presence bonus in that state each turn, and is what lets you canvass
          there. Costs actions by the state&apos;s size.
        </p>
      </div>

      <div className="flex items-center flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="text-[10px] uppercase tracking-wider text-muted">Currently in</div>
          {currentStateId ? (
            <div className="mt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-sm font-semibold text-amber-400">
                📍 {currentStateName ?? currentStateId}
              </span>
            </div>
          ) : (
            <div className="text-sm text-muted mt-1">
              Nowhere yet. You can only canvass in your home state until you travel.
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPickerOpen(true)}
          className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {currentStateId ? "Travel elsewhere" : "Travel to a state"}
        </button>
      </div>

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
          title="Pick a state to travel to"
          states={states}
          currentStateId={currentStateId}
          playerActions={playerActions}
          busy={busy}
          onPick={travelTo}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
