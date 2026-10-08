"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { BLEND, BLEND_LABEL, FONT } from "@/components/blend/tokens";
import { shadeColorForTier } from "@/lib/elections/marginTierShade";
import { TIER_BANDS } from "../generalBlendViewModel";
import { StatePanel } from "./StatePanel";
import { FOG_FILL, StateLabels, StatePaths } from "./StateShapes";
import type { PresMapModel, PresMapState } from "./presMapModel";
import { CALLOUT_STATES } from "./usStates";
import { loadUsStateGeo, MAP_HEIGHT, MAP_WIDTH, type StateGeo } from "./usStatesGeo";
import { usePanZoom } from "./usePanZoom";
import { MAX_ZOOM, MIN_ZOOM, isIdentityView } from "./mapView";

/** Container width at which the state overview sits over the map instead of rising as a sheet. */
const PANEL_MIN_WIDTH = 640;

export interface PresidentialMapProps {
  /**
   * Per-state display data. A state missing from `model.states` is drawn in
   * the fog colour and cannot be opened, which is how a broadcast view holds
   * back states that have not reported. Callers may override `fill` and `ink`
   * on any state to grey, fog or call it.
   */
  model: PresMapModel;
  electionId: string;
  countryId: string;
  /** Changes when the race re-tallies, so county results are fetched fresh. */
  turn: number | null;
}

type Hover = { id: string; x: number; y: number } | null;

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(MAP_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || MAP_WIDTH);
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * The US presidential map: geographic states shaded by margin tier in the
 * leader's colour, locked by default, with a state overview on click.
 *
 * Locked means the page owns the wheel and the touch: no gesture on the map is
 * captured until the reader unlocks it.
 */
