/**
 * Globe art for the broadcast lander (the 1991 hero): a lit ocean sphere with
 * an atmosphere rim, a dissolved state's old outline as a fading dashed border
 * with the borders it left behind drawn in, and satellites on tilted orbits
 * that beam down to the datelines of the year's headlines.
 *
 * Everything renders inside `MapSVGContent` through its `underlay` / `overlay`
 * slots and is inert, so drag, hover and click still reach the countries
 * underneath. React draws the static art once; everything that moves is
 * written by `render` on the globe's own frame loop, which already caps the
 * frame rate, halves it on a weak device, and stops when the hero is scrolled
 * away or the tab is hidden. Each moving piece is its own small element, so a
 * frame repaints a satellite's trail rather than the whole globe.
 */
import { useCallback, useMemo, useRef } from "react";
import type { MultiLineString } from "geojson";
import type { mesh as topojsonMesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { BroadcastPlace, BroadcastTickerItem } from "./eraThemes";
import {
  beamAt,
  envelope,
  orbitAxes,
  orbitPosition,
  orbitToGlobe,
  orbitTrail,
  projectOnGlobe,
  type OrbitSpec,
  type Rotate,
} from "./broadcastMotion";

/** Sphere and graticule colours handed to `MapSVGContent`. */
export const BROADCAST_SPHERE_FILL = "url(#ahd-bc-ocean)";
export const BROADCAST_SPHERE_STROKE = "rgba(150, 205, 255, 0.6)";
export const BROADCAST_GRATICULE_STROKE = "rgba(190, 220, 255, 0.45)";

const SIGNAL_RED = "#ff4d5e";
const MONO = "var(--font-geist-mono), ui-monospace, monospace";

type Orbit = OrbitSpec & { dotted: boolean };

/**
 * Two rings that cross in front of the globe on opposite halves: the inner on
 * the lower half, the outer (rolled past 180°) on the upper. Between them a
 * satellite is near every part of the face, so no uplink has to cross it.
 */
const ORBITS: readonly Orbit[] = [
  { id: "inner", radius: 1.12, tilt: 73, roll: -15, period: 34, phase: 0, dotted: false },
  { id: "outer", radius: 1.36, tilt: 81, roll: 191, period: 78, phase: 0, dotted: true },
];

type Satellite = {
  id: string;
  orbit: Orbit;
  /** Where in its revolution it starts, 0 to 1. */
  phase: number;
  /** Carries the era's orbit label. */
  labelled: boolean;
};

/**
 * Mir on the inner ring, and three comsats a third of a turn apart on the
 * outer: one of them is always on the near side, so a beam always has a source.
 */
const SATELLITES: readonly Satellite[] = [
  { id: "mir", orbit: ORBITS[0], phase: 0.7, labelled: true },
  { id: "comsat-1", orbit: ORBITS[1], phase: 0.25, labelled: false },
  { id: "comsat-2", orbit: ORBITS[1], phase: 0.25 + 1 / 3, labelled: false },
  { id: "comsat-3", orbit: ORBITS[1], phase: 0.25 + 2 / 3, labelled: false },
];

/** Radians of orbit a satellite's trail covers. */
const TRAIL_SWEEP = 0.42;

/** One beam at a time: live for this long, then a short quiet spell. */
const BEAM_ACTIVE_S = 2.8;
const BEAM_REST_S = 0.9;

/** Places a beam may not revisit until this many others have had one. */
const BEAM_PLACE_COOLDOWN = 3;

/** The dissolved state's outline breathes once its CSS break has run. */
const GHOST_PULSE_DELAY_S = 3.2;
const GHOST_PULSE_PERIOD_S = 6;

/** A dateline nearer the limb than this share of the radius is too foreshortened to land on. */
const BEAM_MAX_INSET = 0.9;

export function broadcastZoomTransform(translate: readonly [number, number], zoom: number): string {
  return `translate(${translate[0]} ${translate[1]}) scale(${zoom})`;
}

/** Precomputed meshes for a dissolved state. */
export type DissolvedStateGeometry = {
  /** Arcs on the outer edge of the union: the border that no longer exists. */
  outline: MultiLineString;
  /** Arcs shared by two members: the borders the break-up created. */
  seams: MultiLineString;
};

/**
 * A dissolved state as two meshes rather than its merged polygon: lines never
 * fill, so the land keeps its tier colour under them. An arc used once by the
 * members is on the union's edge; one used twice is a border between them.
 * `mesh` is `topojson-client`'s, passed in because the globe loads it lazily.
 */
export function dissolvedStateGeometry(
  mesh: typeof topojsonMesh,
  topology: Topology,
  featureIds: readonly string[]
): DissolvedStateGeometry | null {
  if (featureIds.length === 0) return null;
  const members = new Set(featureIds);
  const countries = topology.objects.countries as GeometryCollection;
  const union: GeometryCollection = {
    type: "GeometryCollection",
    geometries: countries.geometries.filter((g) => members.has(String(g.id))),
  };
  if (union.geometries.length === 0) return null;
  return {
    outline: mesh(topology, union, (a, b) => a === b),
    seams: mesh(topology, union, (a, b) => a !== b),
  };
}

/** What the globe hands `render` each frame. */
export type BroadcastView = {
  rotate: Rotate;
  zoom: number;
  /** Milliseconds, on the same clock as `requestAnimationFrame`. */
  now: number;
  /** False under reduced motion: satellites park and no beam is drawn. */
  animate: boolean;
  /**
   * False while the globe's idle crisis tour has the stage: satellites keep
   * orbiting, but no beam competes with the tour's card. Defaults to true.
   */
  beams?: boolean;
  /**
   * Projects a line mesh for this frame, cut at the horizon. Present only when
   * the globe itself moved and its borders need redrawing.
   */
  lines?: (geometry: MultiLineString) => string;
};

type Dateline = { place: BroadcastPlace; date: string };

type BindRef = (key: string) => (el: SVGElement | null) => void;

/* ────────────────────────────────────────────────────────────────────────── */
/* Static art                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

function OrbitSide({
  orbit,
  side,
  globeRadius,
  label,
  bind,
}: {
  orbit: Orbit;
  side: "far" | "near";
  globeRadius: number;
  label?: string;
  bind: BindRef;
}) {
  const { a, b } = orbitAxes(orbit, globeRadius);
  const clipId = `ahd-bc-orbit-${orbit.id}-${side}`;
  const pad = 14;
  const near = side === "near";

  return (
    <g transform={`rotate(${orbit.roll})`}>
      <defs>
        {/* The far side is drawn under the sphere, the near side over it; each
            keeps to its own half so a satellite crossing the limb is drawn once. */}
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect x={-a - pad} y={near ? 0 : -b - pad} width={2 * (a + pad)} height={b + pad} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <ellipse
          rx={a}
          ry={b}
          fill="none"
          stroke="rgb(170, 210, 255)"
          strokeOpacity={near ? 0.3 : 0.14}
          strokeWidth={orbit.dotted ? 0.55 : 0.4}
          strokeDasharray={orbit.dotted ? "0.6 2.4" : undefined}
          strokeLinecap={orbit.dotted ? "round" : undefined}
        />
        {SATELLITES.filter((sat) => sat.orbit === orbit).map((sat) => (
          <g key={sat.id}>
            <path
              ref={bind(`trail:${sat.id}:${side}`)}
              fill="none"
              stroke={`url(#ahd-bc-trail-${sat.id})`}
              strokeWidth={0.85}
              strokeLinecap="round"
              opacity={near ? 1 : 0.6}
            />
            <g ref={bind(`sat:${sat.id}:${side}`)} opacity={near ? 1 : 0.65}>
              {/* Swells while this satellite is the one transmitting. */}
              <circle ref={bind(`halo:${sat.id}:${side}`)} r={2.6} fill="#ffffff" opacity={0.16} />
              <rect x={-3.4} y={-0.35} width={6.8} height={0.7} fill="rgb(200, 225, 255)" />
              <circle r={1.15} fill="#ffffff" />
              {sat.labelled && label && (
                <text
                  x={4.2}
                  y={-3.2}
                  transform={`rotate(${-orbit.roll})`}
                  fill="#ffffff"
                  fillOpacity={0.85}
                  fontSize={4.4}
                  fontFamily={MONO}
                  letterSpacing={0.6}
                >
                  {label}
                </text>
              )}
            </g>
          </g>
        ))}
      </g>
    </g>
  );
}

