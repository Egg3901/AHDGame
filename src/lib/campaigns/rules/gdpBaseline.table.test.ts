/**
 * Derivation pin for the era GDP-baseline table (issue #798).
 *
 * The table in `./gdpBaseline` is authoritative at runtime, but its cells are
 * DERIVED: for each (playable country, era), the population-weighted mean
 * regional GDP per capita over exactly the region bundle that country's seeder
 * writes for that preset, times the seed-time reconcile scalar where the
 * pre-1999 era gate applies (`admin/seed/reconcileStateGdp.ts`).
 *
 * This test recomputes every cell from those same seed modules and fails when
 * a seed edit leaves the table stale. The failure output reports the
 * recomputed value: copy it into the table after calibration review
 * (balance-sensitive — worldsim before merge).
 *
 * Bundle selection mirrors each country's seeder dispatch (`seedStates`,
 * `seedUKRegions`, `seedDERegions`, `seedJPRegions`, `seedIERegions`,
 * `seedNGRegions`): a missing era bundle falls back to the 2019 bundle, and
 * that fallback is written out explicitly here (IE/NG 2027), matching the
 * table's explicit cells. If a seeder wires a new era bundle, update the map
 * below — the recompute loop will fail until the table is recalibrated.
 */
import { describe, expect, it } from "vitest";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { GDP_DENOMINATION_1953 } from "@/lib/seeds/reference/gdpDenomination";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import {
  computeStateGdpScalars,
  shouldReconcileStateGdpForPreset,
} from "@/lib/admin/seed/reconcileStateGdp";
import type { State } from "@/lib/db/types";
import type { EraId } from "@/lib/seeds/presetSelector";
import { getIncomeGdpScalar } from "@/lib/utils/fundGeneration";
import { states } from "@/lib/seeds/reference/states";
import { states1953 } from "@/lib/seeds/reference/states1953";
import { states1979 } from "@/lib/seeds/reference/states1979";
import { states1991 } from "@/lib/seeds/reference/states1991";
import { states1999 } from "@/lib/seeds/reference/states1999";
import { states2007 } from "@/lib/seeds/reference/states2007";
import { states2023 } from "@/lib/seeds/reference/states2023";
import { states2027 } from "@/lib/seeds/reference/states2027";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { deRegions1953 } from "@/lib/seeds/de/deRegions1953";
import { deRegions1979 } from "@/lib/seeds/de/deRegions1979";
import { deRegions1991 } from "@/lib/seeds/de/deRegions1991";
import { deRegions1999 } from "@/lib/seeds/de/deRegions1999";
import { deRegions2007 } from "@/lib/seeds/de/deRegions2007";
import { deRegions2023 } from "@/lib/seeds/de/deRegions2023";
import { deRegions2027 } from "@/lib/seeds/de/deRegions2027";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { ieRegions1953 } from "@/lib/seeds/ie/ieRegions1953";
import { ieRegions1979 } from "@/lib/seeds/ie/ieRegions1979";
import { ieRegions1991 } from "@/lib/seeds/ie/ieRegions1991";
import { ieRegions1999 } from "@/lib/seeds/ie/ieRegions1999";
import { ieRegions2007 } from "@/lib/seeds/ie/ieRegions2007";
import { ieRegions2023 } from "@/lib/seeds/ie/ieRegions2023";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { jpRegions1953 } from "@/lib/seeds/jp/jpRegions1953";
import { jpRegions1979 } from "@/lib/seeds/jp/jpRegions1979";
import { jpRegions1991 } from "@/lib/seeds/jp/jpRegions1991";
import { jpRegions1999 } from "@/lib/seeds/jp/jpRegions1999";
import { jpRegions2007 } from "@/lib/seeds/jp/jpRegions2007";
import { jpRegions2023 } from "@/lib/seeds/jp/jpRegions2023";
import { jpRegions2027 } from "@/lib/seeds/jp/jpRegions2027";
import { ngRegions } from "@/lib/seeds/ng/ngRegions";
import { ngRegions1953 } from "@/lib/seeds/ng/ngRegions1953";
import { ngRegions1979 } from "@/lib/seeds/ng/ngRegions1979";
import { ngRegions1991 } from "@/lib/seeds/ng/ngRegions1991";
import { ngRegions1999 } from "@/lib/seeds/ng/ngRegions1999";
import { ngRegions2007 } from "@/lib/seeds/ng/ngRegions2007";
import { ngRegions2023 } from "@/lib/seeds/ng/ngRegions2023";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import { ukRegions1979 } from "@/lib/seeds/uk/ukRegions1979";
import { ukRegions1991 } from "@/lib/seeds/uk/ukRegions1991";
import { ukRegions1999 } from "@/lib/seeds/uk/ukRegions1999";
import { ukRegions2007 } from "@/lib/seeds/uk/ukRegions2007";
import { ukRegions2023 } from "@/lib/seeds/uk/ukRegions2023";
import { ukRegions2027 } from "@/lib/seeds/uk/ukRegions2027";
import {
  gdpBaselinePerCapita,
  getGdpBaselineTable,
  hasGdpBaseline,
  resolveCampaignGdpBaseline,
  type GdpBaselineCountry,
} from "./gdpBaseline";

