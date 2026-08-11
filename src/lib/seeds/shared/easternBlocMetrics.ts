import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { EraId } from "@/lib/seeds/presetSelector";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

/**
 * Shared command-economy metric baseline for the Warsaw-Pact one-party states:
 * full employment, administered/subsidised prices, low inequality, a pervasive
 * security state (very low press freedom), and lignite/heavy-industry pollution.
 * Per-country/region values are layered on top. `medianIncome` is annual
 * household income in the country's currency.
 *
 * Two authored eras. **1979** is mature consumer socialism — the bloc at its
 * material peak, near-universal literacy, a built-out health and transit system,
 * and stagnating growth. **1953** is the opposite end of the same system: war
 * damage barely repaired, reconstruction growth rates, mass illiteracy in the
 * southern members, a health and road network that does not exist yet, famine-
 * adjacent food insecurity, and the terror state at full extent (mass
 * incarceration, near-zero transparency). Grading a 1953 bloc world on the 1979
 * table made every early-Cold-War region read as a collapsing 1979 state rather
 * than a poor, fast-industrialising 1953 one.
 */
function mv(value: number) {
  return { value };
}

export interface EBMetricOverride {
  unemploymentRate?: number;
  medianIncome?: number;
  gdpGrowth?: number;
  povertyRate?: number;
  costOfLiving?: number;
  lifeExpectancy?: number;
  literacyRate?: number;
  pressFreedom?: number;
  airQuality?: number;
  urbanizationRate?: number;
  medianAge?: number;
  /** 0-100 fertility index (population.birthRate) — NOT a crude per-1000 rate.
   *  See `baseline1953`'s population block for the systemic-fix rationale. */
  birthRate?: number;
  incomeInequality?: number;
}

/** The bloc only exists in the Cold-War eras; anything else reads as 1979. */
export function easternBlocMetricEra(era: EraId): "1953" | "1979" {
  return era === "1953" ? "1953" : "1979";
}

function baseline1979(income: number): Omit<StateMetrics, "_id" | "lastUpdated"> {
  return {
    economic: {
      unemploymentRate: mv(0.4),
      medianIncome: mv(income),
      gdpGrowth: mv(2.5),
      povertyRate: mv(10),
      costOfLiving: mv(100),
      smallBusinessFormation: mv(0.8),
      laborParticipation: mv(78),
      matchingFriction: mv(1),
      tradeBalance: mv(-1.0),
      productivityGrowth: mv(1.8),
      rdIntensity: mv(1.4),
      exportDependency: mv(24),
      manufacturingCompetitiveness: mv(56),
    },
    education: {
      highSchoolGradRate: mv(78),
      testPerformance: mv(92),
      educationSpending: mv(4_000),
      literacyRate: mv(98),
      workforceSkill: mv(68),
      apprenticeshipRate: mv(7),
    },
    healthcare: {
      uninsuredRate: mv(0),
      affordabilityIndex: mv(68),
      physicianRate: mv(2.2),
      lifeExpectancy: mv(70.0),
      preventableMortality: mv(380),
      publicHealthPreparedness: mv(58),
      // Weeks. Semashko delivers universal free care but rations it by QUEUE
      // rather than by price, so waits stay long even at the bloc's material
      // peak. Bloc-wide rather than per-country on purpose: the system was
      // uniform by design, and splitting HU from PL here would invent
      // precision the sources do not support.
      nhsWaitingTime: mv(14),
    },
    infrastructure: {
      roadCondition: mv(52),
      broadbandAccess: mv(0),
      publicTransit: mv(70),
      waterQuality: mv(60),
      powerGridReliability: mv(97.5),
      infrastructureInvestmentGap: mv(38),
    },
    publicSafety: {
      crimeRate: mv(2_000),
      violentCrimeRate: mv(60),
      policePerCapita: mv(5.0),
      incarcerationRate: mv(150),
      recidivismRate: mv(38),
      publicSafetyConfidence: mv(48),
    },
    environment: {
      airQuality: mv(58),
      renewableEnergy: mv(8),
      carbonEmissions: mv(12),
      recyclingRate: mv(15),
      climateResilience: mv(45),
      protectedLand: mv(5),
    },
    social: {
      socialMobility: mv(52),
      incomeInequality: mv(22),
      homelessnessRate: mv(1),
      foodInsecurity: mv(6),
      civicParticipation: mv(58),
      socialCohesion: mv(50),
      housingSupplyGrowth: mv(2.4),
    },
    governance: {
      governmentTransparency: mv(14),
      budgetBalance: mv(-2.0),
      debtToGdp: mv(22),
      corruptionIndex: mv(45),
      voterTurnout: mv(98),
      publicTrust: mv(38),
      coDeterminationQuality: mv(45),
    },
    population: {
      populationGrowth: mv(0.2),
      urbanizationRate: mv(58),
      medianAge: mv(34),
      migrationRate: mv(-0.2),
    },
    mediaInformation: {
      mediaPolarization: mv(20),
      disinformationRisk: mv(40),
      pressFreedom: mv(12),
      socialMediaSentiment: mv(0),
      newsTrust: mv(38),
    },
  };
}

