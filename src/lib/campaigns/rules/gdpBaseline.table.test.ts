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
 * `seedNGRegions`, `seedCNRegions`, `seedDDRegions`, `seedRURegions`): a
 * missing era bundle falls back to the 2019 bundle, and that fallback is
 * written out explicitly here (IE/NG 2027; DD and RU outside their authored
 * eras), matching the table's explicit cells. If a seeder wires a new era
 * bundle, update the map below — the recompute loop will fail until the table
 * is recalibrated.
 *
 * Not every cell is derivable. A country can seed no regions for an era (DD
 * after reunification) or seed regions with no authored national GDP to
 * reconcile against (RU in 1991). Those are listed in NON_DERIVABLE_ERAS and
 * asserted as documented repeats instead of being recomputed.
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
// Japan's seed data lives in its country folder; `src/lib/seeds/jp/` was
// emptied by the conversion and left no forwarder, because the whole
// directory moved rather than individual files.
import { jpRegions } from "@/lib/countries/jp/data/jpRegions";
import { jpRegions1953 } from "@/lib/countries/jp/data/jpRegions1953";
import { jpRegions1979 } from "@/lib/countries/jp/data/jpRegions1979";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";
import { jpRegions1999 } from "@/lib/countries/jp/data/jpRegions1999";
import { jpRegions2007 } from "@/lib/countries/jp/data/jpRegions2007";
import { jpRegions2023 } from "@/lib/countries/jp/data/jpRegions2023";
import { jpRegions2027 } from "@/lib/countries/jp/data/jpRegions2027";
import { ngRegions } from "@/lib/seeds/ng/ngRegions";
import { ngRegions1953 } from "@/lib/seeds/ng/ngRegions1953";
import { ngRegions1979 } from "@/lib/seeds/ng/ngRegions1979";
import { ngRegions1991 } from "@/lib/seeds/ng/ngRegions1991";
import { ngRegions1999 } from "@/lib/seeds/ng/ngRegions1999";
import { ngRegions2007 } from "@/lib/seeds/ng/ngRegions2007";
import { ngRegions2023 } from "@/lib/seeds/ng/ngRegions2023";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { cnRegions1953 } from "@/lib/seeds/cn/cnRegions1953";
import { cnRegions1979 } from "@/lib/seeds/cn/cnRegions1979";
import { cnRegions1991 } from "@/lib/seeds/cn/cnRegions1991";
import { cnRegions1999 } from "@/lib/seeds/cn/cnRegions1999";
import { cnRegions2007 } from "@/lib/seeds/cn/cnRegions2007";
import { cnRegions2023 } from "@/lib/seeds/cn/cnRegions2023";
import { cnRegions2027 } from "@/lib/seeds/cn/cnRegions2027";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import { ukRegions1979 } from "@/lib/seeds/uk/ukRegions1979";
import { ukRegions1991 } from "@/lib/seeds/uk/ukRegions1991";
import { ukRegions1999 } from "@/lib/seeds/uk/ukRegions1999";
import { ukRegions2007 } from "@/lib/seeds/uk/ukRegions2007";
import { ukRegions2023 } from "@/lib/seeds/uk/ukRegions2023";
import { ukRegions2027 } from "@/lib/seeds/uk/ukRegions2027";
// DD seeds only two bundles: 1953, and the Länder model used for 1979.
import { ddRegions } from "@/lib/seeds/dd/ddRegions";
import { ddRegions1953 } from "@/lib/seeds/dd/ddRegions1953";
// RU likewise authors two: 1953, and `ruRegions` for 1979 plus every era that
// takes the 2019-default fallback (`seedRURegions`).
import { ruRegions } from "@/lib/seeds/ru/ruRegions";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
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
 * Era bundle per country, mirroring seeder dispatch (`seedCNRegions` wires an
 * explicit 2027 bundle, so CN is bundle-native in every era). IE and NG seed
 * no 2027 bundle, so their seeders fall back to the 2019 bundle — repeated
 * here as an explicit cell, exactly as the baseline table does.
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
  CN: {
    "1953": cnRegions1953,
    "1979": cnRegions1979,
    "1991": cnRegions1991,
    "1999": cnRegions1999,
    "2007": cnRegions2007,
    "2019": cnRegions,
    "2023": cnRegions2023,
    // Unlike IE/NG, CN seeds an explicit 2027 bundle (see `seedCNRegions`).
    "2027": cnRegions2027,
  },
  DD: {
    "1953": ddRegions1953,
    // `seedDDRegions` wires `ddRegions` to 1979, not to 2019.
    "1979": ddRegions,
    // DD dissolves at reunification: `seedDDRegions` maps 2019 to an EMPTY
    // bundle, so every unified era seeds no DD regions at all. These entries
    // repeat the 1979 bundle to match the table's repeated cells; they are not
    // recomputed (see NON_DERIVABLE_ERAS) because there is no authored national
    // GDP to reconcile against, and an empty bundle has no mean to take.
    "1991": ddRegions,
    "1999": ddRegions,
    "2007": ddRegions,
    "2019": ddRegions,
    "2023": ddRegions,
    "2027": ddRegions,
  },
  RU: {
    "1953": ruRegions1953,
    // `seedRURegions` keys 1979 explicitly at `ruRegions`; every era below
    // outside 1953 lands on the same bundle via the 2019-default fallback.
    // All are derived from it EXCEPT 1991, which has no authored national GDP
    // to reconcile against and is listed in NON_DERIVABLE_ERAS.
    "1979": ruRegions,
    "1991": ruRegions,
    "1999": ruRegions,
    "2007": ruRegions,
    "2019": ruRegions,
    "2023": ruRegions,
    "2027": ruRegions,
  },
};

