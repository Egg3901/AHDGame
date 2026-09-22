/**
 * 1953-era adjustments for `StateMetricBaseline` documents. Mirrors the
 * field-level anchors in `stateMetrics1953.ts` so freshly-seeded 1953
 * worlds have baselines aligned with the era-floored metric values
 * (zero decay pressure at game start).
 *
 * Applied at seed time by each country's `seedXBaselines` function
 * (and `runCoreSeed` for US) when the active preset is `1953-default`.
 *
 * Pattern mirrors `stateBaselines1991.ts` — deep-clone + field-level
 * shift, not a separately-curated baseline file. Pure: no DB, no Date.
 *
 * Field-level rules (each guarded by a presence check):
 *
 *   - infrastructure.broadbandAccess → 0 (internet did not exist).
 *   - mediaInformation.socialMediaSentiment → 0 (no platforms).
 *   - mediaInformation.disinformationRisk → clamped ≤5 (pre-TV mass
 *     media; state propaganda exists but no viral misinformation).
 *   - mediaInformation.mediaPolarization → −20 (clamped 5..25;
 *     no cable news, no talk radio echo chambers).
 *   - mediaInformation.pressFreedom → +8 (clamped 45..90; trusted
 *     newspapers, no social-media-driven threats).
 *   - mediaInformation.newsTrust → +15 (clamped 50..90; pre-Vietnam,
 *     pre-Watergate era of relatively high institutional trust).
 *   - economic.medianIncome → ×0.06 (1953 nominal ~$3,900 vs 2019
 *     ~$65,000; the ratio is ~6%).
 *   - economic.costOfLiving → ×0.06.
 *   - economic.povertyRate → +5pp (clamped 15..35; pre-welfare state,
 *     pre-Great Society programs).
 *   - economic.gdpGrowth → +0.5pp (clamped 3..8; Korean War boom
 *     was tapering but growth was structurally higher in the era).
 *   - healthcare.lifeExpectancy → −10 (clamped 44..70; US 1953 ≈ 68;
 *     developing-world countries significantly lower).
 *   - healthcare.uninsuredRate → +15pp (clamped 30..70; no
 *     Medicare/Medicaid before 1965; most care is private/OOP).
 *   - publicSafety.crimeRate → ×0.65 (below the 1960s-70s peak).
 *   - publicSafety.violentCrimeRate → ×0.60.
 *   - publicSafety.incarcerationRate → ×0.35 (mass incarceration
 *     didn't begin until the 1970s-80s).
 *   - population.urbanizationRate → ×0.75 (significantly less urban
 *     than modern values in most countries).
 *   - population.medianAge → −8 when the input is still modern-old,
 *     else pass through; clamped 15..36 (same band as
 *     stateMetricsEra1953 — decay target must not be narrower than
 *     the live metric). Skip the −8 when already ≤24 (young-era;
 *     blanket ageing assumes a modern input — see Nigeria).
 *   - population.populationGrowth → +0.5pp (clamped 0.5..3.5;
 *     post-WWII baby boom).
 *   - (no birthRate baseline field — fertility index lives on metrics
 *     only; see stateMetricsEra1953 birthRate band [30, 95].)
 *   - governance.voterTurnout → +5pp (clamped 50..80; high Cold War
 *     civic participation in democracies).
 *   - governance.debtToGdp → ×0.6 (clamped 15..80; post-WWII debt
 *     being eroded by rapid nominal GDP growth).
 *
 * Country-specific fields handled below with `!== undefined` guards
 * so countries lacking those fields pass through unchanged.
 */

import type { StateMetricBaseline } from "@/lib/db/types";
import { getIncomeAnchor } from "@/lib/era/metricCatalog";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 1953 medianAge decay-target band — MUST stay identical to the live-metric
 * band in `stateMetricsEra1953` ([15, 36]). A narrower baseline would drag an
 * era-real seeded age toward a modern/Western floor over a long run.
 */
const MEDIAN_AGE_BAND_1953 = { lo: 15, hi: 36 } as const;
/** Upper end of developing-world 1953 medians (~18–22; UN Pop Division 1950s). */
const MEDIAN_AGE_ALREADY_YOUNG = 24;

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

// Income LEVEL comes from the authored era income-anchor table (the SSOT shared
// with era scoring); regional variation preserved via anchor(1953)/anchor(2019).
const INCOME_ANCHOR_RATIO_1953 = getIncomeAnchor("US", 1953)! / getIncomeAnchor("US", 2019)!;

