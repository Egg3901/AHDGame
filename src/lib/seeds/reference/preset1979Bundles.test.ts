/**
 * Coverage tests for the 1979-default seed bundles.
 *
 * Mirrors preset1991Bundles.test.ts, but adds the guard the manual audit missed:
 * a loop over the FULL enabled 1979 country set (from seedCountryGameStates) that
 * asserts every per-country bundle either resolves real 1979 data or skips cleanly —
 * never silently falls back to 2019, and never throws and aborts the reset.
 *
 * This is the deterministic backstop for audit layers F/G/J/K/Q. A missing bundle
 * registration (the exact class of bug that shipped 1979 data files but never wired
 * them) fails here instead of slipping past a human grep.
 */

import { describe, expect, it } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { getRegionPopulationAnchor } from "@/lib/seeds/populationAnchors";
import { getNationalBudgetSeedConfigsForPreset } from "./budgets";
import { getBasePolicies } from "./basePolicies";
import { COUNTRY_POLICY_CONFIGS_1979 } from "./basePolicies1979";

// Authored 1979 census bundles (must be the data getRegionCensusData returns).
import { ukRegionCensusData1979 } from "@/lib/seeds/uk/ukRegionCensusData1979";
import { deRegionCensusData1979 } from "@/lib/seeds/de/deRegionCensusData1979";
import { jpRegionCensusData1979 } from "@/lib/seeds/jp/jpRegionCensusData1979";
import { cnRegionCensusData1979 } from "@/lib/seeds/cn/cnRegionCensusData1979";
import { brRegionCensusData1979 } from "@/lib/seeds/br/brRegionCensusData1979";
import { ieRegionCensusData1979 } from "@/lib/seeds/ie/ieRegionCensusData1979";
import { frRegionCensusData1979 } from "@/lib/seeds/fr/frRegionCensusData1979";
import { ngRegionCensusData1979 } from "@/lib/seeds/ng/ngRegionCensusData1979";

// Authored 1979 metric-preset overlays.
import { ukMetricPresets1979 } from "@/lib/seeds/uk/ukMetricPresets1979";
import { deMetricPresets1979 } from "@/lib/seeds/de/deMetricPresets1979";
import { jpMetricPresets1979 } from "@/lib/seeds/jp/jpMetricPresets1979";
import { cnMetricPresets1979 } from "@/lib/seeds/cn/cnMetricPresets1979";
import { brMetricPresets1979 } from "@/lib/seeds/br/brMetricPresets1979";

/**
 * The countries the 1979 reset enables — kept in sync with
 * seedCountryGameStates.ts "1979-default". The NPP Eastern-bloc fillers have no
 * census bundle of their own (they seed via seedEasternBloc), so getRegionCensusData
 * returns null for them — which must NOT throw.
 */
const ENABLED_1979_COUNTRIES = [
  "UK",
  "RU",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "DE",
  "JP",
  "CN",
  "NG",
  "BR",
  "IE",
  "DD",
  "PL",
  "RO",
  "YU",
  "HU",
  "CS",
  "BG",
] as CountryId[];

describe("1979-default — no reset crash (full enabled country set)", () => {
  // selectPresetBundle throws when a country has a census bundle but no matching
  // 1979 entry AND no 2019-default fallback. That threw for FR/IT/ES/SU/DD/NG and
  // aborted the 1979 reset inside the unguarded seedCohortVectors loop. The probe
  // region need not exist — the throw (if any) happens at bundle selection.
  for (const cc of ENABLED_1979_COUNTRIES) {
    it(`${cc}: 1979 census resolves without throwing`, () => {
      expect(() => getRegionCensusData(cc, "__probe__", "1979-default")).not.toThrow();
    });
  }
});

describe("1979-default census wired to authored 1979 data (no silent 2019 fallback)", () => {
  const CENSUS_1979: Record<string, Record<string, unknown>> = {
    UK: ukRegionCensusData1979,
    DE: deRegionCensusData1979,
    JP: jpRegionCensusData1979,
    CN: cnRegionCensusData1979,
    BR: brRegionCensusData1979,
    IE: ieRegionCensusData1979,
    FR: frRegionCensusData1979,
    NG: ngRegionCensusData1979,
  };
  for (const [cc, file] of Object.entries(CENSUS_1979)) {
    it(`${cc}: getRegionCensusData returns the authored 1979 record, not a 2019 alias`, () => {
      const key = Object.keys(file)[0];
      expect(key, `${cc} 1979 census has at least one region`).toBeDefined();
      // Reference identity: lookup must resolve to the 1979 object, proving the
      // "1979-default" key is registered (not falling through to 2019).
      expect(getRegionCensusData(cc as CountryId, key, "1979-default")).toBe(file[key]);
    });
  }
});