/**
 * Eras whose cell cannot be recomputed, so it is a documented repeat instead.
 * Asserted as a repeat below rather than run through `recomputeBaseline`, which
 * would need a bundle to average and an authored national GDP to reconcile
 * against. Two different reasons land here:
 *
 * - DD seeds NO REGIONS after reunification (`seedDDRegions` maps 2019, and so
 *   every unified era, to an empty bundle). Nothing to average.
 * - RU seeds regions in 1991 via the 2019-default fallback, but the USSR has no
 *   AUTHORED NATIONAL GDP for 1991 — `getNationalBudgetSeedConfigsForPreset`
 *   builds that era from `NATIONAL_BUDGET_SEED_CONFIGS_1991` plus only AT/FI/GR
 *   carried forward. The reconcile gate covers 1991 (`era < 1999`), so there is
 *   nothing to reconcile against. Its bundle is byte-identical to 2019's and
 *   2019 takes no reconcile, so the honest value is exactly the 2019 cell.
 */
const NON_DERIVABLE_ERAS: Partial<Record<GdpBaselineCountry, { eras: EraId[]; repeats: EraId }>> = {
  DD: { eras: ["1991", "1999", "2007", "2019", "2023", "2027"], repeats: "1979" },
  RU: { eras: ["1991"], repeats: "2019" },
};

function derivableEras(country: GdpBaselineCountry): EraId[] {
  const skip = new Set(NON_DERIVABLE_ERAS[country]?.eras ?? []);
  return ERAS.filter((era) => !skip.has(era));
}

/**
 * Which bundle each (country, era) cell actually came from, spelled out here
 * rather than imported from the module under test — importing the production
 * override map would make the assertion compare it against itself.
 *
 * Read off the seeder dispatch: `seedDDRegions` and `seedRURegions` key only
 * some presets and let `selectPresetBundle` fall through to `2019-default`;
 * IE/NG seed no 2027 bundle.
 */
const EXPECTED_BUNDLE_PRESET: Partial<Record<GdpBaselineCountry, Partial<Record<EraId, string>>>> =
  {
    IE: { "2027": "2019-default" },
    NG: { "2027": "2019-default" },
    DD: {
      "1991": "1979-default",
      "1999": "1979-default",
      "2007": "1979-default",
      "2019": "1979-default",
      "2023": "1979-default",
      "2027": "1979-default",
    },
    RU: {
      "1991": "2019-default",
      "1999": "2019-default",
      "2007": "2019-default",
      "2023": "2019-default",
      "2027": "2019-default",
    },
  };