function baseline1953(income: number): Omit<StateMetrics, "_id" | "lastUpdated"> {
  return {
    economic: {
      unemploymentRate: mv(0.5), // full employment by decree, plus rural underemployment
      medianIncome: mv(income),
      gdpGrowth: mv(6.0), // reconstruction + first five-year-plan heavy industry
      povertyRate: mv(32),
      costOfLiving: mv(100),
      smallBusinessFormation: mv(0.4), // private trade being expropriated outright
      laborParticipation: mv(82), // women mobilised into industry
      matchingFriction: mv(1),
      tradeBalance: mv(-1.5),
      productivityGrowth: mv(3.5), // easy catch-up gains off a destroyed base
      rdIntensity: mv(0.6),
      exportDependency: mv(14), // near-autarkic, pre-CMEA-integration
      manufacturingCompetitiveness: mv(38),
    },
    education: {
      highSchoolGradRate: mv(30), // secondary schooling not yet a mass experience
      testPerformance: mv(78),
      educationSpending: mv(1_200),
      literacyRate: mv(88), // literacy campaigns still running in the south
      workforceSkill: mv(44),
      apprenticeshipRate: mv(5),
    },
    healthcare: {
      uninsuredRate: mv(0), // free at the point of use from the start
      affordabilityIndex: mv(60),
      physicianRate: mv(1.0),
      lifeExpectancy: mv(62.0),
      preventableMortality: mv(760), // TB and infant mortality still endemic
      publicHealthPreparedness: mv(36),
      // Weeks. Same queue-rationed system, but in 1953 the clinics and hospitals
      // largely do not exist yet — universal entitlement on paper, long waits in
      // practice. See the 1979 block for why this is bloc-wide.
      nhsWaitingTime: mv(20),
    },
    infrastructure: {
      roadCondition: mv(30),
      broadbandAccess: mv(0),
      publicTransit: mv(50), // trams and rail only; the bus networks come later
      waterQuality: mv(38), // rural mains water largely absent
      powerGridReliability: mv(90.0),
      infrastructureInvestmentGap: mv(64),
    },
    publicSafety: {
      crimeRate: mv(2_600),
      violentCrimeRate: mv(75),
      policePerCapita: mv(7.5), // secret police and militia at full extent
      incarcerationRate: mv(600), // camps, forced labour, political sentences
      recidivismRate: mv(42),
      publicSafetyConfidence: mv(32),
    },
    environment: {
      airQuality: mv(46), // unfiltered lignite, no abatement whatsoever
      renewableEnergy: mv(10), // prestige hydro schemes
      carbonEmissions: mv(7),
      recyclingRate: mv(8),
      climateResilience: mv(28),
      protectedLand: mv(2),
    },
    social: {
      socialMobility: mv(58), // worker/peasant cadre promotion was real and fast
      incomeInequality: mv(20),
      homelessnessRate: mv(4), // war-destroyed housing stock
      foodInsecurity: mv(24), // rationing and compulsory produce deliveries
      civicParticipation: mv(62), // compulsory mobilisation, not voluntary
      socialCohesion: mv(42),
      housingSupplyGrowth: mv(3.6), // rebuilding from a very low base
    },
    governance: {
      governmentTransparency: mv(6),
      budgetBalance: mv(-1.0),
      debtToGdp: mv(12), // Western borrowing is a 1970s phenomenon
      corruptionIndex: mv(38),
      voterTurnout: mv(99), // single-list elections, abstention itself punished
      publicTrust: mv(32),
      coDeterminationQuality: mv(28),
    },
    population: {
      populationGrowth: mv(1.4), // postwar baby boom
      urbanizationRate: mv(34),
      medianAge: mv(27),
      // `population.birthRate` is a 0-100 fertility INDEX (metricDefinitions
      // `unit: "index"`), NOT a crude rate per 1000 — see the doc comment on
      // `BIRTH_RATE_1953` in reference/stateMetrics1953.ts for the full
      // mechanism. This field was previously ABSENT here, so every 1953
      // Eastern-bloc region fell through `seedCohortVectors`'s
      // `DEFAULT_BIRTH_RATE = 50` — a 2019-replacement-level fertility
      // reading (birthRateIndexToTFR(50, 2.06) = 2.06 TFR) silently imposed on
      // a postwar-baby-boom bloc whose real 1953 TFRs ran ~2.3 (Hungary,
      // lowest) to ~2.9-3.0 (Poland, highest) — this is the same defect
      // already fixed for BR/CN/GR/JP/IE/NG/RU/AT/FI and the US states
      // (stateMetrics1953.ts), now fixed for the shared bloc baseline so all
      // eight countries built on `makeEasternBlocStateMetrics` (HU, PL, RO,
      // YU, BG, BLR, CS, BAL) get it in one place. Index 70 -> TFR
      // 2.06*(0.4+0.7*1.2) = 2.554 (birthRateIndexToTFR, fertility.ts) — the
      // bloc-average postwar TFR (~2.5-2.6), consistent with this baseline's
      // own "postwar baby boom" populationGrowth comment above. Individual
      // countries may override via `EBMetricOverride.birthRate` (e.g. Poland
      // authors a higher index for its higher real TFR, Hungary a lower one
      // for the bloc's lowest).
      birthRate: mv(70),
      migrationRate: mv(-0.4),
    },
    mediaInformation: {
      mediaPolarization: mv(8), // one permitted line
      disinformationRisk: mv(62),
      pressFreedom: mv(4),
      socialMediaSentiment: mv(0),
      newsTrust: mv(30),
    },
  };
}