describe("1979-default metric presets wired (no silent 2019 fallback)", () => {
  const METRICS_1979: Record<string, Record<string, unknown>> = {
    UK: ukMetricPresets1979,
    DE: deMetricPresets1979,
    JP: jpMetricPresets1979,
    CN: cnMetricPresets1979,
    BR: brMetricPresets1979,
  };
  for (const [cc, file] of Object.entries(METRICS_1979)) {
    it(`${cc}: getRegionMetricPresets returns the authored 1979 overlay`, () => {
      const key = Object.keys(file)[0];
      expect(key, `${cc} 1979 metric preset has at least one region`).toBeDefined();
      expect(getRegionMetricPresets(cc as CountryId, key, "1979-default")).toBe(file[key]);
    });
  }
});

describe("1979-default budgets", () => {
  it("cover all player + ECON + NPP-state countries", () => {
    const configs = getNationalBudgetSeedConfigsForPreset("1979-default");
    const countries = new Set<string>(configs.map((c) => c.countryId));
    for (const cc of [
      "US",
      "UK",
      "RU",
      "DE",
      "JP",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "CN",
      "BR",
      "IE",
      "NG",
      "DD",
    ]) {
      expect(countries.has(cc as CountryId), `1979 budget config for ${cc}`).toBe(true);
    }
  });

  it("use 1979-era fiscal years", () => {
    const configs = getNationalBudgetSeedConfigsForPreset("1979-default");
    for (const c of configs) {
      expect(c.fiscalYear, `${c.countryId} fiscal year`).toBe(1979);
    }
  });
});

describe("1979-default policies", () => {
  it("COUNTRY_POLICY_CONFIGS_1979 covers every player + ECON country (no 2019 fallback)", () => {
    const keys = new Set(Object.keys(COUNTRY_POLICY_CONFIGS_1979).map((k) => k.toLowerCase()));
    for (const cc of [
      "us",
      "uk",
      "de",
      "jp",
      "fr",
      "it",
      "es",
      "se",
      "tr",
      "cn",
      "br",
      "ie",
      "ng",
      "su",
      "dd",
    ]) {
      expect(keys.has(cc), `1979 policy config for ${cc}`).toBe(true);
    }
  });

  it("getBasePolicies('1979-default') differs from the 2019 config", async () => {
    const [p1979, p2019] = await Promise.all([
      getBasePolicies("1979-default"),
      getBasePolicies("2019-default"),
    ]);
    expect(p1979).not.toEqual(p2019);
  });
});

/**
 * Known audit gaps — graded HIGH by the alias rule (data resolves, but to 2019).
 * Kept as ready-to-activate tests so the fix is one `.skip` removal away and the
 * gap is visible in the suite rather than buried in a report.
 */
describe("1979-default — known gaps (skipped until authored)", () => {
  // GAP: POPULATION_ANCHOR_BUNDLES has no 1979-default for any country, so the
  // population pyramid (medianAge/birthRate) silently seeds at 2019 values.
  // Author *PopulationAnchors1979 + register "1979-default", then unskip.
  it.skip("population anchors resolve 1979-specific data, not the 2019 alias", () => {
    const ukAnchorRegion = Object.keys(ukMetricPresets1979)[0]; // UK region id
    const a1979 = getRegionPopulationAnchor("UK", ukAnchorRegion, "1979-default");
    const a2019 = getRegionPopulationAnchor("UK", ukAnchorRegion, "2019-default");
    expect(a1979).not.toEqual(a2019);
  });

  // GAP: international/fr.ts and ng.ts set ERA_CENSUS["1979"] to 2019/scaffold data
  // instead of *RegionCensusData1979. Re-point them, then unskip.
  it.todo("FR/NG international ERA_CENSUS[1979] uses the authored 1979 census");
});
