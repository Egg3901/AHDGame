import { ObjectId, type Db } from "mongodb";
import { writeSplitMetricsBulk } from "@/lib/macroMetrics/split";
import type {
  State,
  PoliticalParty,
  DemographicCategory,
  StateDemographics,
  StateMetrics,
  StateMetricValue,
  StatePartyOrg,
} from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

export type ModernTransitionCountryId = "PL" | "RO";

/**
 * Generic modern (2027-default) seed path for the post-communist transition
 * democracies — Poland and Romania. Cold-War PL/RO (1953/1979) keep their guard
 * in bootstrapGameWorld and seed via seedEasternBlocCountry; this file never
 * runs there. Other modern presets (1991/2019/...) are out of scope: their
 * roster claims stay as they were, exactly like the HU 2027 path in seedHU.
 *
 * Each step is gated on `preset === "2027-default"` and, under reset, wipes
 * only its own country's rows first — so a 2027 reset never leaves stale
 * PZPR/PMR/PCR-era regions, parties, orgs, demographics, metrics, or
 * baselines behind, and a 1953/1979/1991 reset is untouched.
 */
function isModernTransitionPreset(preset: string): boolean {
  return preset === "2027-default";
}

interface TransitionCountryConfig {
  categoryId: string;
  categoryName: string;
}

const TRANSITION_COUNTRIES: Record<ModernTransitionCountryId, TransitionCountryConfig> = {
  PL: { categoryId: "pl_voterGroups", categoryName: "Poland Voter Groups" },
  RO: { categoryId: "ro_voterGroups", categoryName: "Romania Voter Groups" },
};

/** Display names + turnout for the modern Layer-1 groups (leans come from the model). */
const GROUP_META: Record<
  ModernTransitionCountryId,
  Record<string, { name: string; turnout: number }>
> = {
  PL: {
    rural_conservative: { name: "Rural Conservative", turnout: 76 },
    urban_civic: { name: "Urban Civic", turnout: 76 },
    agrarian_centre: { name: "Agrarian Centre", turnout: 74 },
    progressive_left: { name: "Progressive Left", turnout: 68 },
    libertarian_nationalist: { name: "Libertarian Nationalist", turnout: 66 },
    silesian_minority: { name: "Silesian Minority", turnout: 58 },
  },
  RO: {
    social_rural: { name: "Social Rural", turnout: 54 },
    urban_reformist: { name: "Urban Reformist", turnout: 56 },
    nationalist_populist: { name: "Nationalist Populist", turnout: 54 },
    liberal_centre: { name: "Liberal Centre", turnout: 52 },
    hungarian_minority: { name: "Hungarian Minority", turnout: 58 },
    green_youth: { name: "Green Youth", turnout: 46 },
  },
};

async function loadRegionBundle(countryId: ModernTransitionCountryId): Promise<State[]> {
  if (countryId === "PL") {
    const { plRegions2027 } = await import("@/lib/countries/pl/data/plRegions2027");
    return [...plRegions2027];
  }
  const { roRegions2027 } = await import("@/lib/countries/ro/data/roRegions2027");
  return [...roRegions2027];
}

async function loadPartySeeds(countryId: ModernTransitionCountryId): Promise<PartySeed[]> {
  if (countryId === "PL") {
    const { plParties } = await import("@/lib/countries/pl/data/plParties");
    return [...plParties];
  }
  const { roParties } = await import("@/lib/countries/ro/data/roParties");
  return [...roParties];
}

