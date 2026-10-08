"use client";

import { useCallback, useEffect, useState } from "react";
import { BLEND, FONT, BLEND_LABEL } from "@/components/blend/tokens";
import type { ContingentHouseVoteView } from "@/lib/elections/contingentHouseVoteView";

interface ContingentHouseVotePanelProps {
  electionId: string;
  /** Candidate colours keyed by candidacy id, when the host page has them. */
  colorMap?: Map<string, string>;
}

/**
 * The House vote that stays open after a contingent deadlock. Fetches its own
 * payload and renders nothing unless this election has such a vote.
 */
export function ContingentHouseVotePanel({ electionId, colorMap }: ContingentHouseVotePanelProps) {
  const [vote, setVote] = useState<ContingentHouseVoteView | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/elections/${electionId}/contingent-vote`, { signal });
        if (!res.ok) return;
        const body = (await res.json()) as { vote: ContingentHouseVoteView | null };
        setVote(body.vote);
      } catch {
        // Aborted or offline: keep what is on screen.
      }
    },
    [electionId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const cast = async (candidateId: string) => {
    setPending(candidateId);
    setError(null);
    try {
      const res = await fetch(`/api/elections/${electionId}/contingent-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Your vote could not be recorded.");
      }
      await load();
    } finally {
      setPending(null);
    }
  };

  if (!vote) return null;

  const open = vote.status === "open" && vote.turnsLeft > 0;
  const winner = vote.winnerId ? vote.candidates.find((c) => c.id === vote.winnerId) : null;
  const ranked = [...vote.candidates].sort(
    (a, b) => b.delegations - a.delegations || a.name.localeCompare(b.name)
  );

  return (
    <section
      aria-label="House vote"
      style={{
        background: BLEND.rail,
        border: `1px solid ${BLEND.hairlineStrong}`,
        borderRadius: 8,
        padding: 16,
        fontFamily: FONT.sans,
        color: BLEND.ink,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>House vote</h3>
        <span style={{ fontFamily: FONT.mono, fontSize: 12, color: BLEND.caution }}>
          {open
            ? `Closes on turn ${vote.closesTurn} (${vote.turnsLeft} ${vote.turnsLeft === 1 ? "turn" : "turns"} left)`
            : "Closed"}
        </span>
      </div>

      <p style={{ margin: "6px 0 12px", fontSize: 13, color: BLEND.muted }}>
        {open ? (
          <>
            No candidate won a majority of state delegations. {vote.actingPresidentName} is acting
            president while the House votes. {vote.threshold} delegations elect a president.
          </>
        ) : winner ? (
          <>
            The House elected {winner.name} president with {winner.delegations} state delegations.{" "}
            {vote.actingPresidentName} is vice president.
          </>
        ) : (
          <>
            The House closed without a majority. {vote.actingPresidentName} continues as acting
            president.
          </>
        )}
      </p>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {ranked.map((c) => {
          const chosen = vote.viewer.choiceId === c.id;
          const color = colorMap?.get(c.id) ?? BLEND.muted;
          return (
            <li
              key={c.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                borderTop: `1px solid ${BLEND.hairline}`,
                paddingTop: 10,
              }}
            >
              <span
                aria-hidden
                style={{ width: 4, alignSelf: "stretch", background: color, borderRadius: 2 }}
              />
              <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{c.name}</div>
                <div style={{ ...BLEND_LABEL, fontFamily: FONT.mono }}>
                  {c.delegations} of {vote.threshold} delegations, {c.members} members
                </div>
                <div
                  style={{ height: 4, marginTop: 6, background: BLEND.track, borderRadius: 2 }}
                  role="presentation"
                >
                  <div
                    style={{
                      height: 4,
                      borderRadius: 2,
                      background: color,
                      width: `${Math.min(100, (c.delegations / Math.max(1, vote.threshold)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              {vote.viewer.canVote && (
                <button
                  type="button"
                  onClick={() => void cast(c.id)}
                  disabled={pending !== null || chosen}
                  aria-pressed={chosen}
                  style={{
                    minHeight: 40,
                    padding: "0 14px",
                    borderRadius: 6,
                    fontFamily: FONT.sans,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: pending !== null || chosen ? "default" : "pointer",
                    color: chosen ? BLEND.ink : BLEND.accentInk,
                    background: chosen ? BLEND.accent : "transparent",
                    border: `1px solid ${chosen ? BLEND.accent : BLEND.chipBorder}`,
                  }}
                >
                  {chosen ? "Your vote" : pending === c.id ? "Voting" : `Vote for ${c.name}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {vote.viewer.canVote && (
        <p style={{ margin: "12px 0 0", fontSize: 12, color: BLEND.mutedDim }}>
          You sit in the House. You can change your vote until the window closes. Members who have
          not voted back the candidate their ideology and party favour.
        </p>
      )}
      {error && (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, color: BLEND.negative }}>
          {error}
        </p>
      )}
    </section>
  );
}
