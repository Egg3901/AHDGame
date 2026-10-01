import { describe, expect, it } from "vitest";
import * as topojson from "topojson-client";
import topo from "../../../public/geo/countries-110m.json";
import { ERA_CONFIGS, SOVIET_REPUBLIC_FEATURE_IDS } from "./eraThemes";
import { HISTORICAL_CRISIS_SHOWCASE } from "./historicalCrisisShowcase";
import { dissolvedStateGeometry } from "./broadcastGlobe";

const DASHES = /[–—]/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const broadcast = ERA_CONFIGS["1991"].broadcast!;

const topology = topo as any;

describe("1991 broadcast lander content", () => {
  it("exists for 1991 and never stacks with the CRT look", () => {
    expect(broadcast).toBeDefined();
    for (const config of Object.values(ERA_CONFIGS)) {
      expect(Boolean(config.broadcast && config.wireframeColor), config.id).toBe(false);
    }
  });

  it("runs the crawl oldest first, with the orbit item last", () => {
    const dated = broadcast.ticker.filter((item) => item.date !== "In orbit");
    const order = dated.map((item) => {
      const [day, month] = item.date.split(" ");
      expect(MONTHS, item.date).toContain(month);
      return MONTHS.indexOf(month) * 100 + Number(day);
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(broadcast.ticker[broadcast.ticker.length - 1].date).toBe("In orbit");
  });

  it("files every dated headline from a real place", () => {
    for (const item of broadcast.ticker) {
      if (item.date === "In orbit") {
        expect(item.place).toBeUndefined();
        continue;
      }
      expect(item.place, item.text).toBeDefined();
      const [lon, lat] = item.place!.lonLat;
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    }
  });

  it("highlights the era year inside the headline", () => {
    expect(ERA_CONFIGS["1991"].heroHeadline).toContain("1991");
  });

  it("keeps em and en dashes out of the copy players read", () => {
    const copy = [
      broadcast.kicker,
      broadcast.dateline,
      broadcast.tickerLabel,
      broadcast.orbitLabel,
      ...broadcast.ticker.flatMap((item) => [item.date, item.text, item.place?.name ?? ""]),
      ...Object.values(ERA_CONFIGS).flatMap((config) => [
        config.loginTagline,
        config.heroHeadline,
        config.heroDek,
      ]),
      ...HISTORICAL_CRISIS_SHOWCASE.flatMap((entry) => [entry.title, entry.description]),
    ];
    for (const text of copy) expect(text, text).not.toMatch(DASHES);
  });

  it("links only eras that have a world report out to one", () => {
    expect(ERA_CONFIGS["1953"].worldReportUrl).toMatch(/^https:\/\//);
    expect(ERA_CONFIGS["1991"].worldReportUrl).toBeUndefined();
  });
});

describe("the dissolved Soviet Union", () => {
  it("names all fifteen republics, each present on the map", () => {
    expect(new Set(SOVIET_REPUBLIC_FEATURE_IDS).size).toBe(15);
    const onMap = new Set(
      topology.objects.countries.geometries.map((g: { id: unknown }) => String(g.id))
    );
    for (const id of SOVIET_REPUBLIC_FEATURE_IDS) expect(onMap.has(id), id).toBe(true);
    expect(broadcast.dissolvedStateFeatureIds).toBe(SOVIET_REPUBLIC_FEATURE_IDS);
  });

  it("draws an outer outline and the borders between republics as separate meshes", () => {
    const geometry = dissolvedStateGeometry(topojson.mesh, topology, SOVIET_REPUBLIC_FEATURE_IDS);
    expect(geometry).not.toBeNull();
    const { outline, seams } = geometry!;
    expect(outline.type).toBe("MultiLineString");
    expect(outline.coordinates.length).toBeGreaterThan(0);
    expect(seams.coordinates.length).toBeGreaterThan(0);

    // The Russia and Ukraine border is a seam, never part of the outline.
    const russiaUkraine = topojson.mesh(
      topology,
      topology.objects.countries,
      (a: { id: unknown }, b: { id: unknown }) =>
        a !== b && [String(a.id), String(b.id)].sort().join() === ["643", "804"].sort().join()
    ) as GeoJSON.MultiLineString;
    const key = (p: number[]) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    const seamPoints = new Set(seams.coordinates.flat().map(key));
    const outlinePoints = new Set(outline.coordinates.flat().map(key));
    // Interior vertices only: where the border meets the coast is on the outline.
    const border = russiaUkraine.coordinates.flatMap((line) => line.slice(1, -1)).map(key);
    expect(border.length).toBeGreaterThan(2);
    for (const point of border) {
      expect(seamPoints.has(point)).toBe(true);
      expect(outlinePoints.has(point)).toBe(false);
    }
  });

  it("draws nothing for an empty or unknown roster", () => {
    expect(dissolvedStateGeometry(topojson.mesh, topology, [])).toBeNull();
    expect(dissolvedStateGeometry(topojson.mesh, topology, ["nowhere"])).toBeNull();
  });
});