/** Painted behind the sphere: gradients, the atmosphere rim, the far side of each orbit. */
export function BroadcastUnderlay({
  translate,
  globeRadius,
  zoom,
  bind,
}: {
  translate: readonly [number, number];
  globeRadius: number;
  /** Zoom at render time; the frame loop keeps it current between renders. */
  zoom: number;
  bind: BindRef;
}) {
  const atmosphere = globeRadius * 1.16;
  const limb = globeRadius / atmosphere;

  return (
    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
      <defs>
        <radialGradient id="ahd-bc-ocean" cx="40%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#3f86d6" />
          <stop offset="32%" stopColor="#1d58ab" />
          <stop offset="66%" stopColor="#0f3577" />
          <stop offset="100%" stopColor="#06173f" />
        </radialGradient>
        <radialGradient id="ahd-bc-atmosphere" cx="50%" cy="50%" r="50%">
          <stop offset={limb - 0.02} stopColor="#7cc0ff" stopOpacity={0} />
          <stop offset={limb} stopColor="#8ac8ff" stopOpacity={0.55} />
          <stop offset={limb + 0.035} stopColor="#4f9dff" stopOpacity={0.2} />
          <stop offset={limb + 0.08} stopColor="#2f7bff" stopOpacity={0.06} />
          <stop offset="100%" stopColor="#2f7bff" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="ahd-bc-shade" cx="34%" cy="28%" r="92%">
          <stop offset="0%" stopColor="#030714" stopOpacity={0} />
          <stop offset="46%" stopColor="#030714" stopOpacity={0} />
          <stop offset="76%" stopColor="#030714" stopOpacity={0.42} />
          <stop offset="100%" stopColor="#030714" stopOpacity={0.8} />
        </radialGradient>
        <radialGradient id="ahd-bc-sheen" cx="33%" cy="26%" r="40%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.17} />
          <stop offset="55%" stopColor="#ffffff" stopOpacity={0.05} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
        {/* Trail gradients run tail to head; `render` moves their ends. Both
            sides of an orbit share one, as they share a coordinate frame. */}
        {SATELLITES.map((sat) => (
          <linearGradient
            key={sat.id}
            id={`ahd-bc-trail-${sat.id}`}
            ref={bind(`grad:${sat.id}`)}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0.75} />
          </linearGradient>
        ))}
      </defs>
      <g ref={bind("zoom:underlay")} transform={broadcastZoomTransform(translate, zoom)}>
        <circle r={atmosphere} fill="url(#ahd-bc-atmosphere)" />
        {ORBITS.map((orbit) => (
          <OrbitSide
            key={orbit.id}
            orbit={orbit}
            side="far"
            globeRadius={globeRadius}
            bind={bind}
          />
        ))}
      </g>
    </g>
  );
}

