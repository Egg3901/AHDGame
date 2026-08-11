import type { StateMetrics } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * East Germany region initial metrics — 1953 (the nascent GDR).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA. Authored for ~1953 directly,
 * NOT transformed from ddStateMetrics.ts (the 1979 file).
 *
 * Keyed to the same eastern-Laender codes as the 1979 bundle (BEO/MV/BB/ST/SN/TH)
 * — matching ddRegions1953.ts and ddRegionCensusData1953.ts.
 *
 * Context vs 1979: post-war reconstruction under the first Five-Year Plan, Soviet
 * reparations still draining industry, rationing (until 1958), the June 17 1953
 * workers' uprising (very low public trust), and peak Republikflucht (~330k left
 * for the West in 1953 → sharp population decline). Incomes roughly half the 1979
 * level, education reform (1952) brand-new, lower urbanisation, lignite pollution
 * present but below the 1979 industrial peak. `medianIncome` is annual household
 * income in Mark der DDR.
 */
function mv(value: number, trend?: number) {
  return trend !== undefined ? { value, trend } : { value };
}

const BASELINE: Omit<StateMetrics, "_id" | "lastUpdated"> = {
  economic: {
    unemploymentRate: mv(0.5), // planned full employment; slight reconstruction friction
    // #income-gdp-scale-audit: population-weighted at the OLD 7,000/8,800/
    // 5,900/6,300/6,900/7,600/7,000 spread this measured at ratio 2.594x GDP
    // per capita (M 50B / 18.4M = M 2,717) — technically inside the
    // medianIncomeGdpScale1953.test.ts [0.8, 2.6] band, but by a margin of
    // 0.006, i.e. a rounding error away from failing. Rescaled ~0.694x
    // (comment mirrors the region OVERRIDES table below) for headroom; the
    // NMP basis for this whole figure is already flagged "very uncertain"
    // above, so a modest downward revision costs nothing in fidelity.
    medianIncome: mv(4_900), // annual household Mark der DDR (~half of 1979)
    gdpGrowth: mv(6.0), // rapid reconstruction off a low, war-shattered base
    povertyRate: mv(22), // post-war hardship, rationing
    costOfLiving: mv(100), // administered, heavily subsidised (era-neutral index)
    smallBusinessFormation: mv(1.5), // private Handwerk remnants, being squeezed
    laborParticipation: mv(78),
    matchingFriction: mv(1.5),
    tradeBalance: mv(-2.0), // reparations drain
    productivityGrowth: mv(3.0),
    rdIntensity: mv(1.0), // low; industry dismantled/rebuilding
    exportDependency: mv(20), // Comecon forming, reparations to the USSR
    manufacturingCompetitiveness: mv(48), // reparations-drained plant
  },
  education: {
    highSchoolGradRate: mv(45), // 1952 education reform brand-new; Volksschule dominant
    testPerformance: mv(88),
    educationSpending: mv(2_500), // Mark der DDR
    literacyRate: mv(98),
    workforceSkill: mv(60),
    apprenticeshipRate: mv(7), // strong Berufsschule tradition
  },
  healthcare: {
    uninsuredRate: mv(5), // Sozialversicherung still expanding to universal
    affordabilityIndex: mv(60),
    physicianRate: mv(1.3), // many doctors fled West; rebuilding
    lifeExpectancy: mv(66.5), // ~1953 GDR
    preventableMortality: mv(520),
    publicHealthPreparedness: mv(50),
  },
  infrastructure: {
    roadCondition: mv(42), // extensive war damage
    broadbandAccess: mv(0),
    publicTransit: mv(66), // war-damaged but extensive rail/tram
    waterQuality: mv(55),
    powerGridReliability: mv(88.0), // reconstruction-era shortages
    infrastructureInvestmentGap: mv(55), // huge war-rebuild need
  },
  publicSafety: {
    crimeRate: mv(2_200), // post-war dislocation, heavy policing
    violentCrimeRate: mv(70),
    policePerCapita: mv(5.0), // Stasi (est. 1950) + Volkspolizei, still building
    incarcerationRate: mv(200), // Stalinist repression + June 1953 arrests
    recidivismRate: mv(38),
    publicSafetyConfidence: mv(42),
  },
  environment: {
    airQuality: mv(70), // lignite present but below the 1979 industrial peak
    renewableEnergy: mv(3), // some hydro
    carbonEmissions: mv(12), // lower output than 1979
    recyclingRate: mv(10), // pre-SERO
    climateResilience: mv(42),
    protectedLand: mv(4),
  },
  social: {
    socialMobility: mv(60), // revolutionary cadre promotion, land reform
    incomeInequality: mv(22), // leveling, not yet as compressed as mature 1979
    homelessnessRate: mv(3), // acute war housing shortage
    foodInsecurity: mv(15), // rationing until 1958
    civicParticipation: mv(55), // mass organisations forming
    socialCohesion: mv(42), // June 1953 unrest, Republikflucht
    housingSupplyGrowth: mv(1.5), // Stalinallee amid a vast shortage
  },
  governance: {
    governmentTransparency: mv(10),
    budgetBalance: mv(-3.0), // reparations + reconstruction
    debtToGdp: mv(12), // reparations were extraction, not sovereign debt
    corruptionIndex: mv(38),
    voterTurnout: mv(99), // single-list ritual turnout
    publicTrust: mv(30), // June 17 1953 uprising
    coDeterminationQuality: mv(40),
  },
  population: {
    // Republikflucht, averaged over the era rather than frozen at its 1953 peak.
    //
    // -1.8 is the correct PEAK (~330k left in 1953), but `migrationRate` and
    // `populationGrowth` are static root metrics that no node decays — so a
    // seeded peak runs unchanged for the life of the world. Over a 1000-turn
    // 1953 world (which reaches 1973) that models two full decades of peak
    // emigration, when the Berlin Wall in fact closed the border in August 1961.
    //
    // Left at -1.8 the effect is not cosmetic: it shrinks DD's labour force
    // ~2.6%/yr, which drives the Solow labour term to -1.73pp and DD's potential
    // growth to -1.21%/yr. DD was the only country in the world to CONTRACT over
    // the run (-13.1%) purely because of this, while its sectors grew normally.
    //
    // -0.55 is roughly the 1953-1973 average: heavy outflow until 1961, then
    // near-zero. Once a dated-event mechanism exists this should become
    // -1.8 pre-1961 stepping to ~0 after, which is the honest shape.
    populationGrowth: mv(-0.55),
    urbanizationRate: mv(64), // below the 1979 level
    medianAge: mv(35),
    // 0-100 fertility INDEX (population.birthRate; metricDefinitions
    // `unit: "index"`), NOT a crude per-1000 rate — see BIRTH_RATE_1953's doc
    // comment in reference/stateMetrics1953.ts for the full mechanism. This
    // field was previously ABSENT, so DD fell through seedCohortVectors'
    // DEFAULT_BIRTH_RATE = 50 (2019-replacement-level TFR 2.06) in a 1953
    // postwar-recovery country whose real TFR was ~2.4 (UN Demographic
    // Yearbook, East Germany). birthRateIndexToTFR(64, 2.06) = 2.06*(0.4 +
    // 0.64*1.2) = 2.44. Set below the bloc's ~2.5-2.6 average to reflect DD's
    // war losses, Republikflucht outmigration of working-age adults, and the
    // authored medianAge of 35 (older than the bloc baseline of 27).
    birthRate: mv(64),
    migrationRate: mv(-0.55),
  },
  mediaInformation: {
    mediaPolarization: mv(15),
    disinformationRisk: mv(45), // state propaganda, Cold War
    pressFreedom: mv(9), // early Stasi-era censorship
    socialMediaSentiment: mv(0),
    newsTrust: mv(30),
  },
};

