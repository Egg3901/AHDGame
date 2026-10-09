"use client";

import { useState, type ReactNode } from "react";
import { BLEND, FONT } from "@/components/blend/tokens";

/** The stage headline: "The 1992 Presidential Election". */
export function presidentialTitle(year: number | string | null | undefined): string {
  return year ? `The ${year} Presidential Election` : "The Presidential Election";
}

export interface PresidentialStageProps {
  /** "The 1992 Presidential Election". */
  title: string;
  /** Small caps line above the title: phase and countdown. */
  kicker?: ReactNode;
  /** The live story line under the title. */
  deck?: ReactNode;
  /** Strip under the masthead (the wire ticker). */
  ticker?: ReactNode;
  /** Previous / next cycle navigation, top of the left rail. */
  nav?: ReactNode;
  /** The scoreboard: head-to-head, college or delegate bar, the field. */
  left: ReactNode;
  /** Context blocks. Omitted on screens that have none. */
  right?: ReactNode;
  /** The map. It is given the whole centre column below the masthead. */
  map: ReactNode;
  /** The state squares board. When given, a toggle switches between it and the map. */
  squares?: ReactNode;
}

/**
 * The presidential race's desktop screen: the map takes the whole viewport
 * under the site navbar, with the scoreboard docked to its left and the
 * context rail to its right, each scrolling on its own. Nothing else on the
 * site is laid out this way, on purpose: the national map is the race.
 *
 * Desktop only (`lg` and up). Phones keep each view's own stacked layout.
 */
export function PresidentialStage({
  title,
  kicker,
  deck,
  ticker,
  nav,
  left,
  right,
  map,
  squares,
}: PresidentialStageProps) {
  const [view, setView] = useState<"map" | "squares">("map");
  const showSquares = view === "squares" && !!squares;
  return (
    <section
      className="pres-stage"
      style={{
        background: BLEND.page,
        color: BLEND.ink,
        fontFamily: FONT.sans,
        borderBottom: `1px solid ${BLEND.hairlineStrong}`,
      }}
    >
      <aside className="pres-stage__rail pres-stage__rail--left">
        {nav ? <div style={{ padding: "10px 18px 0" }}>{nav}</div> : null}
        <div style={{ padding: "14px 18px 24px" }}>{left}</div>
      </aside>

      <div className="pres-stage__centre">
        <header
          style={{
            position: "relative",
            padding: "18px 24px 14px",
            borderBottom: `1px solid ${BLEND.hairline}`,
          }}
        >
          {squares ? (
            <div
              role="tablist"
              aria-label="Board view"
              style={{
                position: "absolute",
                top: 18,
                right: 24,
                display: "inline-flex",
                border: `1px solid ${BLEND.hairlineStrong}`,
              }}
            >
              {(["map", "squares"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  style={{
                    padding: "6px 14px",
                    cursor: "pointer",
                    font: "inherit",
                    fontFamily: FONT.mono,
                    fontSize: 11,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    border: "none",
                    color: view === v ? BLEND.ink : BLEND.muted,
                    background: view === v ? BLEND.hairlineStrong : "transparent",
                  }}
                >
                  {v === "map" ? "Map" : "Squares"}
                </button>
              ))}
            </div>
          ) : null}
          {kicker ? (
            <div
              style={{
                fontFamily: FONT.mono,
                fontSize: 10.5,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: BLEND.muted,
              }}
            >
              {kicker}
            </div>
          ) : null}
          <h1
            style={{
              margin: "6px 0 0",
              fontFamily: FONT.sans,
              fontSize: "clamp(28px, 2.6vw, 44px)",
              lineHeight: 1.05,
              fontWeight: 650,
              letterSpacing: "-0.025em",
            }}
          >
            {title}
          </h1>
          {deck ? (
            <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.4, color: BLEND.muted }}>
              {deck}
            </p>
          ) : null}
        </header>
        {ticker}
        {showSquares ? (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 24px" }}>
            {squares}
          </div>
        ) : (
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>{map}</div>
        )}
      </div>

      {right ? (
        <aside className="pres-stage__rail pres-stage__rail--right">
          <div style={{ padding: "18px 18px 24px" }}>{right}</div>
        </aside>
      ) : null}

      <style>{`
        .pres-stage {
          display: grid;
          height: calc(100dvh - 3.5rem);
          min-height: 640px;
          grid-template-columns: minmax(330px, 24vw) minmax(0, 1fr) ${right ? "minmax(270px, 19vw)" : ""};
        }
        .pres-stage__rail {
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          background: ${BLEND.rail};
        }
        .pres-stage__rail--left { border-right: 1px solid ${BLEND.hairlineStrong}; }
        .pres-stage__rail--right { border-left: 1px solid ${BLEND.hairlineStrong}; }
        .pres-stage__centre {
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
        }
      `}</style>
    </section>
  );
}
