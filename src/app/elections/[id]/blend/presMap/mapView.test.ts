import { describe, expect, it } from "vitest";
import {
  IDENTITY_VIEW,
  MAX_ZOOM,
  clampView,
  isIdentityView,
  labelFits,
  panBy,
  wheelFactor,
  zoomAt,
  zoomStep,
} from "./mapView";

const W = 960;
const H = 600;

describe("map view", () => {
  it("never zooms out past the whole country or in past the cap", () => {
    expect(clampView({ k: 0.2, x: 0, y: 0 }, W, H).k).toBe(1);
    expect(clampView({ k: 99, x: 0, y: 0 }, W, H).k).toBe(MAX_ZOOM);
  });

  it("keeps the map covering the frame", () => {
    const v = clampView({ k: 2, x: 500, y: -9999 }, W, H);
    expect(v.x).toBe(0);
    expect(v.y).toBe(H - H * 2);
  });

  it("keeps the point under the cursor fixed when zooming", () => {
    const v = zoomAt(IDENTITY_VIEW, 2, 480, 300, W, H);
    // Map point 480 sits at 480 on screen after the zoom as before.
    expect(480 * v.k + v.x).toBeCloseTo(480);
    expect(300 * v.k + v.y).toBeCloseTo(300);
  });

  it("cannot pan while fully zoomed out", () => {
    expect(isIdentityView(panBy(IDENTITY_VIEW, 50, 50, W, H))).toBe(true);
  });

  it("steps in and back out to the start", () => {
    const back = zoomStep(zoomStep(IDENTITY_VIEW, 1, W, H), -1, W, H);
    expect(back.k).toBeCloseTo(1);
  });

  it("zooms in on a wheel push away, out on a pull", () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0)).toBeLessThan(1);
  });

  it("fits a label only where the state box is big enough at the current zoom", () => {
    const box = { width: 20, height: 20 };
    expect(labelFits(box, 1, 1, 22)).toBe(false);
    expect(labelFits(box, 2, 1, 22)).toBe(true);
  });
});