type Override = Partial<{
  unemploymentRate: number;
  medianIncome: number;
  gdpGrowth: number;
  povertyRate: number;
  airQuality: number;
  urbanizationRate: number;
  birthRate: number;
  lifeExpectancy: number;
}>;

const OVERRIDES: Record<string, Override> = {
  BEO: {
    unemploymentRate: 0.3,
    medianIncome: 6_100,
    gdpGrowth: 6.5,
    povertyRate: 18,
    airQuality: 62,
    urbanizationRate: 95,
    birthRate: 59,
    lifeExpectancy: 68,
  }, // privileged capital, administrative elite, June 17 epicentre
  MV: {
    unemploymentRate: 0.8,
    medianIncome: 4_100,
    gdpGrowth: 4.8,
    povertyRate: 26,
    airQuality: 82,
    urbanizationRate: 32,
    birthRate: 68,
    lifeExpectancy: 66.5,
  }, // agrarian Baltic coast (cleanest air), expellee-swollen villages
  BB: {
    unemploymentRate: 0.7,
    medianIncome: 4_400,
    gdpGrowth: 5.2,
    povertyRate: 24,
    airQuality: 74,
    urbanizationRate: 38,
    birthRate: 67,
    lifeExpectancy: 66,
  }, // Berlin's agrarian ring; Cottbus lignite beginning to scale
  ST: {
    unemploymentRate: 0.5,
    medianIncome: 4_800,
    gdpGrowth: 5.8,
    povertyRate: 22,
    airQuality: 60,
    urbanizationRate: 48,
    birthRate: 64,
    lifeExpectancy: 65.5,
  }, // Halle/Magdeburg chemical belt — early heavy pollution
  SN: {
    unemploymentRate: 0.4,
    medianIncome: 5_300,
    gdpGrowth: 6.3,
    povertyRate: 20,
    airQuality: 58,
    urbanizationRate: 66,
    birthRate: 62,
    lifeExpectancy: 66.5,
  }, // Saxon industrial heartland (worst air), highest wages outside Berlin
  TH: {
    unemploymentRate: 0.5,
    medianIncome: 4_900,
    gdpGrowth: 6.0,
    povertyRate: 22,
    airQuality: 70,
    urbanizationRate: 52,
    birthRate: 64,
    lifeExpectancy: 66.5,
  }, // Thuringian workshops and the Wismut uranium fields
};

