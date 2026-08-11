/**
 * 1991-era state metrics. Derives from the existing
 * `generateStateMetrics` pipeline but applies era-floor adjustments to
 * fields that didn't exist or were dramatically different in 1991:
 *
 *   - `infrastructure.broadbandAccess`: clamped to 0 (residential broadband
 *     effectively didn't exist in 1991; experimental cable-modem deployments
 *     began 1995).
 *   - `mediaInformation.socialMediaSentiment`: clamped to 0 (no platforms
 *     existed).
 *   - `mediaInformation.disinformationRisk`: clamped to ≤20 (pre-internet info
 *     environment).
 *   - `mediaInformation.mediaPolarization`: clamped to ≤35 (cable news
 *     polarization had not yet started; Fox News didn't launch until 1996).
 *   - `economic.unemploymentRate`: +1.5pp baseline shift to reflect the
 *     1990-91 recession.
 *   - `economic.gdpGrowth`: -2pp baseline shift (1991 US growth was -0.1%).
 *   - `publicSafety.crimeRate`: +35% (1991-1993 was the US crime-rate peak).
 *   - `publicSafety.violentCrimeRate`: +40%.
 *   - `publicSafety.incarcerationRate`: -25% (mass-incarceration ramp was
 *     mid-1990s on).
 *   - `population.urbanizationRate`: -3pp.
 *   - `population.medianAge`: -5.
 *   - `healthcare.lifeExpectancy`: -3.
 *   - `healthcare.uninsuredRate`: +4pp (pre-ACA, pre-1997 SCHIP).
 *   - `governance.voterTurnout`: +5pp.
 *   - `governance.debtToGdp`: ×0.5 (US debt was 60% in 1991 vs 130% today).
 *   - `mediaInformation.pressFreedom`, `newsTrust`: +10pp each.
 *   - All nominal-dollar fields (medianIncome, costOfLiving) scaled to 1991.
 */

import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import { stateMetrics as stateMetrics2020 } from "./stateMetrics";
import { getRegionPopulationAnchor } from "@/lib/seeds/populationAnchors";
import { getIncomeAnchor } from "@/lib/era/metricCatalog";
import type { CountryId } from "@/lib/constants/countries";

// Income LEVEL comes from the authored era income-anchor table (the SSOT shared
// with era scoring) — regional variation is preserved by scaling each region's
// modern seed by anchor(1991)/anchor(2019) instead of a hand-picked ratio.
const INCOME_ANCHOR_RATIO_1991 = getIncomeAnchor("US", 1991)! / getIncomeAnchor("US", 2019)!;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shift(value: StateMetricValue | undefined, fn: (v: number) => number): StateMetricValue {
  if (!value) return { value: fn(50) };
  return { ...value, value: fn(value.value) };
}

