/**
 * The fresh 1991 world must seed corporate productive capacity, and GDP-driven
 * demand, in proportion to each country's economy in anchor terms.
 *
 * Yardstick: the national budget seed GDP converted with the preset's
 * denomination rate, which is independent of the regional rows the sector
 * pools are built from. Capacity: the sum of unowned sector pool revenue over
 * every region and operating lane, the pool NPP competitors and state sectors
 * are cut from. Demand: the state GDP map the commodity ledger multiplies by
 * each macro demand fraction.
 */
import { describe, expect, it } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import { OPERATING_SECTOR_TYPES } from "@/lib/constants/corporations";
import { regionBundleFor } from "@/lib/admin/seedDiagnostic/regionBundles";
import { selectStatesBundleForPreset } from "@/lib/admin/seed/seedStates";
import { computeUnownedSeedRevenue } from "@/lib/admin/seed/seedUnownedSectors";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import { gdpToAnchor } from "@/lib/currency/gdpAnchorRate";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import {
  buildStateLookups,
  STATE_GDP_ANCHOR_PHASE_TURNS,
  stateGdpAnchorBlend,
} from "@/lib/turn/commodity/sectorLedger";
import type { State } from "@/lib/db/types";

const PRESET = "1991-default";
const MAJORS: CountryId[] = ["US", "JP", "DE", "UK", "CN"];
/** Allowed gap, in percentage points of the five-country total. */
const SHARE_TOLERANCE_POINTS = 3;

function regionsFor(countryId: CountryId): State[] {
  const bundle =
    countryId === "US"
      ? (selectStatesBundleForPreset(PRESET) as State[])
      : (regionBundleFor(countryId, PRESET) ?? []);
  return bundle.filter((s) => s.countryId === countryId && !NATIONAL_SCOPE_IDS.has(s._id));
}

function shares(values: Record<string, number>): Record<string, number> {
  const total = Object.values(values).reduce((sum, v) => sum + v, 0);
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, (100 * v) / total]));
}

const nationalGdp = new Map(
  getInitialNationalBudgetsForPreset(PRESET).map((b) => [b.countryId, b.gdp])
);
const gdpShare = shares(
  Object.fromEntries(MAJORS.map((c) => [c, gdpToAnchor(nationalGdp.get(c) ?? 0, c, PRESET)]))
);

describe("1991 seed: capacity and demand track GDP share", () => {
  it("has a national GDP and regional rows for every major country", () => {
    for (const c of MAJORS) {
      expect(nationalGdp.get(c) ?? 0, c).toBeGreaterThan(0);
      expect(regionsFor(c).length, c).toBeGreaterThan(0);
    }
  });

  it("seeds sector pool capacity within a few points of each country's GDP share", () => {
    const capacity: Record<string, number> = {};
    for (const c of MAJORS) {
      capacity[c] = regionsFor(c).reduce(
        (sum, region) =>
          sum +
          OPERATING_SECTOR_TYPES.reduce(
            (laneSum, lane) =>
              laneSum +
              computeUnownedSeedRevenue({
                gdp: region.gdp,
                countryId: c,
                stateId: region._id,
                sectorType: lane,
                preset: PRESET,
              }),
            0
          ),
        0
      );
    }
    const capacityShare = shares(capacity);
    for (const c of MAJORS) {
      expect(
        Math.abs(capacityShare[c] - gdpShare[c]),
        `${c}: capacity ${capacityShare[c].toFixed(1)}% vs GDP ${gdpShare[c].toFixed(1)}%`
      ).toBeLessThanOrEqual(SHARE_TOLERANCE_POINTS);
    }
  });

  it("feeds macro demand anchor GDP, so Japan's yen rows are not read as anchor", () => {
    const allRegions = MAJORS.flatMap(regionsFor);
    const { stateGdpMap } = buildStateLookups(allRegions, [], PRESET);
    const demandGdp: Record<string, number> = {};
    for (const region of allRegions) {
      demandGdp[region.countryId] =
        (demandGdp[region.countryId] ?? 0) + (stateGdpMap.get(region._id) ?? 0);
    }
    const demandShare = shares(demandGdp);
    for (const c of MAJORS) {
      expect(
        Math.abs(demandShare[c] - gdpShare[c]),
        `${c}: demand GDP ${demandShare[c].toFixed(1)}% vs GDP ${gdpShare[c].toFixed(1)}%`
      ).toBeLessThanOrEqual(SHARE_TOLERANCE_POINTS);
    }
  });

  it("keeps the raw stored reading for worlds seeded before the fix", () => {
    const jp = regionsFor("JP");
    const { stateGdpMap } = buildStateLookups(jp, []);
    for (const region of jp) expect(stateGdpMap.get(region._id)).toBe(region.gdp);
  });
});

describe("live phase-in onto anchor state GDP", () => {
  it("blend is 1 on anchored worlds, ramps from the operator start otherwise, else 0", () => {
    expect(stateGdpAnchorBlend(true, undefined, 10)).toBe(1);
    expect(stateGdpAnchorBlend(false, undefined, 10)).toBe(0);
    expect(stateGdpAnchorBlend(false, 220, 219)).toBe(0);
    expect(stateGdpAnchorBlend(false, 220, 220 + STATE_GDP_ANCHOR_PHASE_TURNS / 2)).toBeCloseTo(
      0.5
    );
    expect(stateGdpAnchorBlend(false, 220, 500)).toBe(1);
  });

  it("moves each region geometrically from raw to anchor GDP", () => {
    const jp = regionsFor("JP");
    const raw = buildStateLookups(jp, []).stateGdpMap;
    const full = buildStateLookups(jp, [], PRESET, 1).stateGdpMap;
    const half = buildStateLookups(jp, [], PRESET, 0.5).stateGdpMap;
    const none = buildStateLookups(jp, [], PRESET, 0).stateGdpMap;
    for (const region of jp) {
      const r = raw.get(region._id)!;
      const f = full.get(region._id)!;
      expect(none.get(region._id)).toBe(r);
      expect(half.get(region._id)!).toBeCloseTo(Math.sqrt(r * f), 0);
    }
  });
});
