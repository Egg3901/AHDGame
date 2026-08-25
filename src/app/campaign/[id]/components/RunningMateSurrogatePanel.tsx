"use client";

import { useState } from "react";
import { CanvassingPanel } from "./CanvassingPanel";

interface RunningMateSurrogatePanelProps {
  electionId: string;
  surrogate: {
    actionsRemaining: number;
    cap: number;
    resetHint: string;
  };
  countryId?: string;
  characterActions?: number;
  characterFunds?: number;
  /** Refetch the campaign (surrogate pool moved). */
  onRefresh: () => void;
  /** Refetch the viewer's own actions/funds (spent on a surrogate act). */
  onResourcesSpent: () => void;
}

/**
 * Running-mate surrogate surface. The VP acts for the ticket within a shared
 * per-day action pool: a "campaign in a state" visit (sets the ticket's
 * surrogate travel state) and canvass-for-ticket (routed through the same pool).
 * Both spend the VP's OWN actions/funds; the pool bounds throughput.
 */
export function RunningMateSurrogatePanel({
  electionId,
  surrogate,
  countryId,
  characterActions,
  characterFunds,
  onRefresh,
  onResourcesSpent,
}: RunningMateSurrogatePanelProps) {
  const [stateId, setStateId] = useState("");
  const [traveling, setTraveling] = useState(false);
  const [message, setMessage] = useState("");

  const poolExhausted = surrogate.actionsRemaining <= 0;

  async function handleTravel() {
    const target = stateId.trim().toUpperCase();
    if (!target) return;
    setTraveling(true);
    setMessage("");
    try {
      const res = await fetch(`/api/elections/${electionId}/running-mate/travel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId: target }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Could not set the campaign state");
        return;
      }
      setMessage(data.message || `Now campaigning in ${target}`);
      setStateId("");
      onRefresh();
      onResourcesSpent();
    } catch {
      setMessage("Network error");
    } finally {
      setTraveling(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Running Mate Surrogate</h2>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {surrogate.actionsRemaining} / {surrogate.cap} actions left
        </span>
      </div>
      <p className="mb-4 text-xs text-muted">
        Campaign for the ticket within a shared daily pool of {surrogate.cap} surrogate actions.
        Visiting a state and canvassing there each spend one action from this pool and use your own
        actions and funds. {surrogate.resetHint}
      </p>

      <div className="mb-4 rounded-md border border-card-border/40 bg-background/30 p-3">
        <div className="mb-2 text-sm font-semibold">Campaign in a state</div>
        <div className="mb-3 text-xs text-muted">
          Sets the ticket&apos;s surrogate travel state. The ticket earns a per-turn presence bonus
          in that state, and it becomes your canvass target below.
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={stateId}
            onChange={(e) => setStateId(e.target.value)}
            placeholder="State code (e.g. PA)"
            maxLength={2}
            className="w-40 rounded-md border border-card-border bg-card px-3 py-2 text-sm uppercase text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            onClick={handleTravel}
            disabled={traveling || poolExhausted || stateId.trim().length === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {traveling ? "Setting…" : poolExhausted ? "No actions left" : "Campaign here"}
          </button>
        </div>
        {message && <div className="mt-2 text-xs text-muted">{message}</div>}
      </div>

      {/* Canvass-for-ticket. The eligibility endpoint resolves this VP to the
          ticket's travel state, so this canvass draws from the shared pool. */}
      <CanvassingPanel
        countryId={countryId}
        characterActions={characterActions}
        characterFunds={characterFunds}
        onResourcesSpent={() => {
          onRefresh();
          onResourcesSpent();
        }}
      />
    </div>
  );
}
