import { ObjectId, type Db } from "mongodb";
import type {
  State,
  PoliticalParty,
  DemographicCategory,
  StateDemographics,
  StateMetrics,
} from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";

/**
 * Seeds USSR regions. The USSR (`SU`) exists in the 1953 and 1979 presets (it
 * dissolved in 1991); enablement is controlled per-preset via
 * `countryGameStates`. Regions have a dedicated 1953 bundle; metrics reuse the
 * ~1979-authored bundle with a 1953 metric-preset overlay (see
 * `ruMetricPresets1953.ts`). Full seed stack (census, demographics, CPSU
 * parties, metrics, baselines, party-org, budget) is added incrementally —
 * this is the regions step.
 */
export async function seedRURegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "RU" });
  }
  const { ruRegions } = await import("@/lib/seeds/ru/ruRegions");
  const { ruRegions1953 } = await import("@/lib/seeds/ru/ruRegions1953");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  const bundle = selectPresetBundle(
    preset,
    {
      "2019-default": ruRegions,
      "1953-default": ruRegions1953,
      "1979-default": ruRegions,
    },
    "seedRU:ruRegions"
  );
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} SU regions (${preset})`);
}

export async function seedRUParties(
  db: Db,
  log: (msg: string) => void,
  // Threaded so party tiers resolve against the ACTIVE preset. This was
  // hardcoded to "1979-default", which seeded the one-party ruling party
  // (CPSU / SED) at "minor" tier in a 1953 world — starting the regime on
  // minor-tier AP/PS caps until partyTierTurn self-corrected from Org.
  preset: string
) {
  const { ruParties } = await import("@/lib/seeds/ru/ruParties");
  const now = new Date();
  for (const party of ruParties as PartySeed[]) {
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
        tier: resolveSeedPartyTier(party, preset),
        transactionApprovalMode: partyData.transactionApprovalMode ?? "double",
        createdAt: now,
        updatedAt: now,
      } as PoliticalParty;
      await db.collection<PoliticalParty>("politicalParties").insertOne(doc);
    }
  }
  log(`Seeded ${ruParties.length} SU parties`);
}

export async function seedRUDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("demographicCategories").deleteMany({ _id: "su_voterGroups" as never });
    await db.collection("stateDemographics").deleteMany({ countryId: "RU" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "RU" });
  }

  const { ruDemographicCategories } = await import("@/lib/seeds/ru/ruDemographicCategories");
  for (const cat of ruDemographicCategories) {
    const { _id, ...catData } = cat;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: catData }, { upsert: true });
  }

  const { getCountryLayer1Model, buildModelRegionDemographics } =
    await import("@/lib/seeds/international");
  const { eraForPreset } = await import("@/lib/seeds/presetSelector");
  const era = eraForPreset(preset);
  const model = getCountryLayer1Model("RU", era);
  if (!model) {
    log("[SU] no Layer-1 model — skipping demographics");
    return;
  }
  const regionDemographics = buildModelRegionDemographics(model);
  for (const raw of regionDemographics) {
    const { _id, ...demoData } = raw;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id }, { $set: demoData }, { upsert: true });
  }

  // Derive the electorate lean onto the states docs. Without this the regions
  // read as "lean not yet derived" and drop out of policy-distance scoring.
  const { persistRegionLeans } = await import("./persistRegionLeans");
  const leanCount = await persistRegionLeans(db, regionDemographics, ruDemographicCategories);

  // Turnout modifier rows (spec §5.1) — one per region, all modifiers 0.
  // The reset branch above already clears them; this fills the gap where they
  // were deleted but never re-seeded.
  const { ruDemographicTurnout } = await import("@/lib/seeds/ru/ruDemographicTurnout");
  for (const turnout of ruDemographicTurnout) {
    const { _id, ...turnoutData } = turnout;
    await db
      .collection("stateDemographicTurnout")
      .updateOne({ _id: _id as never }, { $set: turnoutData }, { upsert: true });
  }

  log(
    `[SU] Seeded ${regionDemographics.length} region demographics + ${ruDemographicTurnout.length} turnout rows + ${leanCount} region leans (era ${era})`
  );
}

const RU_REGION_IDS = [
  "CEN",
  "NWR",
  "NOR",
  "CBE",
  "VOL",
  "NCA",
  "URA",
  "WSB",
  "ESB",
  "FEA",
  "KAZ",
  "TRA",
  "CAS",
  "MOL",
];

export async function seedRUStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("macroMetrics").deleteMany({ _id: { $in: RU_REGION_IDS } as never });
  }
  const { ruStateMetrics } = await import("@/lib/seeds/ru/ruStateMetrics");
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  const { writeSplitMetrics } = await import("@/lib/macroMetrics/split");
  for (const metric of ruStateMetrics) {
    // The base bundle is authored as ~1979 values; the 1953 preset overlays its
    // era-authored values so seeded metrics match the 1953-adjusted baselines
    // (no decay glide from turn 1). Other presets have no RU overlay (no-op).
    const overlay = getRegionMetricPresets("RU", String(metric._id), preset);
    const withPresets = overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
    // SP5: split write — RU is playable, so the splitter emits ONLY the
    // macroMetrics doc (subsumes SP4's strip at seed time).
    await writeSplitMetrics(db, { ...withPresets, countryId: "RU" } as StateMetrics);
  }
  log(`Seeded ${ruStateMetrics.length} SU state metrics (preset: ${preset})`);
}

export async function seedRUBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("stateBaselines").deleteMany({ _id: { $in: RU_REGION_IDS } as never });
  }
  const { ruStateBaselines } = await import("@/lib/seeds/ru/ruStateBaselines");
  const { getRegionMetricPresets, applyMetricPresetToBaseline } =
    await import("@/lib/seeds/metricPresets");
  const is1953 = preset === "1953-default";
  const is1979 = preset === "1979-default";
  const { applyEra1953BaselineAdjustments } = is1953
    ? await import("@/lib/seeds/reference/stateBaselines1953")
    : { applyEra1953BaselineAdjustments: <T>(x: T): T => x };
  const { applyEra1979BaselineAdjustments } = is1979
    ? await import("@/lib/seeds/reference/stateBaselines1979")
    : { applyEra1979BaselineAdjustments: <T>(x: T): T => x };
  for (const raw of ruStateBaselines) {
    const adjusted = is1953
      ? applyEra1953BaselineAdjustments(raw)
      : is1979
        ? applyEra1979BaselineAdjustments(raw)
        : raw;
    // Align decay targets with the authored era metric values (UK/DE/JP pattern):
    // the overlay wins over the generic era shifts for every path it covers.
    const overlay = getRegionMetricPresets("RU", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(adjusted, overlay) : adjusted;
    const { _id, ...baselineData } = baseline;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }
  log(`Seeded ${ruStateBaselines.length} SU baselines (preset: ${preset})`);
}

/**
 * Seed the RU governmentFormations doc (D5: FORMED with the NPC Premier from
 * the SU executive HistoricalSeat rows). Must run AFTER historical officials
 * are seeded so the Premier NPP exists; degrades to `pending` when it doesn't
 * and skips entirely when the preset seeds no RU regions.
 */
export async function seedRUGovernmentFormation(db: Db, log: (msg: string) => void) {
  const { buildRuGovernmentFormation } = await import("@/lib/seeds/ru/ruGovernmentFormation");
  const now = new Date();
  const doc = await buildRuGovernmentFormation(db, now);
  if (!doc) {
    log("RU government formation skipped (no RU regions in this preset)");
    return;
  }
  const { _id, ...formationData } = doc;
  await db
    .collection("governmentFormations")
    .updateOne(
      { _id: _id as never },
      { $set: { ...formationData, createdAt: now, updatedAt: now } },
      { upsert: true }
    );
  log(`Seeded RU government formation (${doc.status}, ${doc.totalSeats} Union seats)`);
}
