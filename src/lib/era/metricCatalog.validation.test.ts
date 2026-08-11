import { describe, expect, it } from "vitest";
import {
  METRIC_ERA_WINDOWS,
  METRIC_BAND_CURVES,
  METRIC_ERA_ENVELOPES,
  ENVELOPE_EXEMPTIONS,
  INCOME_ANCHORS,
  getEraBand,
  getEraEnvelope,
  type BandAnchor,
} from "./metricCatalog";
import { THRESHOLDS, IS_HIGHER_BETTER } from "@/lib/utils/metricScoring";
import { METRIC_REGISTRY_SORTED } from "@/lib/metricEngine/registry";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Authoring validation (house calibration-test pattern): the catalog's data
 * tables carry structural invariants the spec demands. Everything here is
 * derived from code/data — never a prose list.
 */

/** Spec window rows: metricId → from year (33 total: 12 universal + 2 scoped + 19 country-specific). */
const SPEC_WINDOWS: Record<string, number> = {
  broadbandAccess: 1998,
  socialMediaSentiment: 2004,
  renewableEnergy: 1974,
  energyTransitionProgress: 2000,
  carbonEmissions: 1990,
  recyclingRate: 1972,
  climateResilience: 2000,
  nuclearSafety: 1957,
  roboticsAdoption: 1980,
  demographicDecline: 1990,
  foreignWorkerIntegration: 1990,
  mentalHealthAccess: 1970,
  devolutionSatisfaction: 1999,
  antiSocialBehaviourRate: 1998,
  schuldenbremseHeadroom: 2009,
  eastWestConvergence: 1990,
  euCohesionScore: 1993,
  rentenStabilitaet: 1957,
  bundeswehrReadiness: 1956,
  kitaCoverage: 1996,
  slaintecareProgress: 2017,
  gniStarGap: 2017,
  directProvisionLoad: 2000,
  hseWaitingListMonths: 2005,
  capDependency: 1973,
  mncDependency: 1960,
  fdiPipelineStrength: 1960,
  agriEmissionsShare: 1990,
  socialCreditCoverage: 2014,
  beltAndRoadEngagement: 2013,
  commonProsperityIndex: 2021,
  eastWestRegionalGap: 1980,
  hukouMobility: 1958,
};

const YEAR_IN_COPY = /\b(1[89]|20)\d{2}\b/;

function scoreAtZero(anchor: BandAnchor): number {
  // higher-is-better score of value 0 against {best, worst}
  const range = anchor.best - anchor.worst;
  return Math.max(0, Math.min(100, ((0 - anchor.worst) / range) * 100));
}