type RegionRow = Pick<State, "_id" | "countryId" | "gdp" | "population">;

const ERAS: EraId[] = ["1953", "1979", "1991", "1999", "2007", "2019", "2023", "2027"];

/**
 * Era bundle per country, mirroring seeder dispatch. IE and NG seed no 2027
 * bundle, so their seeders fall back to the 2019 bundle — repeated here as an
 * explicit cell, exactly as the baseline table does.
 */
const BUNDLES: Record<GdpBaselineCountry, Record<EraId, RegionRow[]>> = {
  US: {
    "1953": states1953,
    "1979": states1979,
    "1991": states1991,
    "1999": states1999,
    "2007": states2007,
    "2019": states,
    "2023": states2023,
    "2027": states2027,
  },
  UK: {
    "1953": ukRegions1953,
    "1979": ukRegions1979,
    "1991": ukRegions1991,
    "1999": ukRegions1999,
    "2007": ukRegions2007,
    "2019": ukRegions,
    "2023": ukRegions2023,
    "2027": ukRegions2027,
  },
  DE: {
    "1953": deRegions1953,
    "1979": deRegions1979,
    "1991": deRegions1991,
    "1999": deRegions1999,
    "2007": deRegions2007,
    "2019": deRegions,
    "2023": deRegions2023,
    "2027": deRegions2027,
  },
  JP: {
    "1953": jpRegions1953,
    "1979": jpRegions1979,
    "1991": jpRegions1991,
    "1999": jpRegions1999,
    "2007": jpRegions2007,
    "2019": jpRegions,
    "2023": jpRegions2023,
    "2027": jpRegions2027,
  },
  IE: {
    "1953": ieRegions1953,
    "1979": ieRegions1979,
    "1991": ieRegions1991,
    "1999": ieRegions1999,
    "2007": ieRegions2007,
    "2019": ieRegions,
    "2023": ieRegions2023,
    // No 2027 bundle: seeder falls back to 2019 (see module doc).
    "2027": ieRegions,
  },
  NG: {
    "1953": ngRegions1953,
    "1979": ngRegions1979,
    "1991": ngRegions1991,
    "1999": ngRegions1999,
    "2007": ngRegions2007,
    "2019": ngRegions,
    "2023": ngRegions2023,
    // No 2027 bundle: seeder falls back to 2019 (see module doc).
    "2027": ngRegions,
  },
};

interface RecomputedCell {
  /** Math.round(rawMean * reconcileScalar): the value the table must hold. */
  value: number;
  /** Population-weighted mean regional per-capita before reconcile. */
  rawMean: number;
  /** Seed-time reconcile scalar (1 outside the pre-1999 gate). */
  scalar: number;
  /** Whether the reconcile moved the value (>2% deviation). */
  applied: boolean;
}

