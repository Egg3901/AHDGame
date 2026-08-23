import type { EconomicModelState } from "@/lib/constants/economicModels";

export type MetricCategoryId =
  | "economic"
  | "education"
  | "healthcare"
  | "infrastructure"
  | "publicSafety"
  | "environment"
  | "social"
  | "governance"
  | "population"
  | "mediaInformation";

export interface StateMetricValue {
  value: number;
  trend?: number;
  /** Sector-only baseline, stored so the GDP growth phase can preserve policy deltas rather than overwriting them */
  sectorBaseline?: number;
}

export interface StateMetrics {
  _id: string;
  countryId?: string;
  /**
   * Economic-model identity (P7) — written by the economicModel turn phase onto
   * regional + national-scope docs. NOT a metric (no bounds/approval term); a
   * descriptive classification surfaced in the UI.
   */
  economicModel?: EconomicModelState;
  economic: {
    unemploymentRate: StateMetricValue;
    medianIncome: StateMetricValue;
    gdpGrowth: StateMetricValue;
    /**
     * The revenue-weighted sector growth signal (the cyclical/production path,
     * §5.2). Surfaced intermediate that the integrated `gdpGrowth` reverts toward
     * potential via the output gap (P1c-2). Excluded from approval scoring
     * (gdpGrowth carries the term). Optional — written by the metric-engine phase.
     */
    sectorGrowth?: StateMetricValue;
    povertyRate: StateMetricValue;
    costOfLiving: StateMetricValue;
    smallBusinessFormation: StateMetricValue;
    /**
     * Per-state demand-side sentiment (0–100, neutral ~60). Engine-computed
     * (no per-country seed needed; see economic.ts consumerConfidenceNode) and
     * moved by crises. Drives sector profit margins via the consumerConfidence
     * margin signal. Distinct from the NATIONAL federalBudget.investorConfidence
     * used for founding/sovereign premiums.
     */
    consumerConfidence?: StateMetricValue;
    /**
     * Per-state investment-side sentiment (0–100, neutral ~60). Engine-computed,
     * moved by crises, and folded into the share-price sentiment multiplier for
     * corps headquartered in this state (applyPriceMultipliers.ts).
     */
    investorConfidence?: StateMetricValue;
    // P6a axis metrics (approval-excluded until the P6d cutover).
    economicFreedom?: StateMetricValue;
    regulatoryBurden?: StateMetricValue;
    /** Percentage of working-age population in the labor force (policy-driven driver) */
    laborParticipation?: StateMetricValue;
    /** Structural unemployment floor from skills mismatch (policy-driven driver) */
    matchingFriction?: StateMetricValue;
    /** Net exports as a percentage of GDP */
    tradeBalance?: StateMetricValue;
    /** Labor productivity growth rate */
    productivityGrowth?: StateMetricValue;
    /**
     * Dynamic fiscal-growth factors (annual %, applied per-turn by the
     * fiscalBaseGrowth phase). `wageGrowth` = real medianIncome Δ + lagged
     * inflation passthrough; `tradeGrowth` = world baseline − tariff/foreign-tax
     * wedges + FTA/forex/manufacturing. Written by the metric-engine phase.
     */
    wageGrowth?: StateMetricValue;
    tradeGrowth?: StateMetricValue;
    /** Research and development spending as a percentage of GDP */
    rdIntensity?: StateMetricValue;
    /**
     * Supply-side POTENTIAL growth trend (annual %, Solow αL·g_L + αK·g_K + TFP,
     * §5.1). Surfaced read-only by the metric-engine phase (P1c-1); the
     * `gdpGrowth = potential + cyclical` integration is P1c-2. Excluded from
     * approval scoring (redundant with the gdpGrowth it will drive).
     */
    potentialGrowth?: StateMetricValue;
    /**
     * Civilian labor force `L` = (workingAge − serving) × laborParticipation
     * (people), the input to potential growth (§5.1). Surfaced read-only; a raw
     * headcount, so excluded from approval scoring.
     */
    laborForce?: StateMetricValue;
    /**
     * Phase 1 labour market telemetry. `labourDemand` is the sum of every
     * corporate sector's revenue-implied headcount in this state (jobs wanted);
     * `labourTightness` is that over `laborForce` (1.0 = the corporate sector
     * wants exactly the whole labour force, above 1 = oversubscribed). Written
     * by the corporation turn, absent when supply is unknown. Read-only
     * measurement: no mechanic prices off either field yet.
     */
    labourDemand?: StateMetricValue;
    labourTightness?: StateMetricValue;
    // Uniform extended metric fields
    propertyValueIndex?: StateMetricValue;
    commercialValueIndex?: StateMetricValue;
    /** Urban-rural divide health, regional economic vitality, depopulation countermeasures */
    ruralRevitalization?: StateMetricValue;
    /** Agricultural self-sufficiency ratio, food supply resilience, import dependency */
    foodSecurity?: StateMetricValue;
    exportDependency?: StateMetricValue;
    manufacturingCompetitiveness?: StateMetricValue;
    // DE-specific (added 2026-05-26 with the DE legislation overhaul).
    /** East-West GDP/wages/productivity gap — Aufbau Ost convergence indicator */
    eastWestConvergence?: StateMetricValue;
    /** Mittelstand SME ecosystem health (family-owned industrial) */
    mittelstandHealth?: StateMetricValue;
    // CN-specific (added 2026-05-27 with the CN legislation overhaul).
    /** 共同富裕 (Common Prosperity) program coverage + inequality + rural-urban convergence */
    commonProsperityIndex?: StateMetricValue;
    /** Five-Year Plan industrial-strategy target achievement, capturing Made in China and active Five-Year Plan flagship initiatives */
    industrialPolicyExecution?: StateMetricValue;
    /** Coastal-interior economic divergence (analogous to DE eastWestConvergence) */
    eastWestRegionalGap?: StateMetricValue;
    // IE-specific (added 2026-05-27 with the IE state-metrics expansion).
    /** % of corp-tax receipts from top-10 multinationals (Apple/Pfizer concentration risk). */
    mncDependency?: StateMetricValue;
    /** % gap between headline GDP and Modified GNI* — "leprechaun economics" distortion. */
    gniStarGap?: StateMetricValue;
    /** IDA Ireland 0-100 FDI attractiveness score derived from job announcements. */
    fdiPipelineStrength?: StateMetricValue;
    /** % of family-farm income from CAP direct payments. Drives rural sector outcomes. */
    capDependency?: StateMetricValue;
  };
  education: {
    // Uniform extended metric fields
    highSchoolGradRate?: StateMetricValue;
    testPerformance: StateMetricValue;
    educationSpending: StateMetricValue;
    literacyRate: StateMetricValue;
    workforceSkill: StateMetricValue;
    gcseAttainment?: StateMetricValue;
    universityEnrollment?: StateMetricValue;
    apprenticeshipRate?: StateMetricValue;
    /** Exam culture intensity, student mental health, cram school prevalence (higher = more pressure) */
    academicPressure?: StateMetricValue;
  };
  healthcare: {
    // Uniform extended metric fields
    uninsuredRate?: StateMetricValue;
    affordabilityIndex?: StateMetricValue;
    physicianRate: StateMetricValue;
    lifeExpectancy: StateMetricValue;
    preventableMortality: StateMetricValue;
    publicHealthPreparedness: StateMetricValue;
    nhsWaitingTime?: StateMetricValue;
    mentalHealthAccess?: StateMetricValue;
    socialCareQuality?: StateMetricValue;
    /** Elder care capacity and quality */
    elderCareQuality?: StateMetricValue;
    // IE-specific (added 2026-05-27 with the IE state-metrics expansion).
    /** Sláintecare universal single-tier rollout tracker; 0-100, higher = closer to completion. */
    slaintecareProgress?: StateMetricValue;
    /** NTPF median outpatient wait in months. Lower = better. */
    hseWaitingListMonths?: StateMetricValue;
  };
  infrastructure: {
    roadCondition: StateMetricValue;
    broadbandAccess: StateMetricValue;
    publicTransit: StateMetricValue;
    waterQuality: StateMetricValue;
    powerGridReliability: StateMetricValue;
    infrastructureInvestmentGap: StateMetricValue;
    // Uniform extended metric fields
    /** Intercity and public transit network quality */
    transportEfficiency?: StateMetricValue;
  };
  publicSafety: {
    crimeRate: StateMetricValue;
    violentCrimeRate: StateMetricValue;
    policePerCapita: StateMetricValue;
    incarcerationRate: StateMetricValue;
    recidivismRate: StateMetricValue;
    publicSafetyConfidence: StateMetricValue;
    // Uniform extended metric fields
    antiSocialBehaviourRate?: StateMetricValue;
    knifeCrimeRate?: StateMetricValue;
    /**
     * Axis metric (P6d pattern): breadth of lawful civilian firearm ownership
     * and carry, 0-100, higher = fewer restrictions. Policy-driven root;
     * electorate-weighted in approval via metricAxisAffinity.
     */
    firearmRights?: StateMetricValue;
  };
  environment: {
    airQuality: StateMetricValue;
    renewableEnergy: StateMetricValue;
    carbonEmissions: StateMetricValue;
    recyclingRate: StateMetricValue;
    climateResilience: StateMetricValue;
    protectedLand: StateMetricValue;
    // Uniform extended metric fields
    floodRisk?: StateMetricValue;
    /** Earthquake/typhoon/tsunami readiness per region */
    naturalDisasterPreparedness?: StateMetricValue;
    /** Nuclear regulatory confidence, reactor safety, energy mix trust */
    nuclearSafety?: StateMetricValue;
    energyTransitionProgress?: StateMetricValue;
    // IE-specific (added 2026-05-27 with the IE state-metrics expansion).
    /** % of total emissions from agriculture (methane + N₂O dominant). Uniquely-high vs peers. */
    agriEmissionsShare?: StateMetricValue;
  };
  social: {
    socialMobility: StateMetricValue;
    incomeInequality: StateMetricValue;
    homelessnessRate: StateMetricValue;
    foodInsecurity: StateMetricValue;
    civicParticipation: StateMetricValue;
    socialCohesion: StateMetricValue;
    /** Annual growth in housing units per capita */
    housingSupplyGrowth?: StateMetricValue;
    // Uniform extended metric fields
    childPoverty?: StateMetricValue;
    housingAffordability?: StateMetricValue;
    roughSleeping?: StateMetricValue;
    /** Overwork risk and labor reform effectiveness */
    workLifeBalance?: StateMetricValue;
    /** Immigration acceptance, visa program breadth, social cohesion with foreign residents */
    foreignWorkerIntegration?: StateMetricValue;
    /** Workforce participation gap, political representation, pay equity */
    genderEquality?: StateMetricValue;
    // DE-specific (added 2026-05-26 with the DE legislation overhaul).
    /** Kita placement coverage rate — Rechtsanspruch auf Kita-Platz */
    kitaCoverage?: StateMetricValue;
    /** New housing units constructed per capita per year */
    wohnungsBauRate?: StateMetricValue;
    // CN-specific (added 2026-05-27 with the CN legislation overhaul).
    /** 户口 (Hukou) transfer ease (inter-region). Higher = freer internal migration. */
    hukouMobility?: StateMetricValue;
    // IE-specific (added 2026-05-27 with the IE state-metrics expansion).
    /** New dwellings per 1k residents (Housing for All target ≈ 6.5/1k). */
    housingCompletionsRate?: StateMetricValue;
    /** Census vacant-dwellings %. Salient land-hoarding / planning failure indicator. */
    vacantPropertyRate?: StateMetricValue;
    /** Median rent as % of median income; drives Rent Pressure Zone designation. */
    rentalPressureIndex?: StateMetricValue;
    /** % claiming some Gaeilge ability (Census). Gaeltacht / Irish-language vitality. */
    irishLanguageStrength?: StateMetricValue;
  };
  governance: {
    governmentTransparency: StateMetricValue;
    budgetBalance: StateMetricValue;
    /** National government debt as a percentage of GDP */
    debtToGdp?: StateMetricValue;
    corruptionIndex: StateMetricValue;
    voterTurnout: StateMetricValue;
    publicTrust: StateMetricValue;
    // P6a axis metrics (approval-excluded until the P6d cutover).
    civilLiberties?: StateMetricValue;
    nationalPride?: StateMetricValue;
    militaryReadiness?: StateMetricValue;
    /**
     * Axis metric (P6d pattern): enforcement and control of entry at the
     * national border, 0-100. Policy-driven root; electorate-weighted in
     * approval via metricAxisAffinity.
     */
    borderSecurity?: StateMetricValue;
    // Uniform extended metric fields
    devolutionSatisfaction?: StateMetricValue;
    /**
     * UK devolved-region sentiment toward leaving the UK (SCO, WAL) or
     * unifying with Ireland (NIR). 0..100 scale; ~50 is neutral. Drift
     * is driven by the seated FM's Devolution Policy plus regional /
     * national approval and inflation — see
     * `docs/design/uk-devolution-policy.md`. UI label varies per region
     * ("Independence" for SCO/WAL, "Reunification" for NIR); the field
     * is shared because the engine math is identical.
     */
    independenceDesire?: StateMetricValue;
    // JP-specific
    /** Industrial and service robotics deployment */
    roboticsAdoption?: StateMetricValue;
    coDeterminationQuality?: StateMetricValue;
    // DE-specific (added 2026-05-26 with the DE legislation overhaul).
    /** Structural-deficit room under Article 109 GG Schuldenbremse (% of GDP under 0.35% cap) */
    schuldenbremseHeadroom?: StateMetricValue;
    /** Bundeswehr operational readiness — Materielle Einsatzbereitschaft */
    bundeswehrReadiness?: StateMetricValue;
    /** Pension sustainability — Rentenniveau vs Beitragssatz balance */
    rentenStabilitaet?: StateMetricValue;
    /** DE-EU integration alignment score */
    euCohesionScore?: StateMetricValue;
    // CN-specific (added 2026-05-27 with the CN legislation overhaul).
    /** CCP internal cohesion + anti-corruption campaign intensity + ideological compliance */
    partyDiscipline?: StateMetricValue;
    /** 社会信用体系 (social credit) deployment depth */
    socialCreditCoverage?: StateMetricValue;
    /** Cross-strait political-military tension level */
    taiwanStraitTension?: StateMetricValue;
    /** 一带一路 (Belt and Road) program participation depth + partner-country count */
    beltAndRoadEngagement?: StateMetricValue;
    // IE-specific (added 2026-05-27 with the IE state-metrics expansion).
    /** RoI polling % favouring North-South unity. Mirrors UK `independenceDesire` semantics from the Republic side. */
    unityReferendumSupport?: StateMetricValue;
    /** IPAS centres % capacity utilization. Higher = system strain; moved by immigration policy. */
    directProvisionLoad?: StateMetricValue;
  };
  population: {
    populationGrowth: StateMetricValue;
    urbanizationRate: StateMetricValue;
    medianAge: StateMetricValue;
    migrationRate: StateMetricValue;
    // Uniform extended metric fields
    /** Birth rate trends, population aging pressure */
    demographicDecline?: StateMetricValue;
    /** Fertility rate, family formation, childcare availability, parental support */
    birthRate?: StateMetricValue;
    /** Share-male %, 0-100, balanced ≈ 50. Derived readout of the age×sex vector (§4.3.1). */
    sexRatio?: StateMetricValue;
    /** (youth+senior)/working-age dependency ratio. Derived readout of the age×sex vector. */
    dependencyRatio?: StateMetricValue;
    /**
     * Realized net migration the demographic flow actually moved this turn
     * (annualized %), surfaced alongside — never onto — the policy `migrationRate`
     * input so the UI can show realized-vs-policy (§8.2 coexistence readout).
     * Written only by the demographic-flows phase; excluded from approval scoring.
     */
    realizedMigrationRate?: StateMetricValue;
  };
  mediaInformation: {
    mediaPolarization: StateMetricValue;
    disinformationRisk: StateMetricValue;
    pressFreedom: StateMetricValue;
    socialMediaSentiment: StateMetricValue;
    newsTrust: StateMetricValue;
    // Uniform extended metric fields
    bbcTrust?: StateMetricValue;
    /** P6a axis metric (approval-excluded until the P6d cutover). */
    stateMediaControl?: StateMetricValue;
  };
  lastUpdated: Date;
}
