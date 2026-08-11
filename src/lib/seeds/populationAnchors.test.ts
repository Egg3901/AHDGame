import { describe, expect, it } from "vitest";
import { getRegionPopulationAnchor, type PopulationAnchor } from "./populationAnchors";
import type { StateMetrics } from "@/lib/db/types";
import type { State } from "@/lib/db/types/state";
import { ieStateMetrics } from "@/lib/seeds/ie/ieStateMetrics";
import { ieRegions1991 } from "@/lib/seeds/ie/ieRegions1991";
import {
  iePopulationAnchors2019,
  iePopulationAnchors1991,
} from "@/lib/seeds/ie/iePopulationAnchors";
import { deStateMetrics } from "@/lib/seeds/de/deStateMetrics";
import { deRegions1991 } from "@/lib/seeds/de/deRegions1991";
import {
  dePopulationAnchors2019,
  dePopulationAnchors1991,
} from "@/lib/seeds/de/dePopulationAnchors";
import { jpStateMetrics } from "@/lib/seeds/jp/jpStateMetrics";
import { jpRegions1991 } from "@/lib/seeds/jp/jpRegions1991";
import {
  jpPopulationAnchors2019,
  jpPopulationAnchors1991,
} from "@/lib/seeds/jp/jpPopulationAnchors";
import { brStateMetrics } from "@/lib/seeds/br/brStateMetrics";
import { brRegions1991 } from "@/lib/seeds/br/brRegions1991";
import {
  brPopulationAnchors2019,
  brPopulationAnchors1991,
} from "@/lib/seeds/br/brPopulationAnchors";
import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import { cnRegions1991 } from "@/lib/seeds/cn/cnRegions1991";
import {
  cnPopulationAnchors2019,
  cnPopulationAnchors1991,
} from "@/lib/seeds/cn/cnPopulationAnchors";
import { ukStateMetrics } from "@/lib/seeds/uk/ukStateMetrics";
import { ukRegions1991 } from "@/lib/seeds/uk/ukRegions1991";
import {
  ukPopulationAnchors2019,
  ukPopulationAnchors1991,
} from "@/lib/seeds/uk/ukPopulationAnchors";
import { stateMetrics as usStateMetrics } from "@/lib/seeds/reference/stateMetrics";
import {
  usPopulationAnchors2019,
  usPopulationAnchors1991,
} from "@/lib/seeds/reference/usPopulationAnchors";

type Anchors = Record<string, PopulationAnchor>;

/** 2019 anchor must equal the current StateMetrics value for every region (parity). */
function expectParity(stateMetrics: StateMetrics[], anchors2019: Anchors) {
  for (const m of stateMetrics) {
    const a = anchors2019[String(m._id)];
    expect(a, `2019 anchor for ${String(m._id)}`).toBeTruthy();
    expect(a.medianAge).toBe(m.population?.medianAge?.value ?? a.medianAge);
    expect(a.birthRate).toBe(m.population?.birthRate?.value ?? 50);
  }
}

/**
 * Every 1991 region has an anchor, younger than 2019 (universal — all these societies
 * aged), medianAge in a sane band, birthRate in [0,100]. `higherFertility` asserts
 * 1991 ≥ 2019 birthRate — true for young/high-fertility societies (IE, BR, US), but NOT
 * for low-fertility ones whose 1991 fertility was at/below today's (DE, JP).
 */
function expectBands(
  regions1991: State[],
  anchors2019: Anchors,
  anchors1991: Anchors,
  opts: { higherFertility: boolean }
) {
  for (const r of regions1991) {
    const id = String(r._id);
    const a1991 = anchors1991[id];
    const a2019 = anchors2019[id];
    expect(a1991, `1991 anchor for ${id}`).toBeTruthy();
    expect(a2019, `2019 anchor for ${id}`).toBeTruthy();
    expect(a1991.medianAge, `${id} younger in 1991`).toBeLessThan(a2019.medianAge);
    expect(a1991.medianAge).toBeGreaterThanOrEqual(18); // very young high-fertility societies (BR North ~19)
    expect(a1991.medianAge).toBeLessThanOrEqual(42);
    expect(a1991.birthRate).toBeGreaterThanOrEqual(0);
    expect(a1991.birthRate).toBeLessThanOrEqual(100);
    if (opts.higherFertility) {
      expect(a1991.birthRate, `${id} higher fertility in 1991`).toBeGreaterThanOrEqual(
        a2019.birthRate
      );
    }
  }
}