function recomputeBaseline(country: GdpBaselineCountry, era: EraId): RecomputedCell {
  const preset = `${era}-default`;
  const rows = BUNDLES[country][era].filter((r) => !NATIONAL_SCOPE_IDS.has(String(r._id)));
  const sumGdpMillions = rows.reduce((sum, r) => sum + (r.gdp || 0), 0);
  const sumPop = rows.reduce((sum, r) => sum + r.population, 0);
  const rawMean = (sumGdpMillions * 1_000_000) / sumPop;
  let scalar = 1;
  let applied = false;
  if (shouldReconcileStateGdpForPreset(preset)) {
    const national = getNationalBudgetSeedConfigsForPreset(preset).find(
      (c) => c.countryId === country
    )?.gdp;
    expect(national, `${country} ${era}: no authored national GDP for reconcile`).toBeDefined();
    const [result] = computeStateGdpScalars(
      rows.map((r) => ({ _id: r._id, countryId: r.countryId, gdp: r.gdp })),
      new Map([[country, national ?? NaN]])
    );
    expect(result, `${country} ${era}: reconcile returned no scalar`).toBeDefined();
    scalar = result?.scalar ?? 1;
    applied = result?.applied ?? false;
  }
  return { value: Math.round(rawMean * scalar), rawMean, scalar, applied };
}