export function PresidentialMap({ model, electionId, countryId, turn }: PresidentialMapProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frameRef);
  const scale = width / MAP_WIDTH;
  const wide = width >= PANEL_MIN_WIDTH;

  const [geo, setGeo] = useState<StateGeo[] | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);

  useEffect(() => {
    let live = true;
    loadUsStateGeo().then(
      (g) => live && setGeo(g),
      () => live && setGeoFailed(true)
    );
    return () => {
      live = false;
    };
  }, []);

  const pz = usePanZoom({
    svgRef,
    enabled: unlocked,
    scale,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
  });

  const states = model.states;
  const geoById = useMemo(() => new Map((geo ?? []).map((g) => [g.id, g])), [geo]);
  const selectedState: PresMapState | null = selected ? (states[selected] ?? null) : null;

  const select = useCallback((id: string | null) => {
    setSelected(id);
    setHover(null);
  }, []);

  useEffect(() => {
    if (!selectedState) return;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedState, select]);

  const stateAt = (target: EventTarget): string | null => {
    const id = (target as Element).getAttribute?.("data-state");
    return id && states[id] ? id : null;
  };

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    if (pz.consumeDrag()) return;
    const id = stateAt(e.target);
    if (id) select(id === selected ? null : id);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const id = stateAt(e.target);
    if (!id) return;
    e.preventDefault();
    select(id === selected ? null : id);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    pz.handlers.onPointerMove(e);
    if (e.pointerType !== "mouse" || pz.dragging) return;
    const id = stateAt(e.target);
    const rect = frameRef.current?.getBoundingClientRect();
    if (!id || !rect) {
      setHover((h) => (h ? null : h));
      return;
    }
    setHover({ id, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const selectedGeo = selected ? geoById.get(selected) : undefined;
  const hoverGeo = hover && hover.id !== selected ? geoById.get(hover.id) : undefined;
  const hoverState = hover ? states[hover.id] : undefined;
  const atRest = isIdentityView(pz.view);

  const callouts = CALLOUT_STATES.map((id) => states[id]).filter((s): s is PresMapState => !!s);

  return (
    <div style={{ fontFamily: FONT.sans, color: BLEND.ink }}>
      <div
        ref={frameRef}
        style={{
          position: "relative",
          background: BLEND.inset,
          border: `1px solid ${BLEND.hairline}`,
          // Room for the overview beside the map without it scrolling at once.
          minHeight: selectedState && wide ? 640 : undefined,
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          role="group"
          aria-label="US presidential map by state"
          data-locked={unlocked ? "false" : "true"}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onPointerDown={pz.handlers.onPointerDown}
          onPointerMove={onMove}
          onPointerUp={pz.handlers.onPointerUp}
          onPointerCancel={pz.handlers.onPointerCancel}
          onPointerLeave={() => setHover(null)}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            aspectRatio: `${MAP_WIDTH} / ${MAP_HEIGHT}`,
            // Locked: the browser keeps vertical scrolling. Unlocked: gestures are ours.
            touchAction: unlocked ? "none" : "pan-y pinch-zoom",
            cursor: unlocked ? (pz.dragging ? "grabbing" : "grab") : "default",
            userSelect: "none",
          }}
        >
          {geo ? (
            <g transform={`translate(${pz.view.x} ${pz.view.y}) scale(${pz.view.k})`}>
              <StatePaths geo={geo} states={states} />
              <StateLabels geo={geo} states={states} k={pz.view.k} scale={scale} />
              {hoverGeo ? (
                <path
                  d={hoverGeo.d}
                  fill="none"
                  stroke={BLEND.ink}
                  strokeOpacity={0.7}
                  strokeWidth={1.4}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              ) : null}
              {selectedGeo ? (
                <path
                  d={selectedGeo.d}
                  fill="none"
                  stroke={BLEND.ink}
                  strokeWidth={2.2}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              ) : null}
            </g>
          ) : null}
        </svg>

        {!geo ? (
          <div
            role="status"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              fontSize: 13,
              color: BLEND.mutedDim,
            }}
          >
            {geoFailed ? "The map could not be loaded." : "Loading map..."}
          </div>
        ) : null}

        <MapControls
          unlocked={unlocked}
          canZoomIn={pz.view.k < MAX_ZOOM}
          canZoomOut={pz.view.k > MIN_ZOOM}
          atRest={atRest}
          onToggle={() => {
            if (unlocked) pz.reset();
            setUnlocked(!unlocked);
          }}
          onZoom={pz.zoomBy}
          onReset={pz.reset}
        />

        {!unlocked && geo ? (
          <div
            style={{
              position: "absolute",
              left: 10,
              bottom: 8,
              fontFamily: FONT.mono,
              fontSize: 10,
              letterSpacing: ".06em",
              color: BLEND.mutedDim,
              pointerEvents: "none",
            }}
          >
            LOCKED. UNLOCK TO PAN AND ZOOM.
          </div>
        ) : null}

        {hoverState && hover ? (
          <HoverTip state={hoverState} x={hover.x} y={hover.y} frameWidth={width} />
        ) : null}

        {selectedState && wide ? (
          <aside
            aria-label={`${selectedState.name} overview`}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: Math.min(400, Math.round(width * 0.5)),
              overflowY: "auto",
              padding: 16,
              background: BLEND.rail,
              borderLeft: `1px solid ${BLEND.hairlineStrong}`,
              boxShadow: "-12px 0 24px rgba(0,0,0,.35)",
            }}
          >
            <StatePanel
              ref={panelRef}
              state={selectedState}
              model={model}
              electionId={electionId}
              countryId={countryId}
              turn={turn}
              onClose={() => select(null)}
            />
          </aside>
        ) : null}
      </div>

      <MapKey model={model} />

      {callouts.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ ...BLEND_LABEL, marginBottom: 6 }}>Small states and DC</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {callouts.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => select(s.id === selected ? null : s.id)}
                title={`${s.name}: ${s.leaderName} +${s.margin.toFixed(1)}pp`}
                aria-label={`${s.name}, ${s.ev} electoral votes, ${s.leaderName} leads by ${s.margin.toFixed(1)} points`}
                aria-pressed={s.id === selected}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 6,
                  padding: "6px 9px",
                  cursor: "pointer",
                  font: "inherit",
                  fontFamily: FONT.mono,
                  fontSize: 11,
                  color: s.ink,
                  background: s.fill,
                  border: `1px solid ${s.id === selected ? BLEND.ink : "transparent"}`,
                }}
              >
                <b style={{ fontWeight: 700 }}>{s.id}</b>
                <span style={{ opacity: 0.8 }}>{s.ev}</span>
                <span style={{ opacity: 0.65, fontSize: 10 }}>+{s.margin.toFixed(1)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {selectedState && !wide ? (
        <BottomSheet label={`${selectedState.name} overview`} onClose={() => select(null)}>
          <StatePanel
            ref={panelRef}
            state={selectedState}
            model={model}
            electionId={electionId}
            countryId={countryId}
            turn={turn}
            onClose={() => select(null)}
          />
        </BottomSheet>
      ) : null}
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 34,
        height: 34,
        display: "grid",
        placeItems: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        font: "inherit",
        fontFamily: FONT.mono,
        fontSize: 16,
        lineHeight: 1,
        color: active ? BLEND.accentInk : BLEND.ink,
        background: active ? "rgba(220,38,38,.16)" : BLEND.rail,
        border: `1px solid ${active ? BLEND.accent : BLEND.hairlineStrong}`,
      }}
    >
      {children}
    </button>
  );
}

