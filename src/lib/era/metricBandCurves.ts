import type { CountryId } from "@/lib/constants/countries";
import { JP_CORE5_NORMALS } from "@/lib/countries/jp/geographyFacts";
import { JP_HEALTH_COVERAGE_BAND } from "@/lib/countries/jp/data/jpMetricOverrides";
import { BR_CORE5_NORMALS } from "@/lib/countries/br/geographyFacts";
import { CN_CORE5_NORMALS } from "@/lib/countries/cn/geographyFacts";
import { DE_CORE5_NORMALS } from "@/lib/countries/de/geographyFacts";
import { IE_CORE5_NORMALS } from "@/lib/countries/ie/geographyFacts";
import { NG_CORE5_NORMALS } from "@/lib/countries/ng/geographyFacts";
import { UK_CORE5_NORMALS } from "@/lib/countries/uk/geographyFacts";
import { US_CORE5_NORMALS } from "@/lib/countries/us/geographyFacts";
import type { BandAnchor, MetricBandCurve, NormalAnchor } from "./metricCatalogTypes";

/**
 * Absolute {year, best, worst} band curves — no reference year; 2019 is just
 * another anchor. Tasks 11-12 author the full dataset.
 * INVARIANT (validated): every key here exists in metricScoring.THRESHOLDS —
 * a curve must never silently make an unscored metric scored.
 */
/**
 * Core-5 curves are authored as per-country ERA NORMALS (the unremarkable value
 * for that country in that year) and converted to absolute best/worst anchors
 * by each metric's fixed band spread — the same geometry as its static
 * THRESHOLDS band (hardcoded here, NOT imported from metricScoring: cycle).
 * Floors keep bands inside each metric's playable range. The global set is the
 * old PR #2661 Western curve (US-shaped), kept as the fallback for latent
 * countries (RU, …). Values are era-plausible authored estimates — the dry-run
 * review is the tuning gate before any flag flip.
 */
const CORE5_SPREADS: Record<
  string,
  { best: number; worst: number; bestFloor?: number; worstCeil?: number }
> = {
  gdpGrowth: { best: 2.8, worst: -5.2 },
  unemploymentRate: { best: -2, worst: 11, bestFloor: 0.5, worstCeil: 25 },
  lifeExpectancy: { best: 6, worst: -9 },
  violentCrimeRate: { best: -300, worst: 320, bestFloor: 20 },
  povertyRate: { best: -7, worst: 14, bestFloor: 3, worstCeil: 45 },
};

export const CORE5_NORMALS: Record<
  string,
  Partial<Record<CountryId | "global", NormalAnchor[]>>