describe("gdpBaseline table derivation (issue #798)", () => {
  it("recomputes every cell from the era seed bundles", () => {
    const table = getGdpBaselineTable();
    for (const country of Object.keys(BUNDLES) as GdpBaselineCountry[]) {
      for (const era of ERAS) {
        const recomputed = recomputeBaseline(country, era);
        expect(
          table[country][era],
          `${country} ${era}: table=${table[country][era]} recomputed=${recomputed.value} ` +
            `(rawMean=${Math.round(recomputed.rawMean)} scalar=${recomputed.scalar} ` +
            `applied=${recomputed.applied}) — copy the recomputed value after calibration review`
        ).toBe(recomputed.value);
      }
    }
  });

  it("pins absolute values for the cross-era anchors", () => {
    const table = getGdpBaselineTable();
    // Modern anchors (DEFAULT_SEED_PRESET era).
    expect(table.US["2019"]).toBe(69_618);
    expect(table.UK["2019"]).toBe(29_734);
    expect(table.JP["2019"]).toBe(4_172_222);
    expect(table.NG["2019"]).toBe(3_669_401);
    // 1953 anchors: JP/NG seeds are USD-anchored, so single/double-digit dollars.
    expect(table.JP["1953"]).toBe(277);
    expect(table.NG["1953"]).toBe(113);
    expect(table.US["1953"]).toBe(2_557);
    // Post-reconcile crush cells: oversized regional authoring scaled down to
    // the authored national GDP (calibration review required on any reseed).
    expect(table.NG["1979"]).toBe(324);
    expect(table.NG["1991"]).toBe(20_226);
  });

  it("keeps the average region at a neutral scalar in every era", () => {
    const table = getGdpBaselineTable();
    for (const country of Object.keys(BUNDLES) as GdpBaselineCountry[]) {
      for (const era of ERAS) {
        const preset = `${era}-default`;
        const { rawMean, scalar } = recomputeBaseline(country, era);
        // The reconcile scales every region equally, so the population-weighted
        // mean per-capita of post-seed regions equals the table value: an
        // exactly-average region resolves a 1.0 scalar.
        const meanRatio = (rawMean * scalar) / table[country][era];
        // Integer-rounded table on small 1953 baselines drifts up to ~0.5%.
        expect(Math.abs(meanRatio - 1.0), `${country} ${era}: mean region ratio`).toBeLessThan(
          0.01
        );
        // And the scalar helper agrees at exactly the baseline.
        expect(
          getIncomeGdpScalar(table[country][era], 1_000_000, country, preset),
          `${country} ${era}: baseline income scalar`
        ).toBeCloseTo(1.0);
      }
    }
  });

  it("reports the era, bundle preset, and denomination unit per resolution", () => {
    for (const country of Object.keys(BUNDLES) as GdpBaselineCountry[]) {
      for (const era of ERAS) {
        const preset = `${era}-default`;
        const res = resolveCampaignGdpBaseline(country, preset);
        expect(res.era).toBe(era);
        expect(res.baseline).toBe(getGdpBaselineTable()[country][era]);
        expect(res.bundlePreset).toBe(
          (country === "IE" || country === "NG") && era === "2027" ? "2019-default" : preset
        );
        expect(res.unit).toBe(
          era === "1953" ? (GDP_DENOMINATION_1953[country] ?? "local") : "local"
        );
      }
    }
    // 1953 USD-anchored seeds resolve "usd"; everything modern is local.
    expect(resolveCampaignGdpBaseline("JP", "1953-default").unit).toBe("usd");
    expect(resolveCampaignGdpBaseline("NG", "1953-default").unit).toBe("usd");
    expect(resolveCampaignGdpBaseline("JP", "2019-default").unit).toBe("local");
    expect(resolveCampaignGdpBaseline("IE", "1953-default").unit).toBe("local");
  });

  it("covers JP and NG cross-era: 1953 baselines differ from modern by orders of magnitude", () => {
    for (const country of ["JP", "NG"] as GdpBaselineCountry[]) {
      const historic = resolveCampaignGdpBaseline(country, "1953-default");
      const modern = resolveCampaignGdpBaseline(country, "2019-default");
      expect(historic.era).toBe("1953");
      expect(modern.era).toBe("2019");
      expect(modern.baseline / historic.baseline).toBeGreaterThan(1_000);
      // A 1953-scale income is neutral under its own era but pinned to the
      // clamp under the modern default — the era parameter is load-bearing.
      const pop = 10_000_000;
      const gdpMillions1953 = (historic.baseline * pop) / 1_000_000;
      expect(getIncomeGdpScalar(gdpMillions1953, pop, country, "1953-default")).toBeCloseTo(1.0);
      expect(getIncomeGdpScalar(gdpMillions1953, pop, country)).toBe(0.9);
    }
  });

  it("fails loudly for countries without an explicit baseline", () => {
    expect(() => resolveCampaignGdpBaseline("XX", "2019-default")).toThrow(/no GDP baseline/);
    // CA sat in the old hardcoded table but is not playable: no silent row.
    expect(() => resolveCampaignGdpBaseline("CA", "2019-default")).toThrow(/no GDP baseline/);
    expect(() => gdpBaselinePerCapita("BR", "1953-default")).toThrow(/no GDP baseline/);
    expect(hasGdpBaseline("US")).toBe(true);
    expect(hasGdpBaseline("NG")).toBe(true);
    expect(hasGdpBaseline("XX")).toBe(false);
    expect(hasGdpBaseline("CA")).toBe(false);
    expect(hasGdpBaseline("BR")).toBe(false);
  });

  it("defaults to the modern era for callers with no world to ask", () => {
    expect(DEFAULT_SEED_PRESET).toBe("2019-default");
    for (const country of Object.keys(BUNDLES) as GdpBaselineCountry[]) {
      expect(gdpBaselinePerCapita(country)).toBe(getGdpBaselineTable()[country]["2019"]);
      expect(resolveCampaignGdpBaseline(country).era).toBe("2019");
    }
    // 2019-family presets resolve the 2019 era, not a silent fallback.
    expect(resolveCampaignGdpBaseline("NG", "empty").baseline).toBe(
      getGdpBaselineTable().NG["2019"]
    );
    expect(resolveCampaignGdpBaseline("JP", "2019-no-parties").era).toBe("2019");
  });
});
