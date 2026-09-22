/**
 * 1979-era adjustments for `StateMetricBaseline` documents. Mirrors the
 * field-level anchors in `stateMetrics1979.ts` so freshly-seeded 1979
 * worlds have baselines aligned with the era-floored metric values
 * (zero decay pressure at game start).
 *
 * Applied at seed time by each country's `seedXBaselines` function
 * (and `runCoreSeed` for US) when the active preset is `1979-default`.
 *
 * Pattern mirrors `stateBaselines1953.ts` — deep-clone + field-level
 * shift, not a separately-curated baseline file. Pure: no DB, no Date.
 *
 * Field-level rules (each guarded by a presence check):
 *
 *   - infrastructure.broadbandAccess → 0 (internet did not exist in 1979).
 *   - mediaInformation.socialMediaSentiment → 0 (no platforms).
 *   - mediaInformation.disinformationRisk → clamped ≤10 (pre-cable-news,
 *     pre-viral; state propaganda exists but no amplification network).
 *   - mediaInformation.mediaPolarization → −15 (clamped 5..30; less
 *     cable/partisan echo chambers than 2019).
 *   - mediaInformation.pressFreedom → +5 (clamped 45..90; pre-tabloid
 *     wars, relatively trusted press corps).
 *   - mediaInformation.newsTrust → +10 (clamped 45..85; Watergate
 *     cynicism fading; pre-cable fragmentation).
 *   - economic.medianIncome → ×0.25 (1979 US nominal ~$15,900 vs 2019
 *     ~$65,000; ratio ≈25%).
 *   - economic.costOfLiving → ×0.25.
 *   - economic.povertyRate → +3pp (clamped 10..30; stagflation eroding
 *     real wages before Reagan-era cuts).
 *   - economic.gdpGrowth → +0.5pp (clamped −1..8; structurally higher
 *     despite 1979 stagflation).
 *   - healthcare.lifeExpectancy → −6 (clamped 45..76; US 1979 ≈ 73.9;
 *     developing-world countries lower).
 *   - healthcare.uninsuredRate → +8pp (clamped 10..55; employer-sponsored
 *     dominant, Medicare/Medicaid smaller than post-ACA; no ACA).
 *   - publicSafety.crimeRate → ×1.4 (1979 near peak — US crime peaked
 *     ~1980-1991; higher than the 2019 equilibrium).
 *   - publicSafety.violentCrimeRate → ×1.5.
 *   - publicSafety.incarcerationRate → ×0.5 (mass incarceration began
 *     in the 1980s; 1979 rates much lower than 2019).
 *   - population.urbanizationRate → ×0.88 (slightly less urban than 2019).
 *   - population.medianAge → −5 (clamped 18..38; baby boomers in
 *     workforce; high birth rates in developing countries).
 *   - population.populationGrowth → +0.3pp (clamped 0.2..3.0).
 *   - governance.debtToGdp → ×0.5 (clamped 10..80; US ≈33%, JP ≈30%,
 *     DE ≈26% — pre-Reagan/Thatcher structural deficits).
 *
 * Key differences from 1953:
 *   - medianIncome ×0.25 (vs 1953 ×0.06) — closer to modern
 *   - lifeExpectancy −6 (vs −10) — closer to modern
 *   - crimeRate ×1.4 (vs ×0.65) — 1979 was ABOVE modern baseline
 *   - incarcerationRate ×0.5 (vs ×0.35) — mass incarceration emerging
 *   - urbanizationRate ×0.88 (vs ×0.75) — more urbanised than 1953
 */

import type { StateMetricBaseline } from "@/lib/db/types";
import { getIncomeAnchor } from "@/lib/era/metricCatalog";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

// Income LEVEL comes from the authored era income-anchor table (the SSOT shared
// with era scoring); regional variation preserved via anchor(1979)/anchor(2019).
const INCOME_ANCHOR_RATIO_1979 = getIncomeAnchor("US", 1979)! / getIncomeAnchor("US", 2019)!;