/** One uplink: a cone of light from a satellite to a dateline, which pings and names itself. */
function UplinkBeam({ bind }: { bind: BindRef }) {
  return (
    <g ref={bind("beam")} opacity={0}>
      <defs>
        <linearGradient id="ahd-bc-beam" ref={bind("beam:grad")} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0.04} />
        </linearGradient>
      </defs>
      <polygon ref={bind("beam:cone")} fill="url(#ahd-bc-beam)" />
      <line ref={bind("beam:axis")} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.3} />
      <g ref={bind("beam:ping")}>
        <circle ref={bind("beam:ring")} fill="none" stroke={SIGNAL_RED} strokeWidth={0.6} />
        <circle ref={bind("beam:ring2")} fill="none" stroke={SIGNAL_RED} strokeWidth={0.45} />
        <circle r={1.2} fill={SIGNAL_RED} />
        {/* Set like the crawl: place in white, date in red. Phones hide it: there
            the globe sits behind the headline and the label reads as noise. */}
        <text
          x={3.6}
          y={-3}
          fontSize={4.2}
          fontFamily={MONO}
          letterSpacing={0.5}
          className="max-sm:hidden"
        >
          <tspan ref={bind("beam:place")} fill="#ffffff" />
          <tspan ref={bind("beam:date")} dx={2.4} fill={SIGNAL_RED} />
        </text>
      </g>
    </g>
  );
}

