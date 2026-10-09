"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { BLEND, BLEND_LABEL, FONT } from "@/components/blend/tokens";
import { useBlendGround } from "@/components/blend/useBlendGround";
import {
  DATA_VIEWS,
  MOMENTUM_FULL_PP,
  SHARE_RAMP,
  PRESENCE_FULL_LEVEL,
  PRESENCE_VIEW,
  applyCountyView,
  applyDataView,
  applyPresenceView,
  hasShareData,
  mixToward,
  shareCandidates,
  shareStrength,
  type MapDataView,
} from "./dataViews";
import type { PresMapCandidate } from "./presMapModel";
import styles from "@/components/blend/blend.module.css";
import { shadeColorForTier } from "@/lib/elections/marginTierShade";
import { TIER_BANDS } from "../generalBlendViewModel";
import { StatePanel } from "./StatePanel";
import { FOG_FILL, OverlayDefs, StateLabels, StatePaths } from "./StateShapes";
import { stateFigure, type PresMapModel, type PresMapState } from "./presMapModel";
import { CALLOUT_STATES } from "./usStates";
import { loadUsStateGeo, MAP_HEIGHT, MAP_WIDTH, type StateGeo } from "./usStatesGeo";
import { usePanZoom } from "./usePanZoom";
import { MIN_ZOOM, MAX_ZOOM, visibleBox } from "./mapView";
import { COUNTY_ZOOM, CountyPaths, countyOpacity, useCountyRows } from "./CountyLayer";
import { countyFadeGround, type CountyRow } from "./countyModel";
import type { CountySource } from "./countyStore";

/** Container width at which the state overview sits over the map instead of rising as a sheet. */
const PANEL_MIN_WIDTH = 640;

/** The stage zooms far enough to read single counties in the smallest states. */
const STAGE_MAX_ZOOM = 30;
/** Zoom past which the open state shows its counties on its own. */
const SELECTED_COUNTY_ZOOM = 1.5;

/** A broadcast state keeps its counties back until it is called. */
function countiesAllowed(s: PresMapState): boolean {
  return !s.broadcast || s.broadcast.countiesOpen;
}

/** Width of the state overview docked over the stage's right edge. */
const STAGE_PANEL_WIDTH = 380;

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
  /** Replaces the default state overview (the broadcast view swaps in its own). */
  renderPanel?: (state: PresMapState, onClose: () => void) => ReactNode;
  /** Replaces the margin-tier colour key. */
  legend?: ReactNode;
  /**
   * `inline` (default) is a block in the page flow, locked until the reader
   * unlocks it. `stage` fills its parent, always pans and zooms, and reveals
   * county results as the reader zooms in.
   */
  variant?: "inline" | "stage";
  /**
   * Draw county results over states on deep zoom (stage only). A state on the
   * broadcast view only shows its counties once `broadcast.countiesOpen`.
   */
  counties?: boolean;
  /** Told whenever the open state changes. */
  onSelectState?: (stateId: string | null) => void;
  /** Where county results come from; defaults to the race's general tally. */
  countySource?: CountySource;
  /**
   * Open a state from outside the map (the 270 snake, a `?state=` link). A new
   * nonce re-opens the same state.
   */
  focusRequest?: { stateId: string; nonce: number } | null;
  /**
   * The reader's own campaign in this race: adds a "Your campaign" colour-by
   * view shaded by Campaign Presence. Absent for a reader not running.
   */
  presence?: { levels: Readonly<Record<string, number>>; color: string } | null;
  /** Appended to the state overview (the reader's campaign actions there). */
  panelExtra?: (stateId: string) => ReactNode;
}

type Hover = { id: string; county?: string; x: number; y: number } | null;

function useElementSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: MAP_WIDTH, h: MAP_HEIGHT });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setSize({ w: el.clientWidth || MAP_WIDTH, h: el.clientHeight || MAP_HEIGHT });
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      if (w > 0 && h > 0) setSize({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

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
export function PresidentialMap({
  model,
  electionId,
  countryId,
  turn,
  renderPanel,
  legend,
  variant = "inline",
  counties = variant === "stage",
  onSelectState,
  countySource,
  focusRequest,
  presence,
  panelExtra,
}: PresidentialMapProps) {
  const stage = variant === "stage";
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inlineWidth = useElementWidth(frameRef);
  const stageSize = useElementSize(frameRef);
  const width = stage ? stageSize.w : inlineWidth;
  // The stage fits the whole country into whatever shape its frame is; the
  // inline map is always drawn at the map's own aspect ratio.
  const scale = stage
    ? Math.min(stageSize.w / MAP_WIDTH, stageSize.h / MAP_HEIGHT)
    : width / MAP_WIDTH;
  const frameW = stage ? stageSize.w / scale : MAP_WIDTH;
  const frameH = stage ? stageSize.h / scale : MAP_HEIGHT;
  const wide = width >= PANEL_MIN_WIDTH;
  const desk = useIsDesktop();
  // The desktop stage is the whole viewport and nothing scrolls under it, so it
  // owns its gestures from the start. Everywhere else the map sits in a
  // scrolling page and stays locked until the reader unlocks it.
  const freeGestures = stage && desk;
  // Where the state overview opens: docked over the map, or as a bottom sheet.
  const docked = stage ? desk : wide;
  const ground = useBlendGround();
  const [dataView, setDataView] = useState<MapDataView>("margin");
  const [shareCandId, setShareCandId] = useState<string | null>(null);

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
    enabled: freeGestures || unlocked,
    scale,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    frame: stage ? { frameWidth: frameW, frameHeight: frameH, maxZoom: STAGE_MAX_ZOOM } : undefined,
  });

  const shareOn = hasShareData(model);
  const presenceOn = stage && !!presence;
  const viewsOn = stage && (shareOn || presenceOn);
  const viewOptions = [
    ...(shareOn ? DATA_VIEWS : DATA_VIEWS.filter((v) => v.id === "margin")),
    ...(presenceOn ? [PRESENCE_VIEW] : []),
  ];
  const pickable = useMemo(() => (viewsOn ? shareCandidates(model) : []), [viewsOn, model]);
  const shareCand =
    (shareCandId ? pickable.find((c) => c.id === shareCandId) : undefined) ?? pickable[0] ?? null;
  const activeView: MapDataView =
    viewsOn && viewOptions.some((v) => v.id === dataView) ? dataView : "margin";
  const viewModel = useMemo(
    () =>
      activeView === "presence" && presence
        ? applyPresenceView(model, ground, presence)
        : applyDataView(model, activeView, ground, shareCand),
    [model, activeView, ground, shareCand, presence]
  );
  const states = viewModel.states;
  const geoById = useMemo(() => new Map((geo ?? []).map((g) => [g.id, g])), [geo]);
  // The overview reads the race itself, not the repainted view.
  const selectedState: PresMapState | null = selected ? (model.states[selected] ?? null) : null;

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      setHover(null);
      onSelectState?.(id);
      // The stage's open state is in the URL (`?state=OH`), so a state view
      // can be shared and the back button works. History is replaced, not
      // pushed, and Next is not asked to navigate.
      if (stage && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set("state", id);
        else url.searchParams.delete("state");
        window.history.replaceState(window.history.state, "", url);
      }
    },
    [onSelectState, stage]
  );

  // County layer: every state in view once the zoom passes the threshold.
  const candidate = useCallback(
    (id: string) => model.candidates[id] ?? { name: "Unknown", color: "#9CA3AF" },
    [model]
  );
  const k = pz.view.k;
  const countyStates = useMemo(() => {
    if (!stage || !counties || !geo) return [];
    // The open state shows its counties as soon as the map has flown to it;
    // the rest fade in only on deep zoom.
    const open =
      selected && states[selected] && countiesAllowed(states[selected]) ? selected : null;
    if (k < COUNTY_ZOOM) return open && k >= SELECTED_COUNTY_ZOOM ? [open] : [];
    const box = visibleBox(pz.view, MAP_WIDTH, MAP_HEIGHT, {
      frameWidth: frameW,
      frameHeight: frameH,
    });
    return geo
      .filter((g) => {
        const s = states[g.id];
        if (!s || !countiesAllowed(s)) return false;
        return (
          g.x0 < box.x1 && g.x0 + g.width > box.x0 && g.y0 < box.y1 && g.y0 + g.height > box.y0
        );
      })
      .map((g) => g.id)
      .sort();
  }, [stage, counties, geo, k, pz.view, frameW, frameH, states, selected]);
  const countyRows = useCountyRows(electionId, turn, countyStates, candidate, countySource);
  // Rows for states that are in view now; ones loaded earlier stay cached.
  const shownCountyRows = useMemo(() => {
    const out: Record<string, CountyRow[]> = {};
    for (const id of countyStates) {
      const rows = countyRows[id]
        ? applyCountyView(countyRows[id], activeView, countyFadeGround(ground), shareCand)
        : null;
      if (rows) out[id] = rows;
    }
    return out;
  }, [countyStates, countyRows, activeView, ground, shareCand]);
  // Momentum has no county series, so that view stays at state level.
  const countyAlpha =
    activeView === "momentum" || activeView === "presence"
      ? 0
      : k < COUNTY_ZOOM && countyStates.length > 0
        ? 1
        : countyOpacity(k);
  const countyLoading = countyStates.some((id) => !countyRows[id]);

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
    // The stage never toggles a state shut on a second click, so a double
    // click (which zooms) leaves the state it zoomed to open.
    if (!id) return;
    if (!stage) {
      select(id === selected ? null : id);
      return;
    }
    select(id);
    // From the national view, fly to the state, framed left of the panel.
    if (k < COUNTY_ZOOM) zoomToState(id);
  };
  const zoomToState = (id: string) => {
    const g = geoById.get(id);
    if (!g) return;
    pz.zoomToBox(
      { x0: g.x0, y0: g.y0, x1: g.x0 + g.width, y1: g.y0 + g.height },
      docked ? STAGE_PANEL_WIDTH / scale : 0
    );
  };
  // Outside requests to open a state (the 270 snake, a `?state=` link): select
  // it and fly to it once the geometry is in. Handled during render, once per
  // nonce, so repeating a state re-opens it.
  const [handledFocus, setHandledFocus] = useState<number | null>(null);
  if (
    focusRequest &&
    geo &&
    focusRequest.nonce !== handledFocus &&
    model.states[focusRequest.stateId]
  ) {
    setHandledFocus(focusRequest.nonce);
    setSelected(focusRequest.stateId);
    setHover(null);
    if (stage) zoomToState(focusRequest.stateId);
  }

  const onDoubleClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!stage) return;
    const id = stateAt(e.target);
    if (!id) return;
    e.preventDefault();
    zoomToState(id);
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
    const county = (e.target as Element).getAttribute?.("data-county") ?? undefined;
    setHover({ id, county, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const selectedGeo = selected ? geoById.get(selected) : undefined;
  const hoverGeo = hover && hover.id !== selected ? geoById.get(hover.id) : undefined;
  const hoverState = hover ? states[hover.id] : undefined;
  const atRest = pz.view.k === pz.rest.k && pz.view.x === pz.rest.x && pz.view.y === pz.rest.y;
  const hoverCounty =
    hover?.county && countyAlpha > 0
      ? countyRows[hover.id]?.find((r) => r.id === hover.county)
      : undefined;
  const pulsing = useMemo(() => Object.values(states).filter((s) => s.pulse), [states]);

  const panel = selectedState ? (
    renderPanel ? (
      <div ref={panelRef} tabIndex={-1} style={{ outline: "none" }}>
        {renderPanel(selectedState, () => select(null))}
        {panelExtra?.(selectedState.id)}
      </div>
    ) : (
      <>
        <StatePanel
          ref={panelRef}
          state={selectedState}
          model={model}
          electionId={electionId}
          countryId={countryId}
          turn={turn}
          onClose={() => select(null)}
        />
        {panelExtra?.(selectedState.id)}
      </>
    )
  ) : null;

  const callouts = CALLOUT_STATES.map((id) => states[id]).filter((s): s is PresMapState => !!s);

  return (
    <div
      style={
        stage
          ? {
              fontFamily: FONT.sans,
              color: BLEND.ink,
              height: "100%",
              display: "flex",
              flexDirection: "column",
            }
          : { fontFamily: FONT.sans, color: BLEND.ink }
      }
    >
      <div
        ref={frameRef}
        style={
          stage
            ? {
                position: "relative",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                background: BLEND.inset,
              }
            : {
                position: "relative",
                background: BLEND.inset,
                border: `1px solid ${BLEND.hairline}`,
                // Room for the overview beside the map without it scrolling at once.
                minHeight: selectedState && wide ? 640 : undefined,
              }
        }
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${frameW} ${frameH}`}
          role="group"
          aria-label="US presidential map by state"
          data-locked={freeGestures || unlocked ? "false" : "true"}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyDown}
          onPointerDown={pz.handlers.onPointerDown}
          onPointerMove={onMove}
          onPointerUp={pz.handlers.onPointerUp}
          onPointerCancel={pz.handlers.onPointerCancel}
          onPointerLeave={() => setHover(null)}
          style={{
            display: "block",
            width: "100%",
            height: stage ? "100%" : "auto",
            aspectRatio: stage ? undefined : `${MAP_WIDTH} / ${MAP_HEIGHT}`,
            // Locked: the browser keeps vertical scrolling. Unlocked: gestures are ours.
            touchAction: freeGestures || unlocked ? "none" : "pan-y pinch-zoom",
            cursor: freeGestures || unlocked ? (pz.dragging ? "grabbing" : "grab") : "default",
            userSelect: "none",
          }}
        >
          {geo ? (
            <g transform={`translate(${pz.view.x} ${pz.view.y}) scale(${pz.view.k})`}>
              <OverlayDefs states={states} />
              <StatePaths geo={geo} states={states} />
              <CountyPaths rows={shownCountyRows} opacity={countyAlpha} />
              {countyAlpha > 0 ? (
                <StateBorders geo={geo} ids={countyStates} opacity={countyAlpha} />
              ) : null}
              {pulsing.map((s) => {
                const g = geoById.get(s.id);
                return g ? (
                  <path
                    key={`${s.id}:${s.pulse}`}
                    d={g.d}
                    className={styles.callPulse}
                    fill="none"
                    stroke={s.leaderColor}
                    strokeWidth={3}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                ) : null;
              })}
              <StateLabels geo={geo} states={states} k={pz.view.k} scale={scale} />
              {hoverGeo ? (
                <path
                  d={hoverGeo.d}
                  fill="none"
                  style={{ stroke: BLEND.ink }}
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
                  style={{ stroke: BLEND.ink }}
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
          stage={freeGestures}
          unlocked={unlocked}
          canZoomIn={pz.view.k < (stage ? STAGE_MAX_ZOOM : MAX_ZOOM)}
          canZoomOut={pz.view.k > MIN_ZOOM}
          atRest={atRest}
          onToggle={() => {
            if (unlocked) pz.reset();
            setUnlocked(!unlocked);
          }}
          onZoom={pz.zoomBy}
          onReset={pz.reset}
        />

        {freeGestures && geo && (atRest || (countyLoading && countyAlpha > 0)) ? (
          <StageHint k={k} countiesOn={counties} loading={countyLoading && countyAlpha > 0} />
        ) : null}

        {!freeGestures && !unlocked && geo ? (
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

        {hoverState && hover && hoverCounty ? (
          <CountyTip
            county={hoverCounty}
            state={hoverState}
            x={hover.x}
            y={hover.y}
            frameWidth={width}
          />
        ) : hoverState && hover ? (
          <HoverTip state={hoverState} x={hover.x} y={hover.y} frameWidth={width} />
        ) : null}

        {selectedState && panel && docked ? (
          <aside
            aria-label={`${selectedState.name} overview`}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: stage
                ? Math.min(STAGE_PANEL_WIDTH, width)
                : Math.min(400, Math.round(width * 0.5)),
              overflowY: "auto",
              padding: 16,
              background: BLEND.rail,
              borderLeft: `1px solid ${BLEND.hairlineStrong}`,
              boxShadow: "-12px 0 24px rgba(0,0,0,.35)",
            }}
          >
            {panel}
          </aside>
        ) : null}
      </div>

      {stage ? (
        <div
          style={{
            padding: "10px 16px 12px",
            borderTop: `1px solid ${BLEND.hairline}`,
            background: BLEND.page,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px 16px",
              marginBottom: 8,
            }}
          >
            {viewsOn ? (
              <DataViewPicker
                options={viewOptions}
                view={activeView}
                onView={setDataView}
                candidates={pickable}
                shareCand={shareCand}
                onShareCand={setShareCandId}
              />
            ) : (
              <span />
            )}
            {callouts.length > 0 ? (
              <CalloutChips callouts={callouts} selected={selected} onSelect={select} stage />
            ) : null}
          </div>
          {activeView === "margin" ? (
            (legend ?? <MapKey model={model} />)
          ) : (
            <DataViewKey
              view={activeView}
              model={model}
              shareCand={shareCand}
              ground={ground}
              presenceColor={presence?.color ?? null}
            />
          )}
        </div>
      ) : (
        (legend ?? <MapKey model={model} />)
      )}

      {!stage && callouts.length > 0 ? (
        <CalloutChips callouts={callouts} selected={selected} onSelect={select} />
      ) : null}

      {selectedState && panel && !docked ? (
        <BottomSheet label={`${selectedState.name} overview`} onClose={() => select(null)}>
          {panel}
        </BottomSheet>
      ) : null}
    </div>
  );
}

/** One button per small state and DC, which are too small to click on the map. */
function CalloutChips({
  callouts,
  selected,
  onSelect,
  stage = false,
}: {
  callouts: PresMapState[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  stage?: boolean;
}) {
  return (
    <div style={stage ? { display: "flex", alignItems: "center", gap: 8 } : { marginTop: 14 }}>
      <div style={{ ...BLEND_LABEL, marginBottom: stage ? 0 : 6 }}>
        {stage ? "Small states" : "Small states and DC"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: stage ? 3 : 4 }}>
        {callouts.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id === selected && !stage ? null : s.id)}
            title={
              s.caption
                ? `${s.name}: ${s.caption}`
                : `${s.name}: ${s.leaderName} +${s.margin.toFixed(1)}pp`
            }
            aria-label={
              s.caption
                ? `${s.name}, ${s.ev} electoral votes, ${s.caption}`
                : `${s.name}, ${s.ev} electoral votes, ${s.leaderName} leads by ${s.margin.toFixed(1)} points`
            }
            aria-pressed={s.id === selected}
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: 6,
              padding: stage ? "3px 6px" : "6px 9px",
              cursor: "pointer",
              font: "inherit",
              fontFamily: FONT.mono,
              fontSize: stage ? 10 : 11,
              color: s.ink,
              background: s.fill,
              border: `1px solid ${s.id === selected ? BLEND.ink : "transparent"}`,
            }}
          >
            <b style={{ fontWeight: 700 }}>{s.id}</b>
            {!stage && stateFigure(s) ? (
              <span style={{ opacity: 0.8 }}>{stateFigure(s)}</span>
            ) : null}
            {stage || s.broadcast || s.evLabel !== undefined ? null : (
              <span style={{ opacity: 0.65, fontSize: 10 }}>+{s.margin.toFixed(1)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** State outlines drawn over the county layer, so state lines stay legible. */
function StateBorders({ geo, ids, opacity }: { geo: StateGeo[]; ids: string[]; opacity: number }) {
  const set = new Set(ids);
  return (
    <g opacity={opacity} pointerEvents="none">
      {geo
        .filter((g) => set.has(g.id))
        .map((g) => (
          <path
            key={g.id}
            d={g.d}
            fill="none"
            style={{ stroke: BLEND.ink }}
            strokeOpacity={0.55}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
    </g>
  );
}

/** Bottom-left readout on the stage: how to drive it, and where counties begin. */
function StageHint({
  k,
  countiesOn,
  loading,
}: {
  k: number;
  countiesOn: boolean;
  loading: boolean;
}) {
  const text = loading
    ? "LOADING COUNTY RESULTS..."
    : countiesOn && k < COUNTY_ZOOM
      ? "CLICK A STATE OR SCROLL TO ZOOM IN FOR COUNTIES"
      : "SCROLL TO ZOOM, DRAG TO PAN";
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 56,
        padding: "3px 7px",
        background: `color-mix(in srgb, ${BLEND.page} 80%, transparent)`,
        fontFamily: FONT.mono,
        fontSize: 10,
        letterSpacing: ".08em",
        color: BLEND.mutedDim,
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
}

function CountyTip({
  county,
  state,
  x,
  y,
  frameWidth,
}: {
  county: CountyRow;
  state: PresMapState;
  x: number;
  y: number;
  frameWidth: number;
}) {
  const flip = x > frameWidth - 230;
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
        minWidth: 180,
        background: BLEND.page,
        border: `1px solid ${BLEND.hairlineStrong}`,
        boxShadow: "0 6px 18px rgba(0,0,0,.5)",
        fontSize: 12.5,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, fontWeight: 600 }}>
        <span>{county.name}</span>
        <span style={{ fontFamily: FONT.mono, fontWeight: 500, color: BLEND.muted }}>
          {state.id}
        </span>
      </div>
      {county.winnerName ? (
        <div
          style={{
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: BLEND.muted,
          }}
        >
          <i
            aria-hidden
            style={{ width: 8, height: 8, display: "block", background: county.winnerColor }}
          />
          {county.winnerName}
          <span style={{ fontFamily: FONT.mono, fontSize: 11 }}>+{county.margin.toFixed(1)}pp</span>
        </div>
      ) : null}
      <div style={{ marginTop: 2, fontFamily: FONT.mono, fontSize: 11, color: BLEND.mutedDim }}>
        {Math.round(county.votes).toLocaleString("en-US")} votes
      </div>
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
  stage,
  unlocked,
  canZoomIn,
  canZoomOut,
  atRest,
  onToggle,
  onZoom,
  onReset,
}: {
  stage: boolean;
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
        top: stage ? 36 : 8,
        left: stage ? 14 : 8,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {stage ? null : (
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
      )}
      {stage || unlocked ? (
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
          {state.evLabel !== undefined ? state.evLabel : `${state.ev} EV`}
        </span>
      </div>
      {state.leaderName ? (
        <div
          style={{
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: BLEND.muted,
          }}
        >
          <i
            aria-hidden
            style={{ width: 8, height: 8, display: "block", background: state.leaderColor }}
          />
          {state.leaderName}
        </div>
      ) : null}
      <div style={{ marginTop: 2, fontFamily: FONT.mono, fontSize: 11, color: BLEND.mutedDim }}>
        {state.caption ??
          `+${state.margin.toFixed(1)}pp / ${TIER_BANDS.find((t) => t.tier === state.tier)?.label}`}
      </div>
    </div>
  );
}

/** Colour key: each tier's shade in the two leading tickets' colours. */
function MapKey({ model }: { model: PresMapModel }) {
  const ground = useBlendGround();
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
                background: shadeColorForTier(c.color, t.tier, ground),
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

/** Whether the viewport is at the desktop breakpoint (`lg`, 1024px). */
function useIsDesktop(): boolean {
  const [desk, setDesk] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const read = () => setDesk(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  return desk;
}

const chipStyle = (on: boolean): React.CSSProperties => ({
  padding: "4px 10px",
  cursor: "pointer",
  font: "inherit",
  fontFamily: FONT.mono,
  fontSize: 10.5,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  border: `1px solid ${on ? BLEND.ink : BLEND.hairlineStrong}`,
  color: on ? BLEND.ink : BLEND.muted,
  background: on ? BLEND.hairlineStrong : "transparent",
});

/** What the map is coloured by, and for the share view, whose share. */
function DataViewPicker({
  options,
  view,
  onView,
  candidates,
  shareCand,
  onShareCand,
}: {
  options: { id: MapDataView; label: string }[];
  view: MapDataView;
  onView: (v: MapDataView) => void;
  candidates: PresMapCandidate[];
  shareCand: PresMapCandidate | null;
  onShareCand: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <span style={{ ...BLEND_LABEL, marginRight: 4 }}>Colour by</span>
      <div
        role="radiogroup"
        aria-label="Colour the map by"
        style={{ display: "inline-flex", gap: 4 }}
      >
        {options.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            onClick={() => onView(v.id)}
            style={chipStyle(view === v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "share" && candidates.length > 0 ? (
        <div
          role="radiogroup"
          aria-label="Whose vote share"
          style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, marginLeft: 8 }}
        >
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={shareCand?.id === c.id}
              onClick={() => onShareCand(c.id)}
              style={{ ...chipStyle(shareCand?.id === c.id), textTransform: "none" }}
            >
              <i
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  marginRight: 6,
                  background: c.color,
                }}
              />
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Colour key for the non-margin views. */
function DataViewKey({
  view,
  model,
  shareCand,
  ground,
  presenceColor,
}: {
  view: MapDataView;
  model: PresMapModel;
  shareCand: PresMapCandidate | null;
  ground: string;
  presenceColor: string | null;
}) {
  const keyStyle: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px 16px",
    fontFamily: FONT.mono,
    fontSize: 10,
    color: BLEND.mutedDim,
  };
  const swatch = (bg: string) => (
    <i aria-hidden style={{ width: 9, height: 9, display: "block", background: bg }} />
  );
  if (view === "presence" && presenceColor) {
    return (
      <div style={keyStyle}>
        <span style={{ letterSpacing: ".1em" }}>YOUR CAMPAIGN PRESENCE:</span>
        {[0, 2, 5, 10].map((lvl) => (
          <span key={lvl} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {swatch(
              mixToward(
                ground,
                presenceColor,
                lvl > 0 ? 0.2 + 0.8 * Math.min(1, lvl / PRESENCE_FULL_LEVEL) : 0.06
              )
            )}
            {lvl === 10 ? "level 10+" : `level ${lvl}`}
          </span>
        ))}
      </div>
    );
  }
  if (view === "winner") {
    return (
      <div style={keyStyle}>
        <span style={{ letterSpacing: ".1em" }}>LEADING IN EACH STATE:</span>
        {shareCandidates(model).map((c) => (
          <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {swatch(c.color)}
            {c.name}
          </span>
        ))}
      </div>
    );
  }
  if (view === "share" && shareCand) {
    const stops = [SHARE_RAMP.lo, 35, 50, SHARE_RAMP.hi];
    return (
      <div style={keyStyle}>
        <span style={{ letterSpacing: ".1em" }}>{shareCand.name.toUpperCase()} VOTE SHARE:</span>
        {stops.map((p) => (
          <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {swatch(mixToward(ground, shareCand.color, shareStrength(p)))}
            {p === SHARE_RAMP.lo
              ? `${p}% or less`
              : p === SHARE_RAMP.hi
                ? `${p}% or more`
                : `${p}%`}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div style={keyStyle}>
      <span style={{ letterSpacing: ".1em" }}>MOMENTUM, LAST FEW TURNS:</span>
      {shareCandidates(model)
        .slice(0, 2)
        .map((c) => (
          <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {swatch(mixToward(ground, c.color, 0.4))}
            {swatch(c.color)}
            toward {c.name} (up to {MOMENTUM_FULL_PP}pp)
          </span>
        ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {swatch(mixToward(ground, "#8f8f9d", 0.22))}
        steady
      </span>
    </div>
  );
}