function expectedBundlePreset(country: GdpBaselineCountry, era: EraId): string {
  return EXPECTED_BUNDLE_PRESET[country]?.[era] ?? `${era}-default`;
}

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
      for (const era of derivableEras(country)) {
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

  it("holds a documented repeat for eras a country seeds no regions in", () => {
    const table = getGdpBaselineTable();
    for (const [country, { eras, repeats }] of Object.entries(NON_DERIVABLE_ERAS) as Array<
      [GdpBaselineCountry, { eras: EraId[]; repeats: EraId }]
    >) {
      for (const era of eras) {
        expect(
          table[country][era],
          `${country} ${era}: no region bundle for this era, so the cell must repeat ` +
            `${repeats} (${table[country][repeats]}) rather than hold a value of its own`
        ).toBe(table[country][repeats]);
      }
    }
  });

  it("resolves DD's post-reunification cells from the 1979 bundle", () => {
    // The repeat is only honest if the resolution says where the number came
    // from: a 2019 DD lookup must not claim a 2019-default bundle it never had.
    expect(resolveCampaignGdpBaseline("DD", "1953-default").bundlePreset).toBe("1953-default");
    expect(resolveCampaignGdpBaseline("DD", "1979-default").bundlePreset).toBe("1979-default");
    expect(resolveCampaignGdpBaseline("DD", "2019-default").bundlePreset).toBe("1979-default");
    expect(resolveCampaignGdpBaseline("DD", "2027-default").bundlePreset).toBe("1979-default");
    // DDM, not USD: DD is `local` in GDP_DENOMINATION_1953.
    expect(resolveCampaignGdpBaseline("DD", "1953-default").unit).toBe("local");
  });

  it("prices a DD region without throwing — the regression this row fixes", () => {
    // `/profile` renders this for every character: `calculateFullFundDistribution`
    // -> `getIncomeGdpScalar` -> the resolver. Before the DD row it threw, and
    // the thrown error surfaced as a Next.js digest on an error page.
    const region = ddRegions1953[0];
    expect(() =>
      getIncomeGdpScalar(region.gdp ?? 0, region.population, "DD", "1953-default")
    ).not.toThrow();
    const scalar = getIncomeGdpScalar(region.gdp ?? 0, region.population, "DD", "1953-default");
    expect(scalar).toBeGreaterThanOrEqual(0.9);
    expect(scalar).toBeLessThanOrEqual(1.5);
  });

  it("pins absolute values for the cross-era anchors", () => {
    const table = getGdpBaselineTable();
    // Modern anchors (DEFAULT_SEED_PRESET era).
    expect(table.US["2019"]).toBe(69_618);
    expect(table.UK["2019"]).toBe(29_734);
    expect(table.JP["2019"]).toBe(4_172_222);
    expect(table.NG["2019"]).toBe(3_669_401);
    expect(table.CN["2019"]).toBe(98_268);
    // 1953 anchors: JP/NG/CN seeds are USD-anchored, so double-digit dollars.
    expect(table.JP["1953"]).toBe(277);
    expect(table.NG["1953"]).toBe(113);
    expect(table.CN["1953"]).toBe(57);
    expect(table.US["1953"]).toBe(2_557);
    // Post-reconcile crush cells: oversized regional authoring scaled down to
    // the authored national GDP (calibration review required on any reseed).
    expect(table.NG["1979"]).toBe(324);
    expect(table.NG["1991"]).toBe(20_226);
    // Post-reconcile uplift cell: undersized CN regional authoring scaled up
    // to the authored national GDP (calibration review required on any reseed).
    expect(table.CN["1979"]).toBe(568);
  });

  it("pins CN absolute values and scale across eras", () => {
    const table = getGdpBaselineTable();
    // Bundle-native cells: 2023 repeats the 2019-era authoring scale, and the
    // explicit 2027 bundle is bundle-native (not a 2019 fallback repeat).
    expect(table.CN["1991"]).toBe(1_931);
    expect(table.CN["1999"]).toBe(7_341);
    expect(table.CN["2007"]).toBe(21_028);
    expect(table.CN["2023"]).toBe(98_268);
    expect(table.CN["2027"]).toBe(110_339);
    // Scale assertion: the 1953 USD-anchored cell is three orders of magnitude
    // below the modern yuan cells — mixing the denominations would pin every
    // CN scalar to a clamp.
    expect(table.CN["2019"] / table.CN["1953"]).toBeGreaterThan(1_000);
    expect(table.CN["2027"] / table.CN["1953"]).toBeGreaterThan(1_000);
    // Currency assertion: 1953 resolves the USD unit, everything modern is local.
    expect(resolveCampaignGdpBaseline("CN", "1953-default").unit).toBe("usd");
    expect(resolveCampaignGdpBaseline("CN", "2019-default").unit).toBe("local");
    expect(resolveCampaignGdpBaseline("CN", "2027-default").unit).toBe("local");
    // CN wires an explicit 2027 bundle, so its bundle preset is era-native.
    expect(resolveCampaignGdpBaseline("CN", "2027-default").bundlePreset).toBe("2027-default");
  });

  it("keeps the average region at a neutral scalar in every era", () => {
    const table = getGdpBaselineTable();
    for (const country of Object.keys(BUNDLES) as GdpBaselineCountry[]) {
      for (const era of derivableEras(country)) {
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
        expect(res.bundlePreset, `${country} ${era} bundlePreset`).toBe(
          expectedBundlePreset(country, era)
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

  it("refuses country ids that collide with Object.prototype keys", () => {
    // A plain `countryId in TABLE` / `TABLE[countryId]` answers for inherited
    // members, so these ids used to sail past the unknown-country guard and
    // return `baseline: undefined` — a NaN scalar the money paths then persist,
    // rather than the loud throw the table promises. Fail closed instead.
    for (const id of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(hasGdpBaseline(id), `hasGdpBaseline(${id})`).toBe(false);
      expect(() => resolveCampaignGdpBaseline(id, "1953-default"), id).toThrow(/no GDP baseline/);
    }
    // The NaN this prevented, stated as the behaviour that matters downstream.
    expect(() => getIncomeGdpScalar(1_000, 1_000_000, "constructor", "1953-default")).toThrow(
      /no GDP baseline/
    );
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
