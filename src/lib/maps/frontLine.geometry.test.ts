import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { projectRegions } from "./projectRegions";
import { frontLine, sampleLand, type PxPoint } from "./frontLine";
import { occupationShift } from "@/lib/military/occupation";
import type { GeoFeature } from "@/components/maps/RegionalGeoMap";

/**
 * The front line against REAL geometry, driven by the REAL occupation rule.
 *
 * `frontLine.test.ts` proves the maths on a square. This proves the thing the
 * player actually sees: that when `battleResolution` moves `control`, the line
 * drawn across Germany moves the right way, by a visible amount, and hands the
 * right Länder to the right side.
 */

const BOX = { w: 620, h: 837 };
/** The UK anchor projected into the German box — NATO's axis of advance. */
const UK: [number, number] = [-2.0, 54.0];

function germany() {
  const raw = fs.readFileSync(path.join(process.cwd(), "public", "germany-regions.json"), "utf8");
  const features = (JSON.parse(raw).features ?? []) as GeoFeature[];
  const geo = projectRegions(features, BOX)!;
  const land = sampleLand(geo.rings, BOX);
  return { geo, land, anchor: geo.project(UK) };
}

/** The line for a given side-B control value, as the page derives it. */
function lineAt(control: number) {
  const { geo, land, anchor } = germany();
  const front = frontLine(BOX, land, anchor, 100 - control)!;
  const held = (side: "A" | "B") =>
    geo.regions
      .filter((r) => front.gap([r.cx, r.cy]) < 0 === (side === "A"))
      .map((r) => r.id)
      .sort();
  return {
    front,
    /** Mean x of the drawn line — how far across the country it sits. */
    meanX:
      front.line
        .slice(1)
        .split("L")
        .map((p) => Number(p.split(" ")[0]))
        .reduce((a, b) => a + b, 0) / front.line.slice(1).split("L").length,
    natoHolds: held("A"),
    pactHolds: held("B"),
    landShareA: land.filter((p) => front.held(p as PxPoint)).length / land.length,
  };
}

describe("the front line over real German geometry", () => {
  it("projects all sixteen Länder", () => {
    const { geo } = germany();
    expect(geo.regions).toHaveLength(16);
    expect(geo.regions.map((r) => r.id).sort()).toContain("BY");
  });

  // The whole point of an area-weighted line: `control` is a share of the host's
  // LAND, so the drawn line has to cut it in that proportion.
  it("puts the sampled land share within a couple of points of `control`", () => {
    for (const control of [20, 35, 50, 65, 80]) {
      const { landShareA } = lineAt(control);
      expect(Math.abs(landShareA * 100 - (100 - control))).toBeLessThan(3);
    }
  });

  it("marches west as side B wins, and never backwards", () => {
    const xs = [30, 40, 50, 60, 70, 80].map((c) => lineAt(c).meanX);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeLessThan(xs[i - 1]);
    }
  });

  // Ground changes hands one way only. A side that gains control must never be
  // shown losing a Land in the same movement — which is exactly the incoherence
  // the old per-region ordering produced when it had no axis to walk along.
  it("hands Länder across without ever taking one back", () => {
    const steps = [90, 75, 60, 45, 30, 15].map((c) => lineAt(c));
    for (let i = 1; i < steps.length; i++) {
      const gained = steps[i].natoHolds;
      const before = steps[i - 1].natoHolds;
      // NATO's holdings grow monotonically as its share grows.
      expect(gained.length).toBeGreaterThanOrEqual(before.length);
      for (const id of before) expect(gained).toContain(id);
    }
    // Every Land belongs to exactly one side at every position of the line.
    for (const s of steps) {
      expect(s.natoHolds.length + s.pactHolds.length).toBe(16);
      expect(s.natoHolds.filter((id) => s.pactHolds.includes(id))).toEqual([]);
    }
  });

  // Bavaria is the deepest ground along a UK→Germany axis and the largest Land,
  // so it is the last to change hands — the map should say so rather than
  // flipping it early because of some ordering artefact.
  it("takes the deepest Land last", () => {
    const flipsAt = [95, 85, 75, 65, 55, 45, 35, 25, 15, 5].find((c) =>
      lineAt(c).natoHolds.includes("BY")
    );
    expect(flipsAt).toBeDefined();
    // NATO must be well past halfway before Bavaria falls.
    expect(flipsAt!).toBeLessThan(35);
    // And the nearest ground (Nordrhein-Westfalen, on the western border) goes first.
    expect(lineAt(85).natoHolds).toContain("NW");
  });

  it("moves visibly for one decisive engagement", () => {
    // What `battleResolution` writes for a decisive win with no retreat.
    const before = 72;
    const after = occupationShift({
      control: before,
      winner: "A",
      margin: 45,
      loserRetreated: false,
    });
    expect(after).toBe(67);
    const moved = lineAt(after).meanX - lineAt(before).meanX;
    // Eastward for NATO, and far enough to see on a 620px-wide map.
    expect(moved).toBeGreaterThan(8);
  });

  // A narrow win must not look identical to a rout, or the map stops carrying
  // any information about how the battle went.
  it("moves further for a rout than for a narrow win", () => {
    const narrow = occupationShift({
      control: 72,
      winner: "A",
      margin: 9,
      loserRetreated: false,
    });
    const rout = occupationShift({ control: 72, winner: "A", margin: 45, loserRetreated: false });
    const dNarrow = lineAt(narrow).meanX - lineAt(72).meanX;
    const dRout = lineAt(rout).meanX - lineAt(72).meanX;
    expect(dRout).toBeGreaterThan(dNarrow * 2);
  });

  it("reverses when the other side wins", () => {
    const base = lineAt(50).meanX;
    const aWon = lineAt(
      occupationShift({ control: 50, winner: "A", margin: 45, loserRetreated: false })
    );
    const bWon = lineAt(
      occupationShift({ control: 50, winner: "B", margin: 45, loserRetreated: false })
    );
    expect(aWon.meanX).toBeGreaterThan(base);
    expect(bWon.meanX).toBeLessThan(base);
  });

  it("gives one side the whole country at a pole, and nothing at the other", () => {
    expect(lineAt(0).pactHolds).toEqual([]);
    expect(lineAt(0).natoHolds).toHaveLength(16);
    expect(lineAt(100).natoHolds).toEqual([]);
    expect(lineAt(100).pactHolds).toHaveLength(16);
  });
});
