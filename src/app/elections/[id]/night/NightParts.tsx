"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { BLEND, BLEND_LABEL, FONT } from "@/components/blend/tokens";
import styles from "@/components/blend/blend.module.css";
import type { ContingentElectionDisplay } from "@/lib/elections/presidentialResolutionDisplay";
import {
  formatCountdown,
  msUntil,
  type CallAlert,
  type NightCandidateView,
  type NightFeedItem,
  type NightKeyRace,
  type NightView,
} from "./nightModel";
import { FOG_NIGHT_FILL, GREY_FILL } from "./nightMapModel";

const MONO_LABEL: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: 10.5,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: BLEND.mutedDim,
};

function Block({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section style={{ padding: "16px 18px", borderBottom: `1px solid ${BLEND.hairline}` }}>
      <div
        style={{
          ...MONO_LABEL,
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          paddingBottom: 6,
          marginBottom: 10,
          borderBottom: `1px solid ${BLEND.hairlineStrong}`,
        }}
      >
        <span>{title}</span>
        {aside ? <span style={{ textTransform: "none", letterSpacing: 0 }}>{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

// ---- header ----

export function LiveBug({ settled }: { settled: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "4px 10px",
        fontFamily: FONT.mono,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: ".16em",
        color: settled ? BLEND.gold : "#ffffff",
        background: settled ? "transparent" : BLEND.accent,
        border: settled ? `1px solid ${BLEND.gold}` : "1px solid transparent",
      }}
    >
      {settled ? null : (
        <i
          aria-hidden
          className={styles.pulse}
          style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", display: "block" }}
        />
      )}
      {settled ? "FINAL" : "LIVE"}
    </span>
  );
}

export function NightHeader({
  title,
  clock,
  view,
  extra,
}: {
  title: string;
  clock: string | null;
  view: NightView;
  extra?: ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 16px",
        padding: "12px 18px",
        borderBottom: `1px solid ${BLEND.hairlineStrong}`,
        background: BLEND.rail,
      }}
    >
      <LiveBug settled={view.settled} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ ...MONO_LABEL, letterSpacing: ".18em" }}>Election night</div>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em" }}>
          {title}
        </h1>
      </div>
      <dl style={{ display: "flex", gap: 22, margin: 0 }}>
        <Stat label="States called" value={`${view.statesCalled} of ${view.totalStates}`} />
        {clock ? <Stat label="Election night clock" value={clock} /> : null}
      </dl>
      {extra}
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <dt style={{ ...MONO_LABEL, fontSize: 9.5 }}>{label}</dt>
      <dd style={{ margin: 0, fontFamily: FONT.mono, fontSize: 17, fontWeight: 600 }}>{value}</dd>
    </div>
  );
}

// ---- race to N ----

export function RaceBar({ view }: { view: NightView }) {
  // The two leading tickets keep fixed sides (by id) so a changing lead does not swap them.
  const [first, second, ...rest] = view.candidates;
  const [a, b] = [first, second].filter(Boolean).sort((x, y) => x.id.localeCompare(y.id));
  const total = Math.max(1, view.totalEv);
  const pct = (ev: number) => `${Math.min(100, (ev / total) * 100)}%`;
  const marker = (view.evNeeded / total) * 100;
  return (
    <div
      data-testid="race-bar"
      style={{
        position: "sticky",
        top: "3.5rem",
        zIndex: 20,
        padding: "10px 18px 12px",
        background: BLEND.page,
        borderBottom: `1px solid ${BLEND.hairlineStrong}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        {a ? <RaceSide c={a} winner={view.winnerId === a.id} align="left" /> : <span />}
        <div style={{ ...MONO_LABEL, textAlign: "center", paddingBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: BLEND.ink, letterSpacing: 0 }}>
            {view.evNeeded}
          </div>
          to win
        </div>
        {b ? <RaceSide c={b} winner={view.winnerId === b.id} align="right" /> : <span />}
      </div>
      <div
        role="img"
        aria-label={`Called electoral votes, ${view.candidates
          .slice(0, 2)
          .map((c) => `${c.name} ${c.ev}`)
          .join(", ")}, ${view.evNeeded} needed`}
        style={{
          position: "relative",
          height: 12,
          marginTop: 6,
          background: BLEND.track,
          overflow: "hidden",
        }}
      >
        {a ? (
          <i
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: pct(a.ev),
              background: a.color,
              display: "block",
              transition: "width .8s ease",
            }}
          />
        ) : null}
        {b ? (
          <i
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: pct(b.ev),
              background: b.color,
              display: "block",
              transition: "width .8s ease",
            }}
          />
        ) : null}
        <i
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${marker}%`,
            width: 2,
            background: BLEND.ink,
            display: "block",
          }}
        />
      </div>
      {rest.some((c) => c.ev > 0) ? (
        <div style={{ marginTop: 6, fontFamily: FONT.mono, fontSize: 11, color: BLEND.muted }}>
          {rest
            .filter((c) => c.ev > 0)
            .map((c) => `${c.name} ${c.ev}`)
            .join(" / ")}
        </div>
      ) : null}
    </div>
  );
}