function applyEra1991Adjustments(metrics: StateMetrics): StateMetrics {
  // `structuredClone` (not a JSON round-trip) so `Date` fields like
  // `lastUpdated` survive as real Dates rather than being stringified — a
  // stringified timestamp crashes readers that call `.toISOString()`.
  const adjusted: StateMetrics = structuredClone(metrics);

  // Economic
  if (adjusted.economic) {
    adjusted.economic.unemploymentRate = shift(adjusted.economic.unemploymentRate, (v) =>
      clamp(v + 1.5, 4.5, 11.0)
    );
    adjusted.economic.gdpGrowth = shift(adjusted.economic.gdpGrowth, (v) =>
      clamp(v - 2.0, -2.5, 3.0)
    );
    adjusted.economic.medianIncome = shift(adjusted.economic.medianIncome, (v) =>
      Math.round(v * INCOME_ANCHOR_RATIO_1991)
    );
    // costOfLiving is a 100-centered RELATIVE index (100 = national average) —
    // NOT a price level; the 2019 regional tilts remain era-valid unscaled
    // (spec seed-reconciliation #3).
    adjusted.economic.povertyRate = shift(adjusted.economic.povertyRate, (v) =>
      clamp(v + 2.0, 8.0, 22.0)
    );
  }

  // Healthcare
  if (adjusted.healthcare) {
    adjusted.healthcare.lifeExpectancy = shift(adjusted.healthcare.lifeExpectancy, (v) =>
      clamp(v - 3.0, 70.0, 78.0)
    );
    if (adjusted.healthcare.uninsuredRate !== undefined) {
      adjusted.healthcare.uninsuredRate = shift(adjusted.healthcare.uninsuredRate, (v) =>
        clamp(v + 4.0, 10.0, 22.0)
      );
    }
  }

  // Infrastructure
  if (adjusted.infrastructure) {
    adjusted.infrastructure.broadbandAccess = { value: 0 };
  }

  // Public safety: 1991 was the US crime-rate peak
  if (adjusted.publicSafety) {
    adjusted.publicSafety.crimeRate = shift(adjusted.publicSafety.crimeRate, (v) =>
      Math.round(v * 1.35)
    );
    adjusted.publicSafety.violentCrimeRate = shift(adjusted.publicSafety.violentCrimeRate, (v) =>
      Math.round(v * 1.4)
    );
    adjusted.publicSafety.incarcerationRate = shift(adjusted.publicSafety.incarcerationRate, (v) =>
      Math.round(v * 0.75)
    );
  }

  // Population
  if (adjusted.population) {
    adjusted.population.urbanizationRate = shift(adjusted.population.urbanizationRate, (v) =>
      clamp(v - 3.0, 50.0, 100.0)
    );
    // Per-region 1991 anchor overrides the blanket medianAge shift and supplies birthRate
    // (which the blanket pass leaves at its 2019 value). No anchor → keep the blanket shift.
    const anchor = getRegionPopulationAnchor(
      adjusted.countryId as CountryId,
      String(adjusted._id),
      "1991-default"
    );
    adjusted.population.medianAge = anchor
      ? { value: anchor.medianAge }
      : shift(adjusted.population.medianAge, (v) => clamp(v - 5.0, 28.0, 40.0));
    if (anchor) adjusted.population.birthRate = { value: anchor.birthRate };
    adjusted.population.populationGrowth = shift(adjusted.population.populationGrowth, (v) =>
      clamp(v + 0.3, -0.5, 2.5)
    );
  }

  // Governance
  if (adjusted.governance) {
    adjusted.governance.voterTurnout = shift(adjusted.governance.voterTurnout, (v) =>
      clamp(v + 5.0, 45.0, 75.0)
    );
    if (adjusted.governance.debtToGdp !== undefined) {
      adjusted.governance.debtToGdp = shift(adjusted.governance.debtToGdp, (v) =>
        clamp(v * 0.5, 25.0, 70.0)
      );
    }
  }

  // Media / information environment
  if (adjusted.mediaInformation) {
    adjusted.mediaInformation.socialMediaSentiment = { value: 0 };
    adjusted.mediaInformation.disinformationRisk = shift(
      adjusted.mediaInformation.disinformationRisk,
      (v) => clamp(v, 0, 20)
    );
    adjusted.mediaInformation.mediaPolarization = shift(
      adjusted.mediaInformation.mediaPolarization,
      (v) => clamp(v - 15, 10, 35)
    );
    adjusted.mediaInformation.pressFreedom = shift(adjusted.mediaInformation.pressFreedom, (v) =>
      clamp(v + 10, 60, 95)
    );
    adjusted.mediaInformation.newsTrust = shift(adjusted.mediaInformation.newsTrust, (v) =>
      clamp(v + 10, 40, 80)
    );
  }

  // ── Country-specific 1991 adjustments ──────────────────────────────────
  // These guards (`!== undefined`) keep cross-country contamination out:
  // only countries that already seeded the field get the era override, so
  // we never accidentally invent country-specific fields on other countries.

  // IE-specific: pre-Celtic-Tiger, pre-Sláintecare, pre-HSE, pre-IPAS,
  // pre-Future-Ireland-Fund. Many of these themes didn't exist in 1991.
  if (adjusted.economic.mncDependency !== undefined) {
    adjusted.economic.mncDependency = shift(adjusted.economic.mncDependency, () => 15);
  }
  if (adjusted.economic.gniStarGap !== undefined) {
    adjusted.economic.gniStarGap = shift(adjusted.economic.gniStarGap, () => 5);
  }
  if (adjusted.economic.fdiPipelineStrength !== undefined) {
    adjusted.economic.fdiPipelineStrength = shift(adjusted.economic.fdiPipelineStrength, () => 30);
  }
  if (adjusted.economic.capDependency !== undefined) {
    adjusted.economic.capDependency = shift(adjusted.economic.capDependency, () => 85);
  }
  if (adjusted.healthcare.slaintecareProgress !== undefined) {
    adjusted.healthcare.slaintecareProgress = shift(
      adjusted.healthcare.slaintecareProgress,
      () => 0
    );
  }
  if (adjusted.healthcare.hseWaitingListMonths !== undefined) {
    adjusted.healthcare.hseWaitingListMonths = shift(
      adjusted.healthcare.hseWaitingListMonths,
      () => 24
    );
  }
  if (adjusted.environment.agriEmissionsShare !== undefined) {
    adjusted.environment.agriEmissionsShare = shift(
      adjusted.environment.agriEmissionsShare,
      () => 42
    );
  }
  if (adjusted.social.housingCompletionsRate !== undefined) {
    adjusted.social.housingCompletionsRate = shift(adjusted.social.housingCompletionsRate, () => 4);
  }
  if (adjusted.social.vacantPropertyRate !== undefined) {
    adjusted.social.vacantPropertyRate = shift(adjusted.social.vacantPropertyRate, () => 18);
  }
  if (adjusted.social.rentalPressureIndex !== undefined) {
    adjusted.social.rentalPressureIndex = shift(adjusted.social.rentalPressureIndex, () => 40);
  }
  if (adjusted.social.irishLanguageStrength !== undefined) {
    adjusted.social.irishLanguageStrength = shift(adjusted.social.irishLanguageStrength, () => 48);
  }
  if (adjusted.governance.unityReferendumSupport !== undefined) {
    adjusted.governance.unityReferendumSupport = shift(
      adjusted.governance.unityReferendumSupport,
      () => 28
    );
  }
  if (adjusted.governance.directProvisionLoad !== undefined) {
    adjusted.governance.directProvisionLoad = shift(
      adjusted.governance.directProvisionLoad,
      () => 0
    );
  }
  // DE-specific: post-reunification, Aufbau Ost, pre-Schuldenbremse,
  // pre-Maastricht. Convergence low, Mittelstand split E/W, EU cohesion peak.
  if (adjusted.economic.eastWestConvergence !== undefined) {
    adjusted.economic.eastWestConvergence = shift(adjusted.economic.eastWestConvergence, () => 30);
  }
  if (adjusted.economic.mittelstandHealth !== undefined) {
    adjusted.economic.mittelstandHealth = shift(adjusted.economic.mittelstandHealth, () => 55);
  }
  if (adjusted.social.kitaCoverage !== undefined) {
    adjusted.social.kitaCoverage = shift(adjusted.social.kitaCoverage, () => 55);
  }
  if (adjusted.social.wohnungsBauRate !== undefined) {
    adjusted.social.wohnungsBauRate = shift(adjusted.social.wohnungsBauRate, () => 5.5);
  }
  // Schuldenbremse (Art. 109 GG) was constitutionalized in 2009 — anachronistic
  // in a 1991 world, but the field STAYS on the doc (read-time-gate contract):
  // the era window (from 2009) hides it from display and approval, and the
  // budget-sync fiscalMirror re-derives its value era-consistently each turn.
  if (adjusted.governance.bundeswehrReadiness !== undefined) {
    adjusted.governance.bundeswehrReadiness = shift(
      adjusted.governance.bundeswehrReadiness,
      () => 70
    );
  }
  if (adjusted.governance.rentenStabilitaet !== undefined) {
    adjusted.governance.rentenStabilitaet = shift(adjusted.governance.rentenStabilitaet, () => 80);
  }
  if (adjusted.governance.euCohesionScore !== undefined) {
    adjusted.governance.euCohesionScore = shift(adjusted.governance.euCohesionScore, () => 85);
  }

  // CN-specific: Deng-era reform, post-Tiananmen, pre-WTO, pre-Belt-Road,
  // pre-social-credit. Hukou tightly controlled, East-coast SEZs surging.
  if (adjusted.economic.commonProsperityIndex !== undefined) {
    adjusted.economic.commonProsperityIndex = shift(
      adjusted.economic.commonProsperityIndex,
      () => 30
    );
  }
  if (adjusted.economic.industrialPolicyExecution !== undefined) {
    adjusted.economic.industrialPolicyExecution = shift(
      adjusted.economic.industrialPolicyExecution,
      () => 50
    );
  }
  if (adjusted.economic.eastWestRegionalGap !== undefined) {
    adjusted.economic.eastWestRegionalGap = shift(adjusted.economic.eastWestRegionalGap, () => 65);
  }
  if (adjusted.social.hukouMobility !== undefined) {
    adjusted.social.hukouMobility = shift(adjusted.social.hukouMobility, () => 15);
  }
  if (adjusted.governance.partyDiscipline !== undefined) {
    adjusted.governance.partyDiscipline = shift(adjusted.governance.partyDiscipline, () => 75);
  }
  if (adjusted.governance.socialCreditCoverage !== undefined) {
    adjusted.governance.socialCreditCoverage = shift(
      adjusted.governance.socialCreditCoverage,
      () => 0
    );
  }
  if (adjusted.governance.taiwanStraitTension !== undefined) {
    adjusted.governance.taiwanStraitTension = shift(
      adjusted.governance.taiwanStraitTension,
      () => 40
    );
  }
  if (adjusted.governance.beltAndRoadEngagement !== undefined) {
    adjusted.governance.beltAndRoadEngagement = shift(
      adjusted.governance.beltAndRoadEngagement,
      () => 0
    );
  }

  return adjusted;
}

export const stateMetrics1991: StateMetrics[] = stateMetrics2020.map(applyEra1991Adjustments);

export { applyEra1991Adjustments };