export async function seedModernTransitionRegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string,
  countryId: ModernTransitionCountryId
) {
  if (!isModernTransitionPreset(preset)) {
    log(`[${countryId}] skipping modern regions (preset ${preset})`);
    return;
  }
  if (reset) {
    await db.collection("states").deleteMany({ countryId });
  }
  const bundle = await loadRegionBundle(countryId);
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} ${countryId} regions (${preset})`);
}

export async function seedModernTransitionParties(
  db: Db,
  log: (msg: string) => void,
  preset: string | undefined,
  countryId: ModernTransitionCountryId
) {
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }
  if (!isModernTransitionPreset(activePreset)) {
    log(`[${countryId}] skipping modern parties (preset ${activePreset})`);
    return;
  }
  const seeds = await loadPartySeeds(countryId);
  const { selectPartyRosterForPreset, prunePresetMismatchedDefaultParties } =
    await import("@/lib/seeds/ensureDefaultParties");

  await prunePresetMismatchedDefaultParties(db, seeds, activePreset);

  const filtered = selectPartyRosterForPreset(seeds, activePreset);
  const now = new Date();
  for (const party of filtered) {
    const { seedOrder: _seedOrder, validForPresets: _validForPresets, ...partyData } = party;
    void _seedOrder;
    void _validForPresets;
    const existing = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ name: party.name, countryId: party.countryId });
    if (existing) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: existing._id }, { $set: { ...partyData, updatedAt: now } });
    } else {
      const sequentialId = await getNextSequentialId(db, "party", party.countryId);
      const doc: PoliticalParty = {
        _id: new ObjectId(),
        sequentialId,
        ...partyData,
        tier: resolveSeedPartyTier(party, activePreset),
        transactionApprovalMode: partyData.transactionApprovalMode ?? "double",
        createdAt: now,
        updatedAt: now,
      } as PoliticalParty;
      await db.collection<PoliticalParty>("politicalParties").insertOne(doc);
    }
  }
  log(`Seeded ${filtered.length} ${countryId} parties (preset: ${activePreset})`);
}

export async function seedModernTransitionDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string,
  countryId: ModernTransitionCountryId
) {
  if (!isModernTransitionPreset(preset)) {
    log(`[${countryId}] skipping modern demographics (preset ${preset})`);
    return;
  }
  const { categoryId, categoryName } = TRANSITION_COUNTRIES[countryId];
  if (reset) {
    await db.collection("demographicCategories").deleteMany({ _id: categoryId as never });
    await db.collection("stateDemographics").deleteMany({ countryId });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId });
  }
  const { getCountryLayer1Model, buildModelRegionDemographics } =
    await import("@/lib/seeds/international");
  const { eraForPreset } = await import("@/lib/seeds/presetSelector");
  const era = eraForPreset(preset);
  const model = getCountryLayer1Model(countryId, era);
  if (!model) {
    log(`[${countryId}] no Layer-1 model — skipping demographics`);
    return;
  }
  // Modern voter-category model built from the Layer-1 roster: group leans are
  // single-sourced from the model's defaultLeans (never the 1979 communist
  // archetypes); only display names and turnout live here.
  const meta = GROUP_META[countryId];
  const category: DemographicCategory = {
    _id: categoryId,
    name: categoryName,
    defaultWeight: 100,
    groups: model.groupIds.map((gid) => ({
      id: gid,
      name: meta[gid]?.name ?? gid,
      defaultEconomicLean: model.defaultLeans[gid]?.economicLean ?? 0,
      defaultSocialLean: model.defaultLeans[gid]?.socialLean ?? 0,
      defaultTurnout: meta[gid]?.turnout ?? 60,
    })),
  };
  const { _id, ...catData } = category;
  await db
    .collection<DemographicCategory>("demographicCategories")
    .updateOne({ _id }, { $set: catData }, { upsert: true });
  const regionDemographics = buildModelRegionDemographics(model);
  for (const raw of regionDemographics) {
    const { _id: demoId, ...demoData } = raw;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id: demoId }, { $set: demoData }, { upsert: true });
  }
  log(`[${countryId}] Seeded ${regionDemographics.length} region demographics (era ${era})`);
}

function mv(value: number, trend?: number): StateMetricValue {
  return trend !== undefined ? { value, trend } : { value };
}

/**
 * Poland transitional metrics fallback. No authored plStateMetrics2027 bundle
 * exists yet (national gap — see handoff), so each region gets a neutral
 * democratic baseline with medianIncome derived from its own authored 2027
 * GDP and population (0.55 labor-share fallback factor). These are gameplay
 * fallbacks, not GUS observations, except where the region GDP/population
 * anchor flows through. Replaced 1:1 once the authored bundle lands.
 */
function buildPlTransitionalMetrics(regions: State[]): StateMetrics[] {
  return regions.map((region) => {
    const gdpPerCapita = ((region.gdp ?? 0) * 1_000_000) / Math.max(1, region.population ?? 1);
    const medianIncome = Math.round((gdpPerCapita * 0.55) / 1000) * 1000;
    return withUniformMetricSet({
      _id: String(region._id),
      countryId: "PL",
      economic: {
        unemploymentRate: mv(5),
        medianIncome: mv(medianIncome),
        gdpGrowth: mv(3),
        povertyRate: mv(region._id === "PL_EAS" ? 20 : 14),
        costOfLiving: mv(region._id === "PL_MAZ" ? 120 : 100),
        smallBusinessFormation: mv(6),
        laborParticipation: mv(63),
        matchingFriction: mv(6),
        tradeBalance: mv(-1),
        productivityGrowth: mv(2),
        rdIntensity: mv(1.4),
        exportDependency: mv(55),
        manufacturingCompetitiveness: mv(62),
      },
      education: {
        highSchoolGradRate: mv(84),
        testPerformance: mv(78),
        educationSpending: mv(1400),
        literacyRate: mv(99),
        workforceSkill: mv(62),
        apprenticeshipRate: mv(8),
      },
      healthcare: {
        uninsuredRate: mv(8),
        affordabilityIndex: mv(58),
        physicianRate: mv(3.4),
        lifeExpectancy: mv(region._id === "PL_EAS" ? 77 : 78),
        preventableMortality: mv(380),
        publicHealthPreparedness: mv(58),
      },
      infrastructure: {
        roadCondition: mv(66),
        broadbandAccess: mv(92),
        publicTransit: mv(62),
        waterQuality: mv(74),
        powerGridReliability: mv(99),
        infrastructureInvestmentGap: mv(26),
      },
      publicSafety: {
        crimeRate: mv(2200),
        violentCrimeRate: mv(80),
        policePerCapita: mv(2.6),
        incarcerationRate: mv(190),
        recidivismRate: mv(38),
        publicSafetyConfidence: mv(54),
      },
      environment: {
        airQuality: mv(region._id === "PL_SLK" ? 55 : 62),
        renewableEnergy: mv(18),
        carbonEmissions: mv(7.5),
        recyclingRate: mv(34),
        climateResilience: mv(52),
        protectedLand: mv(12),
      },
      social: {
        socialMobility: mv(52),
        incomeInequality: mv(44),
        homelessnessRate: mv(2),
        foodInsecurity: mv(7),
        civicParticipation: mv(48),
        socialCohesion: mv(56),
        housingSupplyGrowth: mv(2),
      },
      governance: {
        governmentTransparency: mv(48),
        budgetBalance: mv(-5.5),
        debtToGdp: mv(55),
        corruptionIndex: mv(52),
        voterTurnout: mv(74),
        publicTrust: mv(44),
        coDeterminationQuality: mv(40),
      },
      population: {
        populationGrowth: mv(-0.4),
        urbanizationRate: mv(region._id === "PL_EAS" ? 46 : 60),
        medianAge: mv(42),
        migrationRate: mv(0.2),
      },
      mediaInformation: {
        mediaPolarization: mv(62),
        disinformationRisk: mv(42),
        pressFreedom: mv(52),
        socialMediaSentiment: mv(0),
        newsTrust: mv(40),
      },
    } as StateMetrics);
  });
}

async function loadMetricsBundle(
  countryId: ModernTransitionCountryId,
  preset: string
): Promise<StateMetrics[]> {
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  if (countryId === "RO") {
    const { roStateMetrics2027 } = await import("@/lib/countries/ro/data/roStateMetrics2027");
    return roStateMetrics2027.map((metric) => {
      const overlay = getRegionMetricPresets("RO", String(metric._id), preset);
      return overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
    });
  }
  const regions = await loadRegionBundle("PL");
  const bundle = buildPlTransitionalMetrics(regions);
  return bundle.map((metric) => {
    const overlay = getRegionMetricPresets("PL", String(metric._id), preset);
    return overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
  });
}

export async function seedModernTransitionStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string,
  countryId: ModernTransitionCountryId
) {
  if (!isModernTransitionPreset(preset)) {
    log(`[${countryId}] skipping modern state metrics (preset ${preset})`);
    return;
  }
  const bundle = await loadMetricsBundle(countryId, preset);
  if (reset) {
    await db
      .collection("macroMetrics")
      .deleteMany({ _id: { $in: bundle.map((m) => m._id) } as never });
  }
  // SP5: split write — macro slice -> macroMetrics (all countries), political
  // remainder -> stateMetrics (non-playables). countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    bundle.map((m) => ({ ...m, countryId }) as StateMetrics)
  );
  log(`Seeded ${bundle.length} ${countryId} state metrics (${preset})`);
}

type MetricCategory = Exclude<keyof StateMetrics, "_id" | "lastUpdated">;

const BASELINE_CATEGORIES: MetricCategory[] = [
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

/**
 * Baselines derive 1:1 from the seeded metrics bundle (same algorithm as
 * roStateBaselines2027, which this reproduces for RO). One code path for both
 * countries; the RO-authored file stays the cross-check, not a second writer.
 */
export function metricsToBaselines(metrics: StateMetrics[]): StateMetricBaseline[] {
  return metrics.map((metric) => {
    const baselines: Record<string, Record<string, number>> = {};
    for (const cat of BASELINE_CATEGORIES) {
      const values: Record<string, number> = {};
      for (const [key, entry] of Object.entries(
        (metric[cat] ?? {}) as Record<string, StateMetricValue | undefined>
      )) {
        if (entry) values[key] = entry.value;
      }
      baselines[cat] = values;
    }
    return { _id: String(metric._id), baselines };
  });
}

export async function seedModernTransitionBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string,
  countryId: ModernTransitionCountryId
) {
  if (!isModernTransitionPreset(preset)) {
    log(`[${countryId}] skipping modern baselines (preset ${preset})`);
    return;
  }
  const bundle = await loadMetricsBundle(countryId, preset);
  const { getRegionMetricPresets, applyMetricPresetToBaseline } =
    await import("@/lib/seeds/metricPresets");
  if (reset) {
    await db
      .collection("stateBaselines")
      .deleteMany({ _id: { $in: bundle.map((m) => String(m._id)) } as never });
  }
  const derived = metricsToBaselines(bundle);
  for (const raw of derived) {
    const overlay = getRegionMetricPresets(countryId, String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(raw, overlay) : raw;
    const { _id, ...baselineData } = baseline;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }
  log(`Seeded ${derived.length} ${countryId} baselines (preset: ${preset})`);
}

/**
 * Democratic state-party org: one presence row per region x 2027 party so the
 * modern parties are registered everywhere (the swing-flow engine's defense
 * reads `registration`; without rows every party sits at the newcomer
 * baseline). Values are a neutral transitional fallback (50/50 presence),
 * not a measured ground game. Under reset the country's rows are wiped first,
 * which also clears stale Cold-War org rows for these regions.
 */
export async function seedModernTransitionStatePartyOrg(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string,
  countryId: ModernTransitionCountryId
) {
  if (!isModernTransitionPreset(preset)) {
    log(`[${countryId}] skipping modern state party org (preset ${preset})`);
    return;
  }
  if (reset) {
    await db.collection("statePartyOrg").deleteMany({ countryId });
  }
  const bundle = await loadRegionBundle(countryId);
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId, isDefault: true })
    .toArray();
  const now = new Date();
  let total = 0;
  for (const region of bundle) {
    for (const party of parties) {
      const partyId = String(party.sequentialId);
      const row: Omit<StatePartyOrg, "createdAt" | "updatedAt"> = {
        _id: `${String(region._id)}_${partyId}`,
        countryId,
        stateId: String(region._id),
        partyId,
        organization: 50,
        registration: 50,
        chairId: null,
        viceChairId: null,
        treasurerId: null,
        treasury: 0,
        stateTaxRate: 0,
        politicalStrength: 0,
        hasPresence: true,
        consecutiveLosses: 0,
      };
      const { _id, ...orgData } = row;
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne(
          { _id },
          { $set: { ...orgData, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        );
      total++;
    }
  }
  log(`Seeded ${total} ${countryId} state party org entries across ${parties.length} parties`);
}

/** Full 2027 substrate for one transition country, in dependency order (org last: it reads back the seeded parties). */
export async function seedModernTransitionCountry(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string,
  countryId: ModernTransitionCountryId
) {
  await seedModernTransitionRegions(db, reset, log, preset, countryId);
  await seedModernTransitionParties(db, log, preset, countryId);
  await seedModernTransitionDemographics(db, reset, log, preset, countryId);
  await seedModernTransitionStateMetrics(db, reset, log, preset, countryId);
  await seedModernTransitionBaselines(db, reset, log, preset, countryId);
  await seedModernTransitionStatePartyOrg(db, reset, log, preset, countryId);
}