function MapControls({
  unlocked,
  canZoomIn,
  canZoomOut,
  atRest,
  onToggle,
  onZoom,
  onReset,
}: {
  unlocked: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  atRest: boolean;
  onToggle: () => void;
  onZoom: (direction: 1 | -1) => void;
  onReset: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <ControlButton
        label={unlocked ? "Lock map (page scrolling resumes)" : "Unlock map to pan and zoom"}
        onClick={onToggle}
        active={unlocked}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <rect x="3" y="7" width="10" height="7" />
          {unlocked ? <path d="M5 7V5a3 3 0 0 1 5.6-1.5" /> : <path d="M5 7V5a3 3 0 0 1 6 0v2" />}
        </svg>
      </ControlButton>
      {unlocked ? (
        <>
          <ControlButton label="Zoom in" onClick={() => onZoom(1)} disabled={!canZoomIn}>
            +
          </ControlButton>
          <ControlButton label="Zoom out" onClick={() => onZoom(-1)} disabled={!canZoomOut}>
            &minus;
          </ControlButton>
          <ControlButton label="Reset view" onClick={onReset} disabled={atRest}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <path d="M3 8a5 5 0 1 0 1.8-3.8M3 2v3h3" />
            </svg>
          </ControlButton>
        </>
      ) : null}
    </div>
  );
}

function HoverTip({
  state,
  x,
  y,
  frameWidth,
}: {
  state: PresMapState;
  x: number;
  y: number;
  frameWidth: number;
}) {
  const flip = x > frameWidth - 210;
  return (
    <div
      role="tooltip"
      style={{
        position: "absolute",
        left: flip ? x - 14 : x + 14,
        top: Math.max(4, y - 10),
        transform: flip ? "translateX(-100%)" : undefined,
        pointerEvents: "none",
        zIndex: 5,
        padding: "8px 10px",
        minWidth: 160,
        background: BLEND.page,
        border: `1px solid ${BLEND.hairlineStrong}`,
        boxShadow: "0 6px 18px rgba(0,0,0,.5)",
        fontSize: 12.5,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, fontWeight: 600 }}>
        <span>{state.name}</span>
        <span style={{ fontFamily: FONT.mono, fontWeight: 500, color: BLEND.muted }}>
          {state.ev} EV
        </span>
      </div>
      <div
        style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, color: BLEND.muted }}
      >
        <i
          aria-hidden
          style={{ width: 8, height: 8, display: "block", background: state.leaderColor }}
        />
        {state.leaderName}
      </div>
      <div style={{ marginTop: 2, fontFamily: FONT.mono, fontSize: 11, color: BLEND.mutedDim }}>
        +{state.margin.toFixed(1)}pp / {TIER_BANDS.find((t) => t.tier === state.tier)?.label}
      </div>
    </div>
  );
}

/** Colour key: each tier's shade in the two leading tickets' colours. */
function MapKey({ model }: { model: PresMapModel }) {
  const [a, b] = model.legendCandidates;
  return (
    <div
      style={{
        marginTop: 12,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px 18px",
        fontFamily: FONT.mono,
        fontSize: 10,
        color: BLEND.mutedDim,
      }}
    >
      <span style={{ letterSpacing: ".1em" }}>MARGIN TIERS:</span>
      {TIER_BANDS.map((t) => (
        <span key={t.tier} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {[a, b].filter(Boolean).map((c) => (
            <i
              key={c.id}
              style={{
                width: 9,
                height: 9,
                display: "block",
                background: shadeColorForTier(c.color, t.tier, BLEND.page),
              }}
            />
          ))}
          {t.label} <span style={{ opacity: 0.6 }}>{t.band}</span>
        </span>
      ))}
      {[a, b].filter(Boolean).map((c) => (
        <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i style={{ width: 9, height: 9, display: "block", background: c.color }} />
          {c.name}
        </span>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <i
          style={{
            width: 9,
            height: 9,
            display: "block",
            background: FOG_FILL,
            border: `1px solid ${BLEND.hairlineStrong}`,
          }}
        />
        No projection
      </span>
    </div>
  );
}

function BottomSheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <div
        onClick={onClose}
        aria-hidden
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "82vh",
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: "8px 16px calc(20px + env(safe-area-inset-bottom))",
          background: BLEND.rail,
          borderTop: `1px solid ${BLEND.hairlineStrong}`,
          boxShadow: "0 -12px 30px rgba(0,0,0,.5)",
        }}
      >
        <div
          aria-hidden
          style={{ width: 36, height: 3, margin: "0 auto 12px", background: BLEND.hairlineStrong }}
        />
        {children}
      </div>
    </div>
  );
}
