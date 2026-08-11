"use client";

import type { ReactNode } from "react";
import { renderInlineEmphasis } from "@/lib/utils/inlineEmphasis";
import { dispatchStatusMeta, toneColor, posName } from "./status";
import { VOTE_COLORS, type VoteCounts } from "./voteSeating";

export function KickerLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 10.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--primary)",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  const meta = dispatchStatusMeta(status);
  const c = toneColor(meta.tone);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: size === "sm" ? "3px 8px" : "5px 11px",
        borderRadius: 999,
        fontSize: size === "sm" ? 10 : 11.5,
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: c,
        background: `color-mix(in srgb, ${c} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 32%, transparent)`,
        whiteSpace: "nowrap",
      }}
    >
      {meta.live && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: c,
            animation: "pulse 1.4s infinite",
          }}
        />
      )}
      {meta.label}
    </span>
  );
}

export function PositionBadges({ econ, social }: { econ?: number | null; social?: number | null }) {
  const items: Array<{ k: string; v: string; c: string }> = [];
  if (econ != null && econ !== 0)
    items.push({
      k: "Econ",
      v: posName(econ, "econ"),
      c: econ < 0 ? "var(--info)" : "var(--error)",
    });
  if (social != null && social !== 0)
    items.push({
      k: "Soc",
      v: posName(social, "social"),
      c: social < 0 ? "var(--warning)" : "var(--success)",
    });
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <span
          key={i}
          className="font-mono"
          style={{
            fontSize: 10.5,
            padding: "2px 7px",
            borderRadius: 6,
            color: it.c,
            background: `color-mix(in srgb, ${it.c} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${it.c} 26%, transparent)`,
          }}
        >
          {it.k} · {it.v}
        </span>
      ))}
    </div>
  );
}

export function VoteBar({
  votes,
  eligible,
  height = 10,
}: {
  votes: VoteCounts;
  eligible: number;
  height?: number;
}) {
  const total = eligible || votes.for + votes.against + votes.abstain || 1;
  const pending = Math.max(0, total - votes.for - votes.against - votes.abstain);
  const seg = (n: number, c: string, label: string) =>
    n <= 0 ? null : (
      <div
        title={`${label}: ${n}`}
        style={{
          width: `${(n / total) * 100}%`,
          background: c,
          transition: "width .6s cubic-bezier(.2,.8,.2,1)",
        }}
      />
    );
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height,
        borderRadius: 999,
        overflow: "hidden",
        background: "color-mix(in srgb, var(--muted) 16%, transparent)",
      }}
    >
      {seg(votes.for, VOTE_COLORS.for, "For")}
      {seg(votes.abstain, VOTE_COLORS.abstain, "Abstain")}
      {seg(votes.against, VOTE_COLORS.against, "Against")}
      {seg(pending, "transparent", "Pending")}
    </div>
  );
}

export function VoteLegend({ votes, eligible }: { votes: VoteCounts; eligible: number }) {
  const pending = Math.max(0, eligible - votes.for - votes.against - votes.abstain);
  const items = [
    { k: "For", v: votes.for, c: VOTE_COLORS.for },
    { k: "Against", v: votes.against, c: VOTE_COLORS.against },
    { k: "Abstain", v: votes.abstain, c: VOTE_COLORS.abstain },
    { k: "Not voted", v: pending, c: VOTE_COLORS.pending },
  ];
  return (
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
      {items.map((it) => (
        <div key={it.k} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: it.c }} />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{it.k}</span>
          <span
            className="font-mono tabular-nums"
            style={{ fontSize: 12.5, fontWeight: 700, color: "var(--foreground)" }}
          >
            {it.v}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--card-border)",
        borderRadius: 8,
        padding: 18,
      }}
    >
      {title && (
        <h3
          style={{
            margin: "0 0 14px",
            fontFamily: "var(--font-fraunces)",
            fontSize: 17,
            fontWeight: 600,
            color: "var(--foreground)",
          }}
        >
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

export function CurrentToProposed({
  current,
  proposed,
  direction,
  currentDescription,
  proposedDescription,
}: {
  /** Current-law title. `null`/`undefined` → render the Proposed box only (e.g. subsidies). */
  current?: string | null;
  proposed: string;
  direction: number;
  currentDescription?: string;
  proposedDescription?: string;
}) {
  const arrowC = direction > 0 ? "var(--success)" : direction < 0 ? "var(--error)" : "var(--muted)";
  const descStyle = {
    fontSize: 11,
    lineHeight: 1.45,
    color: "var(--muted)",
    marginTop: 4,
  } as const;
  const showCurrent = current != null;
  return (
    // Mobile: stack Current → Proposed vertically. Desktop (sm+): 3-col row when a
    // current law exists; single column (proposed only) when it does not.
    <div
      className={
        showCurrent
          ? "grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-[1fr_auto_1fr]"
          : "grid grid-cols-1 items-stretch gap-2.5"
      }
    >
      {showCurrent && (
        <div
          style={{
            borderRadius: 6,
            border: "1px solid var(--card-border)",
            background: "color-mix(in srgb, var(--muted) 8%, transparent)",
            padding: "9px 12px",
          }}
        >
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            Current law
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{current}</div>
          {currentDescription && (
            <div style={descStyle}>{renderInlineEmphasis(currentDescription)}</div>
          )}
        </div>
      )}
      {showCurrent && (
        <div
          style={{
            display: "grid",
            placeItems: "center",
            color: arrowC,
            fontSize: 18,
            fontWeight: 700,
          }}
          aria-hidden="true"
        >
          <span className="inline-block rotate-90 sm:rotate-0">→</span>
        </div>
      )}
      <div
        style={{
          borderRadius: 6,
          border: "1px solid color-mix(in srgb, var(--info) 38%, transparent)",
          background: "color-mix(in srgb, var(--info) 9%, transparent)",
          padding: "9px 12px",
        }}
      >
        <div
          style={{
            fontSize: 9,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--info)",
            fontWeight: 700,
            marginBottom: 4,
          }}
        >
          Proposed
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{proposed}</div>
        {proposedDescription && (
          <div style={{ ...descStyle, color: "var(--foreground)", opacity: 0.75 }}>
            {renderInlineEmphasis(proposedDescription)}
          </div>
        )}
      </div>
    </div>
  );
}

export function TheCountRail({
  votes,
  eligible,
  footer,
}: {
  votes: VoteCounts;
  eligible: number;
  footer?: string;
}) {
  return (
    // Mobile (stacked under the row): top divider. Desktop (sm+): left divider — unchanged.
    <div className="border-t border-card-border pt-4 sm:border-l sm:border-t-0 sm:pl-[22px] sm:pt-0">
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 9,
          fontWeight: 600,
        }}
      >
        The Count
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <span
          className="tabular-nums"
          style={{
            fontFamily: "var(--font-fraunces)",
            fontSize: 30,
            fontWeight: 600,
            color: "var(--success)",
            lineHeight: 1,
          }}
        >
          {votes.for}
        </span>
        <span
          className="tabular-nums"
          style={{
            fontFamily: "var(--font-fraunces)",
            fontSize: 30,
            fontWeight: 600,
            color: "var(--error)",
            lineHeight: 1,
          }}
        >
          {votes.against}
        </span>
      </div>
      <VoteBar votes={votes} eligible={eligible} height={6} />
      {footer && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--muted)", fontStyle: "italic" }}>
          {footer}
        </div>
      )}
    </div>
  );
}