> = {
  gdpGrowth: {
    global: [
      { year: 1950, value: 4.2 },
      { year: 1970, value: 3.6 },
      { year: 1990, value: 2.9 },
      { year: 2019, value: 2.2 },
      { year: 2040, value: 1.8 },
    ],
    US: US_CORE5_NORMALS["gdpGrowth"] as NormalAnchor[],
    UK: UK_CORE5_NORMALS["gdpGrowth"] as NormalAnchor[],
    DE: DE_CORE5_NORMALS["gdpGrowth"] as NormalAnchor[],
    JP: JP_CORE5_NORMALS["gdpGrowth"] as NormalAnchor[],
    IE: IE_CORE5_NORMALS["gdpGrowth"] as NormalAnchor[],
    BR: BR_CORE5_NORMALS["gdpGrowth"] as NormalAnchor[],
    CN: CN_CORE5_NORMALS["gdpGrowth"] as NormalAnchor[],
    NG: NG_CORE5_NORMALS["gdpGrowth"] as NormalAnchor[],
  },
  unemploymentRate: {
    global: [
      { year: 1950, value: 4.5 },
      { year: 1980, value: 7.0 },
      { year: 1995, value: 5.8 },
      { year: 2019, value: 4.0 },
      { year: 2040, value: 4.2 },
    ],
    US: US_CORE5_NORMALS["unemploymentRate"] as NormalAnchor[],
    UK: UK_CORE5_NORMALS["unemploymentRate"] as NormalAnchor[],
    DE: DE_CORE5_NORMALS["unemploymentRate"] as NormalAnchor[],
    JP: JP_CORE5_NORMALS["unemploymentRate"] as NormalAnchor[],
    IE: IE_CORE5_NORMALS["unemploymentRate"] as NormalAnchor[],
    BR: BR_CORE5_NORMALS["unemploymentRate"] as NormalAnchor[],
    CN: CN_CORE5_NORMALS["unemploymentRate"] as NormalAnchor[],
    NG: NG_CORE5_NORMALS["unemploymentRate"] as NormalAnchor[],
  },
  lifeExpectancy: {
    global: [
      { year: 1950, value: 68 },
      { year: 1970, value: 71 },
      { year: 1990, value: 75 },
      { year: 2019, value: 79 },
      { year: 2040, value: 82 },
    ],
    US: US_CORE5_NORMALS["lifeExpectancy"] as NormalAnchor[],
    UK: UK_CORE5_NORMALS["lifeExpectancy"] as NormalAnchor[],
    DE: DE_CORE5_NORMALS["lifeExpectancy"] as NormalAnchor[],
    JP: JP_CORE5_NORMALS["lifeExpectancy"] as NormalAnchor[],
    IE: IE_CORE5_NORMALS["lifeExpectancy"] as NormalAnchor[],
    BR: BR_CORE5_NORMALS["lifeExpectancy"] as NormalAnchor[],
    CN: CN_CORE5_NORMALS["lifeExpectancy"] as NormalAnchor[],
    NG: NG_CORE5_NORMALS["lifeExpectancy"] as NormalAnchor[],
  },
  violentCrimeRate: {
    global: [
      { year: 1950, value: 180 },
      { year: 1970, value: 400 },
      { year: 1990, value: 700 },
      { year: 2005, value: 470 },
      { year: 2019, value: 380 },
      { year: 2040, value: 350 },
    ],
    US: US_CORE5_NORMALS["violentCrimeRate"] as NormalAnchor[],
    UK: UK_CORE5_NORMALS["violentCrimeRate"] as NormalAnchor[],
    DE: DE_CORE5_NORMALS["violentCrimeRate"] as NormalAnchor[],
    JP: JP_CORE5_NORMALS["violentCrimeRate"] as NormalAnchor[],
    IE: IE_CORE5_NORMALS["violentCrimeRate"] as NormalAnchor[],
    BR: BR_CORE5_NORMALS["violentCrimeRate"] as NormalAnchor[],
    CN: CN_CORE5_NORMALS["violentCrimeRate"] as NormalAnchor[],
    NG: NG_CORE5_NORMALS["violentCrimeRate"] as NormalAnchor[],
  },
  povertyRate: {
    global: [
      { year: 1950, value: 22 },
      { year: 1970, value: 12.5 },
      { year: 1990, value: 13.5 },
      { year: 2019, value: 11 },
      { year: 2040, value: 10 },
    ],
    US: US_CORE5_NORMALS["povertyRate"] as NormalAnchor[],
    UK: UK_CORE5_NORMALS["povertyRate"] as NormalAnchor[],
    DE: DE_CORE5_NORMALS["povertyRate"] as NormalAnchor[],
    JP: JP_CORE5_NORMALS["povertyRate"] as NormalAnchor[],
    IE: IE_CORE5_NORMALS["povertyRate"] as NormalAnchor[],
    BR: BR_CORE5_NORMALS["povertyRate"] as NormalAnchor[],
    CN: CN_CORE5_NORMALS["povertyRate"] as NormalAnchor[],
    NG: NG_CORE5_NORMALS["povertyRate"] as NormalAnchor[],
  },
};

function normalsToAnchors(metricId: string, normals: NormalAnchor[]): BandAnchor[] {
  const s = CORE5_SPREADS[metricId];
  return normals.map(({ year, value }) => ({
    year,
    best: Math.max(value + s.best, s.bestFloor ?? -Infinity),
    worst: Math.min(value + s.worst, s.worstCeil ?? Infinity),
  }));
}