function RaceSide({
  c,
  winner,
  align,
}: {
  c: NightCandidateView;
  winner: boolean;
  align: "left" | "right";
}) {
  return (
    <div style={{ textAlign: align, minWidth: 0, flex: 1 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          justifyContent: align === "left" ? "flex-start" : "flex-end",
          fontSize: 13.5,
          fontWeight: 500,
          minWidth: 0,
        }}
      >
        <i
          aria-hidden
          style={{ width: 9, height: 9, background: c.color, display: "block", flex: "none" }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {c.name}
        </span>
        {winner ? (
          <span style={{ ...MONO_LABEL, color: BLEND.gold, letterSpacing: ".08em", flex: "none" }}>
            Projected winner
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 30,
          lineHeight: 1.1,
          fontWeight: 700,
          color: winner ? BLEND.gold : BLEND.ink,
        }}
      >
        {c.ev}
      </div>
    </div>
  );
}

// ---- map legend ----

function Swatch({ style }: { style: CSSProperties }) {
  return (
    <i
      aria-hidden
      style={{
        width: 11,
        height: 11,
        display: "block",
        border: `1px solid ${BLEND.hairlineStrong}`,
        ...style,
      }}
    />
  );
}

export function NightMapLegend({ candidates }: { candidates: NightCandidateView[] }) {
  const [a, b] = candidates;
  const ca = a?.color ?? "#9CA3AF";
  const cb = b?.color ?? "#6B7280";
  const hatch = (base: string, line: string): CSSProperties => ({
    background: `repeating-linear-gradient(135deg, ${base} 0 3px, ${line} 3px 5px)`,
  });
  const items: { swatch: CSSProperties; label: string }[] = [
    { swatch: { background: GREY_FILL }, label: "Polls open" },
    { swatch: hatch(FOG_NIGHT_FILL, "#3a3a4d"), label: "Polls closed, too early to call" },
    { swatch: hatch(`${ca}55`, ca), label: "Leading, not called" },
    {
      swatch: { background: `repeating-linear-gradient(135deg, ${ca} 0 4px, ${cb} 4px 8px)` },
      label: "Too close to call",
    },
    { swatch: { background: ca }, label: "Projected" },
  ];
  return (
    <div
      style={{
        marginTop: 12,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px 16px",
        fontFamily: FONT.mono,
        fontSize: 10,
        color: BLEND.mutedDim,
      }}
    >
      {items.map((i) => (
        <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Swatch style={i.swatch} />
          {i.label}
        </span>
      ))}
      {[a, b].filter(Boolean).map((c) => (
        <span key={c!.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Swatch style={{ background: c!.color }} />
          {c!.name}
        </span>
      ))}
    </div>
  );
}

// ---- call alert ----

export function CallAlertBanner({
  alert,
  view,
  onDismiss,
}: {
  alert: CallAlert;
  view: NightView;
  onDismiss: () => void;
}) {
  const cand = view.candidates.find((c) => c.id === alert.candidateId);
  return (
    <div
      key={alert.key}
      role="status"
      aria-live="polite"
      className={`night-alert ${styles.alertIn}`}
      onClick={onDismiss}
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "rgba(12,12,18,.96)",
        border: `1px solid ${BLEND.hairlineStrong}`,
        boxShadow: "0 8px 24px rgba(0,0,0,.55)",
        cursor: "pointer",
      }}
    >
      <i
        aria-hidden
        style={{ width: 6, flex: "none", display: "block", background: alert.color }}
      />
      <div style={{ padding: "8px 14px", minWidth: 0, flex: 1 }}>
        <div style={{ ...MONO_LABEL, color: BLEND.gold, letterSpacing: ".14em" }}>Projected</div>
        <div
          className="night-alert__title"
          style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.2 }}
        >
          {alert.candidateName} wins {alert.stateName}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 11.5, color: BLEND.muted, marginTop: 2 }}>
          {alert.ev} electoral votes
          {cand ? ` / ${cand.name} ${cand.ev} of ${view.evNeeded}` : ""}
        </div>
      </div>
    </div>
  );
}