function buildMetrics(regionId: string): StateMetrics {
  const o = OVERRIDES[regionId] ?? {};
  return withUniformMetricSet({
    _id: regionId,
    countryId: "DD",
    economic: {
      ...BASELINE.economic,
      ...(o.unemploymentRate !== undefined && {
        unemploymentRate: mv(o.unemploymentRate),
      }),
      ...(o.medianIncome !== undefined && { medianIncome: mv(o.medianIncome) }),
      ...(o.gdpGrowth !== undefined && { gdpGrowth: mv(o.gdpGrowth) }),
      ...(o.povertyRate !== undefined && { povertyRate: mv(o.povertyRate) }),
    },
    education: { ...BASELINE.education },
    healthcare: {
      ...BASELINE.healthcare,
      ...(o.lifeExpectancy !== undefined && { lifeExpectancy: mv(o.lifeExpectancy) }),
    },
    infrastructure: { ...BASELINE.infrastructure },
    publicSafety: { ...BASELINE.publicSafety },
    environment: {
      ...BASELINE.environment,
      ...(o.airQuality !== undefined && { airQuality: mv(o.airQuality) }),
    },
    social: { ...BASELINE.social },
    governance: { ...BASELINE.governance },
    population: {
      ...BASELINE.population,
      ...(o.urbanizationRate !== undefined && { urbanizationRate: mv(o.urbanizationRate) }),
      ...(o.birthRate !== undefined && { birthRate: mv(o.birthRate) }),
    },
    mediaInformation: { ...BASELINE.mediaInformation },
    lastUpdated: new Date(),
  });
}

export const ddStateMetrics1953: StateMetrics[] = Object.keys(OVERRIDES).map(buildMetrics);
