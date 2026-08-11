/**
 * Era bands must carry signal in 1953, not just be present.
 *
 * The failure this guards is subtle: a band can be well-formed, in range, and
 * still useless. If a metric's 2019 band sits entirely outside the authored 1953
 * distribution, every country pins at 0 or 100 — the score stops responding to
 * policy, the player sees a grade they can neither earn nor fix, and any
 * approval term built on it is a constant.
 *
 * So this scores every authored 1953 seed value against the band the engine
 * would actually use, and fails when an approval-scoring metric is pinned for
 * half the world or more. That is a measurement, not a judgement: it caught nine
 * metrics that no amount of reading the tables would have surfaced.
 *
 * Badge-only metrics are exempt. `medianAge` and `populationGrowth` are in
 * `APPROVAL_EXCLUDED_METRICS`, so their pinning is cosmetic — and `medianAge`'s
 * direction is genuinely era-dependent (a low 1953 median age reflects infant
 * mortality as much as a demographic dividend), so banding it would assert
 * something the model does not actually believe.
 */
import { describe, expect, it } from "vitest";
import { THRESHOLDS, scoreMetric } from "@/lib/utils/metricScoring";
import { APPROVAL_EXCLUDED_METRICS } from "@/lib/utils/governmentApproval";

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

type Bundle = Record<string, Record<string, number>>;

const BUNDLES: Record<string, Bundle> = {
  IE: ieMetricPresets1953 as unknown as Bundle,
  DE: deMetricPresets1953 as unknown as Bundle,
  JP: jpMetricPresets1953 as unknown as Bundle,
  BR: brMetricPresets1953 as unknown as Bundle,
  CN: cnMetricPresets1953 as unknown as Bundle,
  NG: ngMetricPresets1953 as unknown as Bundle,
  UK: ukMetricPresets1953 as unknown as Bundle,
  US: usMetricPresets1953 as unknown as Bundle,
  RU: ruMetricPresets1953 as unknown as Bundle,
  IT: itMetricPresets1953 as unknown as Bundle,
  FR: frMetricPresets1953 as unknown as Bundle,
  ES: esMetricPresets1953 as unknown as Bundle,
  SE: seMetricPresets1953 as unknown as Bundle,
  TR: trMetricPresets1953 as unknown as Bundle,
  AT: atMetricPresets1953 as unknown as Bundle,
  FI: fiMetricPresets1953 as unknown as Bundle,
  GR: grMetricPresets1953 as unknown as Bundle,
};

const YEAR = 1953;
/** A world-scale income index; the band scales linearly with it, so 1 is representative. */
const INCOME_INDEX = 1;
/** Below this many authored values a "distribution" is one country's opinion. */
const MIN_SAMPLE = 20;
/** Share of the world allowed to sit at 0 or 100 before the band is dead. */
const MAX_PINNED_PCT = 50;

function scoresFor(metricId: string): number[] {
  const out: number[] = [];
  for (const [cc, bundle] of Object.entries(BUNDLES)) {
    for (const overlay of Object.values(bundle)) {
      for (const [path, v] of Object.entries(overlay)) {
        if (!path.endsWith(`.${metricId}`)) continue;
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const s = scoreMetric(metricId, v, cc, "1953-default", YEAR, INCOME_INDEX, YEAR);
        if (s != null) out.push(s);
      }
    }
  }
  return out;
}

function pinnedPct(scores: number[]): number {
  const pinned = scores.filter((s) => s <= 5 || s >= 95).length;
  return (pinned / scores.length) * 100;
}

const CANDIDATES = Object.keys(THRESHOLDS).filter((m) => !APPROVAL_EXCLUDED_METRICS.has(m));

describe("1953 band signal", () => {
  it("is non-vacuous — the seed bundles actually carry scored metrics", () => {
    const withData = CANDIDATES.filter((m) => scoresFor(m).length >= MIN_SAMPLE);
    expect(withData.length).toBeGreaterThan(20);
  });

  it("no approval-scoring metric is pinned for half the world", () => {
    const dead: string[] = [];
    for (const metricId of CANDIDATES) {
      const scores = scoresFor(metricId);
      if (scores.length < MIN_SAMPLE) continue;
      const pct = pinnedPct(scores);
      if (pct >= MAX_PINNED_PCT)
        dead.push(`${metricId} (${pct.toFixed(0)}% pinned, n=${scores.length})`);
    }
    expect(
      dead,
      "These metrics score 0 or 100 for most of the 1953 world, so policy cannot " +
        "move them. Author an era band in METRIC_BAND_CURVES (or an INCOME_ANCHORS " +
        "entry for medianIncome)."
    ).toEqual([]);
  });

  // The specific regressions this pass fixed. Named so a future re-narrowing
  // fails with the metric that broke rather than a bare count.
  it.each([
    "militaryReadiness",
    "pressFreedom",
    "stateMediaControl",
    "disinformationRisk",
    "apprenticeshipRate",
    "productivityGrowth",
    "nationalPride",
    "housingAffordability",
    "medianIncome",
  ])("%s spreads across the 1953 world", (metricId) => {
    const scores = scoresFor(metricId);
    expect(scores.length).toBeGreaterThanOrEqual(MIN_SAMPLE);
    expect(pinnedPct(scores)).toBeLessThan(MAX_PINNED_PCT);
    // Spread, not just un-pinned: a band that maps everything to 50 is equally dead.
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(20);
  });
});
