"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { BLEND, FONT, BLEND_LABEL } from "@/components/blend/tokens";
import type {
  ContingentHouseVoteView,
  ContingentHouseVoteViewCandidate,
} from "@/lib/elections/contingentHouseVoteView";

interface ContingentHouseVotePanelProps {
  electionId: string;
  /** Candidate colours keyed by candidacy id, when the host page has them. */
  colorMap?: Map<string, string>;
}

/** Used when the host page has no party colours for the three candidates. */
const FALLBACK_COLORS = ["#60a5fa", "#fbbf24", "#c084fc"];

/** Refresh while the vote is open: the House ballots again every turn. */
const POLL_MS = 30_000;

const sectionTitle: CSSProperties = {
  ...BLEND_LABEL,
  fontFamily: FONT.mono,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontSize: 11,
  margin: "0 0 8px",
};

const block: CSSProperties = {
  borderTop: `1px solid ${BLEND.hairline}`,
  paddingTop: 12,
  marginTop: 14,
};

function choiceButton(active: boolean, disabled: boolean): CSSProperties {
  return {
    minHeight: 40,
    padding: "0 14px",
    borderRadius: 6,
    fontFamily: FONT.sans,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled || active ? "default" : "pointer",
    color: active ? BLEND.ink : BLEND.accentInk,
    background: active ? BLEND.accent : "transparent",
    border: `1px solid ${active ? BLEND.accent : BLEND.chipBorder}`,
  };
}

