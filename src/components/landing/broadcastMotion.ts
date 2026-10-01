/**
 * Geometry and timing for the broadcast lander's moving parts: satellites on
 * tilted orbits around the globe, and the uplinks they beam down to datelines.
 *
 * Pure: angles, positions and clocks in, numbers out. The globe owns rotation
 * and supplies it as a function, so nothing here depends on d3 or the DOM.
 */

/** A screen point in globe SVG units, and whether it is on the visible face. */
export type ScreenPoint = { x: number; y: number; visible: boolean };

/** The globe's rotation as d3 applies it: `[lon, lat]` in, rotated `[lon, lat]` out. */
export type Rotate = (lonLat: [number, number]) => [number, number];

const DEG = Math.PI / 180;

/** Orthographic projection of a place on the surface, as the globe draws it. */
export function projectOnGlobe(
  rotate: Rotate,
  lonLat: readonly [number, number],
  center: readonly [number, number],
  radius: number
): ScreenPoint {
  const [lon, lat] = rotate([lonLat[0], lonLat[1]]);
  const l = lon * DEG;
  const p = lat * DEG;
  return {
    x: center[0] + radius * Math.cos(p) * Math.sin(l),
    y: center[1] - radius * Math.sin(p),
    visible: Math.cos(p) * Math.cos(l) >= 0,
  };
}

export type OrbitSpec = {
  id: string;
  /** Orbit radius as a multiple of the globe radius. */
  radius: number;
  /** Tilt away from face-on, in degrees. 90 is edge-on. */
  tilt: number;
  /** Roll of the orbit in the screen plane, in degrees clockwise. */
  roll: number;
  /** Seconds per revolution. */
  period: number;
  /** Where in its revolution the satellite starts, 0 to 1. */
  phase: number;
};

/** Semi-axes of an orbit's on-screen ellipse at zoom 1. */
export function orbitAxes(orbit: OrbitSpec, globeRadius: number): { a: number; b: number } {
  const a = orbit.radius * globeRadius;
  return { a, b: a * Math.cos(orbit.tilt * DEG) };
}

/**
 * Where the satellite is at `seconds`, in the orbit's own frame (centred on
 * the globe, before `roll`). Uniform motion on a tilted circle, so it speeds
 * up across the face of the globe the way a real pass does. `near` is the half
 * that faces the viewer, the lower half of the ellipse.
 */
export function orbitPosition(
  orbit: OrbitSpec,
  globeRadius: number,
  seconds: number
): { x: number; y: number; theta: number; near: boolean } {
  const { a, b } = orbitAxes(orbit, globeRadius);
  const theta = 2 * Math.PI * (seconds / orbit.period + orbit.phase);
  const y = -b * Math.sin(theta);
  return { x: a * Math.cos(theta), y, theta, near: y > 0 };
}

/** The orbit-frame polyline from `theta - sweep` up to `theta`, for a trail. */
export function orbitTrail(
  orbit: OrbitSpec,
  globeRadius: number,
  theta: number,
  sweep: number,
  steps = 10
): [number, number][] {
  const { a, b } = orbitAxes(orbit, globeRadius);
  const out: [number, number][] = [];
  for (let i = steps; i >= 0; i--) {
    const at = theta - (sweep * i) / steps;
    out.push([a * Math.cos(at), -b * Math.sin(at)]);
  }
  return out;
}

/** An orbit-frame point carried into globe SVG coordinates. */
export function orbitToGlobe(
  [x, y]: readonly [number, number],
  orbit: OrbitSpec,
  center: readonly [number, number],
  zoom: number
): [number, number] {
  const r = orbit.roll * DEG;
  return [
    center[0] + zoom * (x * Math.cos(r) - y * Math.sin(r)),
    center[1] + zoom * (x * Math.sin(r) + y * Math.cos(r)),
  ];
}

/**
 * The uplink rota: a beam is live for `active` seconds, then the sky is quiet
 * for `rest`. Returns which beam this is (counting from zero) and how far
 * through it we are, or null between beams.
 */
export function beamAt(
  seconds: number,
  active: number,
  rest: number
): { beam: number; progress: number } | null {
  if (seconds < 0) return null;
  const cycle = active + rest;
  const beam = Math.floor(seconds / cycle);
  const into = seconds - beam * cycle;
  return into < active ? { beam, progress: into / active } : null;
}

/** Fade in over the first `edge` of a span and out over the last. */
export function envelope(progress: number, edge: number): number {
  return Math.max(0, Math.min(1, progress / edge, (1 - progress) / edge));
}
