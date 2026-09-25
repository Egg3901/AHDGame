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

const HU_REGION_IDS = ["HU_BUD", "HU_PES", "HU_TRW", "HU_TRS", "HU_NOR", "HU_ALF"];

/**
 * Modern (2027-default) Hungary seed path — the democratic Third Republic.
 * Cold-War HU (1953/1979) keeps its guard in bootstrapGameWorld and seeds via
 * seedEasternBlocCountry; this file never runs there. Other modern presets
 * (1991/2019/2023) are out of scope: their roster claims stay as they were.
 */
function isModernHuPreset(preset: string): boolean {
  return preset === "2027-default";
}

export async function seedHURegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (!isModernHuPreset(preset)) {
    log(`[HU] skipping modern regions (preset ${preset})`);
    return;
  }
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "HU" });
  }
  const { huRegions2027 } = await import("@/lib/countries/hu/data/huRegions2027");
  const { huRegions } = await import("@/lib/seeds/hu/huRegions");
  const { huRegions1953 } = await import("@/lib/seeds/hu/huRegions1953");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  const bundle = selectPresetBundle(
    preset,
    {
      "2027-default": huRegions2027,
      "2019-default": huRegions,
      "1979-default": huRegions,
      "1953-default": huRegions1953,
    },
    "seedHU:huRegions"
  );
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} HU regions (${preset})`);
}

export async function seedHUParties(db: Db, log: (msg: string) => void, preset?: string) {
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }
  if (!isModernHuPreset(activePreset)) {
    log(`[HU] skipping modern parties (preset ${activePreset})`);
    return;
  }
  const { huParties } = await import("@/lib/seeds/hu/huParties");
  const { selectPartyRosterForPreset, prunePresetMismatchedDefaultParties } =
    await import("@/lib/seeds/ensureDefaultParties");

  await prunePresetMismatchedDefaultParties(db, huParties as PartySeed[], activePreset);

  const filtered = selectPartyRosterForPreset(huParties as PartySeed[], activePreset);
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
  log(`Seeded ${filtered.length} HU parties (preset: ${activePreset})`);
}

export async function seedHUDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (!isModernHuPreset(preset)) {
    log(`[HU] skipping modern demographics (preset ${preset})`);
    return;
  }
  if (reset) {
    await db.collection("demographicCategories").deleteMany({ _id: "hu_voterGroups" as never });
    await db.collection("stateDemographics").deleteMany({ countryId: "HU" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "HU" });
  }
  const { huDemographicCategories } =
    await import("@/lib/countries/hu/data/huDemographicCategories");
  for (const cat of huDemographicCategories) {
    const { _id, ...catData } = cat;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: catData }, { upsert: true });
  }
  const { getCountryLayer1Model, buildModelRegionDemographics } =
    await import("@/lib/seeds/international");
  const { eraForPreset } = await import("@/lib/seeds/presetSelector");
  const era = eraForPreset(preset);
  const model = getCountryLayer1Model("HU", era);
  if (!model) {
    log("[HU] no Layer-1 model — skipping demographics");
    return;
  }
  const regionDemographics = buildModelRegionDemographics(model);
  for (const raw of regionDemographics) {
    const { _id, ...demoData } = raw;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id }, { $set: demoData }, { upsert: true });
  }
  log(`[HU] Seeded ${regionDemographics.length} region demographics (era ${era})`);
}

export async function seedHUStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (!isModernHuPreset(preset)) {
    log(`[HU] skipping modern state metrics (preset ${preset})`);
    return;
  }
  if (reset) {
    await db.collection("macroMetrics").deleteMany({ _id: { $in: HU_REGION_IDS } as never });
  }
  const { huStateMetrics2027 } = await import("@/lib/countries/hu/data/huStateMetrics2027");
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  // Base bundle is ~2024; no era overlays are registered for HU (2027 no-op).
  const bundle = huStateMetrics2027.map((metric) => {
    const overlay = getRegionMetricPresets("HU", String(metric._id), preset);
    return overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
  });
  // SP5: split write — macro slice -> macroMetrics (all countries), political
  // remainder -> stateMetrics (non-playables). countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    bundle.map((m) => ({ ...m, countryId: "HU" }) as StateMetrics)
  );
  log(`Seeded ${bundle.length} HU state metrics (${preset})`);
}

export async function seedHUBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (!isModernHuPreset(preset)) {
    log(`[HU] skipping modern baselines (preset ${preset})`);
    return;
  }
  if (reset) {
    await db.collection("stateBaselines").deleteMany({ _id: { $in: HU_REGION_IDS } as never });
  }
  const { huStateBaselines2027 } = await import("@/lib/countries/hu/data/huStateBaselines2027");
  const { getRegionMetricPresets, applyMetricPresetToBaseline } =
    await import("@/lib/seeds/metricPresets");
  for (const raw of huStateBaselines2027) {
    // No era adjustments: the bundle is authored for the modern world, and no
    // HU metric-preset overlay is registered for this preset.
    const overlay = getRegionMetricPresets("HU", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(raw, overlay) : raw;
    const { _id, ...baselineData } = baseline;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }
  log(`Seeded ${huStateBaselines2027.length} HU baselines (preset: ${preset})`);
}
