import { ObjectId, type Db } from "mongodb";
import { writeSplitMetricsBulk } from "@/lib/macroMetrics/split";
import {
  State,
  PoliticalParty,
  DemographicCategory,
  StateDemographics,
  StateDemographicTurnout,
  StateMetrics,
  StatePartyOrg,
} from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import { getGameStatePresetOrDefault, DEFAULT_SEED_PRESET } from "@/lib/db/collections/gameState";

const IE_REGION_IDS = ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"];

export async function seedIERegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "IE" });
  }
  const { ieRegions } = await import("@/lib/seeds/ie/ieRegions");
  const { ieRegions1953 } = await import("@/lib/seeds/ie/ieRegions1953");
  const { ieRegions1979 } = await import("@/lib/seeds/ie/ieRegions1979");
  const { ieRegions1991 } = await import("@/lib/seeds/ie/ieRegions1991");
  const { ieRegions1999 } = await import("@/lib/seeds/ie/ieRegions1999");
  const { ieRegions2007 } = await import("@/lib/seeds/ie/ieRegions2007");
  const { ieRegions2023 } = await import("@/lib/seeds/ie/ieRegions2023");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  const bundle = selectPresetBundle(
    preset,
    {
      "1953-default": ieRegions1953,
      "2019-default": ieRegions,
      "1979-default": ieRegions1979,
      "1991-default": ieRegions1991,
      "1999-default": ieRegions1999,
      "2007-default": ieRegions2007,
      "2023-default": ieRegions2023,
    },
    "seedIE:ieRegions1953"
  );
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} IE regions (${preset})`);
}

export async function seedIEParties(db: Db, log: (msg: string) => void, preset?: string) {
  const { isPartyValidForPreset } = await import("@/lib/seeds/ensureDefaultParties");
  const { ieParties } = await import("@/lib/seeds/ie/ieParties");

  let activePreset = preset;
  if (!activePreset) {
    const gameState = await db
      .collection<{ preset?: string }>("gameState")
      .findOne({ _id: "current" as unknown as undefined });
    activePreset = gameState?.preset ?? DEFAULT_SEED_PRESET;
  }

  const filtered = (ieParties as PartySeed[]).filter((seed) =>
    isPartyValidForPreset(seed, activePreset!)
  );

  const now = new Date();
  for (const party of filtered) {
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
        tier: resolveSeedPartyTier(party, activePreset),
        transactionApprovalMode: partyData.transactionApprovalMode ?? "double",
        createdAt: now,
        updatedAt: now,
      } as PoliticalParty;
      await db.collection<PoliticalParty>("politicalParties").insertOne(doc);
    }
  }
  log(`Seeded ${filtered.length}/${ieParties.length} IE parties for preset ${activePreset}`);
}

export async function seedIEDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("demographicCategories").deleteMany({ _id: "ie_voterGroups" as never });
    await db.collection("stateDemographics").deleteMany({ countryId: "IE" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "IE" });
  }

  const { ieDemographicCategories } = await import("@/lib/seeds/ie/ieDemographicCategories");
  for (const cat of ieDemographicCategories) {
    const { _id, ...catData } = cat;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: catData }, { upsert: true });
  }

  const { ieRegionDemographics: ieRegionDemographicsStatic } =
    await import("@/lib/seeds/ie/ieRegionDemographics");
  const is1991 = preset === "1991-default";
  const { applyEra1991DemographicAdjustments } = is1991
    ? await import("@/lib/seeds/reference/stateDemographics1991")
    : { applyEra1991DemographicAdjustments: <T>(x: T): T => x };

  const { isLayer1PositionsEnabled } = await import("@/lib/seeds/layer1PositionsFlag");
  const useLayer1 = await isLayer1PositionsEnabled();
  let ieRegionDemographics: typeof ieRegionDemographicsStatic = ieRegionDemographicsStatic;
  if (useLayer1) {
    const { getCountryLayer1Model, buildModelRegionDemographics } =
      await import("@/lib/seeds/international");
    const { eraForPreset } = await import("@/lib/seeds/presetSelector");
    const { loadFullOverride } = await import("@/lib/seeds/loadEraPositionOverride");
    const era = eraForPreset(preset);
    const model = getCountryLayer1Model("IE", era);
    if (model) {
      const full = await loadFullOverride("IE", era);
      if (full) log(`[IE] Applying model override for era ${era}`);
      ieRegionDemographics = buildModelRegionDemographics(
        model,
        full?.positions ?? undefined,
        full ? { turnout: full.turnout } : undefined
      );
      log(
        `[IE] Using Layer-1-derived demographics (${ieRegionDemographics.length} regions, era ${era})`
      );
    }
  }
  for (const raw of ieRegionDemographics) {
    const demo = is1991 ? applyEra1991DemographicAdjustments(raw, "IE") : raw;
    const { _id, ...demoData } = demo;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id }, { $set: demoData }, { upsert: true });
  }

  const { ieDemographicTurnout } = await import("@/lib/seeds/ie/ieDemographicTurnout");
  for (const turnout of ieDemographicTurnout) {
    const { _id, ...turnoutData } = turnout;
    await db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .updateOne({ _id }, { $set: turnoutData }, { upsert: true });
  }

  log(
    `Seeded IE demographics (preset: ${preset}, ${ieDemographicCategories.length} categories, ${ieRegionDemographics.length} regions, ${ieDemographicTurnout.length} turnout)`
  );
}

export async function seedIEStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("macroMetrics").deleteMany({
      _id: { $in: IE_REGION_IDS } as never,
    });
  }
  const { ieStateMetrics } = await import("@/lib/seeds/ie/ieStateMetrics");
  const { applyEra1991Adjustments } = await import("@/lib/seeds/reference/stateMetrics1991");
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  const transformed =
    preset === "1991-default" ? ieStateMetrics.map(applyEra1991Adjustments) : ieStateMetrics;
  // Overlay the per-region/era authored values for the new ROOT metrics. Runs AFTER
  // applyEra1991Adjustments so an authored era value is the final word (e.g. IE-1991
  // debtToGdp ~95% replaces the blanket ×0.5 floor). Unauthored metrics keep their
  // uniformMetricDefault. For 2019 this is a no-op (presets derive from the seed).
  const bundle = transformed.map((metric) => {
    const overlay = getRegionMetricPresets("IE", String(metric._id), preset);
    return overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
  });
  // SP5: split write — macro slice -> macroMetrics (all countries), political
  // remainder -> stateMetrics (non-playables). countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    bundle.map((m) => ({ ...m, countryId: "IE" }) as StateMetrics)
  );
  log(`Seeded ${bundle.length} IE state metrics (${preset})`);
}

export async function seedIEBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("stateBaselines").deleteMany({
      _id: { $in: IE_REGION_IDS } as never,
    });
  }
  const { ieStateBaselines } = await import("@/lib/seeds/ie/ieStateBaselines");
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
  for (const raw of ieStateBaselines) {
    const adjusted = is1991
      ? applyEra1991BaselineAdjustments(raw)
      : is1953
        ? applyEra1953BaselineAdjustments(raw)
        : is1979
          ? applyEra1979BaselineAdjustments(raw)
          : raw;
    // Overlay the authored metric presets onto the decay targets so a 1991 world doesn't
    // decay back toward 2019-shaped baselines for the new ROOT metrics (rdIntensity,
    // energyTransitionProgress, debtToGdp, …). No-op for 2019 (baselines derive from the seed).
    const overlay = getRegionMetricPresets("IE", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(adjusted, overlay) : adjusted;
    const { _id, ...baselineData } = baseline;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }
  log(`Seeded ${ieStateBaselines.length} IE baselines (preset: ${preset})`);
}

export async function seedIEGovernmentFormation(
  db: Db,
  log: (msg: string) => void,
  preset: string
) {
  const { ieGovernmentFormation } = await import("@/lib/seeds/ie/ieGovernmentFormation");
  const now = new Date();
  const { _id, ...formationData } = ieGovernmentFormation;
  // 1953 Dáil Éireann had 147 seats (13th Dáil). Majority: 74.
  const eraOverride = preset === "1953-default" ? { totalSeats: 147, majorityThreshold: 74 } : {};
  await db
    .collection<GovernmentFormation>("governmentFormations")
    .updateOne(
      { _id },
      { $set: { ...formationData, ...eraOverride, createdAt: now, updatedAt: now } },
      { upsert: true }
    );
  log("Seeded IE government formation document");
}

/**
 * Seed IE statePartyOrg rows derived from per-preset regional vote-share
 * estimates. Mirrors the JP/DE/CN pattern. Reset clears existing IE rows.
 */
export async function seedIEStatePartyOrg(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset?: string
) {
  if (reset) {
    await db.collection("statePartyOrg").deleteMany({ countryId: "IE" });
  }

  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  const { calculateIEStatePartyOrgs } = await import("@/lib/seeds/ie/ieStatePartyOrgCalculations");
  const orgs = await calculateIEStatePartyOrgs(db, activePreset);
  const now = new Date();
  for (const org of orgs) {
    const { _id, ...orgData } = org;
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne({ _id }, { $set: { ...orgData, updatedAt: now } }, { upsert: true });
  }
  log(`Seeded ${orgs.length} IE state party org records (preset: ${activePreset})`);
}

/**
 * Non-destructive variant of `seedIEStatePartyOrg`: inserts polling-derived
 * rows for (region, party) pairs that don't already exist (e.g. 1991-only
 * parties when switching presets). Player-modified org values on existing
 * rows are preserved — never overwrites a row that's there.
 */
export async function ensureMissingIEStatePartyOrgRows(
  db: Db,
  log: (msg: string) => void,
  preset?: string
): Promise<void> {
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  const { calculateIEStatePartyOrgs } = await import("@/lib/seeds/ie/ieStatePartyOrgCalculations");
  const now = new Date();
  const orgs = await calculateIEStatePartyOrgs(db, activePreset);

  const ids = orgs.map((o) => o._id);
  const existing = await db
    .collection<StatePartyOrg>("statePartyOrg")
    /* eslint-disable @typescript-eslint/no-explicit-any */
    .find({ _id: { $in: ids as any } } as any)
    /* eslint-enable @typescript-eslint/no-explicit-any */
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  const existingIds = new Set(existing.map((r) => String(r._id)));
  const missing = orgs.filter((o) => !existingIds.has(o._id));
  if (missing.length > 0) {
    for (const org of missing) {
      const { _id, ...orgData } = org;
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne(
          { _id },
          { $set: { ...orgData, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        );
    }
    log(`Inserted ${missing.length} missing IE state party org row(s) (preset: ${activePreset})`);
  }
}
