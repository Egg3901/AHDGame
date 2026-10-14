import { describe, expect, it } from "vitest";
import { framingLongitude, majorPolygons } from "./mapFraming";

const US: [number, number] = [-125, -67];
const ALASKA: [number, number] = [-168, -141];
const UK: [number, number] = [-8, 2];
const JAPAN: [number, number] = [129, 146];

describe("framingLongitude", () => {
  it("centers on the Americas when the widest gap is Eurasia", () => {
    const center = framingLongitude([US, ALASKA, UK, JAPAN]);
    // Arc runs from Japan east across the Pacific and Americas to the UK.
    expect(center).toBeGreaterThan(-130);
    expect(center).toBeLessThan(-90);
  });

  it("centers on a single country", () => {
    expect(framingLongitude([UK])).toBeCloseTo(-3, 5);
  });

  it("handles intervals that cross the dateline", () => {
    const center = framingLongitude([[170, 190]]);
    expect(Math.abs(center)).toBeCloseTo(180, 5);
  });

  it("defaults to Greenwich with nothing to frame", () => {
    expect(framingLongitude([])).toBe(0);
  });
});

describe("majorPolygons", () => {
  it("drops small outlying polygons", () => {
    const geometry = { type: "MultiPolygon", coordinates: [[["big"]], [["tiny"]], [["mid"]]] };
    const sizes: Record<string, number> = { big: 100, tiny: 1, mid: 40 };
    const kept = majorPolygons(geometry, (p) => {
      const coords = p.coordinates as string[][];
      return sizes[coords[0][0]];
    });
    expect(kept).toHaveLength(2);
  });

  it("passes single polygons through", () => {
    const geometry = { type: "Polygon", coordinates: [] };
    expect(majorPolygons(geometry, () => 1)).toEqual([geometry]);
  });
});
