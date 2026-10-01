import { describe, expect, it } from "vitest";
import {
  beamAt,
  envelope,
  orbitAxes,
  orbitPosition,
  orbitToGlobe,
  orbitTrail,
  projectOnGlobe,
  type OrbitSpec,
} from "./broadcastMotion";

const identity = (lonLat: [number, number]): [number, number] => lonLat;
const CENTER: [number, number] = [320, 184];
const R = 100;

const ORBIT: OrbitSpec = { id: "t", radius: 1.2, tilt: 60, roll: 0, period: 40, phase: 0 };

describe("projectOnGlobe", () => {
  it("puts the view centre at the middle of the disc, facing the viewer", () => {
    const p = projectOnGlobe(identity, [0, 0], CENTER, R);
    expect(p.x).toBeCloseTo(320);
    expect(p.y).toBeCloseTo(184);
    expect(p.visible).toBe(true);
  });

  it("draws north up and east to the right", () => {
    const pole = projectOnGlobe(identity, [0, 90], CENTER, R);
    expect(pole.y).toBeCloseTo(184 - R);
    const east = projectOnGlobe(identity, [45, 0], CENTER, R);
    expect(east.x).toBeGreaterThan(320);
  });

  it("hides the far side", () => {
    expect(projectOnGlobe(identity, [180, 0], CENTER, R).visible).toBe(false);
    expect(projectOnGlobe(identity, [120, 10], CENTER, R).visible).toBe(false);
  });

  it("applies the globe's rotation before projecting", () => {
    // A rotation that brings Moscow to the centre of the view.
    const rotate = ([lon, lat]: [number, number]): [number, number] => [lon - 37.6, lat - 55.75];
    const moscow = projectOnGlobe(rotate, [37.6, 55.75], CENTER, R);
    expect(moscow.x).toBeCloseTo(320);
    expect(moscow.y).toBeCloseTo(184);
  });
});

describe("orbits", () => {
  it("foreshortens the orbit by its tilt", () => {
    const { a, b } = orbitAxes(ORBIT, R);
    expect(a).toBeCloseTo(120);
    expect(b).toBeCloseTo(60);
  });

  it("goes over the top first, so the near side is the lower half", () => {
    const start = orbitPosition(ORBIT, R, 0);
    expect(start.x).toBeCloseTo(120);
    expect(start.y).toBeCloseTo(0);

    const quarter = orbitPosition(ORBIT, R, 10);
    expect(quarter.y).toBeCloseTo(-60);
    expect(quarter.near).toBe(false);

    const threeQuarters = orbitPosition(ORBIT, R, 30);
    expect(threeQuarters.y).toBeCloseTo(60);
    expect(threeQuarters.near).toBe(true);
  });

  it("starts each satellite at its own phase", () => {
    const half = orbitPosition({ ...ORBIT, phase: 0.5 }, R, 0);
    expect(half.x).toBeCloseTo(-120);
  });

  it("ends a trail at the satellite and runs back along the orbit", () => {
    const position = orbitPosition(ORBIT, R, 7);
    const trail = orbitTrail(ORBIT, R, position.theta, 0.4, 8);
    expect(trail).toHaveLength(9);
    const [headX, headY] = trail[trail.length - 1];
    expect(headX).toBeCloseTo(position.x);
    expect(headY).toBeCloseTo(position.y);
  });

  it("carries orbit coordinates through roll and zoom into the globe's frame", () => {
    expect(orbitToGlobe([10, 0], ORBIT, CENTER, 1)).toEqual([330, 184]);
    const rolled = orbitToGlobe([10, 0], { ...ORBIT, roll: 90 }, CENTER, 2);
    expect(rolled[0]).toBeCloseTo(320);
    expect(rolled[1]).toBeCloseTo(204);
  });
});

describe("beamAt", () => {
  it("is live for the active span and quiet for the rest", () => {
    expect(beamAt(0, 3, 1)).toEqual({ beam: 0, progress: 0 });
    expect(beamAt(1.5, 3, 1)).toEqual({ beam: 0, progress: 0.5 });
    expect(beamAt(3.5, 3, 1)).toBeNull();
    expect(beamAt(4.75, 3, 1)).toEqual({ beam: 1, progress: 0.25 });
  });

  it("has nothing before the clock starts", () => {
    expect(beamAt(-1, 3, 1)).toBeNull();
  });
});

describe("envelope", () => {
  it("fades in, holds, and fades out", () => {
    expect(envelope(0, 0.2)).toBe(0);
    expect(envelope(0.1, 0.2)).toBeCloseTo(0.5);
    expect(envelope(0.5, 0.2)).toBe(1);
    expect(envelope(1, 0.2)).toBe(0);
  });
});
