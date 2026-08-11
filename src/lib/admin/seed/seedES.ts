import { ObjectId, type Db } from "mongodb";
import { writeSplitMetricsBulk } from "@/lib/macroMetrics/split";
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
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

const ES_REGION_IDS = [
  "ES_MAD",
  "ES_CAT",
  "ES_AND",
  "ES_VAL",
  "ES_PVB",
  "ES_GAL",
  "ES_NOR",
  "ES_CEN",
];

export async function seedESRegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "ES" });
  }
  const { esRegions } = await import("@/lib/seeds/es/esRegions");
  const { esRegions1953 } = await import("@/lib/seeds/es/esRegions1953");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  const bundle = selectPresetBundle(
    preset,
    {
      "2019-default": esRegions,
      "1953-default": esRegions1953,
      "1979-default": esRegions,
    },
    "seedES:esRegions"
  );
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} ES regions (${preset})`);
}

export async function seedESParties(db: Db, log: (msg: string) => void, preset?: string) {
  const { esParties } = await import("@/lib/seeds/es/esParties");
  const { isPartyValidForPreset, prunePresetMismatchedDefaultParties } =
    await import("@/lib/seeds/ensureDefaultParties");

  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  await prunePresetMismatchedDefaultParties(db, esParties as PartySeed[], activePreset);

  const filtered = (esParties as PartySeed[]).filter((seed) =>
    isPartyValidForPreset(seed, activePreset)
  );
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
  log(`Seeded ${filtered.length} ES parties (preset: ${activePreset})`);
}

export async function seedESDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("demographicCategories").deleteMany({ _id: "es_voterGroups" as never });
    await db.collection("stateDemographics").deleteMany({ countryId: "ES" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "ES" });
  }
  const { esDemographicCategories } = await import("@/lib/seeds/es/esDemographicCategories");
  for (const cat of esDemographicCategories) {
    const { _id, ...catData } = cat;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: catData }, { upsert: true });
  }
  const { getCountryLayer1Model, buildModelRegionDemographics } =
    await import("@/lib/seeds/international");
  const { eraForPreset } = await import("@/lib/seeds/presetSelector");
  const era = eraForPreset(preset);
  const model = getCountryLayer1Model("ES", era);
  if (!model) {
    log("[ES] no Layer-1 model — skipping demographics");
    return;
  }
  const regionDemographics = buildModelRegionDemographics(model);
  for (const raw of regionDemographics) {
    const { _id, ...demoData } = raw;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id }, { $set: demoData }, { upsert: true });
  }
  log(`[ES] Seeded ${regionDemographics.length} region demographics (era ${era})`);
}

export async function seedESStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("macroMetrics").deleteMany({ _id: { $in: ES_REGION_IDS } as never });
  }
  const { esStateMetrics } = await import("@/lib/seeds/es/esStateMetrics");
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  // Base bundle is ~1979; 1953 overlay is the only registered ES preset (2019 no-op).
  const bundle = esStateMetrics.map((metric) => {
    const overlay = getRegionMetricPresets("ES", String(metric._id), preset);
    return overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
  });
  // SP5: split write — macro slice -> macroMetrics (all countries), political
  // remainder -> stateMetrics (non-playables). countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    bundle.map((m) => ({ ...m, countryId: "ES" }) as StateMetrics)
  );
  log(`Seeded ${bundle.length} ES state metrics (${preset})`);
}

export async function seedESBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("stateBaselines").deleteMany({ _id: { $in: ES_REGION_IDS } as never });
  }
  const { esStateBaselines } = await import("@/lib/seeds/es/esStateBaselines");
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
  for (const raw of esStateBaselines) {
    const adjusted = is1953
      ? applyEra1953BaselineAdjustments(raw)
      : is1979
        ? applyEra1979BaselineAdjustments(raw)
        : raw;
    // Align decay targets with the authored metric overlay (1953); no-op otherwise.
    const overlay = getRegionMetricPresets("ES", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(adjusted, overlay) : adjusted;
    const { _id, ...baselineData } = baseline;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }
  log(`Seeded ${esStateBaselines.length} ES baselines (preset: ${preset})`);
}