export function applyEra1979BaselineAdjustments(
  baseline: StateMetricBaseline
): StateMetricBaseline {
  const out: StateMetricBaseline = deepClone(baseline);
  const b = out.baselines as Record<string, Record<string, number>> | undefined;
  if (!b) return out;

  // ── Economic ──────────────────────────────────────────────────────────────
  if (b.economic) {
    if (typeof b.economic.gdpGrowth === "number") {
      b.economic.gdpGrowth = clamp(b.economic.gdpGrowth + 0.5, -1, 8);
    }
    if (typeof b.economic.medianIncome === "number") {
      b.economic.medianIncome = Math.round(b.economic.medianIncome * INCOME_ANCHOR_RATIO_1979);
    }
    // costOfLiving is a 100-centered RELATIVE index (100 = national average) —
    // NOT a price level. Scaling it nominally seeded ~25 on a [70,165] band
    // (spec seed-reconciliation #3); the 2019 regional tilts remain era-valid.
    if (typeof b.economic.povertyRate === "number") {
      b.economic.povertyRate = clamp(b.economic.povertyRate + 3, 10, 30);
    }
  }

  // ── Healthcare ────────────────────────────────────────────────────────────
  if (b.healthcare) {
    if (typeof b.healthcare.lifeExpectancy === "number") {
      b.healthcare.lifeExpectancy = clamp(b.healthcare.lifeExpectancy - 6, 45, 76);
    }
    if (typeof b.healthcare.uninsuredRate === "number") {
      b.healthcare.uninsuredRate = clamp(b.healthcare.uninsuredRate + 8, 10, 55);
    }
  }

  // ── Infrastructure ────────────────────────────────────────────────────────
  if (b.infrastructure && typeof b.infrastructure.broadbandAccess === "number") {
    b.infrastructure.broadbandAccess = 0;
  }

  // ── Environment: windowed roots not yet in their era (climate framing is a
  // post-2000 window; renewables/recycling are already active by 1979) ───────
  if (b.environment) {
    if (typeof b.environment.climateResilience === "number") b.environment.climateResilience = 0;
    if (typeof b.environment.energyTransitionProgress === "number") {
      b.environment.energyTransitionProgress = 0;
    }
  }

  // ── Public Safety ─────────────────────────────────────────────────────────
  if (b.publicSafety) {
    if (typeof b.publicSafety.crimeRate === "number") {
      b.publicSafety.crimeRate = Math.round(b.publicSafety.crimeRate * 1.4);
    }
    if (typeof b.publicSafety.violentCrimeRate === "number") {
      b.publicSafety.violentCrimeRate = Math.round(b.publicSafety.violentCrimeRate * 1.5);
    }
    if (typeof b.publicSafety.incarcerationRate === "number") {
      b.publicSafety.incarcerationRate = Math.round(b.publicSafety.incarcerationRate * 0.5);
    }
  }

  // ── Population ────────────────────────────────────────────────────────────
  if (b.population) {
    if (typeof b.population.urbanizationRate === "number") {
      b.population.urbanizationRate = Math.round(b.population.urbanizationRate * 0.88);
    }
    if (typeof b.population.medianAge === "number") {
      b.population.medianAge = clamp(b.population.medianAge - 5, 18, 38);
    }
    if (typeof b.population.populationGrowth === "number") {
      b.population.populationGrowth = clamp(b.population.populationGrowth + 0.3, 0.2, 3.0);
    }
  }

  // ── Governance ────────────────────────────────────────────────────────────
  if (b.governance) {
    if (typeof b.governance.debtToGdp === "number") {
      b.governance.debtToGdp = clamp(b.governance.debtToGdp * 0.5, 10, 80);
    }
  }

  // ── Media / information environment ───────────────────────────────────────
  if (b.mediaInformation) {
    if (typeof b.mediaInformation.socialMediaSentiment === "number") {
      b.mediaInformation.socialMediaSentiment = 0;
    }
    if (typeof b.mediaInformation.disinformationRisk === "number") {
      b.mediaInformation.disinformationRisk = clamp(b.mediaInformation.disinformationRisk, 0, 10);
    }
    if (typeof b.mediaInformation.mediaPolarization === "number") {
      b.mediaInformation.mediaPolarization = clamp(
        b.mediaInformation.mediaPolarization - 15,
        5,
        30
      );
    }
    if (typeof b.mediaInformation.pressFreedom === "number") {
      b.mediaInformation.pressFreedom = clamp(b.mediaInformation.pressFreedom + 5, 45, 90);
    }
    if (typeof b.mediaInformation.newsTrust === "number") {
      b.mediaInformation.newsTrust = clamp(b.mediaInformation.newsTrust + 10, 45, 85);
    }
  }

  // ── Country-specific 1979 baseline adjustments ────────────────────────────
  // Each guarded by `!== undefined` so countries without these fields pass through.

  // IE: pre-Celtic-Tiger; agriculture-heavy; Church hegemony; low FDI; high emigration
  if (b.economic) {
    if (typeof b.economic.mncDependency === "number") b.economic.mncDependency = 8;
    if (typeof b.economic.gniStarGap === "number") b.economic.gniStarGap = 2;
    if (typeof b.economic.fdiPipelineStrength === "number") b.economic.fdiPipelineStrength = 15;
    if (typeof b.economic.capDependency === "number") b.economic.capDependency = 85;
  }
  if (b.healthcare) {
    if (typeof b.healthcare.slaintecareProgress === "number") b.healthcare.slaintecareProgress = 0;
    if (typeof b.healthcare.hseWaitingListMonths === "number") {
      b.healthcare.hseWaitingListMonths = 28;
    }
  }
  if (b.social) {
    if (typeof b.social.irishLanguageStrength === "number") b.social.irishLanguageStrength = 52;
    if (typeof b.social.housingCompletionsRate === "number") b.social.housingCompletionsRate = 3;
    if (typeof b.social.rentalPressureIndex === "number") b.social.rentalPressureIndex = 22;
  }
  if (b.governance) {
    if (typeof b.governance.unityReferendumSupport === "number") {
      b.governance.unityReferendumSupport = 18;
    }
    if (typeof b.governance.directProvisionLoad === "number") b.governance.directProvisionLoad = 0;
  }

  // DE: Schmidt/SPD-FDP; Ostpolitik; Wirtschaftswunder fading; no reunification yet
  if (b.economic) {
    if (typeof b.economic.eastWestConvergence === "number") b.economic.eastWestConvergence = 0;
    if (typeof b.economic.mittelstandHealth === "number") b.economic.mittelstandHealth = 72;
  }
  if (b.social) {
    if (typeof b.social.kitaCoverage === "number") b.social.kitaCoverage = 22;
    if (typeof b.social.wohnungsBauRate === "number") b.social.wohnungsBauRate = 4.5;
  }
  if (b.governance) {
    // Schuldenbremse (2009) is anachronistic in 1979 — but the field STAYS on
    // the doc (read-time-gate contract): it is budget-MIRRORED (fiscalMirror
    // re-derives it each turn) and the era gate hides it until its window.
    if (typeof b.governance.bundeswehrReadiness === "number") {
      b.governance.bundeswehrReadiness = 65; // Bundeswehr established 1955; NATO integrated
    }
    if (typeof b.governance.rentenStabilitaet === "number") b.governance.rentenStabilitaet = 80;
    if (typeof b.governance.euCohesionScore === "number") b.governance.euCohesionScore = 55; // EEC working
  }

  // CN: Deng Xiaoping era; Four Modernizations (1978); Cultural Revolution just ended
  if (b.economic) {
    if (typeof b.economic.commonProsperityIndex === "number") {
      b.economic.commonProsperityIndex = 25;
    }
    if (typeof b.economic.industrialPolicyExecution === "number") {
      b.economic.industrialPolicyExecution = 55; // early reform; less efficient than Soviet model
    }
    if (typeof b.economic.eastWestRegionalGap === "number") {
      b.economic.eastWestRegionalGap = 70;
    }
  }
  if (b.social && typeof b.social.hukouMobility === "number") b.social.hukouMobility = 8;
  if (b.governance) {
    if (typeof b.governance.partyDiscipline === "number") b.governance.partyDiscipline = 80;
    if (typeof b.governance.socialCreditCoverage === "number") {
      b.governance.socialCreditCoverage = 0; // system did not exist
    }
    if (typeof b.governance.taiwanStraitTension === "number") {
      b.governance.taiwanStraitTension = 45; // calmer than 1953; US-China normalisation 1979
    }
    if (typeof b.governance.beltAndRoadEngagement === "number") {
      b.governance.beltAndRoadEngagement = 0;
    }
  }

  return out;
}
