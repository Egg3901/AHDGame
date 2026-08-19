import { ObjectId, type Db } from "mongodb";
import { writeSplitMetricsBulk } from "@/lib/macroMetrics/split";
import type {
  State,
  PoliticalParty,
  DemographicCategory,
  StateDemographics,
  StateDemographicTurnout,
  StateMetrics,
} from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";

const CN_REGION_IDS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];

export async function seedCNRegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "CN" });
  }
  const { cnRegions } = await import("@/lib/seeds/cn/cnRegions");
  const { cnRegions1953 } = await import("@/lib/seeds/cn/cnRegions1953");
  const { cnRegions1979 } = await import("@/lib/seeds/cn/cnRegions1979");
  const { cnRegions1991 } = await import("@/lib/seeds/cn/cnRegions1991");
  const { cnRegions1999 } = await import("@/lib/seeds/cn/cnRegions1999");
  const { cnRegions2007 } = await import("@/lib/seeds/cn/cnRegions2007");
  const { cnRegions2023 } = await import("@/lib/seeds/cn/cnRegions2023");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  const bundle = selectPresetBundle(
    preset,
    {
      "1953-default": cnRegions1953,
      "2019-default": cnRegions,
      "1979-default": cnRegions1979,
      "1991-default": cnRegions1991,
      "1999-default": cnRegions1999,
      "2007-default": cnRegions2007,
      "2023-default": cnRegions2023,
    },
    "seedCN:cnRegions1953"
  );
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} CN regions (${preset})`);
}

export async function seedCNParties(db: Db, log: (msg: string) => void) {
  const { cnParties } = await import("@/lib/seeds/cn/cnParties");
  const now = new Date();
  for (const party of cnParties as PartySeed[]) {
    const { seedOrder: _seedOrder, ...partyData } = party;
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
        tier: resolveSeedPartyTier(party, "2019-default"),
        transactionApprovalMode: partyData.transactionApprovalMode ?? "double",
        createdAt: now,
        updatedAt: now,
      } as PoliticalParty;
      await db.collection<PoliticalParty>("politicalParties").insertOne(doc);
    }
  }
  log(`Seeded ${cnParties.length} CN parties`);
}

export async function seedCNDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("demographicCategories").deleteMany({ _id: "cn_voterGroups" as never });
    await db.collection("stateDemographics").deleteMany({ countryId: "CN" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "CN" });
  }

  const { cnDemographicCategories } = await import("@/lib/seeds/cn/cnDemographicCategories");
  for (const cat of cnDemographicCategories) {
    const { _id, ...catData } = cat;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: catData }, { upsert: true });
  }

  const { cnRegionDemographics: cnRegionDemographicsStatic } =
    await import("@/lib/seeds/cn/cnRegionDemographics");
  const is1991 = preset === "1991-default";
  const { applyEra1991DemographicAdjustments } = is1991
    ? await import("@/lib/seeds/reference/stateDemographics1991")
    : { applyEra1991DemographicAdjustments: <T>(x: T): T => x };

  const { isLayer1PositionsEnabled } = await import("@/lib/seeds/layer1PositionsFlag");
  const useLayer1 = await isLayer1PositionsEnabled();
  let cnRegionDemographics: typeof cnRegionDemographicsStatic = cnRegionDemographicsStatic;
  if (useLayer1) {
    const { getCountryLayer1Model, buildModelRegionDemographics } =
      await import("@/lib/seeds/international");
    const { eraForPreset } = await import("@/lib/seeds/presetSelector");
    const { loadFullOverride } = await import("@/lib/seeds/loadEraPositionOverride");
    const era = eraForPreset(preset);
    const model = getCountryLayer1Model("CN", era);
    if (model) {
      const full = await loadFullOverride("CN", era);
      if (full) log(`[CN] Applying model override for era ${era}`);
      cnRegionDemographics = buildModelRegionDemographics(
        model,
        full?.positions ?? undefined,
        full ? { turnout: full.turnout } : undefined
      );
      log(
        `[CN] Using Layer-1-derived demographics (${cnRegionDemographics.length} regions, era ${era})`
      );
    }
  }
  for (const raw of cnRegionDemographics) {
    const demo = is1991 ? applyEra1991DemographicAdjustments(raw, "CN") : raw;
    const { _id, ...demoData } = demo;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id }, { $set: demoData }, { upsert: true });
  }

  const { cnDemographicTurnout } = await import("@/lib/seeds/cn/cnDemographicTurnout");
  for (const turnout of cnDemographicTurnout) {
    const { _id, ...turnoutData } = turnout;
    await db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .updateOne({ _id }, { $set: turnoutData }, { upsert: true });
  }

  log(
    `Seeded CN demographics (preset: ${preset}, ${cnDemographicCategories.length} categories, ${cnRegionDemographics.length} regions, ${cnDemographicTurnout.length} turnout)`
  );
}

export async function seedCNStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("macroMetrics").deleteMany({
      _id: { $in: CN_REGION_IDS } as never,
    });
  }
  const { cnStateMetrics } = await import("@/lib/seeds/cn/cnStateMetrics");
  const { applyEra1991Adjustments } = await import("@/lib/seeds/reference/stateMetrics1991");
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  const transformed =
    preset === "1991-default" ? cnStateMetrics.map(applyEra1991Adjustments) : cnStateMetrics;
  // Overlay the per-region/era authored values for the new ROOT metrics (both eras authored).
  const bundle = transformed.map((metric) => {
    const overlay = getRegionMetricPresets("CN", String(metric._id), preset);
    return overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
  });
  // SP5: split write — macro slice -> macroMetrics (all countries), political
  // remainder -> stateMetrics (non-playables). countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    bundle.map((m) => ({ ...m, countryId: "CN" }) as StateMetrics)
  );
  log(`Seeded ${bundle.length} CN state metrics (${preset})`);
}

export async function seedCNBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("stateBaselines").deleteMany({
      _id: { $in: CN_REGION_IDS } as never,
    });
  }
  const { cnStateBaselines } = await import("@/lib/seeds/cn/cnStateBaselines");
  const { getRegionMetricPresets, applyMetricPresetToBaseline } =
    await import("@/lib/seeds/metricPresets");
  const is1991 = preset === "1991-default";
  const is1953 = preset === "1953-default";
  const is1979 = preset === "1979-default";
  const { applyEra1991BaselineAdjustments } = is1991
    ? await import("@/lib/seeds/reference/stateBaselines1991")
    : { applyEra1991BaselineAdjustments: <T>(x: T): T => x };
  const { applyEra1953BaselineAdjustments } = is1953
    ? await import("@/lib/seeds/reference/stateBaselines1953")
    : { applyEra1953BaselineAdjustments: <T>(x: T): T => x };
  const { applyEra1979BaselineAdjustments } = is1979
    ? await import("@/lib/seeds/reference/stateBaselines1979")
    : { applyEra1979BaselineAdjustments: <T>(x: T): T => x };
  for (const raw of cnStateBaselines) {
    const adjusted = is1991
      ? applyEra1991BaselineAdjustments(raw)
      : is1953
        ? applyEra1953BaselineAdjustments(raw)
        : is1979
          ? applyEra1979BaselineAdjustments(raw)
          : raw;
    // Align decay targets with the authored metric values (both eras).
    const overlay = getRegionMetricPresets("CN", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(adjusted, overlay) : adjusted;
    const { _id, ...baselineData } = baseline;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }
  log(`Seeded ${cnStateBaselines.length} CN baselines (preset: ${preset})`);
}

export async function seedCNGovernmentFormation(db: Db, log: (msg: string) => void) {
  const { cnGovernmentFormation } = await import("@/lib/seeds/cn/cnGovernmentFormation");
  const now = new Date();
  const { _id, ...formationData } = cnGovernmentFormation;
  await db
    .collection<GovernmentFormation>("governmentFormations")
    .updateOne(
      { _id },
      { $set: { ...formationData, createdAt: now, updatedAt: now } },
      { upsert: true }
    );
  log("Seeded CN government formation document");
}

export { seedCnStatePartyOrg } from "./seedCnStatePartyOrg";