export function applyEra1953BaselineAdjustments(
  baseline: StateMetricBaseline
): StateMetricBaseline {
  const out: StateMetricBaseline = deepClone(baseline);
  const b = out.baselines as Record<string, Record<string, number>> | undefined;
  if (!b) return out;

  // ── Economic ──────────────────────────────────────────────────────────────
  if (b.economic) {
    if (typeof b.economic.gdpGrowth === "number") {
      b.economic.gdpGrowth = clamp(b.economic.gdpGrowth + 0.5, 3, 8);
    }
    if (typeof b.economic.medianIncome === "number") {
      b.economic.medianIncome = Math.round(b.economic.medianIncome * INCOME_ANCHOR_RATIO_1953);
    }
    // costOfLiving is a 100-centered RELATIVE index (100 = national average) —
    // NOT a price level. Scaling it nominally seeded ~6 on a [70,165] band
    // (spec seed-reconciliation #3); the 2019 regional tilts remain era-valid.
    if (typeof b.economic.povertyRate === "number") {
      b.economic.povertyRate = clamp(b.economic.povertyRate + 5, 15, 35);
    }
  }

  // ── Healthcare ────────────────────────────────────────────────────────────
  if (b.healthcare) {
    if (typeof b.healthcare.lifeExpectancy === "number") {
      b.healthcare.lifeExpectancy = clamp(b.healthcare.lifeExpectancy - 10, 44, 70);
    }
    if (typeof b.healthcare.uninsuredRate === "number") {
      b.healthcare.uninsuredRate = clamp(b.healthcare.uninsuredRate + 15, 30, 70);
    }
  }

  // ── Infrastructure ────────────────────────────────────────────────────────
  if (b.infrastructure && typeof b.infrastructure.broadbandAccess === "number") {
    b.infrastructure.broadbandAccess = 0;
  }

  // ── Environment: windowed policy roots era-zeroed (spec seed-reconciliation
  // #4 — roots have no engine envelope; seeds + decay-to-baseline govern their
  // pre-window value, so the baseline must sit at the hold) ──────────────────
  if (b.environment) {
    if (typeof b.environment.renewableEnergy === "number") b.environment.renewableEnergy = 0;
    if (typeof b.environment.recyclingRate === "number") b.environment.recyclingRate = 0;
    if (typeof b.environment.climateResilience === "number") b.environment.climateResilience = 0;
    if (typeof b.environment.energyTransitionProgress === "number") {
      b.environment.energyTransitionProgress = 0;
    }
  }

  // ── Public Safety ─────────────────────────────────────────────────────────
  if (b.publicSafety) {
    if (typeof b.publicSafety.crimeRate === "number") {
      b.publicSafety.crimeRate = Math.round(b.publicSafety.crimeRate * 0.65);
    }
    if (typeof b.publicSafety.violentCrimeRate === "number") {
      b.publicSafety.violentCrimeRate = Math.round(b.publicSafety.violentCrimeRate * 0.6);
    }
    if (typeof b.publicSafety.incarcerationRate === "number") {
      b.publicSafety.incarcerationRate = Math.round(b.publicSafety.incarcerationRate * 0.35);
    }
  }

  // ── Population ────────────────────────────────────────────────────────────
  if (b.population) {
    if (typeof b.population.urbanizationRate === "number") {
      b.population.urbanizationRate = Math.round(b.population.urbanizationRate * 0.75);
    }
    if (typeof b.population.medianAge === "number") {
      // Mirror stateMetricsEra1953: −8 only when the input still looks modern.
      // Already-young seeds (NG 16, TR 20) must not be aged further — the decay
      // target would otherwise fight the live metric for a thousand turns.
      // Band [15, 36] matches the metric adjuster; do not narrow one without
      // the other.
      const v = b.population.medianAge;
      b.population.medianAge =
        v >= MEDIAN_AGE_BAND_1953.lo && v <= MEDIAN_AGE_ALREADY_YOUNG
          ? v
          : clamp(v - 8, MEDIAN_AGE_BAND_1953.lo, MEDIAN_AGE_BAND_1953.hi);
    }
    if (typeof b.population.populationGrowth === "number") {
      b.population.populationGrowth = clamp(b.population.populationGrowth + 0.5, 0.5, 3.5);
    }
  }

  // ── Governance ────────────────────────────────────────────────────────────
  if (b.governance) {
    if (typeof b.governance.voterTurnout === "number") {
      b.governance.voterTurnout = clamp(b.governance.voterTurnout + 5, 50, 80);
    }
    if (typeof b.governance.debtToGdp === "number") {
      b.governance.debtToGdp = clamp(b.governance.debtToGdp * 0.6, 15, 80);
    }
  }

  // ── Media / information environment ───────────────────────────────────────
  if (b.mediaInformation) {
    if (typeof b.mediaInformation.socialMediaSentiment === "number") {
      b.mediaInformation.socialMediaSentiment = 0;
    }
    if (typeof b.mediaInformation.disinformationRisk === "number") {
      b.mediaInformation.disinformationRisk = clamp(b.mediaInformation.disinformationRisk, 0, 5);
    }
    if (typeof b.mediaInformation.mediaPolarization === "number") {
      b.mediaInformation.mediaPolarization = clamp(
        b.mediaInformation.mediaPolarization - 20,
        5,
        25
      );
    }
    if (typeof b.mediaInformation.pressFreedom === "number") {
      b.mediaInformation.pressFreedom = clamp(b.mediaInformation.pressFreedom + 8, 45, 90);
    }
    if (typeof b.mediaInformation.newsTrust === "number") {
      b.mediaInformation.newsTrust = clamp(b.mediaInformation.newsTrust + 15, 50, 90);
    }
  }

  // ── Country-specific 1953 baseline adjustments ────────────────────────────
  // Each guarded by `!== undefined` so countries without these fields pass through.

  // IE: pre-Celtic-Tiger, agrarian protectionism, Church hegemony, emigration crisis
  if (b.economic) {
    if (typeof b.economic.mncDependency === "number") b.economic.mncDependency = 2;
    if (typeof b.economic.gniStarGap === "number") b.economic.gniStarGap = 1;
    if (typeof b.economic.fdiPipelineStrength === "number") b.economic.fdiPipelineStrength = 5;
    if (typeof b.economic.capDependency === "number") b.economic.capDependency = 92;
  }
  if (b.healthcare) {
    if (typeof b.healthcare.slaintecareProgress === "number") b.healthcare.slaintecareProgress = 0;
    if (typeof b.healthcare.hseWaitingListMonths === "number") {
      b.healthcare.hseWaitingListMonths = 36;
    }
  }
  if (b.social) {
    if (typeof b.social.irishLanguageStrength === "number") b.social.irishLanguageStrength = 62;
    if (typeof b.social.housingCompletionsRate === "number") b.social.housingCompletionsRate = 2;
    if (typeof b.social.rentalPressureIndex === "number") b.social.rentalPressureIndex = 20;
  }
  if (b.governance) {
    if (typeof b.governance.unityReferendumSupport === "number") {
      b.governance.unityReferendumSupport = 12;
    }
    if (typeof b.governance.directProvisionLoad === "number") b.governance.directProvisionLoad = 0;
  }

  // DE: pre-reunification West Germany, Wirtschaftswunder, Adenauer/CDU
  if (b.economic) {
    if (typeof b.economic.eastWestConvergence === "number") b.economic.eastWestConvergence = 0;
    if (typeof b.economic.mittelstandHealth === "number") b.economic.mittelstandHealth = 45;
  }
  if (b.social) {
    if (typeof b.social.kitaCoverage === "number") b.social.kitaCoverage = 15;
    if (typeof b.social.wohnungsBauRate === "number") b.social.wohnungsBauRate = 7.0;
  }
  if (b.governance) {
    // Schuldenbremse (2009) is anachronistic in 1953 — but the field STAYS on
    // the doc (read-time-gate contract; deleting it broke field presence). It
    // is budget-MIRRORED: the fiscalMirror re-derives it from the live budget
    // every turn, and the era gate hides it until its window opens.
    if (typeof b.governance.bundeswehrReadiness === "number") {
      b.governance.bundeswehrReadiness = 20; // Bundeswehr not formed until 1955
    }
    if (typeof b.governance.rentenStabilitaet === "number") b.governance.rentenStabilitaet = 65;
    if (typeof b.governance.euCohesionScore === "number") b.governance.euCohesionScore = 0; // EEC not until 1957
  }

  // CN: First Five-Year Plan, Stalinist model, pre-reform, pre-social-credit
  if (b.economic) {
    if (typeof b.economic.commonProsperityIndex === "number") {
      b.economic.commonProsperityIndex = 20;
    }
    if (typeof b.economic.industrialPolicyExecution === "number") {
      b.economic.industrialPolicyExecution = 65; // Soviet-model Five-Year Plan highly executed
    }
    if (typeof b.economic.eastWestRegionalGap === "number") {
      b.economic.eastWestRegionalGap = 80; // coastal/interior divide extreme in 1953
    }
  }
  if (b.social && typeof b.social.hukouMobility === "number") b.social.hukouMobility = 5;
  if (b.governance) {
    if (typeof b.governance.partyDiscipline === "number") b.governance.partyDiscipline = 90;
    if (typeof b.governance.socialCreditCoverage === "number") {
      b.governance.socialCreditCoverage = 0; // system did not exist
    }
    if (typeof b.governance.taiwanStraitTension === "number") {
      b.governance.taiwanStraitTension = 70; // First Taiwan Strait Crisis 1954-55
    }
    if (typeof b.governance.beltAndRoadEngagement === "number") {
      b.governance.beltAndRoadEngagement = 0;
    }
  }

  return out;
}
