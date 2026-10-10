"use client";

import { useState } from "react";
import { apiErrorText } from "@/lib/errors/catalog";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { BLEND, BLEND_LABEL } from "@/components/blend/tokens";

/**
 * Endorse or un-endorse one presidential candidate, from the stage's field list.
 *
 * Same route and rules as the general screen's ticket button: one endorsement
 * per player per race, never your own candidate, and the route says no (with a
 * reason, shown under the button) for a closed race or, during a primary, a
 * candidate outside your party. Renders nothing for a reader with no character,
 * for the reader's own candidacy, and for a candidate the reader could not
 * endorse (unless they already have, so it can be undone).
 */
export function EndorseControl({
  electionId,
  candidateId,
  myCharId,
  isYou,
  endorsed,
  eligible = true,
  onChanged,
}: {
  electionId: string;
  candidateId: string;
  myCharId: string | null;
  isYou: boolean;
  endorsed: boolean;
  /** False for a candidate the route would refuse, such as another party's in a primary. */
  eligible?: boolean;
  /** Called after the route accepts the change, with the new endorsed candidate id or null. */
  onChanged: (endorsedCandidateId: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!myCharId || isYou || (!eligible && !endorsed)) return null;

  async function toggle() {
    setBusy(true);
    setError(null);
    trackAction("election.endorse", {
      electionId,
      candidateId,
      action: endorsed ? "DELETE" : "POST",
    });
    try {
      const res = await fetch(`/api/elections/${electionId}/endorse`, {
        method: endorsed ? "DELETE" : "POST",
        ...(endorsed
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ candidateId }),
            }),
      });
      if (res.ok) {
        onChanged(endorsed ? null : candidateId);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(apiErrorText(body, "That endorsement did not go through."));
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        style={{
          ...BLEND_LABEL,
          padding: "3px 9px",
          font: "inherit",
          fontWeight: 700,
          whiteSpace: "nowrap",
          cursor: busy ? "not-allowed" : "pointer",
          ...(endorsed
            ? {
                border: "1px solid rgba(34,197,94,.4)",
                background: "rgba(34,197,94,.12)",
                color: BLEND.positive,
              }
            : {
                border: `1px solid ${BLEND.hairlineStrong}`,
                background: "transparent",
                color: BLEND.muted,
              }),
        }}
      >
        {busy ? "…" : endorsed ? "Endorsed" : "Endorse"}
      </button>
      {error ? (
        <p role="alert" style={{ margin: "4px 0 0", fontSize: 11.5, color: BLEND.negative }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