describe("metric era catalog — authoring validation", () => {
  it("every spec window row is present in code with the spec's from-year (33 rows)", () => {
    expect(Object.keys(METRIC_ERA_WINDOWS).sort()).toEqual(Object.keys(SPEC_WINDOWS).sort());
    for (const [metricId, from] of Object.entries(SPEC_WINDOWS)) {
      expect(METRIC_ERA_WINDOWS[metricId]!.from, metricId).toBe(from);
    }
    expect(Object.keys(METRIC_ERA_WINDOWS)).toHaveLength(33);
  });

  it("every window (and every countryOverride) has non-empty news copy with NO literal years", () => {
    for (const [metricId, w] of Object.entries(METRIC_ERA_WINDOWS)) {
      expect(w.news.title.trim().length, `${metricId} title`).toBeGreaterThan(0);
      expect(w.news.body.trim().length, `${metricId} body`).toBeGreaterThan(0);
      expect(YEAR_IN_COPY.test(w.news.title), `${metricId} title has a year`).toBe(false);
      expect(YEAR_IN_COPY.test(w.news.body), `${metricId} body has a year`).toBe(false);
      for (const [cid, ov] of Object.entries(w.countryOverrides ?? {})) {
        expect(ov!.news.title.trim().length, `${metricId}/${cid} title`).toBeGreaterThan(0);
        expect(ov!.news.body.trim().length, `${metricId}/${cid} body`).toBeGreaterThan(0);
        expect(YEAR_IN_COPY.test(ov!.news.title), `${metricId}/${cid} title year`).toBe(false);
        expect(YEAR_IN_COPY.test(ov!.news.body), `${metricId}/${cid} body year`).toBe(false);
      }
    }
  });

  it("every band-curve metricId exists in THRESHOLDS (a curve must never silently score an unscored metric)", () => {
    for (const metricId of Object.keys(METRIC_BAND_CURVES)) {
      expect(THRESHOLDS[metricId], metricId).toBeDefined();
    }
  });

  it("anchors are strictly ascending by year with best ≠ worst", () => {
    for (const [metricId, curve] of Object.entries(METRIC_BAND_CURVES)) {
      const sets: Array<[string, BandAnchor[]]> = [];
      if (curve.global) sets.push(["global", curve.global]);
      for (const [cid, anchors] of Object.entries(curve.byCountry ?? {})) {
        if (anchors) sets.push([cid, anchors]);
      }
      for (const [scope, anchors] of sets) {
        for (let i = 0; i < anchors.length; i++) {
          expect(anchors[i].best, `${metricId}/${scope}[${i}]`).not.toBe(anchors[i].worst);
          if (i > 0) {
            expect(anchors[i].year, `${metricId}/${scope} ascending`).toBeGreaterThan(
              anchors[i - 1].year
            );
          }
        }
      }
    }
  });

  it("every SCORED windowed metric's curve covers its from-year with score-at-value-0 ≥ 20 (higher-is-better)", () => {
    for (const [metricId, w] of Object.entries(METRIC_ERA_WINDOWS)) {
      if (!THRESHOLDS[metricId]) continue; // unscored stay unscored — no curve required
      const curve = METRIC_BAND_CURVES[metricId];
      expect(curve, `${metricId} scored+windowed needs a curve`).toBeDefined();
      const anchors = curve!.global ?? Object.values(curve!.byCountry ?? {})[0]!;
      expect(anchors[0].year, `${metricId} first anchor ≤ from`).toBeLessThanOrEqual(w.from);
      if (IS_HIGHER_BETTER[metricId]) {
        expect(
          scoreAtZero(anchors[0]),
          `${metricId} score at 0 at activation`
        ).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("envelope coverage is complete, derived from METRIC_REGISTRY (never prose)", () => {
    const animatedWindowed = METRIC_REGISTRY_SORTED.filter(
      (n) => n.metricId in METRIC_ERA_WINDOWS
    ).map((n) => n.metricId);
    for (const metricId of animatedWindowed) {
      const scored = THRESHOLDS[metricId] !== undefined;
      const higherBetter = IS_HIGHER_BETTER[metricId] ?? true;
      if (scored && higherBetter) {
        expect(METRIC_ERA_ENVELOPES[metricId], `${metricId} needs an envelope`).toBeDefined();
      } else {
        expect(
          METRIC_ERA_ENVELOPES[metricId] !== undefined ||
            ENVELOPE_EXEMPTIONS[metricId] !== undefined,
          `${metricId} animated+windowed must be enveloped or explicitly exempted`
        ).toBe(true);
      }
    }
  });

  it("ceiling(year) ≥ band best(year) at every envelope anchor year", () => {
    for (const [metricId, env] of Object.entries(METRIC_ERA_ENVELOPES)) {
      for (const anchor of env.anchors) {
        const band = getEraBand(metricId, undefined, anchor.year);
        if (!band) continue;
        const e = getEraEnvelope(metricId, undefined, anchor.year)!;
        expect(e.limit, `${metricId}@${anchor.year}`).toBeGreaterThanOrEqual(band.best);
      }
    }
  });

  it("INCOME_ANCHORS covers all 8 playable countries at every preset start year", () => {
    const countries: CountryId[] = ["US", "UK", "DE", "JP", "IE", "BR", "CN", "NG"];
    for (const c of countries) {
      const anchors = INCOME_ANCHORS[c];
      expect(anchors, c).toBeDefined();
      const years = anchors!.map((a) => a.year);
      for (const y of [1953, 1979, 1991, 2019]) {
        expect(years, `${c} anchor at ${y}`).toContain(y);
      }
      for (const a of anchors!) expect(a.value, `${c}@${a.year}`).toBeGreaterThan(0);
    }
  });

  it("era-baseline transforms hold windowed metrics at/below the pre-window value (decay-writer safety)", async () => {
    const { applyEra1953BaselineAdjustments } =
      await import("@/lib/seeds/reference/stateBaselines1953");
    const { applyEra1979BaselineAdjustments } =
      await import("@/lib/seeds/reference/stateBaselines1979");
    const { applyEra1991BaselineAdjustments } =
      await import("@/lib/seeds/reference/stateBaselines1991");
    const synthetic = {
      _id: "US-CA",
      baselines: {
        economic: { medianIncome: 65_000, costOfLiving: 104 },
        infrastructure: { broadbandAccess: 88 },
        environment: {
          renewableEnergy: 20,
          recyclingRate: 32,
          climateResilience: 60,
          energyTransitionProgress: 40,
        },
        governance: { schuldenbremseHeadroom: 0.2 },
        mediaInformation: { socialMediaSentiment: 8 },
      },
    } as never;

    const cases: Array<[number, { baselines: Record<string, Record<string, number>> }]> = [
      [1953, applyEra1953BaselineAdjustments(synthetic) as never],
      [1979, applyEra1979BaselineAdjustments(synthetic) as never],
      [1991, applyEra1991BaselineAdjustments(synthetic) as never],
    ];
    const rootPaths: Array<[string, string]> = [
      ["infrastructure", "broadbandAccess"],
      ["environment", "renewableEnergy"],
      ["environment", "recyclingRate"],
      ["environment", "climateResilience"],
      ["environment", "energyTransitionProgress"],
      ["mediaInformation", "socialMediaSentiment"],
    ];
    for (const [presetYear, adjusted] of cases) {
      for (const [cat, metricId] of rootPaths) {
        const w = METRIC_ERA_WINDOWS[metricId];
        if (!w || presetYear >= w.from) continue; // active at seed ⇒ era-plausible value is fine
        expect(
          adjusted.baselines[cat]![metricId],
          `${metricId} baseline must be 0 in ${presetYear} (window ${w.from})`
        ).toBe(0);
      }
      // schuldenbremseHeadroom must STAY on the doc (read-time-gate contract).
      expect(
        adjusted.baselines.governance!.schuldenbremseHeadroom,
        `schuldenbremseHeadroom present in ${presetYear}`
      ).toBeDefined();
      // costOfLiving is a relative index — never nominally scaled.
      expect(
        adjusted.baselines.economic!.costOfLiving,
        `costOfLiving unscaled in ${presetYear}`
      ).toBe(104);
    }
  });
});
