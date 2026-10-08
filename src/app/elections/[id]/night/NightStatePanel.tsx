"use client";

import { useCallback } from "react";
import Link from "next/link";
import { BLEND, BLEND_LABEL, FONT } from "@/components/blend/tokens";
import { electionRegionUrl } from "@/lib/urls";
import { CountySection } from "../blend/presMap/CountySection";
import type { PresMapModel, PresMapState } from "../blend/presMap/presMapModel";

export interface NightStatePanelProps {
  state: PresMapState;
  model: PresMapModel;
  electionId: string;
  countryId: string;
  turn: number | null;
  /** The race has resolved: the full state page is safe to link. */
  settled: boolean;
  onClose: () => void;
}

/**
 * State overview for election night. It prints only what the night payload
 * shows for the state, and the county table is mounted (and fetched) only once
 * the state is called or the race has resolved, so it cannot leak a result
 * ahead of the broadcast.
 */
export function NightStatePanel({
  state,
  model,
  electionId,
  countryId,
  turn,
  settled,
  onClose,
}: NightStatePanelProps) {
  const b = state.broadcast;
  const candidate = useCallback(
    (id: string) => model.candidates[id] ?? { name: "Unknown", color: "#9CA3AF" },
    [model]
  );
  if (!b) return null;
  const leader = state.shares[0];

  return (
    <div style={{ fontFamily: FONT.sans, color: BLEND.ink }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...BLEND_LABEL, fontSize: 11, letterSpacing: ".08em" }}>
            {state.id} / {state.ev} ELECTORAL {state.ev === 1 ? "VOTE" : "VOTES"}
          </div>
          <h3 style={{ margin: "2px 0 0", fontSize: 21, fontWeight: 600, lineHeight: 1.15 }}>
            {state.name}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close state overview"
          style={{
            flex: "none",
            width: 32,
            height: 32,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            border: `1px solid ${BLEND.hairlineStrong}`,
            background: "transparent",
            color: BLEND.muted,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" fill="none" />
          </svg>
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: BLEND.inset,
          border: `1px solid ${BLEND.hairline}`,
        }}
      >
        <i
          aria-hidden
          style={{ width: 12, height: 34, flex: "none", display: "block", background: state.fill }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>
            {b.called && leader ? `Projected: ${leader.name} wins` : b.statusLabel}
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 11.5, color: BLEND.muted, marginTop: 2 }}>
            {b.closed ? `Polls closed ${b.closeLabel}` : `Polls close ${b.closeLabel}`}
          </div>
        </div>
      </div>

      <dl style={{ margin: "14px 0 0", display: "flex", gap: 24 }}>
        <Fact label="Reporting" value={`${b.reportingPct.toFixed(1)}%`} />
        <Fact label="Status" value={b.statusLabel} />
      </dl>

      <Section title="Vote counted so far">
        {b.showNumbers && state.shares.length > 0 ? (
          state.shares.map((s) => (
            <div
              key={s.id}
              style={{ padding: "8px 0", borderBottom: `1px solid ${BLEND.hairline}` }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <i
                  aria-hidden
                  style={{
                    width: 9,
                    height: 9,
                    flex: "none",
                    display: "block",
                    background: s.color,
                    alignSelf: "center",
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 14,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.name}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: 15, fontWeight: 500 }}>
                  {s.pct.toFixed(1)}%
                </span>
              </div>
              <div style={{ marginTop: 6, height: 3, background: BLEND.trackAlt }}>
                <i
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${Math.min(100, s.pct)}%`,
                    background: s.color,
                  }}
                />
              </div>
              <div
                style={{ marginTop: 5, fontFamily: FONT.mono, fontSize: 11, color: BLEND.mutedDim }}
              >
                {Math.round(s.votes).toLocaleString("en-US")} votes
              </div>
            </div>
          ))
        ) : (
          <p style={{ margin: 0, fontSize: 13.5, color: BLEND.muted }}>
            {b.closed
              ? "Too early to call. No leader is shown until more of the vote is in."
              : "Polls are still open. No votes are reported."}
          </p>
        )}
        {b.showNumbers && !b.called && !settled ? (
          <p style={{ margin: "7px 0 0", fontSize: 11.5, color: BLEND.mutedDim }}>
            Partial returns. The share of the vote can still move as the count continues.
          </p>
        ) : null}
      </Section>

      {b.countiesOpen ? (
        <Section title="Counties">
          <CountySection
            electionId={electionId}
            stateId={state.id}
            turn={turn}
            candidate={candidate}
          />
        </Section>
      ) : (
        <Section title="Counties">
          <p style={{ margin: 0, fontSize: 13.5, color: BLEND.muted }}>
            County results open once the state is called.
          </p>
        </Section>
      )}

      {settled ? (
        <Link
          href={electionRegionUrl(electionId, countryId, state.id)}
          style={{
            marginTop: 16,
            display: "block",
            textAlign: "center",
            padding: "9px 12px",
            border: `1px solid ${BLEND.hairlineStrong}`,
            color: BLEND.ink,
            textDecoration: "none",
            fontSize: 13.5,
            fontWeight: 500,
          }}
        >
          Open full {state.name} page
        </Link>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ ...BLEND_LABEL, fontSize: 11 }}>{label}</dt>
      <dd style={{ margin: "2px 0 0", fontFamily: FONT.mono, fontSize: 15, fontWeight: 600 }}>
        {value}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 18 }}>
      <div
        style={{
          ...BLEND_LABEL,
          fontFamily: FONT.mono,
          fontSize: 10.5,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: BLEND.mutedDim,
          paddingBottom: 6,
          borderBottom: `1px solid ${BLEND.hairlineStrong}`,
        }}
      >
        {title}
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </section>
  );
}