export function makeEasternBlocStateMetrics(
  countryId: string,
  defaultIncome: number,
  perRegion: Record<string, EBMetricOverride>,
  era: EraId = "1979"
): StateMetrics[] {
  const makeBaseline = easternBlocMetricEra(era) === "1953" ? baseline1953 : baseline1979;
  return Object.entries(perRegion).map(([regionId, o]) => {
    const B = makeBaseline(o.medianIncome ?? defaultIncome);
    const set = (cat: Record<string, StateMetricValue>, key: string, val?: number) =>
      val !== undefined ? { ...cat, [key]: mv(val) } : cat;
    return withUniformMetricSet({
      _id: regionId,
      countryId,
      economic: (() => {
        let e = { ...B.economic } as Record<string, StateMetricValue>;
        e = set(e, "unemploymentRate", o.unemploymentRate);
        e = set(e, "gdpGrowth", o.gdpGrowth);
        e = set(e, "povertyRate", o.povertyRate);
        e = set(e, "costOfLiving", o.costOfLiving);
        return e as typeof B.economic;
      })(),
      education: set(
        { ...B.education } as Record<string, StateMetricValue>,
        "literacyRate",
        o.literacyRate
      ) as typeof B.education,
      healthcare: set(
        { ...B.healthcare } as Record<string, StateMetricValue>,
        "lifeExpectancy",
        o.lifeExpectancy
      ) as typeof B.healthcare,
      infrastructure: { ...B.infrastructure },
      publicSafety: { ...B.publicSafety },
      environment: set(
        { ...B.environment } as Record<string, StateMetricValue>,
        "airQuality",
        o.airQuality
      ) as typeof B.environment,
      social: set(
        { ...B.social } as Record<string, StateMetricValue>,
        "incomeInequality",
        o.incomeInequality
      ) as typeof B.social,
      governance: { ...B.governance },
      population: (() => {
        let p = { ...B.population } as Record<string, StateMetricValue>;
        p = set(p, "urbanizationRate", o.urbanizationRate);
        p = set(p, "medianAge", o.medianAge);
        p = set(p, "birthRate", o.birthRate);
        return p as typeof B.population;
      })(),
      mediaInformation: set(
        { ...B.mediaInformation } as Record<string, StateMetricValue>,
        "pressFreedom",
        o.pressFreedom
      ) as typeof B.mediaInformation,
      lastUpdated: new Date(),
    });
  });
}

export function makeEasternBlocBaselines(metrics: StateMetrics[]): StateMetricBaseline[] {
  const cats: Array<Exclude<keyof StateMetrics, "_id" | "lastUpdated">> = [
    "economic",
    "education",
    "healthcare",
    "infrastructure",
    "publicSafety",
    "environment",
    "social",
    "governance",
    "population",
    "mediaInformation",
  ];
  return metrics.map((m) => {
    const baselines: Record<string, Record<string, number>> = {};
    for (const c of cats) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(m[c] as Record<string, StateMetricValue>)) {
        if (v) out[k] = v.value;
      }
      baselines[c] = out;
    }
    return { _id: m._id, baselines };
  });
}
