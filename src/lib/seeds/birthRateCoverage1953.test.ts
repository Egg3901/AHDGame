/**
 * 1953 seed-audit — a region that authors `population.medianAge` for a
 * historical preset MUST also author `population.birthRate`.
 *
 * `population.birthRate` is a 0-100 fertility INDEX (metricDefinitions
 * `unit: "index"`; see demographics/flows/fertility.ts's
 * `birthRateIndexToTFR`), not a crude rate per 1000. When a region omits it,
 * `seedCohortVectors` falls back to `DEFAULT_BIRTH_RATE = 50` — a
 * 2019-replacement-level fertility reading (birthRateIndexToTFR(50, 2.06) =
 * 2.06 TFR) silently imposed on a historical world, and — because
 * `population.birthRate` is a STATIC ROOT metric with no turn-engine node
 * that evolves it (unlike `medianAge`, which the demographic phase updates
 * every turn from the live cohort vector) — whatever gets seeded here is
 * literally the fertility rate for the ENTIRE run, with no way for the
 * simulation to correct it.
 *
 * This is deliberately a check for a HISTORICAL preset only (1953-default):
 * a neutral/omitted birthRate is the right default for a MODERN preset
 * (where replacement-level fertility is realistic), and wrong for an era
 * whose real TFR was usually well above replacement. Authoring `medianAge`
 * without `birthRate` for 1953 has been found and fixed three separate times
 * (Nigeria's ngMetricPresets1953.ts carries the comment "cannot be missed.
 * birthRate below is the real fix"; the US reference stateMetrics1953.ts and
 * this pass's Eastern-bloc / DE / FR / ES / IT / TR / SE / AT / DD fixes) —
 * this test exists so a fourth occurrence fails loudly instead of shipping.
 *
 * Two shapes of 1953 seed are covered:
 *   (a) FLAT OVERLAY bundles (`*MetricPresets1953.ts`): a region → dotted-path
 *       → number map. Checked directly against the raw authored keys — no
 *       merge with a modern base, so this catches the exact authoring gap.
 *   (b) CONSTRUCTED StateMetrics (Eastern bloc via `makeEasternBlocStateMetrics`,
 *       and DD's hand-built `ddStateMetrics1953`): checked on the final
 *       `population.medianAge` / `population.birthRate` values, since these
 *       don't go through a flat overlay merge.
 */
import { describe, expect, it } from "vitest";

import { ieMetricPresets1953 } from "@/lib/seeds/ie/ieMetricPresets1953";
import { deMetricPresets1953 } from "@/lib/seeds/de/deMetricPresets1953";
import { jpMetricPresets1953 } from "@/lib/seeds/jp/jpMetricPresets1953";
import { brMetricPresets1953 } from "@/lib/seeds/br/brMetricPresets1953";
import { cnMetricPresets1953 } from "@/lib/seeds/cn/cnMetricPresets1953";
import { ngMetricPresets1953 } from "@/lib/seeds/ng/ngMetricPresets1953";
import { ruMetricPresets1953 } from "@/lib/seeds/ru/ruMetricPresets1953";
import { itMetricPresets1953 } from "@/lib/seeds/it/itMetricPresets1953";
import { frMetricPresets1953 } from "@/lib/seeds/fr/frMetricPresets1953";
import { esMetricPresets1953 } from "@/lib/seeds/es/esMetricPresets1953";
import { seMetricPresets1953 } from "@/lib/seeds/se/seMetricPresets1953";
import { trMetricPresets1953 } from "@/lib/seeds/tr/trMetricPresets1953";
import { atMetricPresets1953 } from "@/lib/seeds/at/atMetricPresets1953";
import { fiMetricPresets1953 } from "@/lib/seeds/fi/fiMetricPresets1953";
import { grMetricPresets1953 } from "@/lib/seeds/gr/grMetricPresets1953";
import { ukMetricPresets1953 } from "@/lib/seeds/uk/ukMetricPresets1953";
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

