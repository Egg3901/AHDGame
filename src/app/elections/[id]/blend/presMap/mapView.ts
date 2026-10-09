/**
 * Pan and zoom maths for the presidential map, in map units (the 960 x 600
 * coordinate space the states are projected into). A view is the transform
 * applied to the map group: `translate(x y) scale(k)`.
 *
 * `width` and `height` are the map's own size. The frame the map is drawn into
 * defaults to the same size (the inline map keeps the map's aspect ratio); the
 * full-screen stage passes a frame of its own shape, and a map smaller than
 * its frame on either axis is centred on that axis instead of pinned.
 */

export interface MapView {
  k: number;
  x: number;
  y: number;
}

/** The frame the map is drawn into, in map units, and how far it may zoom. */
export interface MapFrame {
  frameWidth?: number;
  frameHeight?: number;
  maxZoom?: number;
}

export const IDENTITY_VIEW: MapView = { k: 1, x: 0, y: 0 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
/** Factor applied by the + and - buttons. */
export const ZOOM_STEP = 1.6;

export function isIdentityView(v: MapView): boolean {
  return v.k === 1 && v.x === 0 && v.y === 0;
}

/** One axis: centre content narrower than the frame, otherwise keep the frame covered. */
function clampAxis(offset: number, content: number, frame: number): number {
  if (content <= frame) return (frame - content) / 2;
  return Math.min(0, Math.max(frame - content, offset));
}

/** Keep the zoom in range and the map covering the frame (no empty margin). */
export function clampView(v: MapView, width: number, height: number, f: MapFrame = {}): MapView {
  const k = Math.min(f.maxZoom ?? MAX_ZOOM, Math.max(MIN_ZOOM, v.k));
  return {
    k,
    x: clampAxis(v.x, width * k, f.frameWidth ?? width),
    y: clampAxis(v.y, height * k, f.frameHeight ?? height),
  };
}

/** The whole map, fitted and centred in the frame. */
export function restingView(width: number, height: number, f: MapFrame = {}): MapView {
  return clampView(IDENTITY_VIEW, width, height, f);
}

/** Scale by `factor` keeping the map point under (px, py) where it is. */
export function zoomAt(
  v: MapView,
  factor: number,
  px: number,
  py: number,
  width: number,
  height: number,
  f: MapFrame = {}
): MapView {
  const k = Math.min(f.maxZoom ?? MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
  const ratio = k / v.k;
  return clampView({ k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio }, width, height, f);
}

export function panBy(
  v: MapView,
  dx: number,
  dy: number,
  width: number,
  height: number,
  f: MapFrame = {}
): MapView {
  return clampView({ k: v.k, x: v.x + dx, y: v.y + dy }, width, height, f);
}

/** Zoom about the centre of the frame, for the + and - buttons. */
export function zoomStep(
  v: MapView,
  direction: 1 | -1,
  width: number,
  height: number,
  f: MapFrame = {}
): MapView {
  const factor = direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP;
  return zoomAt(
    v,
    factor,
    (f.frameWidth ?? width) / 2,
    (f.frameHeight ?? height) / 2,
    width,
    height,
    f
  );
}

/**
 * Fit a box (map units) into the frame with some margin around it, the way a
 * double-clicked state is brought into view.
 */
export function viewForBox(
  box: { x0: number; y0: number; x1: number; y1: number },
  width: number,
  height: number,
  f: MapFrame = {},
  padding = 0.18,
  /** Frame width (map units) covered on the right, e.g. by a docked panel. */
  insetRight = 0
): MapView {
  const fw = Math.max(1, (f.frameWidth ?? width) - insetRight);
  const fh = f.frameHeight ?? height;
  const bw = Math.max(1, box.x1 - box.x0);
  const bh = Math.max(1, box.y1 - box.y0);
  const k = Math.min(fw / (bw * (1 + padding * 2)), fh / (bh * (1 + padding * 2)));
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return clampView({ k, x: fw / 2 - cx * k, y: fh / 2 - cy * k }, width, height, f);
}

/** The part of the map (map units) the frame currently shows. */
export function visibleBox(
  v: MapView,
  width: number,
  height: number,
  f: MapFrame = {}
): { x0: number; y0: number; x1: number; y1: number } {
  const fw = f.frameWidth ?? width;
  const fh = f.frameHeight ?? height;
  return { x0: -v.x / v.k, y0: -v.y / v.k, x1: (fw - v.x) / v.k, y1: (fh - v.y) / v.k };
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
