/**
 * Pan and zoom maths for the presidential map, in map units (the 960 x 600
 * coordinate space the states are projected into). A view is the transform
 * applied to the map group: `translate(x y) scale(k)`.
 */

export interface MapView {
  k: number;
  x: number;
  y: number;
}

export const IDENTITY_VIEW: MapView = { k: 1, x: 0, y: 0 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
/** Factor applied by the + and - buttons. */
export const ZOOM_STEP = 1.6;

export function isIdentityView(v: MapView): boolean {
  return v.k === 1 && v.x === 0 && v.y === 0;
}

/** Keep the zoom in range and the map covering the frame (no empty margin). */
export function clampView(v: MapView, width: number, height: number): MapView {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k));
  const x = Math.min(0, Math.max(width - width * k, v.x));
  const y = Math.min(0, Math.max(height - height * k, v.y));
  return { k, x, y };
}

/** Scale by `factor` keeping the map point under (px, py) where it is. */
export function zoomAt(
  v: MapView,
  factor: number,
  px: number,
  py: number,
  width: number,
  height: number
): MapView {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
  const ratio = k / v.k;
  return clampView({ k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio }, width, height);
}

export function panBy(v: MapView, dx: number, dy: number, width: number, height: number): MapView {
  return clampView({ k: v.k, x: v.x + dx, y: v.y + dy }, width, height);
}

/** Zoom about the centre of the frame, for the + and - buttons. */
export function zoomStep(v: MapView, direction: 1 | -1, width: number, height: number): MapView {
  const factor = direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP;
  return zoomAt(v, factor, width / 2, height / 2, width, height);
}

/** Wheel delta to zoom factor. Smooth for trackpads, steady for notched wheels. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
  const clamped = Math.max(-120, Math.min(120, px));
  return Math.exp(-clamped * 0.0022);
}

/**
 * Whether a label of `labelPx` fits inside a state's box at the current zoom.
 * `scale` is screen pixels per map unit at zoom 1.
 */
export function labelFits(
  box: { width: number; height: number },
  k: number,
  scale: number,
  labelPx: number
): boolean {
  return Math.min(box.width, box.height) * k * scale >= labelPx;
}
