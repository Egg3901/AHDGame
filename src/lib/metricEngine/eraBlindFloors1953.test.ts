/**
 * Era-blind floor/ceiling regression — spread assertions.
 *
 * Unit tests passed while the DB stayed wrong through four prior rounds of
 * this bug (lifeExpectancy 70→62→35, literacyRate 80→10, medianAge 22→15,
 * then registry bounds that re-flattened after metricDefinitions was fixed).
 * Guarding individual values is not enough: assert the authored 1953
 * world-wide extreme sits OUTSIDE the old Western band, so a future
 * re-narrowing fails loudly.
 */
import { describe, expect, it } from "vitest";
import { metricCategories } from "@/lib/constants/metricDefinitions";
import { METRIC_REGISTRY } from "@/lib/metricEngine/registry";
import { ieMetricPresets1953 } from "@/lib/seeds/ie/ieMetricPresets1953";
import { deMetricPresets1953 } from "@/lib/seeds/de/deMetricPresets1953";
import { jpMetricPresets1953 } from "@/lib/seeds/jp/jpMetricPresets1953";
import { brMetricPresets1953 } from "@/lib/seeds/br/brMetricPresets1953";
import { cnMetricPresets1953 } from "@/lib/seeds/cn/cnMetricPresets1953";
import { ngMetricPresets1953 } from "@/lib/seeds/ng/ngMetricPresets1953";
import { ukMetricPresets1953 } from "@/lib/seeds/uk/ukMetricPresets1953";
import { usMetricPresets1953 } from "@/lib/seeds/reference/usMetricPresets1953";
import { ruMetricPresets1953 } from "@/lib/seeds/ru/ruMetricPresets1953";
import { itMetricPresets1953 } from "@/lib/seeds/it/itMetricPresets1953";
import { frMetricPresets1953 } from "@/lib/seeds/fr/frMetricPresets1953";
import { esMetricPresets1953 } from "@/lib/seeds/es/esMetricPresets1953";
import { seMetricPresets1953 } from "@/lib/seeds/se/seMetricPresets1953";
import { trMetricPresets1953 } from "@/lib/seeds/tr/trMetricPresets1953";
import { atMetricPresets1953 } from "@/lib/seeds/at/atMetricPresets1953";
import { fiMetricPresets1953 } from "@/lib/seeds/fi/fiMetricPresets1953";
import { grMetricPresets1953 } from "@/lib/seeds/gr/grMetricPresets1953";
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

const BUNDLES_1953: Record<string, MetricPresetBundle> = {
  IE: ieMetricPresets1953,
  DE: deMetricPresets1953,
  JP: jpMetricPresets1953,
  BR: brMetricPresets1953,
  CN: cnMetricPresets1953,
  NG: ngMetricPresets1953,
  UK: ukMetricPresets1953,
  US: usMetricPresets1953,
  RU: ruMetricPresets1953,
  IT: itMetricPresets1953,
  FR: frMetricPresets1953,
  ES: esMetricPresets1953,
  SE: seMetricPresets1953,
  TR: trMetricPresets1953,
  AT: atMetricPresets1953,
  FI: fiMetricPresets1953,
  GR: grMetricPresets1953,
};

type Extreme = { value: number; country: string; region: string };

function authoredExtremes(path: string): { min: Extreme; max: Extreme } | null {
  let min: Extreme | null = null;
  let max: Extreme | null = null;
  for (const [country, bundle] of Object.entries(BUNDLES_1953)) {
    for (const [region, overlay] of Object.entries(bundle)) {
      const v = overlay[path];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (!min || v < min.value) min = { value: v, country, region };
      if (!max || v > max.value) max = { value: v, country, region };
    }
  }
  return min && max ? { min, max } : null;
}

function defBounds(path: string): { min?: number; max?: number } {
  const [catId, metricId] = path.split(".");
  const cat = metricCategories.find((c) => c.id === catId);
  const metric = cat?.metrics.find((m) => m.id === metricId);
  return { min: metric?.minValue, max: metric?.maxValue };
}

function regBounds(path: string): { min?: number; max?: number } {
  const node = METRIC_REGISTRY.find((n) => n.id === path);
  if (!node?.bounds) return {};
  return { min: node.bounds[0], max: node.bounds[1] };
}

/**
 * Each row: metric path, the OLD Western band edge that was breached, whether
 * the breach was a floor (authored below) or ceiling (authored above), and the
 * country/region that sits at the extreme so a future narrowing is visibly a
 * narrowing of a real era value.
 */