// ---- side blocks ----

export function NextClosing({
  view,
  night,
  progress,
  windowRealMs,
}: {
  view: NightView;
  night: { windowStart: string; windowEnd: string } | null;
  progress: number;
  windowRealMs: number;
}) {
  const next = view.nextClose;
  return (
    <Block
      title="Next polls close"
      aside={`${view.statesPollsClosed} of ${view.totalStates} closed`}
    >
      {next && night ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span style={{ fontFamily: FONT.mono, fontSize: 22, fontWeight: 600 }}>
              {next.label}
            </span>
            <span style={{ fontFamily: FONT.mono, fontSize: 13, color: BLEND.caution }}>
              in {formatCountdown(msUntil(next.at, night, progress, windowRealMs))}
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: BLEND.muted, lineHeight: 1.45 }}>
            {next.stateNames.join(", ")}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13.5, color: BLEND.muted }}>Polls have closed in every state.</div>
      )}
    </Block>
  );
}

export function CandidateTotals({ view }: { view: NightView }) {
  return (
    <Block
      title={view.settled ? "Final vote" : "Votes counted so far"}
      aside={`${view.reportingPct.toFixed(view.reportingPct >= 100 ? 0 : 1)}% reporting`}
    >
      {view.candidates.map((c) => (
        <div key={c.id} style={{ padding: "7px 0", borderBottom: `1px solid ${BLEND.hairline}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <i
              aria-hidden
              style={{
                width: 9,
                height: 9,
                background: c.color,
                display: "block",
                alignSelf: "center",
                flex: "none",
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 13.5,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.name}
            </span>
            <span style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 600 }}>
              {c.sharePct.toFixed(1)}%
            </span>
          </div>
          <div style={{ marginTop: 4, height: 3, background: BLEND.trackAlt }}>
            <i
              style={{
                display: "block",
                height: "100%",
                width: `${Math.min(100, c.sharePct)}%`,
                background: c.color,
              }}
            />
          </div>
          <div style={{ marginTop: 4, fontFamily: FONT.mono, fontSize: 11, color: BLEND.mutedDim }}>
            {Math.round(c.votes).toLocaleString("en-US")} votes / {c.ev} EV called
          </div>
        </div>
      ))}
    </Block>
  );
}

export function NightFeed({
  items,
  collapsible = false,
}: {
  items: NightFeedItem[];
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const list = (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.length === 0 ? (
        <li style={{ fontSize: 13, color: BLEND.mutedDim }}>Polls have not closed yet.</li>
      ) : null}
      {items.map((i) => (
        <li
          key={i.key}
          style={{
            display: "flex",
            gap: 10,
            padding: "7px 0 7px 8px",
            borderBottom: `1px solid ${BLEND.hairline}`,
            borderLeft: `3px solid ${i.color ?? BLEND.hairlineStrong}`,
          }}
        >
          <span
            style={{
              flex: "none",
              width: 64,
              fontFamily: FONT.mono,
              fontSize: 10.5,
              color: BLEND.mutedDim,
              paddingTop: 2,
            }}
          >
            {i.clock.replace(" ET", "")}
          </span>
          <span
            style={{
              fontSize: 13,
              lineHeight: 1.4,
              color: i.kind === "call" ? BLEND.ink : BLEND.muted,
            }}
          >
            {i.text}
          </span>
        </li>
      ))}
    </ol>
  );
  if (!collapsible) return <Block title="Feed">{list}</Block>;
  return (
    <section style={{ padding: "12px 18px", borderBottom: `1px solid ${BLEND.hairline}` }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          ...MONO_LABEL,
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          padding: "4px 0 8px",
          cursor: "pointer",
          background: "transparent",
          border: 0,
          borderBottom: `1px solid ${BLEND.hairlineStrong}`,
          marginBottom: open ? 10 : 0,
        }}
      >
        <span>Feed ({items.length})</span>
        <span>{open ? "Hide" : "Show"}</span>
      </button>
      {open ? list : null}
    </section>
  );
}

export function KeyRaces({ races }: { races: NightKeyRace[] }) {
  if (races.length === 0) return null;
  return (
    <section style={{ padding: "14px 18px", borderTop: `1px solid ${BLEND.hairline}` }}>
      <div style={{ ...BLEND_LABEL, marginBottom: 8 }}>Key races</div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {races.map((r) => (
          <li
            key={r.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: BLEND.inset,
              border: `1px solid ${r.status === "too_close" ? BLEND.caution : BLEND.hairlineStrong}`,
              fontSize: 12.5,
            }}
          >
            <b style={{ fontWeight: 600 }}>{r.name}</b>
            <span style={{ fontFamily: FONT.mono, fontSize: 11, color: BLEND.muted }}>
              {r.ev} EV
            </span>
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 11,
                color: r.status === "too_close" ? BLEND.caution : BLEND.mutedDim,
              }}
            >
              {r.status === "too_close" ? "Too close to call" : "Not yet called"} /{" "}
              {r.reportingPct.toFixed(0)}% reporting
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- settled ----

export function SettledPanel({
  view,
  candidateName,
  contingent,
  href,
  onContinue,
}: {
  view: NightView;
  candidateName: (id: string) => string;
  contingent?: { result?: ContingentElectionDisplay };
  href: string;
  onContinue?: () => void;
}) {
  const winner = view.winnerId ? view.candidates.find((c) => c.id === view.winnerId) : undefined;
  const result = contingent?.result;
  const linkStyle: CSSProperties = {
    display: "inline-block",
    padding: "8px 14px",
    border: `1px solid ${BLEND.hairlineStrong}`,
    background: "transparent",
    color: BLEND.ink,
    textDecoration: "none",
    fontFamily: FONT.sans,
    fontSize: 13.5,
    fontWeight: 500,
    cursor: "pointer",
  };
  return (
    <section
      data-testid="night-settled"
      style={{
        padding: "16px 18px",
        borderBottom: `1px solid ${BLEND.hairlineStrong}`,
        background: BLEND.inset,
        borderLeft: `4px solid ${winner ? winner.color : BLEND.caution}`,
      }}
    >
      {winner ? (
        <>
          <div style={{ ...MONO_LABEL, color: BLEND.gold }}>Projected winner</div>
          <div style={{ fontSize: 24, fontWeight: 600, marginTop: 2 }}>{winner.name}</div>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: BLEND.muted }}>
            {winner.ev} electoral votes, {view.evNeeded} needed. All {view.totalStates} states
            called, 100% reporting.
          </p>
        </>
      ) : (
        <>
          <div style={{ ...MONO_LABEL, color: BLEND.caution }}>Contingent election</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>
            No candidate reached {view.evNeeded} electoral votes
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: BLEND.muted }}>
            {result
              ? `The House elected ${candidateName(result.presidentWinnerId)} with ${result.houseVoteTotals[result.presidentWinnerId] ?? 0} state delegation votes.`
              : "The presidency goes to a contingent election in the House of Representatives."}{" "}
            All {view.totalStates} states called, 100% reporting.
          </p>
        </>
      )}
      <div style={{ marginTop: 12 }}>
        {onContinue ? (
          <button type="button" onClick={onContinue} style={linkStyle}>
            View concluded results
          </button>
        ) : (
          <Link href={href} style={linkStyle}>
            View concluded results
          </Link>
        )}
      </div>
    </section>
  );
}