import { getHuSeedConfig } from "@/lib/seeds/hu/huSeed";
import { getPlSeedConfig } from "@/lib/seeds/pl/plSeed";
import { getRoSeedConfig } from "@/lib/seeds/ro/roSeed";
import { getYuSeedConfig } from "@/lib/seeds/yu/yuSeed";
import { getBgSeedConfig } from "@/lib/seeds/bg/bgSeed";
import { getBlrSeedConfig } from "@/lib/seeds/blr/blrSeed";
import { getCsSeedConfig } from "@/lib/seeds/cs/csSeed";
import { getBalSeedConfig } from "@/lib/seeds/bal/balSeed";
import { ddStateMetrics1953 } from "@/lib/seeds/dd/ddStateMetrics1953";

/**
 * FLAT OVERLAY bundles to check.
 */
const FLAT_OVERLAY_BUNDLES: Record<string, MetricPresetBundle> = {
  IE: ieMetricPresets1953,
  DE: deMetricPresets1953,
  JP: jpMetricPresets1953,
  BR: brMetricPresets1953,
  CN: cnMetricPresets1953,
  NG: ngMetricPresets1953,
  RU: ruMetricPresets1953,
  IT: itMetricPresets1953,
  FR: frMetricPresets1953,
  ES: esMetricPresets1953,
  SE: seMetricPresets1953,
  TR: trMetricPresets1953,
  AT: atMetricPresets1953,
  FI: fiMetricPresets1953,
  GR: grMetricPresets1953,
  UK: ukMetricPresets1953,
};

describe("1953 seed-audit — medianAge without birthRate (flat overlay countries)", () => {
  for (const [country, bundle] of Object.entries(FLAT_OVERLAY_BUNDLES)) {
    it(`${country}: every region authoring population.medianAge also authors population.birthRate`, () => {
      const violations: string[] = [];
      for (const [regionId, overlay] of Object.entries(bundle)) {
        const hasMedianAge = "population.medianAge" in overlay;
        const hasBirthRate = "population.birthRate" in overlay;
        if (hasMedianAge && !hasBirthRate) {
          violations.push(regionId);
        }
      }
      expect(
        violations,
        `${country} 1953: regions authoring medianAge without birthRate (falls to ` +
          `DEFAULT_BIRTH_RATE=50, a 2019-replacement-level TFR, for the whole run): ` +
          violations.join(", ")
      ).toEqual([]);
    });
  }
});

interface EBSeedConfig {
  metrics: Array<{
    _id: string;
    population?: { medianAge?: { value: number }; birthRate?: { value: number } };
  }>;
}

const EASTERN_BLOC: Record<string, (preset: string) => EBSeedConfig> = {
  HU: getHuSeedConfig,
  PL: getPlSeedConfig,
  RO: getRoSeedConfig,
  YU: getYuSeedConfig,
  BG: getBgSeedConfig,
  BLR: getBlrSeedConfig,
  CS: getCsSeedConfig,
  BAL: getBalSeedConfig,
};

describe("1953 seed-audit — medianAge without birthRate (Eastern bloc + DD)", () => {
  for (const [country, getConfig] of Object.entries(EASTERN_BLOC)) {
    it(`${country}: every 1953 region has both medianAge and birthRate on population`, () => {
      const { metrics } = getConfig("1953-default");
      const violations: string[] = [];
      for (const m of metrics) {
        const hasMedianAge = m.population?.medianAge !== undefined;
        const hasBirthRate = m.population?.birthRate !== undefined;
        if (hasMedianAge && !hasBirthRate) violations.push(m._id);
      }
      expect(violations, `${country} 1953: regions with medianAge but no birthRate`).toEqual([]);
    });
  }

  it("DD: every 1953 region has both medianAge and birthRate on population", () => {
    const violations: string[] = [];
    for (const m of ddStateMetrics1953) {
      const hasMedianAge = m.population?.medianAge !== undefined;
      const hasBirthRate = m.population?.birthRate !== undefined;
      if (hasMedianAge && !hasBirthRate) violations.push(m._id);
    }
    expect(violations, "DD 1953: regions with medianAge but no birthRate").toEqual([]);
  });
});
