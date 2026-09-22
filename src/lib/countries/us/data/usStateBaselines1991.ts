/**
 * 1991-era adjustments for `StateMetricBaseline` documents. Mirrors the
 * field-level shifts in `stateMetrics1991.ts` so freshly-seeded 1991
 * worlds have baselines aligned with the era-floored metric values
 * (zero decay pressure at game start).
 *
 * Applied at seed time by each country's `seedXBaselines` function
 * (and `runCoreSeed` for US) when the active preset is `1991-default`.
 *
 * Mirrors the approach in `stateDemographics1991.ts` / `stateMetrics1991.ts`
 * — a deep-clone + field-level shift, not a separately-curated 1991
 * baseline file. Pure function: no DB, no Date.
 *
 * Field-level rules (each guarded by a presence check, so countries
 * that don't seed a given field pass through unchanged):
 *
 *   - infrastructure.broadbandAccess → 0 (residential broadband didn't
 *     exist in 1991; cable-modem experiments began 1995).
 *   - mediaInformation.socialMediaSentiment → 0 (no platforms).
 *   - mediaInformation.disinformationRisk → clamped ≤20 (pre-internet
 *     info environment).
 *   - mediaInformation.mediaPolarization → −15 (clamped 10..35; cable-
 *     news polarization had not yet started, Fox News 1996).
 *   - mediaInformation.pressFreedom → +10 (clamped 60..95).
 *   - mediaInformation.newsTrust → +10 (clamped 40..80).
 *   - economic.unemploymentRate → +1.5pp (clamped 4.5..11; 1990-91
 *     recession).
 *   - economic.gdpGrowth → −2pp (clamped −2.5..3; 1991 US growth
 *     was −0.1%).
 *   - economic.medianIncome → ×0.4 (1991 nominal vs 2020 nominal).
 *   - economic.costOfLiving → ×0.5.
 *   - economic.povertyRate → +2pp (clamped 8..22).
 *   - healthcare.lifeExpectancy → −3 (clamped 70..78; 1991 US peak).
 *   - healthcare.uninsuredRate → +4pp (pre-ACA, pre-1997 SCHIP).
 *   - publicSafety.crimeRate → ×1.35 (1991-93 US crime peak).
 *   - publicSafety.violentCrimeRate → ×1.4.
 *   - publicSafety.incarcerationRate → ×0.75 (mass-incarceration ramp
 *     was mid-1990s on).
 *   - governance.voterTurnout → +5pp (clamped 45..75).
 *   - governance.debtToGdp → ×0.5 (clamped 25..70; US 60% in 1991 vs
 *     130% today).
 *
 * Country-specific fields (IE / DE / CN) are explicitly handled below
 * so cross-country baselines (e.g. UK's `bbcTrust`, IE's `gniStarGap`,
 * DE's `schuldenbremseHeadroom`, CN's `socialCreditCoverage`) don't get
 * contaminated by US-side shifts. Each clause guards with `!== undefined`
 * so a country that doesn't carry the field is a no-op.
 */

import type { StateMetricBaseline } from "@/lib/db/types";
import { getIncomeAnchor } from "@/lib/era/metricCatalog";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// `structuredClone` (not a JSON round-trip) so any `Date` fields survive as
// real Dates rather than being silently stringified.
function deepClone<T>(value: T): T {
  return structuredClone(value);
}

// Income LEVEL comes from the authored era income-anchor table (the SSOT shared
// with era scoring); regional variation preserved via anchor(1991)/anchor(2019).
const INCOME_ANCHOR_RATIO_1991 = getIncomeAnchor("US", 1991)! / getIncomeAnchor("US", 2019)!;

