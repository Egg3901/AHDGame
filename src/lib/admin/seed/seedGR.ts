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

const GR_REGION_IDS = ["GR_ATT", "GR_MAC", "GR_THE", "GR_EPC", "GR_PEL", "GR_ISL"];

export async function seedGRRegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "GR" });
  }
  const { grRegions } = await import("@/lib/seeds/gr/grRegions");
  const { grRegions1953 } = await import("@/lib/seeds/gr/grRegions1953");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  const bundle = selectPresetBundle(
    preset,
    {
      "2019-default": grRegions,
      "1953-default": grRegions1953,
      "1979-default": grRegions,
    },
    "seedGR:grRegions"
  );
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} GR regions (${preset})`);
}

export async function seedGRParties(db: Db, log: (msg: string) => void, preset?: string) {
  const { grParties } = await import("@/lib/seeds/gr/grParties");
  const { isPartyValidForPreset, prunePresetMismatchedDefaultParties } =
    await import("@/lib/seeds/ensureDefaultParties");

  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  await prunePresetMismatchedDefaultParties(db, grParties as PartySeed[], activePreset);

  const filtered = (grParties as PartySeed[]).filter((seed) =>
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
  log(`Seeded ${filtered.length} GR parties (preset: ${activePreset})`);
}

export async function seedGRDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("demographicCategories").deleteMany({ _id: "gr_voterGroups" as never });
    await db.collection("stateDemographics").deleteMany({ countryId: "GR" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "GR" });
  }
  const { grDemographicCategories } = await import("@/lib/seeds/gr/grDemographicCategories");
  for (const cat of grDemographicCategories) {
    const { _id, ...catData } = cat;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: catData }, { upsert: true });
  }
  const { getCountryLayer1Model, buildModelRegionDemographics } =
    await import("@/lib/seeds/international");
  const { eraForPreset } = await import("@/lib/seeds/presetSelector");
  const era = eraForPreset(preset);
  const model = getCountryLayer1Model("GR", era);
  if (!model) {
    log("[GR] no Layer-1 model — skipping demographics");
    return;
  }
  const regionDemographics = buildModelRegionDemographics(model);
  for (const raw of regionDemographics) {
    const { _id, ...demoData } = raw;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id }, { $set: demoData }, { upsert: true });
  }
  log(`[GR] Seeded ${regionDemographics.length} region demographics (era ${era})`);
}

export async function seedGRStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("macroMetrics").deleteMany({ _id: { $in: GR_REGION_IDS } as never });
  }
  const { grStateMetrics } = await import("@/lib/seeds/gr/grStateMetrics");
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  // Base bundle is ~1979; 1953 overlay is the only registered GR preset (2019 no-op).
  const bundle = grStateMetrics.map((metric) => {
    const overlay = getRegionMetricPresets("GR", String(metric._id), preset);
    return overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
  });
  // SP5: split write — macro slice -> macroMetrics (all countries), political
  // remainder -> stateMetrics (non-playables). countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    bundle.map((m) => ({ ...m, countryId: "GR" }) as StateMetrics)
  );
  log(`Seeded ${bundle.length} GR state metrics (${preset})`);
}

export async function seedGRBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("stateBaselines").deleteMany({ _id: { $in: GR_REGION_IDS } as never });
  }
  const { grStateBaselines } = await import("@/lib/seeds/gr/grStateBaselines");
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
  for (const raw of grStateBaselines) {
    const adjusted = is1953
      ? applyEra1953BaselineAdjustments(raw)
      : is1979
        ? applyEra1979BaselineAdjustments(raw)
        : raw;
    // Align decay targets with the authored metric overlay (1953); no-op otherwise.
    const overlay = getRegionMetricPresets("GR", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(adjusted, overlay) : adjusted;
    const { _id, ...baselineData } = baseline;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }
  log(`Seeded ${grStateBaselines.length} GR baselines (preset: ${preset})`);
}
