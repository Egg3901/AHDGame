"use client";

import { useState } from "react";
import { CanvassingPanel } from "./CanvassingPanel";
import { BLEND, FONT } from "@/components/blend/tokens";
import {
  blendButtonStyle,
  BlendInput,
  BlendProse,
  BlendSubPanel,
} from "@/components/blend/BlendControls";

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
  const canTravel = !traveling && !poolExhausted && stateId.trim().length > 0;

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
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontFamily: FONT.serif, fontSize: 17, fontWeight: 600 }}>
          Running mate surrogate
        </h3>
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 10.5,
            letterSpacing: ".08em",
            color: poolExhausted ? BLEND.caution : BLEND.positive,
            whiteSpace: "nowrap",
          }}
        >
          {surrogate.actionsRemaining} / {surrogate.cap} ACTIONS LEFT
        </span>
      </div>

      <BlendProse>
        Campaign for the ticket within a shared daily pool of {surrogate.cap} surrogate actions.
        Visiting a state and canvassing there each spend one action from this pool and use your own
        actions and funds. {surrogate.resetHint}
      </BlendProse>

      <BlendSubPanel title="Campaign in a state">
        <div
          style={{
            marginBottom: 10,
            fontFamily: FONT.serif,
            fontSize: 13,
            lineHeight: 1.55,
            color: BLEND.muted,
          }}
        >
          Sets the ticket&apos;s surrogate travel state. The ticket earns a per-turn presence bonus
          in that state, and it becomes your canvass target below.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BlendInput
            type="text"
            value={stateId}
            onChange={(e) => setStateId(e.target.value)}
            placeholder="State code, e.g. PA"
            maxLength={2}
            style={{ width: 170, textTransform: "uppercase" }}
          />
          <button
            type="button"
            onClick={handleTravel}
            disabled={!canTravel}
            style={blendButtonStyle("primary", canTravel)}
          >
            {traveling ? "Setting" : poolExhausted ? "No actions left" : "Campaign here"}
          </button>
        </div>
        {message && (
          <div
            style={{
              marginTop: 8,
              fontFamily: FONT.serif,
              fontSize: 13,
              color: BLEND.muted,
            }}
          >
            {message}
          </div>
        )}
      </BlendSubPanel>

      {/* Canvass-for-ticket. The eligibility endpoint resolves this VP to the
          ticket's travel state, so this canvass draws from the shared pool. */}
      <div style={{ marginTop: 14 }}>
        <CanvassingPanel
          variant="blend"
          countryId={countryId}
          characterActions={characterActions}
          characterFunds={characterFunds}
          onResourcesSpent={() => {
            onRefresh();
            onResourcesSpent();
          }}
        />
      </div>
    </div>
  );
}