function buildCore5Curves(): Record<string, MetricBandCurve> {
  const out: Record<string, MetricBandCurve> = {};
  for (const [metricId, byScope] of Object.entries(CORE5_NORMALS)) {
    const curve: MetricBandCurve = { byCountry: {} };
    for (const [scope, normals] of Object.entries(byScope)) {
      if (!normals) continue;
      const anchors = normalsToAnchors(metricId, normals);
      if (scope === "global") curve.global = anchors;
      else curve.byCountry![scope as CountryId] = anchors;
    }
    out[metricId] = curve;
  }
  return out;
}

export const METRIC_BAND_CURVES: Record<string, MetricBandCurve> = {
  ...buildCore5Curves(),

  // ── Distortion set (scored metrics whose 2019 band misjudges old eras) ──────
  publicTrust: {
    global: [
      { year: 1953, best: 90, worst: 40 },
      { year: 1979, best: 85, worst: 30 },
      { year: 1991, best: 82, worst: 25 },
      { year: 2019, best: 80, worst: 20 },
    ],
  },
  literacyRate: {
    global: [
      { year: 1953, best: 97, worst: 70 },
      { year: 1991, best: 98.5, worst: 78 },
      { year: 2019, best: 99, worst: 82 },
    ],
    byCountry: {
      CN: [
        { year: 1953, best: 50, worst: 15 },
        { year: 1979, best: 80, worst: 40 },
        { year: 1991, best: 88, worst: 55 },
        { year: 2019, best: 99, worst: 82 },
      ],
      NG: [
        { year: 1953, best: 30, worst: 8 },
        { year: 1979, best: 45, worst: 15 },
        { year: 1991, best: 60, worst: 25 },
        { year: 2019, best: 75, worst: 40 },
      ],
      BR: [
        { year: 1953, best: 60, worst: 25 },
        { year: 1979, best: 75, worst: 40 },
        { year: 1991, best: 85, worst: 55 },
        { year: 2019, best: 95, worst: 70 },
      ],
      // Turkey sat far below the global floor: the 1950 census put national
      // literacy near 32%, from roughly 15% in the eastern provinces to the
      // mid-50s in Istanbul. On the global 1953 band (worst 70) every Turkish
      // region scored a flat 0, so no Turkish education policy could move the
      // number at all. The village-institute and later literacy campaigns are
      // the whole point of the period here, and they need somewhere to land.
      TR: [
        { year: 1953, best: 60, worst: 12 },
        { year: 1979, best: 75, worst: 35 },
        { year: 1991, best: 85, worst: 55 },
        { year: 2019, best: 97, worst: 75 },
      ],
    },
  },
  debtToGdp: {
    global: [
      // "best" was 25 against a 1953 median of 22, so most of the world scored
      // 100 together. Postwar debt was concentrated in the belligerents (UK has
      // its own band below, US 68); for everyone else low debt was the era's
      // norm and needs room to differentiate.
      { year: 1953, best: 5, worst: 110 },
      { year: 1979, best: 20, worst: 90 },
      { year: 1991, best: 20, worst: 110 },
      { year: 2019, best: 20, worst: 140 },
    ],
    byCountry: {
      UK: [
        { year: 1953, best: 60, worst: 220 },
        { year: 1979, best: 30, worst: 120 },
        { year: 1991, best: 20, worst: 100 },
        { year: 2019, best: 20, worst: 140 },
      ],
    },
  },
  // Spec B fiscal teeth (flag-on): tighter than the global THRESHOLDS (worst -8)
  // so a moderate structural deficit bites sooner — the affordability penalty for
  // over-legislating. Extreme era deficits (17-48% of GDP) already peg this at 0.
  budgetBalance: {
    global: [
      { year: 1953, best: 3, worst: -6 },
      { year: 2019, best: 3, worst: -6 },
    ],
  },
  incarcerationRate: {
    global: [
      { year: 1953, best: 50, worst: 400 },
      { year: 2019, best: 50, worst: 800 },
    ],
    byCountry: {
      US: [
        { year: 1953, best: 50, worst: 350 },
        { year: 1979, best: 50, worst: 450 },
        { year: 1991, best: 50, worst: 750 },
        { year: 2019, best: 50, worst: 800 },
        { year: 2040, best: 50, worst: 700 },
      ],
    },
  },
  incomeInequality: {
    // 1953 best lowered 22→12 (#3238): the US 1953 seeds author Gini 15-42
    // around a 22 normal (the most-equal modern era) — with best=22 half the
    // country pinned at score 100 at seed and equality gains carried no signal.
    global: [
      { year: 1953, best: 12, worst: 45 },
      { year: 1979, best: 23, worst: 48 },
      { year: 1991, best: 24, worst: 52 },
      { year: 2019, best: 24, worst: 55 },
    ],
  },
  voterTurnout: {
    global: [
      { year: 1953, best: 90, worst: 45 },
      { year: 1979, best: 88, worst: 40 },
      { year: 2019, best: 85, worst: 30 },
    ],
  },
  civicParticipation: {
    global: [
      { year: 1953, best: 88, worst: 45 },
      { year: 1979, best: 84, worst: 38 },
      { year: 2019, best: 80, worst: 30 },
    ],
  },
  physicianRate: {
    global: [
      { year: 1953, best: 2.5, worst: 0.4 },
      { year: 1979, best: 3.5, worst: 0.7 },
      { year: 1991, best: 4, worst: 0.8 },
      { year: 2019, best: 5, worst: 1 },
    ],
  },
  preventableMortality: {
    global: [
      { year: 1953, best: 350, worst: 900 },
      { year: 1979, best: 220, worst: 700 },
      { year: 1991, best: 180, worst: 600 },
      { year: 2019, best: 120, worst: 500 },
    ],
  },
  airQuality: {
    global: [
      { year: 1953, best: 30, worst: 150 },
      { year: 1979, best: 20, worst: 110 },
      { year: 1991, best: 15, worst: 95 },
      { year: 2019, best: 8, worst: 80 },
    ],
  },
  highSchoolGradRate: {
    global: [
      { year: 1953, best: 70, worst: 25 },
      { year: 1979, best: 88, worst: 45 },
      { year: 1991, best: 92, worst: 52 },
      { year: 2019, best: 97, worst: 60 },
    ],
  },
  universityEnrollment: {
    global: [
      // Floor was 5, but the 1953 world's MEDIAN enrollment is 5 — so most of
      // the world sat at or under it and scored 0 together (NG 0.2, CN 0.5,
      // TR 0.8, BR and ES 2). Mass higher education is a 1960s phenomenon;
      // the floor has to be the bottom of the era, not of the modern band.
      { year: 1953, best: 25, worst: 0 },
      { year: 1979, best: 55, worst: 12 },
      { year: 1991, best: 65, worst: 18 },
      { year: 2019, best: 85, worst: 25 },
    ],
  },

  // ── Saturation set (#3238): metrics whose era-authentic 1953/1979 seed
  //    values pinned at 0/100 against the modern static band. Anchors are
  //    derived from the authored seed normals (stateMetrics1953/1979.ts and
  //    the per-country ${cc}MetricPresets1953/1979.ts files) so a freshly
  //    seeded era world lands mid-band and responds in both directions.
  //    INVARIANT: every 2019 anchor equals the static THRESHOLDS band exactly,
  //    and interpolateBand clamps beyond the last anchor — so year ≥ 2019
  //    scoring is byte-identical to the uncurved behavior (regression-tested
  //    in metricScoring.era.test.ts). Countries without a byCountry entry and
  //    without a global set keep the static band (getEraBand → null). ────────
  educationSpending: {
    // Nominal per-pupil, US-authored seeds only (other countries seed their
    // own currency scales and stay on the static band). Band shape mirrors
    // the modern geometry: best ≈ normal ×1.67, worst ≈ normal ×0.33.
    byCountry: {
      US: [
        { year: 1953, best: 585, worst: 115 }, // NCES 1953 normal ≈ $350
        { year: 1979, best: 3650, worst: 730 }, // NCES 1978-79 normal ≈ $2,200
        { year: 2019, best: 15000, worst: 3000 }, // = THRESHOLDS
      ],
    },
  },
  uninsuredRate: {
    // Pre-universal-coverage eras: high uninsured rates were structural, not
    // policy failure. Per-country normals from the era preset files. UK/DE
    // (early universal/statutory systems) already score mid on the static
    // band and are deliberately NOT curved.
    byCountry: {
      US: [
        { year: 1953, best: 13, worst: 68 }, // normal 38 (pre-Medicare/Medicaid)
        { year: 1979, best: 3, worst: 33 }, // normal 13
        { year: 2019, best: 0, worst: 22 }, // = THRESHOLDS
      ],
      JP: JP_HEALTH_COVERAGE_BAND,
      IE: [
        { year: 1953, best: 12, worst: 62 }, // normal 35 (Mother-and-Child defeat)
        { year: 2019, best: 0, worst: 22 },
      ],
      BR: [
        { year: 1953, best: 45, worst: 95 }, // normal 72
        { year: 1979, best: 28, worst: 88 }, // normal 55 (INPS formal workers only)
        { year: 2019, best: 0, worst: 22 },
      ],
      CN: [
        { year: 1953, best: 55, worst: 99 }, // normal 80 (pre-barefoot-doctors)
        { year: 1979, best: 15, worst: 70 }, // normal 40
        { year: 2019, best: 0, worst: 22 },
      ],
      NG: [
        { year: 1953, best: 85, worst: 100 }, // normal 95 (essentially no coverage)
        { year: 1979, best: 55, worst: 98 }, // normal ~85
        { year: 2019, best: 0, worst: 22 },
      ],
    },
  },
  crimeRate: {
    // US-authored era seeds only (1953 ≈ 1750, the historical property-crime
    // low; 1979 ≈ 5300, near peak — the modern band already fits 1979+).
    byCountry: {
      US: [
        { year: 1953, best: 500, worst: 5000 },
        { year: 1979, best: 1500, worst: 11000 }, // = THRESHOLDS
        { year: 2019, best: 1500, worst: 11000 },
      ],
    },
  },
  waterQuality: {
    // US 1953 seeds tier 60-92 (pre-Safe-Drinking-Water-Act); 1979 seeds 72-95.
    // The US row alone left every OTHER country falling through to the modern
    // THRESHOLDS (99/70), where a realistic 1953 supply floors — treated piped
    // water was a city privilege almost everywhere outside north-west Europe.
    // The global row is wider at the bottom than the US row for that reason.
    byCountry: {
      US: [
        { year: 1953, best: 95, worst: 40 },
        { year: 1979, best: 97, worst: 55 },
        { year: 2019, best: 99, worst: 70 }, // = THRESHOLDS
      ],
    },
    global: [
      { year: 1953, best: 88, worst: 30 },
      { year: 1979, best: 95, worst: 55 },
      { year: 2019, best: 99, worst: 70 }, // = THRESHOLDS
    ],
  },
  rdIntensity: {
    // All era preset files author 1953 normals 0.0-1.0 (defense-only R&D) and
    // 1979 normals ~0.9-2.0. Negative worst keeps a 0 value un-pinned (NG 1953
    // authors 0.0 as its era normal).
    global: [
      { year: 1953, best: 1.4, worst: -0.35 },
      { year: 1979, best: 2.6, worst: -0.4 },
      { year: 2019, best: 4.5, worst: 0.5 }, // = THRESHOLDS
    ],
  },
  exportDependency: {
    // Lower-is-better exposure metric: pre-globalization trade shares of 8-35
    // pinned at 100 against the modern {30,55} band. Global anchors fit the
    // 1953 preset normals (JP 18, DE 20, UK 25, BR 15, NG 28); the US
    // (autarkic, normal 8) gets its own tighter curve.
    global: [
      { year: 1953, best: 4, worst: 40 },
      { year: 1979, best: 8, worst: 48 },
      { year: 2019, best: 30, worst: 55 }, // = THRESHOLDS
    ],
    byCountry: {
      US: [
        { year: 1953, best: 2, worst: 25 },
        { year: 1979, best: 5, worst: 35 },
        { year: 2019, best: 30, worst: 55 },
      ],
    },
  },

  // ── Activation ramps (scored WINDOWED metrics; first anchor at `from`,
  //    `worst` below the value floor per the step-discontinuity rule so a
  //    just-activated ~0 value scores Fair, not 0/100) ───────────────────────
  broadbandAccess: {
    global: [
      { year: 1998, best: 15, worst: -40 },
      { year: 2008, best: 60, worst: 5 },
      { year: 2019, best: 99, worst: 50 },
    ],
  },
  // Utilities. Both are scored against a MODERN band otherwise
  // (powerGridReliability best 99.9 / worst 97 — a 2.9-point window), which no
  // 1953 grid on earth clears: a realistic early-Cold-War grid floors, while a
  // region that kept its un-overlaid modern seed scores 100. The family that
  // reads them (infrastructure.utilities) was noise in both directions.
  //
  // 1953 anchors: national grids exist across the industrial core but outages
  // are routine, and treated piped water is a city privilege almost everywhere
  // outside north-west Europe. The 2019 rows restate the static THRESHOLDS so
  // the modern era is unchanged by construction.
  powerGridReliability: {
    global: [
      { year: 1953, best: 98, worst: 84 },
      { year: 1979, best: 99.5, worst: 92 },
      { year: 2019, best: 99.9, worst: 97 },
    ],
  },
  // Roads and protected land. Neither is anachronistic — both existed in 1953 —
  // but both were scored against a MODERN band, where a realistic early-Cold-War
  // value floors: `protectedLand` worst is 3% when global coverage in 1953 was
  // about 1-3% TOTAL, so the whole world reads as "worst". Anchored so the
  // Eastern-bloc values already authored in easternBlocMetrics (1953 road 30,
  // protectedLand 2) land mid-range rather than at the bottom. 2019 rows restate
  // THRESHOLDS so the modern era is unchanged by construction.
  roadCondition: {
    global: [
      { year: 1953, best: 70, worst: 8 },
      { year: 1979, best: 82, worst: 25 },
      { year: 2019, best: 90, worst: 40 }, // = THRESHOLDS
    ],
  },
  protectedLand: {
    global: [
      { year: 1953, best: 4, worst: 0.1 },
      { year: 1979, best: 12, worst: 1 },
      { year: 2019, best: 50, worst: 3 }, // = THRESHOLDS
    ],
  },
  socialMediaSentiment: {
    global: [
      { year: 2004, best: 10, worst: -20 },
      { year: 2019, best: 15, worst: -15 },
    ],
  },
  renewableEnergy: {
    global: [
      { year: 1974, best: 12, worst: -30 },
      { year: 1991, best: 25, worst: -10 },
      { year: 2005, best: 45, worst: 0 },
      { year: 2019, best: 80, worst: 5 },
    ],
  },
  energyTransitionProgress: {
    global: [
      { year: 2000, best: 30, worst: -60 },
      { year: 2019, best: 90, worst: 20 },
    ],
  },
  carbonEmissions: {
    // Lower-is-better: no zero-cliff (a 0 value scores 100); era-authentic
    // higher emissions were normal at activation.
    global: [
      { year: 1990, best: 6, worst: 35 },
      { year: 2019, best: 3, worst: 25 },
    ],
  },
  recyclingRate: {
    global: [
      { year: 1972, best: 10, worst: -25 },
      { year: 1991, best: 30, worst: -5 },
      { year: 2019, best: 70, worst: 10 },
    ],
  },
  // ── P5: bands the 1953 data proved were carrying no signal ─────────────────
  // Each of these was measured, not guessed: every authored 1953 seed value was
  // scored against the static band, and these are the metrics where half or more
  // of the world pinned at 0 or 100. A pinned metric is worse than a wrong one —
  // policy cannot move it, so the player sees a permanent grade they can neither
  // earn nor fix, and approval built on it is a constant.

  militaryReadiness: {
    // Static band (85/25) put occupied and neutral states (IE, DE, AT at 15) at
    // 0 and both superpowers (US 85, RU 90) at 100 — the sharpest spread of the
    // Cold War, flattened to two values. Widening both ends restores the ranking
    // that actually existed.
    global: [
      { year: 1953, best: 95, worst: 10 },
      { year: 1979, best: 92, worst: 15 },
      { year: 2019, best: 85, worst: 25 },
    ],
  },
  pressFreedom: {
    // 1953 was genuinely bimodal, and scoring RU (3) and CN (5) badly is
    // correct — but a floor of 25 scored them identically to Spain (8) and to
    // each other. Dropping it keeps the verdict and restores the ordering
    // within the authoritarian bloc.
    global: [
      { year: 1953, best: 92, worst: 0 },
      { year: 1979, best: 92, worst: 5 },
      { year: 2019, best: 92, worst: 25 },
    ],
  },
  stateMediaControl: {
    // A ceiling of 85 meant CN and RU (98) and Spain (90) all scored 0. The
    // era's whole point is that state control varied enormously.
    global: [
      { year: 1953, best: 8, worst: 100 },
      { year: 1979, best: 8, worst: 98 },
      { year: 2019, best: 10, worst: 85 },
    ],
  },
  disinformationRisk: {
    // Pre-broadcast, pre-internet: authored 1953 values run 5-22 against a band
    // whose "best" is 10, so 85% of the world scored ~100 and the real variation
    // was invisible.
    global: [
      { year: 1953, best: 3, worst: 25 },
      { year: 1979, best: 5, worst: 40 },
      { year: 2019, best: 10, worst: 70 },
    ],
  },
  mediaPolarization: {
    global: [
      { year: 1953, best: 3, worst: 60 },
      { year: 1979, best: 5, worst: 70 },
      { year: 2019, best: 10, worst: 80 },
    ],
  },
  apprenticeshipRate: {
    // Apprenticeship was central to European economies in a way it is not now:
    // Austria 28, Russia and Finland 8, Germany 6 all hit the static ceiling of
    // 6 together. Raising it separates the dual-system economies; dropping the
    // floor to 0 stops Brazil and Nigeria (0.5) sharing a score with China (1).
    global: [
      { year: 1953, best: 12, worst: 0 },
      { year: 1979, best: 8, worst: 0.5 },
      { year: 2019, best: 6, worst: 1 },
    ],
  },
  productivityGrowth: {
    // Postwar reconstruction: Japan 8, Germany 7.5, China 6 against a ceiling of
    // 4 — the miracle economies were indistinguishable from merely adequate ones.
    global: [
      { year: 1953, best: 9, worst: 0 },
      { year: 1979, best: 5, worst: -1 },
      { year: 2019, best: 4, worst: -2 },
    ],
  },
  nationalPride: {
    // Postwar pride ran high nearly everywhere (median 72 against a ceiling of
    // 80). Raising it lets defeated and occupied states — Germany 50, Austria
    // and Japan 55 — read differently from Russia 85 and Britain 80.
    global: [
      { year: 1953, best: 92, worst: 45 },
      { year: 1979, best: 86, worst: 38 },
      { year: 2019, best: 80, worst: 30 },
    ],
  },
  housingAffordability: {
    // Housing was cheap against income in 1953 (median 20 on a band whose "best"
    // is 15), so most of the world scored ~100 and the metric could not respond
    // to policy. Russia's postwar urban housing crisis (60) is the top end the
    // ceiling has to reach.
    global: [
      { year: 1953, best: 5, worst: 65 },
      { year: 1979, best: 10, worst: 68 },
      { year: 2019, best: 15, worst: 70 },
    ],
  },
  climateResilience: {
    global: [
      { year: 2000, best: 40, worst: -50 },
      { year: 2019, best: 90, worst: 30 },
    ],
  },
};