describe("getRegionPopulationAnchor", () => {
  it("returns the 1991 anchor for a known region under the 1991 preset", () => {
    const a = getRegionPopulationAnchor("IE", "DUB", "1991-default");
    expect(a).toBeTruthy();
    expect(a!.medianAge).toBeGreaterThan(0);
    expect(a!.birthRate).toBeGreaterThan(0);
  });

  it("falls back to the 2019 bundle when the preset is absent", () => {
    const a = getRegionPopulationAnchor("IE", "DUB", "some-unknown-preset");
    expect(a).toBeTruthy();
  });

  it("returns null for an unknown country or region", () => {
    expect(getRegionPopulationAnchor("ZZ" as never, "DUB", "2019-default")).toBeNull();
    expect(getRegionPopulationAnchor("IE", "NOPE", "2019-default")).toBeNull();
  });
});

describe("IE population anchors", () => {
  it("2019 parity with ieStateMetrics", () =>
    expectParity(ieStateMetrics, iePopulationAnchors2019));
  it("1991 younger + higher-fertility, in band", () =>
    expectBands(ieRegions1991, iePopulationAnchors2019, iePopulationAnchors1991, {
      higherFertility: true,
    }));
});

describe("DE population anchors", () => {
  it("2019 parity with deStateMetrics", () =>
    expectParity(deStateMetrics, dePopulationAnchors2019));
  // No higher-fertility assertion: the 1991 reunification trough (esp. East) was below 2019.
  it("1991 younger, in band", () =>
    expectBands(deRegions1991, dePopulationAnchors2019, dePopulationAnchors1991, {
      higherFertility: false,
    }));
});

describe("JP population anchors", () => {
  it("2019 parity with jpStateMetrics", () =>
    expectParity(jpStateMetrics, jpPopulationAnchors2019));
  // higherFertility not asserted per-region: urban Kanto was already low in 1991.
  it("1991 younger, in band", () =>
    expectBands(jpRegions1991, jpPopulationAnchors2019, jpPopulationAnchors1991, {
      higherFertility: false,
    }));
});

describe("BR population anchors", () => {
  it("2019 parity with brStateMetrics", () =>
    expectParity(brStateMetrics, brPopulationAnchors2019));
  it("1991 younger + higher-fertility, in band", () =>
    expectBands(brRegions1991, brPopulationAnchors2019, brPopulationAnchors1991, {
      higherFertility: true,
    }));
});

describe("CN population anchors", () => {
  it("2019 parity with cnStateMetrics", () =>
    expectParity(cnStateMetrics, cnPopulationAnchors2019));
  it("1991 younger + higher-fertility, in band", () =>
    expectBands(cnRegions1991, cnPopulationAnchors2019, cnPopulationAnchors1991, {
      higherFertility: true,
    }));
});

describe("UK population anchors", () => {
  it("2019 parity with ukStateMetrics", () =>
    expectParity(ukStateMetrics, ukPopulationAnchors2019));
  // higherFertility not asserted: 1991 TFR (~1.8) only marginally above 2019.
  it("1991 younger, in band", () =>
    expectBands(ukRegions1991, ukPopulationAnchors2019, ukPopulationAnchors1991, {
      higherFertility: false,
    }));
});

describe("US population anchors", () => {
  // US "regions" are the 50 states + DC (stateMetrics), not a *Regions1991 array.
  it("2019 parity with stateMetrics", () => expectParity(usStateMetrics, usPopulationAnchors2019));
  // higherFertility not asserted per-state (no per-state 1991 fertility data).
  it("1991 younger, in band (every state)", () =>
    expectBands(
      usStateMetrics as unknown as State[],
      usPopulationAnchors2019,
      usPopulationAnchors1991,
      { higherFertility: false }
    ));
});
