import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

function mv(value: number, trend?: number) {
  return { value, trend };
}

/**
 * UK region metrics — unique per region, calibrated to ONS / UK Census 2021 data.
 *
 * Key structural differences from the US baseline:
 *   - incarcerationRate: ~140 per 100k (much lower than US ~600)
 *   - crimeRate / violentCrimeRate: calibrated to ONS Crime Survey (England & Wales)
 *     and Scotland/NI equivalents; uses crimes per 100k population
 *   - educationSpending: per-pupil spend in GBP
 *   - medianIncome: annual gross median household income in GBP
 *   - gdpGrowth: regional GVA growth rate (ONS Regional Economic Indicators)
 *   - costOfLiving: index relative to UK mean (100 = UK average)
 *   - urbanizationRate: % living in urban areas (ONS definition)
 *   - renewableEnergy: % of regional electricity from renewables (BEIS)
 *
 * All figures are approximate 2021-era estimates.
 */
const ukStateMetricsBase: StateMetrics[] = [
  // ── London ─────────────────────────────────────────────────────────────────
  {
    _id: "LON",
    economic: {
      unemploymentRate: mv(4.5),
      medianIncome: mv(42000),
      gdpGrowth: mv(2.2),
      povertyRate: mv(20), // Higher poverty in London due to housing costs
      costOfLiving: mv(145), // Far above UK mean
      smallBusinessFormation: mv(7.2),
      propertyValueIndex: mv(160), // Well above baseline — London premium
      commercialValueIndex: mv(155),
    },
    education: {
      testPerformance: mv(105),
      educationSpending: mv(8500), // Per-pupil GBP
      literacyRate: mv(91),
      workforceSkill: mv(72),
      gcseAttainment: mv(68), // Above national avg despite deprivation mix
      universityEnrollment: mv(55),
      apprenticeshipRate: mv(1.8),
    },
    healthcare: {
      physicianRate: mv(3.2),
      lifeExpectancy: mv(81.5),
      preventableMortality: mv(260),
      publicHealthPreparedness: mv(78),
      nhsWaitingTime: mv(22), // Longer waits in London (weeks)
      mentalHealthAccess: mv(38),
      socialCareQuality: mv(48),
    },
    infrastructure: {
      roadCondition: mv(60), // Heavy congestion, older road stock
      broadbandAccess: mv(97),
      publicTransit: mv(92), // Best public transit in UK
      waterQuality: mv(94),
      powerGridReliability: mv(99.6),
      infrastructureInvestmentGap: mv(18),
    },
    publicSafety: {
      crimeRate: mv(8700), // Higher total crime rate (ONS Metro Police)
      violentCrimeRate: mv(450),
      policePerCapita: mv(3.8),
      incarcerationRate: mv(155),
      recidivismRate: mv(40),
      publicSafetyConfidence: mv(58),
      antiSocialBehaviourRate: mv(12), // High density urban — above national avg
      knifeCrimeRate: mv(6.5), // London has highest knife crime rate in UK
    },
    environment: {
      airQuality: mv(55), // Worse air quality — high traffic/density
      renewableEnergy: mv(22),
      carbonEmissions: mv(18),
      recyclingRate: mv(38), // Lower household recycling in dense urban
      climateResilience: mv(60),
      protectedLand: mv(5),
      floodRisk: mv(15), // Thames flood risk — significant infrastructure
    },
    social: {
      socialMobility: mv(55),
      incomeInequality: mv(46), // Highest inequality — Gini
      homelessnessRate: mv(22), // Highest rough sleeping per 100k
      foodInsecurity: mv(14),
      civicParticipation: mv(58),
      socialCohesion: mv(52),
      childPoverty: mv(37), // Highest child poverty rate in UK
      housingAffordability: mv(14.0), // 14x income ratio — extreme
      roughSleeping: mv(6.0), // Highest rough sleeping per 100k
    },
    governance: {
      governmentTransparency: mv(70),
      budgetBalance: mv(-0.8),
      corruptionIndex: mv(30),
      voterTurnout: mv(60), // Below national avg — large non-voter population
      publicTrust: mv(48),
      devolutionSatisfaction: mv(55), // GLA devolution broadly supported
    },
    population: {
      populationGrowth: mv(0.9),
      urbanizationRate: mv(100), // 100% urban by ONS definition
      medianAge: mv(36.5), // Youngest region
      migrationRate: mv(1.8), // Highest net inward migration
    },
    mediaInformation: {
      mediaPolarization: mv(48),
      disinformationRisk: mv(40),
      pressFreedom: mv(80),
      socialMediaSentiment: mv(3),
      newsTrust: mv(44),
      bbcTrust: mv(52),
    },
    lastUpdated: new Date(),
  },

  // ── South East England ─────────────────────────────────────────────────────
  {
    _id: "SEE",
    economic: {
      unemploymentRate: mv(3.2),
      medianIncome: mv(35000),
      gdpGrowth: mv(1.8),
      povertyRate: mv(12),
      costOfLiving: mv(120),
      smallBusinessFormation: mv(5.8),
      propertyValueIndex: mv(130),
      commercialValueIndex: mv(115),
    },
    education: {
      testPerformance: mv(108),
      educationSpending: mv(7200),
      literacyRate: mv(94),
      workforceSkill: mv(68),
      gcseAttainment: mv(68),
      universityEnrollment: mv(43),
      apprenticeshipRate: mv(2.2),
    },
    healthcare: {
      physicianRate: mv(2.9),
      lifeExpectancy: mv(82.2),
      preventableMortality: mv(240),
      publicHealthPreparedness: mv(72),
      nhsWaitingTime: mv(17),
      mentalHealthAccess: mv(42),
      socialCareQuality: mv(54),
    },
    infrastructure: {
      roadCondition: mv(70),
      broadbandAccess: mv(96),
      publicTransit: mv(72),
      waterQuality: mv(96),
      powerGridReliability: mv(99.8),
      infrastructureInvestmentGap: mv(20),
    },
    publicSafety: {
      crimeRate: mv(5800),
      violentCrimeRate: mv(290),
      policePerCapita: mv(2.5),
      incarcerationRate: mv(138),
      recidivismRate: mv(37),
      publicSafetyConfidence: mv(70),
      antiSocialBehaviourRate: mv(7.0),
      knifeCrimeRate: mv(2.5),
    },
    environment: {
      airQuality: mv(38),
      renewableEnergy: mv(32),
      carbonEmissions: mv(12),
      recyclingRate: mv(50),
      climateResilience: mv(68),
      protectedLand: mv(30), // High AONB / National Park coverage
      floodRisk: mv(12), // Thames estuary and low-lying coastal areas
    },
    social: {
      socialMobility: mv(56),
      incomeInequality: mv(38),
      homelessnessRate: mv(7),
      foodInsecurity: mv(9),
      civicParticipation: mv(62),
      socialCohesion: mv(65),
      childPoverty: mv(25),
      housingAffordability: mv(10.0),
      roughSleeping: mv(2.0),
    },
    governance: {
      governmentTransparency: mv(70),
      budgetBalance: mv(-1.0),
      corruptionIndex: mv(30),
      voterTurnout: mv(70),
      publicTrust: mv(55),
      devolutionSatisfaction: mv(48),
    },
    population: {
      populationGrowth: mv(0.6),
      urbanizationRate: mv(72),
      medianAge: mv(41.5),
      migrationRate: mv(0.5),
    },
    mediaInformation: {
      mediaPolarization: mv(40),
      disinformationRisk: mv(35),
      pressFreedom: mv(80),
      socialMediaSentiment: mv(6),
      newsTrust: mv(50),
      bbcTrust: mv(56),
    },
    lastUpdated: new Date(),
  },

  // ── South West England ─────────────────────────────────────────────────────
  {
    _id: "SWE",
    economic: {
      unemploymentRate: mv(3.8),
      medianIncome: mv(29000),
      gdpGrowth: mv(1.5),
      povertyRate: mv(14),
      costOfLiving: mv(108),
      smallBusinessFormation: mv(5.0),
      propertyValueIndex: mv(108),
      commercialValueIndex: mv(100),
    },
    education: {
      testPerformance: mv(103),
      educationSpending: mv(6900),
      literacyRate: mv(93),
      workforceSkill: mv(60),
      gcseAttainment: mv(66),
      universityEnrollment: mv(38),
      apprenticeshipRate: mv(2.2),
    },
    healthcare: {
      physicianRate: mv(2.7),
      lifeExpectancy: mv(82.0),
      preventableMortality: mv(250),
      publicHealthPreparedness: mv(68),
      nhsWaitingTime: mv(18),
      mentalHealthAccess: mv(40),
      socialCareQuality: mv(52),
    },
    infrastructure: {
      roadCondition: mv(68),
      broadbandAccess: mv(90), // Lower rural broadband penetration
      publicTransit: mv(52), // More car-dependent
      waterQuality: mv(97),
      powerGridReliability: mv(99.5),
      infrastructureInvestmentGap: mv(25),
    },
    publicSafety: {
      crimeRate: mv(4800),
      violentCrimeRate: mv(250),
      policePerCapita: mv(2.2),
      incarcerationRate: mv(128),
      recidivismRate: mv(35),
      publicSafetyConfidence: mv(74),
      antiSocialBehaviourRate: mv(6.5),
      knifeCrimeRate: mv(2.0),
    },
    environment: {
      airQuality: mv(28), // Best air quality in England
      renewableEnergy: mv(38), // Good wind/solar in Cornwall/Devon
      carbonEmissions: mv(10),
      recyclingRate: mv(54),
      climateResilience: mv(65), // Coastal flood risk
      protectedLand: mv(38), // Dartmoor, Exmoor, AONB
      floodRisk: mv(14), // Significant coastal and river flooding
    },
    social: {
      socialMobility: mv(48),
      incomeInequality: mv(36),
      homelessnessRate: mv(7),
      foodInsecurity: mv(10),
      civicParticipation: mv(64),
      socialCohesion: mv(70),
      childPoverty: mv(27),
      housingAffordability: mv(8.5),
      roughSleeping: mv(2.2),
    },
    governance: {
      governmentTransparency: mv(68),
      budgetBalance: mv(-1.8),
      corruptionIndex: mv(28),
      voterTurnout: mv(68),
      publicTrust: mv(57),
      devolutionSatisfaction: mv(46),
    },
    population: {
      populationGrowth: mv(0.4),
      urbanizationRate: mv(52),
      medianAge: mv(44.5), // Older population — retirement migration
      migrationRate: mv(0.2),
    },
    mediaInformation: {
      mediaPolarization: mv(36),
      disinformationRisk: mv(34),
      pressFreedom: mv(79),
      socialMediaSentiment: mv(7),
      newsTrust: mv(53),
      bbcTrust: mv(58),
    },
    lastUpdated: new Date(),
  },

  // ── East of England ────────────────────────────────────────────────────────
  {
    _id: "EAE",
    economic: {
      unemploymentRate: mv(3.5),
      medianIncome: mv(32000),
      gdpGrowth: mv(1.7),
      povertyRate: mv(13),
      costOfLiving: mv(112),
      smallBusinessFormation: mv(5.2),
      propertyValueIndex: mv(115),
      commercialValueIndex: mv(105),
    },
    education: {
      testPerformance: mv(104),
      educationSpending: mv(7000),
      literacyRate: mv(93),
      workforceSkill: mv(64),
      gcseAttainment: mv(66),
      universityEnrollment: mv(40),
      apprenticeshipRate: mv(2.1),
    },
    healthcare: {
      physicianRate: mv(2.7),
      lifeExpectancy: mv(82.1),
      preventableMortality: mv(245),
      publicHealthPreparedness: mv(70),
      nhsWaitingTime: mv(18),
      mentalHealthAccess: mv(41),
      socialCareQuality: mv(52),
    },
    infrastructure: {
      roadCondition: mv(72),
      broadbandAccess: mv(92),
      publicTransit: mv(58),
      waterQuality: mv(96),
      powerGridReliability: mv(99.7),
      infrastructureInvestmentGap: mv(22),
    },
    publicSafety: {
      crimeRate: mv(5100),
      violentCrimeRate: mv(265),
      policePerCapita: mv(2.3),
      incarcerationRate: mv(132),
      recidivismRate: mv(36),
      publicSafetyConfidence: mv(71),
      antiSocialBehaviourRate: mv(7.0),
      knifeCrimeRate: mv(2.2),
    },
    environment: {
      airQuality: mv(32),
      renewableEnergy: mv(42), // Strong wind (offshore East Anglia)
      carbonEmissions: mv(11),
      recyclingRate: mv(52),
      climateResilience: mv(60), // Flat — significant flood risk
      protectedLand: mv(22),
      floodRisk: mv(18), // Flat terrain — highest flood risk outside London
    },
    social: {
      socialMobility: mv(52),
      incomeInequality: mv(37),
      homelessnessRate: mv(7),
      foodInsecurity: mv(10),
      civicParticipation: mv(62),
      socialCohesion: mv(66),
      childPoverty: mv(26),
      housingAffordability: mv(9.0),
      roughSleeping: mv(2.0),
    },
    governance: {
      governmentTransparency: mv(68),
      budgetBalance: mv(-1.2),
      corruptionIndex: mv(29),
      voterTurnout: mv(68),
      publicTrust: mv(54),
      devolutionSatisfaction: mv(47),
    },
    population: {
      populationGrowth: mv(0.5),
      urbanizationRate: mv(62),
      medianAge: mv(42.5),
      migrationRate: mv(0.4),
    },
    mediaInformation: {
      mediaPolarization: mv(38),
      disinformationRisk: mv(36),
      pressFreedom: mv(79),
      socialMediaSentiment: mv(6),
      newsTrust: mv(51),
      bbcTrust: mv(56),
    },
    lastUpdated: new Date(),
  },

  // ── East Midlands ──────────────────────────────────────────────────────────
  {
    _id: "EMI",
    economic: {
      unemploymentRate: mv(4.2),
      medianIncome: mv(28000),
      gdpGrowth: mv(1.6),
      povertyRate: mv(16),
      costOfLiving: mv(100), // Near UK average
      smallBusinessFormation: mv(4.2),
      propertyValueIndex: mv(98),
      commercialValueIndex: mv(95),
    },
    education: {
      testPerformance: mv(100),
      educationSpending: mv(6600),
      literacyRate: mv(91),
      workforceSkill: mv(57),
      gcseAttainment: mv(64),
      universityEnrollment: mv(37),
      apprenticeshipRate: mv(2.1),
    },
    healthcare: {
      physicianRate: mv(2.5),
      lifeExpectancy: mv(80.8),
      preventableMortality: mv(285),
      publicHealthPreparedness: mv(66),
      nhsWaitingTime: mv(19),
      mentalHealthAccess: mv(39),
      socialCareQuality: mv(49),
    },
    infrastructure: {
      roadCondition: mv(70),
      broadbandAccess: mv(91),
      publicTransit: mv(55),
      waterQuality: mv(95),
      powerGridReliability: mv(99.6),
      infrastructureInvestmentGap: mv(26),
    },
    publicSafety: {
      crimeRate: mv(5600),
      violentCrimeRate: mv(310),
      policePerCapita: mv(2.2),
      incarcerationRate: mv(142),
      recidivismRate: mv(39),
      publicSafetyConfidence: mv(66),
      antiSocialBehaviourRate: mv(8.0),
      knifeCrimeRate: mv(2.8),
    },
    environment: {
      airQuality: mv(38),
      renewableEnergy: mv(25),
      carbonEmissions: mv(15), // Nottingham / Derby industrial legacy
      recyclingRate: mv(46),
      climateResilience: mv(64),
      protectedLand: mv(20),
      floodRisk: mv(10),
    },
    social: {
      socialMobility: mv(50),
      incomeInequality: mv(35),
      homelessnessRate: mv(8),
      foodInsecurity: mv(12),
      civicParticipation: mv(55),
      socialCohesion: mv(60),
      childPoverty: mv(28),
      housingAffordability: mv(7.5),
      roughSleeping: mv(2.2),
    },
    governance: {
      governmentTransparency: mv(66),
      budgetBalance: mv(-1.8),
      corruptionIndex: mv(32),
      voterTurnout: mv(65),
      publicTrust: mv(50),
      devolutionSatisfaction: mv(48),
    },
    population: {
      populationGrowth: mv(0.4),
      urbanizationRate: mv(62),
      medianAge: mv(41.0),
      migrationRate: mv(0.3),
    },
    mediaInformation: {
      mediaPolarization: mv(42),
      disinformationRisk: mv(40),
      pressFreedom: mv(77),
      socialMediaSentiment: mv(5),
      newsTrust: mv(48),
      bbcTrust: mv(54),
    },
    lastUpdated: new Date(),
  },

  // ── West Midlands ──────────────────────────────────────────────────────────
  {
    _id: "WMI",
    economic: {
      unemploymentRate: mv(5.2), // Higher — Birmingham, Wolverhampton deindustrialisation
      medianIncome: mv(27500),
      gdpGrowth: mv(1.5),
      povertyRate: mv(18),
      costOfLiving: mv(102),
      smallBusinessFormation: mv(4.0),
      propertyValueIndex: mv(96),
      commercialValueIndex: mv(92),
    },
    education: {
      testPerformance: mv(98),
      educationSpending: mv(6800),
      literacyRate: mv(90),
      workforceSkill: mv(55),
      gcseAttainment: mv(63),
      universityEnrollment: mv(38),
      apprenticeshipRate: mv(2.0),
    },
    healthcare: {
      physicianRate: mv(2.4),
      lifeExpectancy: mv(80.2),
      preventableMortality: mv(295),
      publicHealthPreparedness: mv(64),
      nhsWaitingTime: mv(20),
      mentalHealthAccess: mv(38),
      socialCareQuality: mv(47),
    },
    infrastructure: {
      roadCondition: mv(66),
      broadbandAccess: mv(92),
      publicTransit: mv(62), // West Midlands Metro, Midlands Rail Hub
      waterQuality: mv(94),
      powerGridReliability: mv(99.5),
      infrastructureInvestmentGap: mv(28),
    },
    publicSafety: {
      crimeRate: mv(7200), // Second-highest in England — Birmingham effect
      violentCrimeRate: mv(400),
      policePerCapita: mv(2.8),
      incarcerationRate: mv(155),
      recidivismRate: mv(42),
      publicSafetyConfidence: mv(60),
      antiSocialBehaviourRate: mv(10.0),
      knifeCrimeRate: mv(4.5),
    },
    environment: {
      airQuality: mv(44),
      renewableEnergy: mv(22),
      carbonEmissions: mv(16),
      recyclingRate: mv(43),
      climateResilience: mv(62),
      protectedLand: mv(12),
      floodRisk: mv(8),
    },
    social: {
      socialMobility: mv(46),
      incomeInequality: mv(36),
      homelessnessRate: mv(10),
      foodInsecurity: mv(14),
      civicParticipation: mv(52),
      socialCohesion: mv(55),
      childPoverty: mv(33),
      housingAffordability: mv(7.5),
      roughSleeping: mv(3.0),
    },
    governance: {
      governmentTransparency: mv(64),
      budgetBalance: mv(-2.0),
      corruptionIndex: mv(34),
      voterTurnout: mv(62),
      publicTrust: mv(48),
      devolutionSatisfaction: mv(50),
    },
    population: {
      populationGrowth: mv(0.5),
      urbanizationRate: mv(78),
      medianAge: mv(38.5), // Younger — large diverse population
      migrationRate: mv(0.5),
    },
    mediaInformation: {
      mediaPolarization: mv(44),
      disinformationRisk: mv(42),
      pressFreedom: mv(76),
      socialMediaSentiment: mv(4),
      newsTrust: mv(46),
      bbcTrust: mv(53),
    },
    lastUpdated: new Date(),
  },

  // ── Yorkshire & the Humber ─────────────────────────────────────────────────
  {
    _id: "YHU",
    economic: {
      unemploymentRate: mv(4.8),
      medianIncome: mv(27000),
      gdpGrowth: mv(1.4),
      povertyRate: mv(17),
      costOfLiving: mv(98), // Below UK average
      smallBusinessFormation: mv(3.9),
      propertyValueIndex: mv(90),
      commercialValueIndex: mv(88),
    },
    education: {
      testPerformance: mv(99),
      educationSpending: mv(6500),
      literacyRate: mv(91),
      workforceSkill: mv(56),
      gcseAttainment: mv(63),
      universityEnrollment: mv(36),
      apprenticeshipRate: mv(2.1),
    },
    healthcare: {
      physicianRate: mv(2.4),
      lifeExpectancy: mv(80.5),
      preventableMortality: mv(290),
      publicHealthPreparedness: mv(65),
      nhsWaitingTime: mv(19),
      mentalHealthAccess: mv(39),
      socialCareQuality: mv(49),
    },
    infrastructure: {
      roadCondition: mv(67),
      broadbandAccess: mv(90),
      publicTransit: mv(58),
      waterQuality: mv(95),
      powerGridReliability: mv(99.5),
      infrastructureInvestmentGap: mv(27),
    },
    publicSafety: {
      crimeRate: mv(5900),
      violentCrimeRate: mv(330),
      policePerCapita: mv(2.3),
      incarcerationRate: mv(145),
      recidivismRate: mv(40),
      publicSafetyConfidence: mv(64),
      antiSocialBehaviourRate: mv(9.0),
      knifeCrimeRate: mv(3.2),
    },
    environment: {
      airQuality: mv(36),
      renewableEnergy: mv(30), // Strong Pennine wind
      carbonEmissions: mv(14),
      recyclingRate: mv(47),
      climateResilience: mv(63),
      protectedLand: mv(25), // Yorkshire Dales, North York Moors
      floodRisk: mv(12), // River Ouse, Aire — recurring flood events
    },
    social: {
      socialMobility: mv(48),
      incomeInequality: mv(35),
      homelessnessRate: mv(8),
      foodInsecurity: mv(13),
      civicParticipation: mv(54),
      socialCohesion: mv(60),
      childPoverty: mv(30),
      housingAffordability: mv(7.0),
      roughSleeping: mv(2.5),
    },
    governance: {
      governmentTransparency: mv(65),
      budgetBalance: mv(-2.0),
      corruptionIndex: mv(33),
      voterTurnout: mv(63),
      publicTrust: mv(49),
      devolutionSatisfaction: mv(52),
    },
    population: {
      populationGrowth: mv(0.3),
      urbanizationRate: mv(68),
      medianAge: mv(40.5),
      migrationRate: mv(0.2),
    },
    mediaInformation: {
      mediaPolarization: mv(43),
      disinformationRisk: mv(41),
      pressFreedom: mv(77),
      socialMediaSentiment: mv(5),
      newsTrust: mv(48),
      bbcTrust: mv(55),
    },
    lastUpdated: new Date(),
  },

  // ── North West England ─────────────────────────────────────────────────────
  {
    _id: "NWE",
    economic: {
      unemploymentRate: mv(5.0),
      medianIncome: mv(27500),
      gdpGrowth: mv(1.5),
      povertyRate: mv(18),
      costOfLiving: mv(99),
      smallBusinessFormation: mv(4.1),
      propertyValueIndex: mv(92),
      commercialValueIndex: mv(90),
    },
    education: {
      testPerformance: mv(100),
      educationSpending: mv(6700),
      literacyRate: mv(91),
      workforceSkill: mv(57),
      gcseAttainment: mv(63),
      universityEnrollment: mv(38),
      apprenticeshipRate: mv(2.0),
    },
    healthcare: {
      physicianRate: mv(2.5),
      lifeExpectancy: mv(80.3),
      preventableMortality: mv(288),
      publicHealthPreparedness: mv(66),
      nhsWaitingTime: mv(20),
      mentalHealthAccess: mv(39),
      socialCareQuality: mv(48),
    },
    infrastructure: {
      roadCondition: mv(67),
      broadbandAccess: mv(93),
      publicTransit: mv(70), // Metrolink Manchester, Merseyrail
      waterQuality: mv(95),
      powerGridReliability: mv(99.6),
      infrastructureInvestmentGap: mv(26),
    },
    publicSafety: {
      crimeRate: mv(6100),
      violentCrimeRate: mv(345),
      policePerCapita: mv(2.6),
      incarcerationRate: mv(148),
      recidivismRate: mv(40),
      publicSafetyConfidence: mv(63),
      antiSocialBehaviourRate: mv(9.5),
      knifeCrimeRate: mv(3.5),
    },
    environment: {
      airQuality: mv(40),
      renewableEnergy: mv(28),
      carbonEmissions: mv(15),
      recyclingRate: mv(44),
      climateResilience: mv(62),
      protectedLand: mv(20), // Lake District (edge), Forest of Bowland
      floodRisk: mv(11),
    },
    social: {
      socialMobility: mv(48),
      incomeInequality: mv(36),
      homelessnessRate: mv(10),
      foodInsecurity: mv(13),
      civicParticipation: mv(53),
      socialCohesion: mv(58),
      childPoverty: mv(32),
      housingAffordability: mv(7.0),
      roughSleeping: mv(2.8),
    },
    governance: {
      governmentTransparency: mv(65),
      budgetBalance: mv(-2.0),
      corruptionIndex: mv(33),
      voterTurnout: mv(63),
      publicTrust: mv(49),
      devolutionSatisfaction: mv(54), // Greater Manchester / Liverpool City Region
    },
    population: {
      populationGrowth: mv(0.3),
      urbanizationRate: mv(78),
      medianAge: mv(39.5),
      migrationRate: mv(0.3),
    },
    mediaInformation: {
      mediaPolarization: mv(44),
      disinformationRisk: mv(41),
      pressFreedom: mv(77),
      socialMediaSentiment: mv(5),
      newsTrust: mv(47),
      bbcTrust: mv(54),
    },
    lastUpdated: new Date(),
  },

  // ── North East England ─────────────────────────────────────────────────────
  {
    _id: "NEE",
    economic: {
      unemploymentRate: mv(6.5), // Highest in England
      medianIncome: mv(24500), // Lowest in England
      gdpGrowth: mv(1.2),
      povertyRate: mv(22),
      costOfLiving: mv(92), // Below UK average
      smallBusinessFormation: mv(3.2),
      propertyValueIndex: mv(80),
      commercialValueIndex: mv(78),
    },
    education: {
      testPerformance: mv(96),
      educationSpending: mv(6400),
      literacyRate: mv(90),
      workforceSkill: mv(52),
      gcseAttainment: mv(61),
      universityEnrollment: mv(33),
      apprenticeshipRate: mv(2.2), // Higher apprenticeship take-up in industrial regions
    },
    healthcare: {
      physicianRate: mv(2.3),
      lifeExpectancy: mv(79.5), // Below UK average (ONS 2020)
      preventableMortality: mv(320),
      publicHealthPreparedness: mv(63),
      nhsWaitingTime: mv(21),
      mentalHealthAccess: mv(37),
      socialCareQuality: mv(46),
    },
    infrastructure: {
      roadCondition: mv(65),
      broadbandAccess: mv(88),
      publicTransit: mv(55), // Tyne and Wear Metro
      waterQuality: mv(94),
      powerGridReliability: mv(99.4),
      infrastructureInvestmentGap: mv(30),
    },
    publicSafety: {
      crimeRate: mv(5500),
      violentCrimeRate: mv(310),
      policePerCapita: mv(2.2),
      incarcerationRate: mv(145),
      recidivismRate: mv(41),
      publicSafetyConfidence: mv(65),
      antiSocialBehaviourRate: mv(9.5),
      knifeCrimeRate: mv(2.8),
    },
    environment: {
      airQuality: mv(34),
      renewableEnergy: mv(35), // Offshore wind (Dogger Bank area)
      carbonEmissions: mv(13),
      recyclingRate: mv(44),
      climateResilience: mv(62),
      protectedLand: mv(22), // Northumberland National Park
      floodRisk: mv(9),
    },
    social: {
      socialMobility: mv(44), // Lowest social mobility in England
      incomeInequality: mv(34),
      homelessnessRate: mv(8),
      foodInsecurity: mv(16),
      civicParticipation: mv(52),
      socialCohesion: mv(62), // Relatively high community cohesion
      childPoverty: mv(35),
      housingAffordability: mv(5.5), // More affordable — lower incomes, lower prices
      roughSleeping: mv(2.0),
    },
    governance: {
      governmentTransparency: mv(64),
      budgetBalance: mv(-2.5),
      corruptionIndex: mv(34),
      voterTurnout: mv(62),
      publicTrust: mv(46),
      devolutionSatisfaction: mv(48),
    },
    population: {
      populationGrowth: mv(0.1), // Near-stagnant: outmigration of young
      urbanizationRate: mv(62),
      medianAge: mv(43.0),
      migrationRate: mv(-0.2), // Net outmigration
    },
    mediaInformation: {
      mediaPolarization: mv(45),
      disinformationRisk: mv(43),
      pressFreedom: mv(76),
      socialMediaSentiment: mv(4),
      newsTrust: mv(46),
      bbcTrust: mv(53),
    },
    lastUpdated: new Date(),
  },

  // ── Scotland ───────────────────────────────────────────────────────────────
  {
    _id: "SCO",
    economic: {
      unemploymentRate: mv(3.8),
      medianIncome: mv(29500),
      gdpGrowth: mv(1.7),
      povertyRate: mv(15),
      costOfLiving: mv(98),
      smallBusinessFormation: mv(4.4),
      propertyValueIndex: mv(88),
      commercialValueIndex: mv(90),
    },
    education: {
      testPerformance: mv(105),
      educationSpending: mv(7800), // Scottish Government spends more per pupil
      literacyRate: mv(93),
      workforceSkill: mv(62),
      gcseAttainment: mv(67), // Scottish National 5 equivalent
      universityEnrollment: mv(42),
      apprenticeshipRate: mv(1.8),
    },
    healthcare: {
      physicianRate: mv(2.9),
      lifeExpectancy: mv(79.8), // Below England average (historical disease burden)
      preventableMortality: mv(298),
      publicHealthPreparedness: mv(70),
      nhsWaitingTime: mv(16),
      mentalHealthAccess: mv(44),
      socialCareQuality: mv(54),
    },
    infrastructure: {
      roadCondition: mv(70),
      broadbandAccess: mv(91),
      publicTransit: mv(62), // ScotRail, Glasgow Subway
      waterQuality: mv(98), // Excellent freshwater resources
      powerGridReliability: mv(99.5),
      infrastructureInvestmentGap: mv(22),
    },
    publicSafety: {
      crimeRate: mv(4200), // Lower recorded crime (Scottish legal system)
      violentCrimeRate: mv(280),
      policePerCapita: mv(2.8), // Police Scotland (merged force)
      incarcerationRate: mv(150),
      recidivismRate: mv(38),
      publicSafetyConfidence: mv(68),
      antiSocialBehaviourRate: mv(7.5),
      knifeCrimeRate: mv(2.5), // Glasgow historically high; declining
    },
    environment: {
      airQuality: mv(25),
      renewableEnergy: mv(72), // Scotland exceeds 100% electricity demand renewables
      carbonEmissions: mv(8),
      recyclingRate: mv(48),
      climateResilience: mv(70),
      protectedLand: mv(40), // Cairngorms, Loch Lomond
      floodRisk: mv(8),
    },
    social: {
      socialMobility: mv(52),
      incomeInequality: mv(35),
      homelessnessRate: mv(9),
      foodInsecurity: mv(12),
      civicParticipation: mv(60),
      socialCohesion: mv(62),
      childPoverty: mv(26),
      housingAffordability: mv(6.5),
      roughSleeping: mv(2.0),
    },
    governance: {
      governmentTransparency: mv(72),
      budgetBalance: mv(-1.5),
      corruptionIndex: mv(28),
      voterTurnout: mv(68), // High engagement — IndyRef, Holyrood elections
      publicTrust: mv(54),
      devolutionSatisfaction: mv(58), // Holyrood devolution broadly supported
      independenceDesire: mv(45), // Post-Brexit SNP surge; ~45/100 baseline 2019
    },
    population: {
      populationGrowth: mv(0.3),
      urbanizationRate: mv(70),
      medianAge: mv(42.0),
      migrationRate: mv(0.1),
    },
    mediaInformation: {
      mediaPolarization: mv(46), // Heightened by independence debate
      disinformationRisk: mv(38),
      pressFreedom: mv(80),
      socialMediaSentiment: mv(5),
      newsTrust: mv(50),
      bbcTrust: mv(48), // Lower BBC trust — Scottish independence context
    },
    lastUpdated: new Date(),
  },

  // ── Wales ──────────────────────────────────────────────────────────────────
  {
    _id: "WAL",
    economic: {
      unemploymentRate: mv(5.0),
      medianIncome: mv(26000), // Lowest of four nations
      gdpGrowth: mv(1.3),
      povertyRate: mv(20),
      costOfLiving: mv(95),
      smallBusinessFormation: mv(3.5),
      propertyValueIndex: mv(85),
      commercialValueIndex: mv(82),
    },
    education: {
      testPerformance: mv(97), // PISA Wales historically below UK average
      educationSpending: mv(7000),
      literacyRate: mv(90),
      workforceSkill: mv(54),
      gcseAttainment: mv(62),
      universityEnrollment: mv(35),
      apprenticeshipRate: mv(2.0),
    },
    healthcare: {
      physicianRate: mv(2.5),
      lifeExpectancy: mv(80.2),
      preventableMortality: mv(295),
      publicHealthPreparedness: mv(65),
      nhsWaitingTime: mv(22), // NHS Wales has worse waits than England
      mentalHealthAccess: mv(38),
      socialCareQuality: mv(48),
    },
    infrastructure: {
      roadCondition: mv(64),
      broadbandAccess: mv(86), // Rural Wales has significant gaps
      publicTransit: mv(50),
      waterQuality: mv(97),
      powerGridReliability: mv(99.3),
      infrastructureInvestmentGap: mv(32),
    },
    publicSafety: {
      crimeRate: mv(4600),
      violentCrimeRate: mv(265),
      policePerCapita: mv(2.3),
      incarcerationRate: mv(140),
      recidivismRate: mv(39),
      publicSafetyConfidence: mv(67),
      antiSocialBehaviourRate: mv(7.5),
      knifeCrimeRate: mv(2.2),
    },
    environment: {
      airQuality: mv(28),
      renewableEnergy: mv(48), // Strong wind — Welsh Government targets
      carbonEmissions: mv(11),
      recyclingRate: mv(58), // Wales leads UK in recycling rates
      climateResilience: mv(65),
      protectedLand: mv(35), // Snowdonia, Brecon Beacons, Pembrokeshire
      floodRisk: mv(12),
    },
    social: {
      socialMobility: mv(46),
      incomeInequality: mv(34),
      homelessnessRate: mv(8),
      foodInsecurity: mv(15),
      civicParticipation: mv(54),
      socialCohesion: mv(65),
      childPoverty: mv(31),
      housingAffordability: mv(6.0),
      roughSleeping: mv(2.0),
    },
    governance: {
      governmentTransparency: mv(68),
      budgetBalance: mv(-2.2),
      corruptionIndex: mv(30),
      voterTurnout: mv(65),
      publicTrust: mv(50),
      devolutionSatisfaction: mv(55), // Senedd devolution has moderate support
      independenceDesire: mv(25), // Modest Plaid-led growth; ~25/100 baseline 2019
    },
    population: {
      populationGrowth: mv(0.2),
      urbanizationRate: mv(54),
      medianAge: mv(43.5), // Older — young outmigration to England
      migrationRate: mv(-0.1),
    },
    mediaInformation: {
      mediaPolarization: mv(40),
      disinformationRisk: mv(38),
      pressFreedom: mv(78),
      socialMediaSentiment: mv(5),
      newsTrust: mv(50),
      bbcTrust: mv(52),
    },
    lastUpdated: new Date(),
  },

  // ── Northern Ireland ───────────────────────────────────────────────────────
  {
    _id: "NIR",
    economic: {
      unemploymentRate: mv(4.5),
      medianIncome: mv(25500),
      gdpGrowth: mv(1.8), // Boosted by Windsor Framework trade access
      povertyRate: mv(19),
      costOfLiving: mv(92), // Lowest of four nations
      smallBusinessFormation: mv(3.8),
      propertyValueIndex: mv(80),
      commercialValueIndex: mv(82),
    },
    education: {
      testPerformance: mv(110), // Grammar system inflates averages
      educationSpending: mv(7200),
      literacyRate: mv(92),
      workforceSkill: mv(58),
      gcseAttainment: mv(68), // Grammar system — higher headline pass rate
      universityEnrollment: mv(38),
      apprenticeshipRate: mv(1.8),
    },
    healthcare: {
      physicianRate: mv(2.4),
      lifeExpectancy: mv(80.5),
      preventableMortality: mv(290),
      publicHealthPreparedness: mv(62),
      nhsWaitingTime: mv(26), // Longest waits in UK — chronic underfunding
      mentalHealthAccess: mv(35),
      socialCareQuality: mv(44),
    },
    infrastructure: {
      roadCondition: mv(70),
      broadbandAccess: mv(87),
      publicTransit: mv(48), // Limited — car-dependent
      waterQuality: mv(96),
      powerGridReliability: mv(99.5),
      infrastructureInvestmentGap: mv(28),
    },
    publicSafety: {
      crimeRate: mv(3800), // Lower total crime rate (PSNI data)
      violentCrimeRate: mv(290),
      policePerCapita: mv(3.5), // Higher policing ratio (historical security)
      incarcerationRate: mv(95), // Well below UK average
      recidivismRate: mv(36),
      publicSafetyConfidence: mv(65),
      antiSocialBehaviourRate: mv(7.0),
      knifeCrimeRate: mv(1.8),
    },
    environment: {
      airQuality: mv(30),
      renewableEnergy: mv(45),
      carbonEmissions: mv(10),
      recyclingRate: mv(48),
      climateResilience: mv(68),
      protectedLand: mv(28), // Strangford Lough, Mourne AONB
      floodRisk: mv(9),
    },
    social: {
      socialMobility: mv(50),
      incomeInequality: mv(33), // Lowest inequality of four nations
      homelessnessRate: mv(6),
      foodInsecurity: mv(14),
      civicParticipation: mv(58),
      socialCohesion: mv(55), // Community tension along sectarian lines
      childPoverty: mv(28),
      housingAffordability: mv(5.5),
      roughSleeping: mv(1.5),
    },
    governance: {
      governmentTransparency: mv(62), // NI Executive — periodic collapse
      budgetBalance: mv(-2.0),
      corruptionIndex: mv(35),
      voterTurnout: mv(63),
      publicTrust: mv(44), // Low trust in local institutions
      devolutionSatisfaction: mv(42), // Stormont collapse erodes confidence
      independenceDesire: mv(40), // Reunification desire — Brexit + demographic shift; ~40/100 baseline 2019
    },
    population: {
      populationGrowth: mv(0.4),
      urbanizationRate: mv(54),
      medianAge: mv(39.5),
      migrationRate: mv(0.2),
    },
    mediaInformation: {
      mediaPolarization: mv(52), // High — constitutional question + Brexit
      disinformationRisk: mv(44),
      pressFreedom: mv(76),
      socialMediaSentiment: mv(3),
      newsTrust: mv(42),
      bbcTrust: mv(45), // Lower trust — cross-community tensions re: BBC NI
    },
    lastUpdated: new Date(),
  },
];

export const ukStateMetrics: StateMetrics[] = ukStateMetricsBase.map((metrics) =>
  withUniformMetricSet({
    ...metrics,
    countryId: "UK",
    economic: {
      ...metrics.economic,
      tradeBalance: mv(-2.5),
      productivityGrowth: mv(metrics.economic.gdpGrowth.value * 0.55),
      rdIntensity: mv(1.4 + metrics.education.workforceSkill.value / 100),
    },
    social: {
      ...metrics.social,
      housingSupplyGrowth: mv(0.8),
    },
    governance: {
      ...metrics.governance,
      debtToGdp: mv(98),
    },
  })
);

export default ukStateMetrics;