/**
 * Painted over the countries: the day/night shading and sheen, the dissolved
 * state's borders on top of that so they stay legible on the night side, the
 * uplink, then the near side of each orbit.
 */
export function BroadcastOverlay({
  translate,
  globeRadius,
  zoom,
  bind,
  orbitLabel,
}: {
  translate: readonly [number, number];
  globeRadius: number;
  zoom: number;
  bind: BindRef;
  orbitLabel?: string;
}) {
  const transform = broadcastZoomTransform(translate, zoom);

  return (
    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
      <g ref={bind("zoom:shade")} transform={transform}>
        <circle r={globeRadius} fill="url(#ahd-bc-shade)" />
        <circle r={globeRadius} fill="url(#ahd-bc-sheen)" />
      </g>
      {/* `d` is written by the frame loop and never by React. */}
      <path
        ref={bind("seams")}
        fill="none"
        stroke="#ffffff"
        strokeOpacity={0.72}
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
      <path
        ref={bind("outline")}
        className="ahd-bc-ghost"
        fill="none"
        stroke={SIGNAL_RED}
        strokeWidth={0.95}
        strokeLinejoin="round"
      />
      <UplinkBeam bind={bind} />
      <g ref={bind("zoom:orbits")} transform={transform}>
        {ORBITS.map((orbit) => (
          <OrbitSide
            key={orbit.id}
            orbit={orbit}
            side="near"
            globeRadius={globeRadius}
            label={orbitLabel}
            bind={bind}
          />
        ))}
      </g>
    </g>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Frame writer                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function setAttrs(el: SVGElement | null | undefined, attrs: Record<string, string | number>) {
  if (!el) return;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
}

function setText(el: SVGElement | null | undefined, text: string) {
  if (el && el.textContent !== text) el.textContent = text;
}

function pointsPath(points: readonly (readonly [number, number])[]): string {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join("");
}

const fixed = (n: number) => n.toFixed(2);

/**
 * Refs and the per-frame writer for the broadcast layers. The globe calls
 * `render` whenever it reprojects, and on its idle frames while held still, so
 * borders never lag the land they trace and satellites keep moving under a
 * hovering cursor.
 */
export function useBroadcastGlobeLayers({
  translate,
  globeRadius,
  ticker,
}: {
  translate: readonly [number, number];
  globeRadius: number;
  /** The crawl. Every item with a place is a dateline a satellite can beam to. */
  ticker?: readonly BroadcastTickerItem[];
}) {
  const els = useRef(new Map<string, SVGElement>());
  const binders = useRef(new Map<string, (el: SVGElement | null) => void>());
  const geometry = useRef<DissolvedStateGeometry | null>(null);
  const lastZoom = useRef<number | null>(null);
  // A beam keeps its satellite and dateline from start to finish.
  const beamTarget = useRef<{ beam: number; satellite: string; dateline: number } | null>(null);
  const recentPlaces = useRef<string[]>([]);
  const lastBeamed = useRef(new Map<number, number>());

  const datelines = useMemo<readonly Dateline[]>(
    () =>
      (ticker ?? []).flatMap((item) =>
        item.place ? [{ place: item.place, date: item.date }] : []
      ),
    [ticker]
  );

  /** One stable callback ref per element key, so React never re-attaches them. */
  const bind = useCallback<BindRef>((key) => {
    let callback = binders.current.get(key);
    if (!callback) {
      callback = (el) => {
        if (el) els.current.set(key, el);
        else els.current.delete(key);
        // A new zoom group carries render-time zoom; rewrite it next frame.
        if (key.startsWith("zoom:")) lastZoom.current = null;
      };
      binders.current.set(key, callback);
    }
    return callback;
  }, []);

  const render = useCallback(
    (view: BroadcastView) => {
      const el = (key: string) => els.current.get(key);
      const seconds = view.now / 1000;
      const radius = globeRadius * view.zoom;

      // The old border breathes, here rather than in CSS so it repaints with
      // the frame instead of at 60fps on its own. Full strength while the
      // stylesheet breaks it into dashes, then a slow 6s swell.
      const breathing = view.animate ? Math.max(0, seconds - GHOST_PULSE_DELAY_S) : 0;
      el("outline")?.setAttribute(
        "opacity",
        fixed(0.65 + 0.25 * Math.cos((2 * Math.PI * breathing) / GHOST_PULSE_PERIOD_S))
      );

      // The dissolved state's borders only move when the globe does.
      const meshes = geometry.current;
      if (meshes && view.lines) {
        el("outline")?.setAttribute("d", view.lines(meshes.outline));
        el("seams")?.setAttribute("d", view.lines(meshes.seams));
      }

      if (lastZoom.current !== view.zoom) {
        lastZoom.current = view.zoom;
        const transform = broadcastZoomTransform(translate, view.zoom);
        for (const key of ["zoom:underlay", "zoom:shade", "zoom:orbits"]) {
          el(key)?.setAttribute("transform", transform);
        }
      }

      // Satellites. Under reduced motion they hold their opening positions.
      const satellites = SATELLITES.map((sat) => {
        const orbit = { ...sat.orbit, phase: sat.phase };
        const position = orbitPosition(orbit, globeRadius, view.animate ? seconds : 0);
        const trail = orbitTrail(orbit, globeRadius, position.theta, TRAIL_SWEEP);
        const d = view.animate ? pointsPath(trail) : "";
        for (const side of ["far", "near"]) {
          setAttrs(el(`sat:${sat.id}:${side}`), {
            transform: `translate(${fixed(position.x)} ${fixed(position.y)})`,
          });
          el(`trail:${sat.id}:${side}`)?.setAttribute("d", d);
        }
        const [tailX, tailY] = trail[0];
        setAttrs(el(`grad:${sat.id}`), {
          x1: fixed(tailX),
          y1: fixed(tailY),
          x2: fixed(position.x),
          y2: fixed(position.y),
        });
        return { id: sat.id, orbit, position };
      });

      const beam = el("beam");
      const live =
        view.animate && view.beams !== false && datelines.length > 0
          ? beamAt(seconds, BEAM_ACTIVE_S, BEAM_REST_S)
          : null;
      const quiet = () => {
        setAttrs(beam, { opacity: 0 });
        for (const sat of SATELLITES) {
          for (const side of ["far", "near"]) {
            setAttrs(el(`halo:${sat.id}:${side}`), { r: 2.6, opacity: 0.16 });
          }
        }
      };
      if (!live) {
        quiet();
        return;
      }

      const project = (lonLat: readonly [number, number]) =>
        projectOnGlobe(view.rotate, lonLat, translate, radius);

      // At the start of each beam, pair a near-side satellite with the visible
      // dateline closest to the point directly beneath it, so the beam drops
      // rather than crossing the globe. A place that just had a beam sits out,
      // and a place with several datelines (Moscow) cycles through its dates.
      if (beamTarget.current?.beam !== live.beam) {
        type Pick = { satellite: string; dateline: number; distance: number; used: number };
        const pick = (cooldown: boolean): Pick | null => {
          let best: Pick | null = null;
          for (const { id, orbit, position } of satellites) {
            if (!position.near) continue;
            const [px, py] = orbitToGlobe([position.x, position.y], orbit, translate, view.zoom);
            const nadirX = translate[0] + (px - translate[0]) / orbit.radius;
            const nadirY = translate[1] + (py - translate[1]) / orbit.radius;
            for (let index = 0; index < datelines.length; index++) {
              if (cooldown && recentPlaces.current.includes(datelines[index].place.name)) continue;
              const p = project(datelines[index].place.lonLat);
              const inset = Math.hypot(p.x - translate[0], p.y - translate[1]) / radius;
              if (!p.visible || inset > BEAM_MAX_INSET) continue;
              const distance = Math.hypot(p.x - nadirX, p.y - nadirY);
              const used = lastBeamed.current.get(index) ?? -1;
              if (
                !best ||
                distance < best.distance - 1e-6 ||
                (Math.abs(distance - best.distance) < 1e-6 && used < best.used)
              ) {
                best = { satellite: id, dateline: index, distance, used };
              }
            }
          }
          return best;
        };
        // With the globe held still, every visible place can be cooling down at
        // once; a repeat then beats a sky that never transmits again.
        const best = pick(true) ?? pick(false);
        beamTarget.current = {
          beam: live.beam,
          satellite: best?.satellite ?? "",
          dateline: best?.dateline ?? -1,
        };
        if (best) {
          lastBeamed.current.set(best.dateline, live.beam);
          recentPlaces.current = [
            datelines[best.dateline].place.name,
            ...recentPlaces.current,
          ].slice(0, BEAM_PLACE_COOLDOWN);
        }
      }

      const target = beamTarget.current;
      const dateline = target.dateline >= 0 ? datelines[target.dateline] : undefined;
      const ground = dateline ? project(dateline.place.lonLat) : undefined;
      const source = satellites.find(({ id }) => id === target.satellite);
      if (!dateline || !ground?.visible || !source?.position.near) {
        quiet();
        return;
      }

      const [sx, sy] = orbitToGlobe(
        [source.position.x, source.position.y],
        source.orbit,
        translate,
        view.zoom
      );
      const fade = envelope(live.progress, 0.14);
      const dx = ground.x - sx;
      const dy = ground.y - sy;
      const length = Math.hypot(dx, dy) || 1;
      // Half-width of the cone where it meets the ground.
      const nx = (-dy / length) * 2.6;
      const ny = (dx / length) * 2.6;
      setAttrs(beam, { opacity: fixed(fade) });
      setAttrs(el("beam:cone"), {
        points: `${fixed(sx)},${fixed(sy)} ${fixed(ground.x + nx)},${fixed(ground.y + ny)} ${fixed(ground.x - nx)},${fixed(ground.y - ny)}`,
      });
      const axis = { x1: fixed(sx), y1: fixed(sy), x2: fixed(ground.x), y2: fixed(ground.y) };
      setAttrs(el("beam:axis"), axis);
      setAttrs(el("beam:grad"), axis);
      setAttrs(el("beam:ping"), { transform: `translate(${fixed(ground.x)} ${fixed(ground.y)})` });
      // Two rings half a beat apart, so the ping reads as a signal, not a blink.
      const ripple = (live.progress * 2) % 1;
      const ripple2 = (ripple + 0.5) % 1;
      setAttrs(el("beam:ring"), {
        r: fixed(1.5 + ripple * 7),
        "stroke-opacity": fixed(1 - ripple),
      });
      setAttrs(el("beam:ring2"), {
        r: fixed(1.5 + ripple2 * 7),
        "stroke-opacity": fixed(1 - ripple2),
      });
      setText(el("beam:place"), dateline.place.name.toUpperCase());
      setText(el("beam:date"), dateline.date.toUpperCase());

      for (const sat of SATELLITES) {
        const transmitting = sat.id === target.satellite;
        for (const side of ["far", "near"]) {
          setAttrs(el(`halo:${sat.id}:${side}`), {
            r: transmitting ? fixed(2.6 + 1.4 * fade) : 2.6,
            opacity: transmitting ? fixed(0.16 + 0.3 * fade) : 0.16,
          });
        }
      }
    },
    [translate, globeRadius, datelines]
  );

  return { bind, geometry, render };
}