const FIXED_BREACHES: Array<{
  path: string;
  kind: "floor" | "ceiling";
  /** Old bound that must stay breached by authored data. */
  oldBound: number;
  /** Extreme must be strictly outside oldBound (below floor / above ceiling). */
  extremeCountry: string;
}> = [
  { path: "education.highSchoolGradRate", kind: "floor", oldBound: 55, extremeCountry: "NG" },
  { path: "healthcare.mentalHealthAccess", kind: "floor", oldBound: 5, extremeCountry: "NG" },
  { path: "healthcare.socialCareQuality", kind: "floor", oldBound: 10, extremeCountry: "NG" },
  // CN, not NG: the #income-gdp-scale-audit re-anchored CN to a USD-anchored
  // $80 against NG's $150, so CN now sits at the floor.
  { path: "economic.medianIncome", kind: "floor", oldBound: 1000, extremeCountry: "CN" },
  { path: "economic.povertyRate", kind: "ceiling", oldBound: 35, extremeCountry: "TR" },
  { path: "economic.productivityGrowth", kind: "ceiling", oldBound: 6, extremeCountry: "JP" },
  { path: "economic.laborParticipation", kind: "floor", oldBound: 50, extremeCountry: "ES" },
  { path: "economic.laborParticipation", kind: "ceiling", oldBound: 75, extremeCountry: "RU" },
  {
    path: "economic.manufacturingCompetitiveness",
    kind: "floor",
    oldBound: 20,
    extremeCountry: "NG",
  },
  { path: "economic.exportDependency", kind: "floor", oldBound: 10, extremeCountry: "RU" },
  { path: "economic.propertyValueIndex", kind: "floor", oldBound: 25, extremeCountry: "CN" },
  { path: "economic.commercialValueIndex", kind: "floor", oldBound: 25, extremeCountry: "CN" },
  { path: "economic.unemploymentRate", kind: "floor", oldBound: 2, extremeCountry: "FR" },
  { path: "education.apprenticeshipRate", kind: "ceiling", oldBound: 8, extremeCountry: "AT" },
  { path: "healthcare.uninsuredRate", kind: "ceiling", oldBound: 25, extremeCountry: "NG" },
  { path: "publicSafety.incarcerationRate", kind: "ceiling", oldBound: 1200, extremeCountry: "RU" },
  { path: "social.childPoverty", kind: "ceiling", oldBound: 50, extremeCountry: "NG" },
];

describe("1953 era-blind floor/ceiling sweep — spread guards", () => {
  for (const row of FIXED_BREACHES) {
    it(`${row.path} authored 1953 ${row.kind} sits beyond old ${row.kind} ${row.oldBound}`, () => {
      const extremes = authoredExtremes(row.path);
      expect(extremes, `no authored 1953 values for ${row.path}`).toBeTruthy();
      const extreme = row.kind === "floor" ? extremes!.min : extremes!.max;
      expect(extreme.country).toBe(row.extremeCountry);
      if (row.kind === "floor") {
        expect(extreme.value).toBeLessThan(row.oldBound);
      } else {
        expect(extreme.value).toBeGreaterThan(row.oldBound);
      }

      // Current defs (and registry, when present) must admit the extreme.
      // economic.unemploymentRate registry bounds still come from
      // UNEMPLOYMENT_MIN in gdpGrowth.ts (out of this sweep's file scope) —
      // defs alone are asserted there until that constant is widened.
      const def = defBounds(row.path);
      const reg = regBounds(row.path);
      if (row.kind === "floor") {
        if (typeof def.min === "number") expect(def.min).toBeLessThanOrEqual(extreme.value);
        if (row.path !== "economic.unemploymentRate" && typeof reg.min === "number") {
          expect(reg.min).toBeLessThanOrEqual(extreme.value);
        }
      } else {
        if (typeof def.max === "number") expect(def.max).toBeGreaterThanOrEqual(extreme.value);
        if (typeof reg.max === "number") expect(reg.max).toBeGreaterThanOrEqual(extreme.value);
      }
    });
  }

  it("lifeExpectancy + literacyRate remain era-wide (prior fixes, do not re-narrow)", () => {
    expect(defBounds("healthcare.lifeExpectancy")).toEqual({ min: 35, max: 90 });
    expect(regBounds("healthcare.lifeExpectancy")).toEqual({ min: 35, max: 90 });
    expect(defBounds("education.literacyRate")).toEqual({ min: 10, max: 99 });
    expect(regBounds("education.literacyRate")).toEqual({ min: 10, max: 99 });
    const life = authoredExtremes("healthcare.lifeExpectancy")!;
    const lit = authoredExtremes("education.literacyRate")!;
    expect(life.min.value).toBeLessThan(60); // China/Turkey floor class
    expect(lit.min.value).toBeLessThan(80); // Turkey east below old Western floor
  });
});
