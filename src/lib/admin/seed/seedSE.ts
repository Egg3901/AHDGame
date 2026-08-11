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

const SE_REGION_IDS = [
  "SE_STH",
  "SE_GOT",
  "SE_SKA",
  "SE_EAS",
  "SE_SML",
  "SE_VML",
  "SE_NOR",
  "SE_UPP",
];

export async function seedSERegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "SE" });
  }
  const { seRegions } = await import("@/lib/seeds/se/seRegions");
  const { seRegions1953 } = await import("@/lib/seeds/se/seRegions1953");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  const bundle = selectPresetBundle(
    preset,
    {
      "2019-default": seRegions,
      "1953-default": seRegions1953,
      "1979-default": seRegions,
    },
    "seedSE:seRegions"
  );
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} SE regions (${preset})`);
}

export async function seedSEParties(db: Db, log: (msg: string) => void, preset?: string) {
  const { seParties } = await import("@/lib/seeds/se/seParties");
  const { isPartyValidForPreset, prunePresetMismatchedDefaultParties } =
    await import("@/lib/seeds/ensureDefaultParties");

  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  await prunePresetMismatchedDefaultParties(db, seParties as PartySeed[], activePreset);

  const filtered = (seParties as PartySeed[]).filter((seed) =>
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
  log(`Seeded ${filtered.length} SE parties (preset: ${activePreset})`);
}

export async function seedSEDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("demographicCategories").deleteMany({ _id: "se_voterGroups" as never });
    await db.collection("stateDemographics").deleteMany({ countryId: "SE" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "SE" });
  }
  const { seDemographicCategories } = await import("@/lib/seeds/se/seDemographicCategories");
  for (const cat of seDemographicCategories) {
    const { _id, ...catData } = cat;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: catData }, { upsert: true });
  }
  const { getCountryLayer1Model, buildModelRegionDemographics } =
    await import("@/lib/seeds/international");
  const { eraForPreset } = await import("@/lib/seeds/presetSelector");
  const era = eraForPreset(preset);
  const model = getCountryLayer1Model("SE", era);
  if (!model) {
    log("[SE] no Layer-1 model — skipping demographics");
    return;
  }
  const regionDemographics = buildModelRegionDemographics(model);
  for (const raw of regionDemographics) {
    const { _id, ...demoData } = raw;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id }, { $set: demoData }, { upsert: true });
  }
  log(`[SE] Seeded ${regionDemographics.length} region demographics (era ${era})`);
}

export async function seedSEStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("macroMetrics").deleteMany({ _id: { $in: SE_REGION_IDS } as never });
  }
  const { seStateMetrics } = await import("@/lib/seeds/se/seStateMetrics");
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  // Base bundle is ~1979; 1953 overlay is the only registered SE preset (2019 no-op).
  const bundle = seStateMetrics.map((metric) => {
    const overlay = getRegionMetricPresets("SE", String(metric._id), preset);
    return overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
  });
  // SP5: split write — macro slice -> macroMetrics (all countries), political
  // remainder -> stateMetrics (non-playables). countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    bundle.map((m) => ({ ...m, countryId: "SE" }) as StateMetrics)
  );
  log(`Seeded ${bundle.length} SE state metrics (${preset})`);
}

export async function seedSEBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("stateBaselines").deleteMany({ _id: { $in: SE_REGION_IDS } as never });
  }
  const { seStateBaselines } = await import("@/lib/seeds/se/seStateBaselines");
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
  for (const raw of seStateBaselines) {
    const adjusted = is1953
      ? applyEra1953BaselineAdjustments(raw)
      : is1979
        ? applyEra1979BaselineAdjustments(raw)
        : raw;
    // Align decay targets with the authored metric overlay (1953); no-op otherwise.
    const overlay = getRegionMetricPresets("SE", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(adjusted, overlay) : adjusted;
    const { _id, ...baselineData } = baseline;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }
  log(`Seeded ${seStateBaselines.length} SE baselines (preset: ${preset})`);
}