/**
 * The House vote that stays open after a contingent deadlock. Fetches its own
 * payload, refreshes while the vote is open, and renders nothing unless this
 * election has such a vote.
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

  const live = vote?.status === "open" && vote.turnsLeft > 0;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  const send = async (path: string, payload: Record<string, unknown>, key: string) => {
    setPending(key);
    setError(null);
    try {
      const res = await fetch(`/api/elections/${electionId}/contingent-vote${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "That could not be recorded.");
      }
      await load();
    } finally {
      setPending(null);
    }
  };

  if (!vote) return null;

  const open = vote.status === "open" && vote.turnsLeft > 0;
  const colorOf = (id: string) =>
    colorMap?.get(id) ??
    FALLBACK_COLORS[
      Math.max(
        0,
        vote.candidates.findIndex((c) => c.id === id)
      ) % 3
    ];
  const nameOf = (id: string) => vote.candidates.find((c) => c.id === id)?.name ?? "a candidate";
  const winner = vote.winnerId ? vote.candidates.find((c) => c.id === vote.winnerId) : null;
  const ranked = [...vote.candidates].sort(
    (a, b) =>
      Number(a.dropped) - Number(b.dropped) ||
      b.delegations - a.delegations ||
      a.name.localeCompare(b.name)
  );
  const whipLabel = (id: string) => (id === "free" ? "a free vote" : nameOf(id));
  const viewerWhipTarget =
    vote.viewer.whip && vote.viewer.whip.candidateId !== "free"
      ? vote.viewer.whip.candidateId
      : null;
  const ballotsShown = [...vote.ballots].reverse();
  const heading = open
    ? `Closes on turn ${vote.closesTurn} (${vote.turnsLeft} ${vote.turnsLeft === 1 ? "turn" : "turns"} left)`
    : "Closed";

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
        <span style={{ fontFamily: FONT.mono, fontSize: 12, color: BLEND.caution }}>{heading}</span>
      </div>

      <p style={{ margin: "6px 0 0", fontSize: 13, color: BLEND.muted }}>
        {open ? (
          <>
            No candidate won a majority of electoral votes, so the House is choosing. The Senate
            already chose {vote.actingPresidentName} as vice president, and they are acting
            president until the House chooses. The House ballots again every turn and the first
            candidate with {vote.threshold} state delegations wins.
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
      {open && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: BLEND.mutedDim }}>
          Each state delegation casts one vote, decided by a majority of its members. A tied
          delegation casts no vote. The District of Columbia has no House vote.
        </p>
      )}

      <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gap: 10 }}>
        {ranked.map((c) => (
          <CandidateRow
            key={c.id}
            c={c}
            threshold={vote.threshold}
            color={colorOf(c.id)}
            canVote={vote.viewer.canVote && !c.dropped}
            chosen={vote.viewer.choiceId === c.id}
            whipped={viewerWhipTarget === c.id}
            winner={vote.winnerId === c.id}
            pending={pending}
            onVote={(id) => void send("", { candidateId: id }, `vote:${id}`)}
          />
        ))}
      </ul>

      {vote.viewer.canVote && (
        <p style={{ margin: "12px 0 0", fontSize: 12, color: BLEND.mutedDim }}>
          You sit in the House and can change your vote until the window closes. If you do not vote,
          you follow your party whip, then your coalition whip, then your party and ideology.
          {vote.viewer.whip && (
            <>
              {" "}
              <span style={{ color: BLEND.ink }}>
                Your {vote.viewer.whip.scope === "party" ? "party" : "coalition"} (
                {vote.viewer.whip.name}) whip is {whipLabel(vote.viewer.whip.candidateId)}.
              </span>
              {viewerWhipTarget &&
                vote.viewer.choiceId &&
                vote.viewer.choiceId !== viewerWhipTarget && (
                  <span style={{ color: BLEND.caution }}> You are voting against it.</span>
                )}
            </>
          )}
        </p>
      )}

      {vote.viewer.canWhip.length > 0 && (
        <div style={block}>
          <h4 style={sectionTitle}>Set a whip</h4>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: BLEND.mutedDim }}>
            Your House members who have not voted follow the whip; players can still vote against
            it. A coalition whip applies to member parties without their own whip.
          </p>
          {vote.viewer.canWhip.map((g) => (
            <div key={`${g.scope}:${g.sequentialId}`} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                {g.name}{" "}
                <span style={{ ...BLEND_LABEL, fontFamily: FONT.mono }}>
                  {g.scope === "party" ? "party" : "coalition"}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  ...vote.candidates
                    .filter((c) => !c.dropped)
                    .map((c) => ({ id: c.id, label: c.name })),
                  { id: "free", label: "Free vote" },
                  { id: "clear", label: "No whip" },
                ].map((opt) => {
                  const active = (g.current ?? "clear") === opt.id;
                  const key = `whip:${g.scope}:${g.sequentialId}:${opt.id}`;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={active}
                      disabled={pending !== null || active}
                      onClick={() =>
                        void send(
                          "/whip",
                          { scope: g.scope, sequentialId: g.sequentialId, candidateId: opt.id },
                          key
                        )
                      }
                      style={choiceButton(active, pending !== null)}
                    >
                      {pending === key ? "Saving" : opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {vote.whips.length > 0 && (
        <div style={block}>
          <h4 style={sectionTitle}>Whips in force</h4>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {vote.whips.map((w) => (
              <li key={w.key} style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 500 }}>{w.name}</span>{" "}
                <span style={{ color: BLEND.muted }}>
                  {w.scope === "party" ? "party" : "coalition"} whip: {whipLabel(w.candidateId)},
                  set by {w.setByName} on turn {w.turn}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {vote.delegations.length > 0 && (
        <div style={block}>
          <h4 style={sectionTitle}>{open ? "State delegations now" : "Final delegations"}</h4>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(46px, 1fr))",
              gap: 4,
            }}
          >
            {vote.delegations.map((d) => {
              const label = d.backing
                ? `${d.stateId}: ${nameOf(d.backing)}`
                : d.tied
                  ? `${d.stateId}: tied, no vote`
                  : `${d.stateId}: no vote`;
              const color = d.backing ? colorOf(d.backing) : null;
              return (
                <li
                  key={d.stateId}
                  title={label}
                  aria-label={label}
                  style={{
                    textAlign: "center",
                    padding: "6px 0",
                    borderRadius: 4,
                    fontFamily: FONT.mono,
                    fontSize: 11,
                    color: color ? BLEND.ink : BLEND.mutedDim,
                    background: color ? `${color}33` : BLEND.inset,
                    border: `1px solid ${color ?? (d.tied ? BLEND.caution : BLEND.hairline)}`,
                    borderStyle: d.tied ? "dashed" : "solid",
                  }}
                >
                  {d.stateId}
                  {d.tied ? "*" : ""}
                </li>
              );
            })}
          </ul>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 12 }}>
            {vote.candidates.map((c) => (
              <span key={c.id} style={{ color: BLEND.muted }}>
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: colorOf(c.id),
                    marginRight: 6,
                  }}
                />
                {c.name}
              </span>
            ))}
            <span style={{ color: BLEND.mutedDim }}>* tied, casts no vote</span>
          </div>
        </div>
      )}

      {vote.defiances.length > 0 && (
        <div style={block}>
          <h4 style={sectionTitle}>Members who defied their whip</h4>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {vote.defiances.map((d) => (
              <li key={`${d.stateId}:${d.name}`} style={{ fontSize: 13, color: BLEND.muted }}>
                <span style={{ color: BLEND.ink }}>{d.name}</span> ({d.stateId}) votes{" "}
                {nameOf(d.candidateId)}, whip said {nameOf(d.whipCandidateId)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ballotsShown.length > 0 && (
        <div style={block}>
          <h4 style={sectionTitle}>Ballots</h4>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {ballotsShown.map((b) => (
              <li
                key={`${b.turn}:${b.opening}`}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "2px 12px",
                  fontSize: 12,
                  fontFamily: FONT.mono,
                  color: BLEND.muted,
                }}
              >
                <span style={{ color: BLEND.ink }}>
                  Turn {b.turn}
                  {b.opening ? " (deadlock)" : ""}
                </span>
                {vote.candidates.map((c) => (
                  <span key={c.id}>
                    {c.name} {b.totals[c.id] ?? 0}
                  </span>
                ))}
                {b.winnerId && <span style={{ color: BLEND.gold }}>{nameOf(b.winnerId)} wins</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" style={{ margin: "10px 0 0", fontSize: 12, color: BLEND.negative }}>
          {error}
        </p>
      )}
    </section>
  );
}

function CandidateRow(props: {
  c: ContingentHouseVoteViewCandidate;
  threshold: number;
  color: string;
  canVote: boolean;
  chosen: boolean;
  whipped: boolean;
  winner: boolean;
  pending: string | null;
  onVote: (id: string) => void;
}) {
  const { c, threshold, color, canVote, chosen, whipped, winner, pending, onVote } = props;
  const share = Math.min(100, (c.delegations / Math.max(1, threshold)) * 100);
  return (
    <li
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        borderTop: `1px solid ${BLEND.hairline}`,
        paddingTop: 10,
        opacity: c.dropped ? 0.55 : 1,
      }}
    >
      <span
        aria-hidden
        style={{ width: 4, alignSelf: "stretch", background: color, borderRadius: 2 }}
      />
      <div style={{ flex: "1 1 160px", minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>
          {c.name}
          {winner && <span style={{ color: BLEND.gold }}> (elected)</span>}
          {c.dropped && <span style={{ color: BLEND.mutedDim }}> (left the race)</span>}
          {whipped && !c.dropped && <span style={{ color: BLEND.muted }}> (your whip)</span>}
        </div>
        <div style={{ ...BLEND_LABEL, fontFamily: FONT.mono }}>
          {c.delegations} of {threshold} delegations
          {c.members != null ? `, ${c.members} members` : ""}
        </div>
        <div
          style={{
            position: "relative",
            height: 4,
            marginTop: 6,
            background: BLEND.track,
            borderRadius: 2,
          }}
          role="presentation"
        >
          <div style={{ height: 4, borderRadius: 2, background: color, width: `${share}%` }} />
        </div>
      </div>
      {canVote && (
        <button
          type="button"
          onClick={() => onVote(c.id)}
          disabled={pending !== null || chosen}
          aria-pressed={chosen}
          style={choiceButton(chosen, pending !== null)}
        >
          {chosen ? "Your vote" : pending === `vote:${c.id}` ? "Voting" : `Vote for ${c.name}`}
        </button>
      )}
    </li>
  );
}
