"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
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

/** Rail widths in px, kept per browser so a reader's layout survives reloads. */
interface RailWidths {
  left: number;
  right: number;
}

const DEFAULT_WIDTHS: RailWidths = { left: 280, right: 300 };
const LIMITS = { left: [220, 560], right: [220, 520] } as const;
const STORAGE_KEY = "ahd-pres-stage-rails";

function clampWidth(side: keyof RailWidths, w: number): number {
  const [lo, hi] = LIMITS[side];
  return Math.round(Math.min(hi, Math.max(lo, w)));
}

function readStoredRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Other tabs resizing the stage update this one too. */
function subscribeStorage(onChange: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function parseWidths(raw: string | null): RailWidths {
  if (!raw) return DEFAULT_WIDTHS;
  try {
    const parsed = JSON.parse(raw) as Partial<RailWidths>;
    return {
      left: clampWidth("left", Number(parsed.left) || DEFAULT_WIDTHS.left),
      right: clampWidth("right", Number(parsed.right) || DEFAULT_WIDTHS.right),
    };
  } catch {
    return DEFAULT_WIDTHS;
  }
}

/**
 * Drag handle on a rail's inner edge. Dragging resizes the rail; a double
 * click puts it back to its default width. Arrow keys nudge it, so the handle
 * works without a pointer.
 */
function RailHandle({
  side,
  width,
  onResize,
  onReset,
}: {
  side: keyof RailWidths;
  width: number;
  onResize: (w: number) => void;
  onReset: () => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);
  const sign = side === "left" ? 1 : -1;
  const end = () => {
    start.current = null;
    setActive(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${side} panel`}
      aria-valuenow={width}
      aria-valuemin={LIMITS[side][0]}
      aria-valuemax={LIMITS[side][1]}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      className="pres-stage__handle"
      data-active={active ? "true" : undefined}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onResize(start.current.w + sign * (e.clientX - start.current.x));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        onResize(width + sign * (e.key === "ArrowRight" ? 24 : -24));
      }}
      style={
        side === "left"
          ? { left: "calc(var(--ps-left) - 4px)" }
          : { right: "calc(var(--ps-right) - 4px)" }
      }
    />
  );
}

/**
 * The presidential race screen. On desktop the map takes the whole viewport
 * under the site navbar, with the scoreboard docked to its left and the
 * context rail to its right, each scrolling on its own and each resizable by
 * dragging its inner edge. Nothing else on the site is laid out this way, on
 * purpose: the national map is the race.
 *
 * Below `lg` the same pieces stack: masthead, map, scoreboard, context.
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

  // Stored widths only exist in the browser: the server renders the defaults
  // and the stored layout takes over on hydration. A drag overrides both and
  // is written back.
  const stored = useSyncExternalStore(subscribeStorage, readStoredRaw, () => null);
  const [dragged, setDragged] = useState<RailWidths | null>(null);
  const widths = dragged ?? parseWidths(stored);
  useEffect(() => {
    if (!dragged) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dragged));
    } catch {
      // storage unavailable: the widths simply do not persist
    }
  }, [dragged]);
  const setWidths = useCallback(
    (fn: (cur: RailWidths) => RailWidths) => setDragged((d) => fn(d ?? widths)),
    [widths]
  );

  const resize = useCallback(
    (side: keyof RailWidths) => (w: number) =>
      setWidths((cur) => ({ ...cur, [side]: clampWidth(side, w) })),
    [setWidths]
  );
  const reset = useCallback(
    (side: keyof RailWidths) => () =>
      setWidths((cur) => ({ ...cur, [side]: DEFAULT_WIDTHS[side] })),
    [setWidths]
  );

  const toggle = squares ? (
    <div
      role="tablist"
      aria-label="Board view"
      style={{ display: "inline-flex", flexShrink: 0, border: `1px solid ${BLEND.hairlineStrong}` }}
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
  ) : null;

  return (
    <section
      className={right ? "pres-stage" : "pres-stage pres-stage--no-right"}
      style={
        {
          background: BLEND.page,
          color: BLEND.ink,
          fontFamily: FONT.sans,
          borderBottom: `1px solid ${BLEND.hairlineStrong}`,
          "--ps-left": `${widths.left}px`,
          "--ps-right": `${widths.right}px`,
        } as React.CSSProperties
      }
    >
      <aside className="pres-stage__rail pres-stage__rail--left">
        {nav ? <div style={{ padding: "10px 16px 0" }}>{nav}</div> : null}
        <div style={{ padding: "12px 16px 24px" }}>{left}</div>
      </aside>

      <div className="pres-stage__centre">
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 16,
            padding: "16px 20px 12px",
            borderBottom: `1px solid ${BLEND.hairline}`,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
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
                fontSize: "clamp(24px, 2.6vw, 44px)",
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
          </div>
          {toggle}
        </header>
        {ticker}
        {showSquares ? (
          <div className="pres-stage__board pres-stage__board--squares">{squares}</div>
        ) : (
          <div className="pres-stage__board">{map}</div>
        )}
      </div>

      {right ? (
        <aside className="pres-stage__rail pres-stage__rail--right">
          <div style={{ padding: "16px 16px 24px" }}>{right}</div>
        </aside>
      ) : null}

      <RailHandle
        side="left"
        width={widths.left}
        onResize={resize("left")}
        onReset={reset("left")}
      />
      {right ? (
        <RailHandle
          side="right"
          width={widths.right}
          onResize={resize("right")}
          onReset={reset("right")}
        />
      ) : null}

      <style>{`
        .pres-stage { position: relative; display: flex; flex-direction: column; }
        .pres-stage__centre { order: 1; display: flex; flex-direction: column; min-width: 0; }
        .pres-stage__rail--left { order: 2; }
        .pres-stage__rail--right { order: 3; }
        .pres-stage__rail {
          position: relative;
          background: ${BLEND.rail};
          border-top: 1px solid ${BLEND.hairlineStrong};
        }
        .pres-stage__handle {
          display: none;
          position: absolute;
          top: 0;
          bottom: 0;
          width: 7px;
          z-index: 6;
          cursor: col-resize;
          touch-action: none;
        }
        .pres-stage__handle:hover,
        .pres-stage__handle:focus-visible { background: ${BLEND.hairlineStrong}; outline: none; }
        .pres-stage__handle[data-active] { background: ${BLEND.accent}; }
        .pres-stage__board { position: relative; height: min(70vh, 540px); min-height: 300px; }
        .pres-stage__board--squares { height: auto; padding: 14px 12px; }
        @media (min-width: 1024px) {
          .pres-stage {
            display: grid;
            height: calc(100dvh - 3.5rem);
            min-height: 640px;
            grid-template-columns: var(--ps-left) minmax(0, 1fr) var(--ps-right);
          }
          .pres-stage--no-right { grid-template-columns: var(--ps-left) minmax(0, 1fr); }
          .pres-stage__centre,
          .pres-stage__rail--left,
          .pres-stage__rail--right { order: 0; }
          .pres-stage__centre { min-height: 0; }
          .pres-stage__rail {
            min-height: 0;
            overflow-y: auto;
            overscroll-behavior: contain;
            border-top: none;
          }
          .pres-stage__rail--left { border-right: 1px solid ${BLEND.hairlineStrong}; }
          .pres-stage__rail--right { border-left: 1px solid ${BLEND.hairlineStrong}; }
          .pres-stage__handle { display: block; }
          .pres-stage__board { flex: 1; height: auto; min-height: 0; }
          .pres-stage__board--squares { overflow-y: auto; padding: 18px 24px; }
        }
      `}</style>
    </section>
  );
}