export function applyEra1991BaselineAdjustments(
  baseline: StateMetricBaseline
): StateMetricBaseline {
  const out: StateMetricBaseline = deepClone(baseline);
  const b = out.baselines as Record<string, Record<string, number>> | undefined;
  if (!b) return out;

  // ── Economic ──────────────────────────────────────────────────────────────
  if (b.economic) {
    if (typeof b.economic.unemploymentRate === "number") {
      b.economic.unemploymentRate = clamp(b.economic.unemploymentRate + 1.5, 4.5, 11);
    }
    if (typeof b.economic.gdpGrowth === "number") {
      b.economic.gdpGrowth = clamp(b.economic.gdpGrowth - 2, -2.5, 3);
    }
    if (typeof b.economic.medianIncome === "number") {
      b.economic.medianIncome = Math.round(b.economic.medianIncome * INCOME_ANCHOR_RATIO_1991);
    }
    // costOfLiving is a 100-centered RELATIVE index (100 = national average) —
    // NOT a price level; the 2019 regional tilts remain era-valid unscaled
    // (spec seed-reconciliation #3).
    if (typeof b.economic.povertyRate === "number") {
      b.economic.povertyRate = clamp(b.economic.povertyRate + 2, 8, 22);
    }
  }

  // ── Healthcare ────────────────────────────────────────────────────────────
  if (b.healthcare) {
    if (typeof b.healthcare.lifeExpectancy === "number") {
      b.healthcare.lifeExpectancy = clamp(b.healthcare.lifeExpectancy - 3, 70, 78);
    }
    if (typeof b.healthcare.uninsuredRate === "number") {
      b.healthcare.uninsuredRate = clamp(b.healthcare.uninsuredRate + 4, 10, 22);
    }
  }

  // ── Infrastructure ────────────────────────────────────────────────────────
  if (b.infrastructure && typeof b.infrastructure.broadbandAccess === "number") {
    b.infrastructure.broadbandAccess = 0;
  }

  // ── Environment: windowed roots not yet in their era (climate framing is a
  // post-2000 window; renewables/recycling are already active by 1991) ───────
  if (b.environment) {
    if (typeof b.environment.climateResilience === "number") b.environment.climateResilience = 0;
    if (typeof b.environment.energyTransitionProgress === "number") {
      b.environment.energyTransitionProgress = 0;
    }
  }

  // ── Public Safety: 1991 crime peak ────────────────────────────────────────
  if (b.publicSafety) {
    if (typeof b.publicSafety.crimeRate === "number") {
      b.publicSafety.crimeRate = Math.round(b.publicSafety.crimeRate * 1.35);
    }
    if (typeof b.publicSafety.violentCrimeRate === "number") {
      b.publicSafety.violentCrimeRate = Math.round(b.publicSafety.violentCrimeRate * 1.4);
    }
    if (typeof b.publicSafety.incarcerationRate === "number") {
      b.publicSafety.incarcerationRate = Math.round(b.publicSafety.incarcerationRate * 0.75);
    }
  }

  // ── Population ────────────────────────────────────────────────────────────
  if (b.population) {
    if (typeof b.population.urbanizationRate === "number") {
      b.population.urbanizationRate = clamp(b.population.urbanizationRate - 3, 50, 100);
    }
    if (typeof b.population.medianAge === "number") {
      b.population.medianAge = clamp(b.population.medianAge - 5, 28, 40);
    }
    if (typeof b.population.populationGrowth === "number") {
      b.population.populationGrowth = clamp(b.population.populationGrowth + 0.3, -0.5, 2.5);
    }
  }

  // ── Governance ────────────────────────────────────────────────────────────
  if (b.governance) {
    if (typeof b.governance.voterTurnout === "number") {
      b.governance.voterTurnout = clamp(b.governance.voterTurnout + 5, 45, 75);
    }
    if (typeof b.governance.debtToGdp === "number") {
      b.governance.debtToGdp = clamp(b.governance.debtToGdp * 0.5, 25, 70);
    }
  }

  // ── Media / information environment ───────────────────────────────────────
  if (b.mediaInformation) {
    if (typeof b.mediaInformation.socialMediaSentiment === "number") {
      b.mediaInformation.socialMediaSentiment = 0;
    }
    if (typeof b.mediaInformation.disinformationRisk === "number") {
      b.mediaInformation.disinformationRisk = clamp(b.mediaInformation.disinformationRisk, 0, 20);
    }
    if (typeof b.mediaInformation.mediaPolarization === "number") {
      b.mediaInformation.mediaPolarization = clamp(
        b.mediaInformation.mediaPolarization - 15,
        10,
        35
      );
    }
    if (typeof b.mediaInformation.pressFreedom === "number") {
      b.mediaInformation.pressFreedom = clamp(b.mediaInformation.pressFreedom + 10, 60, 95);
    }
    if (typeof b.mediaInformation.newsTrust === "number") {
      b.mediaInformation.newsTrust = clamp(b.mediaInformation.newsTrust + 10, 40, 80);
    }
  }

  // ── Country-specific 1991 baseline adjustments ────────────────────────────
  // Each guarded by `=== undefined` checks so non-applicable countries skip.

  // IE: pre-Celtic-Tiger / pre-Sláintecare / pre-HSE
  if (b.economic) {
    if (typeof b.economic.mncDependency === "number") b.economic.mncDependency = 15;
    if (typeof b.economic.gniStarGap === "number") b.economic.gniStarGap = 5;
    if (typeof b.economic.fdiPipelineStrength === "number") b.economic.fdiPipelineStrength = 30;
    if (typeof b.economic.capDependency === "number") b.economic.capDependency = 85;
  }
  if (b.healthcare) {
    if (typeof b.healthcare.slaintecareProgress === "number") b.healthcare.slaintecareProgress = 0;
    if (typeof b.healthcare.hseWaitingListMonths === "number") {
      b.healthcare.hseWaitingListMonths = 24;
    }
  }
  if (b.environment && typeof b.environment.agriEmissionsShare === "number") {
    b.environment.agriEmissionsShare = 42;
  }
  if (b.social) {
    if (typeof b.social.housingCompletionsRate === "number") b.social.housingCompletionsRate = 4;
    if (typeof b.social.vacantPropertyRate === "number") b.social.vacantPropertyRate = 18;
    if (typeof b.social.rentalPressureIndex === "number") b.social.rentalPressureIndex = 40;
    if (typeof b.social.irishLanguageStrength === "number") b.social.irishLanguageStrength = 48;
  }
  if (b.governance) {
    if (typeof b.governance.unityReferendumSupport === "number") {
      b.governance.unityReferendumSupport = 28;
    }
    if (typeof b.governance.directProvisionLoad === "number") b.governance.directProvisionLoad = 0;
  }

  // DE: post-reunification, Aufbau Ost, pre-Schuldenbremse, pre-Maastricht
  if (b.economic) {
    if (typeof b.economic.eastWestConvergence === "number") b.economic.eastWestConvergence = 30;
    if (typeof b.economic.mittelstandHealth === "number") b.economic.mittelstandHealth = 55;
  }
  if (b.social) {
    if (typeof b.social.kitaCoverage === "number") b.social.kitaCoverage = 55;
    if (typeof b.social.wohnungsBauRate === "number") b.social.wohnungsBauRate = 5.5;
  }
  if (b.governance) {
    // Schuldenbremse (2009) is anachronistic in 1991 — but the field STAYS on
    // the doc (read-time-gate contract): it is budget-MIRRORED (fiscalMirror
    // re-derives it each turn) and the era gate hides it until its window.
    if (typeof b.governance.bundeswehrReadiness === "number") {
      b.governance.bundeswehrReadiness = 70;
    }
    if (typeof b.governance.rentenStabilitaet === "number") b.governance.rentenStabilitaet = 80;
    if (typeof b.governance.euCohesionScore === "number") b.governance.euCohesionScore = 85;
  }

  // CN: Deng-era reform, post-Tiananmen, pre-WTO, pre-Belt-Road, pre-social-credit
  if (b.economic) {
    if (typeof b.economic.commonProsperityIndex === "number") {
      b.economic.commonProsperityIndex = 30;
    }
    if (typeof b.economic.industrialPolicyExecution === "number") {
      b.economic.industrialPolicyExecution = 50;
    }
    if (typeof b.economic.eastWestRegionalGap === "number") {
      b.economic.eastWestRegionalGap = 65;
    }
  }
  if (b.social && typeof b.social.hukouMobility === "number") b.social.hukouMobility = 15;
  if (b.governance) {
    if (typeof b.governance.partyDiscipline === "number") b.governance.partyDiscipline = 75;
    if (typeof b.governance.socialCreditCoverage === "number") {
      b.governance.socialCreditCoverage = 0;
    }
    if (typeof b.governance.taiwanStraitTension === "number") {
      b.governance.taiwanStraitTension = 40;
    }
    if (typeof b.governance.beltAndRoadEngagement === "number") {
      b.governance.beltAndRoadEngagement = 0;
    }
  }

  return out;
}
