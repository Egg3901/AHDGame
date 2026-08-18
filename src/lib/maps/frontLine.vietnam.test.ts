import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { projectRegions } from "./projectRegions";
import { axisWords, frontLine, sampleLand, type PxPoint } from "./frontLine";
import { COUNTRY_ANCHOR } from "./countryAnchors";
import type { GeoFeature } from "@/components/maps/RegionalGeoMap";

/**
 * The Vietnam front against REAL geometry: Hanoi north of Saigon, both halves
 * in the box, axis of advance north-south rather than the west-east fallback.
 */

const BOX = { w: 620, h: 837 };

function vietnam() {
  const raw = fs.readFileSync(path.join(process.cwd(), "public", "vietnam-regions.json"), "utf8");
  const features = (JSON.parse(raw).features ?? []) as GeoFeature[];
  const geo = projectRegions(features, BOX)!;
  const land = sampleLand(geo.rings, BOX);
  return { geo, land };
}

describe("the front line over real Vietnam geometry", () => {
  it("projects both halves", () => {
    const { geo } = vietnam();
    expect(geo.regions.map((r) => r.id).sort()).toEqual(["NVN", "SVN"]);
  });

  it("orients a 50/50 front north-south from the two capitals", () => {
    const { geo, land } = vietnam();
    const saigon = geo.project(COUNTRY_ANCHOR.SVN);
    const centre: PxPoint = [BOX.w / 2, BOX.h / 2];
    expect(Math.hypot(saigon[0] - centre[0], saigon[1] - centre[1])).toBeGreaterThan(BOX.w * 0.35);

    const front = frontLine(BOX, land, saigon, 50)!;
    expect(Math.abs(front.u[1])).toBeGreaterThan(Math.abs(front.u[0]));
    expect(axisWords(front.u)).toBe("south → north");

    const hanoi = geo.project(COUNTRY_ANCHOR.NVN);
    expect(hanoi[1]).toBeLessThan(saigon[1]);
  });
});
