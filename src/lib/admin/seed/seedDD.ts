import { ObjectId, type Db } from "mongodb";
import type {
  State,
  PoliticalParty,
  DemographicCategory,
  StateDemographics,
  StateMetrics,
} from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import { eraForPreset } from "@/lib/seeds/presetSelector";

// Both Cold-War seeds (1953 + 1979) put East Germany on the modern
// eastern-Länder codes that the unified-era FRG seeds carry under `DE`
// (`BB/MV/SN/ST/TH`) plus East Berlin (`BEO`). The shared Länder codes belong
// to DE in a unified era and are DD's ONLY in the divided eras; `BEO` is
// DD-exclusive in every era (the retired `DD_*` macro-region ids stay in the
// exclusive cleanup list so legacy worlds seeded on them still get cleaned).
// So a DIVIDED-era reset cleans the full union (clearing whichever era's codes
// a prior seed left), while a UNIFIED-era reset cleans only the exclusive
// codes — the shared Länder there belong to (and are re-seeded by) DE, so
// deleting them would wipe DE's freshly-seeded data.
const DD_EXCLUSIVE_REGION_IDS = ["BEO", "DD_BER", "DD_NOR", "DD_SOU"];
const DD_DIVIDED_REGION_IDS = [...DD_EXCLUSIVE_REGION_IDS, "MV", "BB", "ST", "SN", "TH"];

/** DD (the GDR) exists in the 1953 and 1979 divided-Germany eras. */
function isDividedGermanyEra(preset: string): boolean {
  const era = eraForPreset(preset);
  return era === "1953" || era === "1979";
}

/** Retired 1953 macro-region ids (pre-Länder model). Kept out of live seeds. */
const DD_LEGACY_MACRO_REGION_IDS = ["DD_BER", "DD_NOR", "DD_SOU"] as const;

export async function seedDDRegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "DD" });
  }
  const { ddRegions } = await import("@/lib/seeds/dd/ddRegions");
  const { ddRegions1953 } = await import("@/lib/seeds/dd/ddRegions1953");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  // DD's Länder codes are shared with DE, so the GDR's territory is seeded ONLY in
  // divided-Germany eras (1953, 1979); unified eras own the eastern Länder under DE
  // and get an empty bundle. The countryId-scoped delete above still cleans up on
  // a downgrade.
  const bundle = selectPresetBundle<State[]>(
    preset,
    {
      "2019-default": [],
      "1953-default": ddRegions1953,
      "1979-default": ddRegions,
    },
    "seedDD:ddRegions1953"
  );
  // Always purge the retired DD_* macro-regions when (re)seeding the Länder
  // model — even if `reset` is false. A half-migrated world that kept
  // DD_BER/NOR/SOU on `states` while metrics keyed on BEO/MV/BB/ST/SN/TH left
  // the metric engine unable to compound state.gdp, so DD's economy stayed
  // byte-identical across independent sims (#3370 P3).
  if (isDividedGermanyEra(preset)) {
    const legacyDelete = await db
      .collection("states")
      .deleteMany({ _id: { $in: [...DD_LEGACY_MACRO_REGION_IDS] } as never });
    if (legacyDelete.deletedCount > 0) {
      log(`[DD] purged ${legacyDelete.deletedCount} legacy macro-region state(s)`);
    }
  }
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} DD regions (${preset})`);
}

export async function seedDDParties(
  db: Db,
  log: (msg: string) => void,
  // Threaded so party tiers resolve against the ACTIVE preset. This was
  // hardcoded to "1979-default", which seeded the one-party ruling party
  // (CPSU / SED) at "minor" tier in a 1953 world — starting the regime on
  // minor-tier AP/PS caps until partyTierTurn self-corrected from Org.
  preset: string
) {
  const { ddParties } = await import("@/lib/seeds/dd/ddParties");
  const now = new Date();
  for (const party of ddParties as PartySeed[]) {
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
  log(`Seeded ${ddParties.length} DD parties`);
}

export async function seedDDDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("demographicCategories").deleteMany({ _id: "dd_voterGroups" as never });
    await db.collection("stateDemographics").deleteMany({ countryId: "DD" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "DD" });
  }
  // DD's region demographics are keyed by the shared eastern-Länder codes, so seed
  // them only in the divided (1979) era — otherwise we'd clobber DE's demographics
  // for BB/MV/SN/ST/TH. The countryId-scoped delete above still cleans up on a
  // downgrade.
  if (!isDividedGermanyEra(preset)) {
    log("[DD] skipped demographics (unified era)");
    return;
  }
  const { ddDemographicCategories } = await import("@/lib/seeds/dd/ddDemographicCategories");
  for (const cat of ddDemographicCategories) {
    const { _id, ...catData } = cat;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: catData }, { upsert: true });
  }
  const { getCountryLayer1Model, buildModelRegionDemographics } =
    await import("@/lib/seeds/international");
  const { eraForPreset } = await import("@/lib/seeds/presetSelector");
  const era = eraForPreset(preset);
  const model = getCountryLayer1Model("DD", era);
  if (!model) {
    log("[DD] no Layer-1 model — skipping demographics");
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
  const leanCount = await persistRegionLeans(db, regionDemographics, ddDemographicCategories);
  log(
    `[DD] Seeded ${regionDemographics.length} region demographics + ${leanCount} region leans (era ${era})`
  );
}

export async function seedDDStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  const divided = isDividedGermanyEra(preset);
  if (reset) {
    // In a unified era only clean DD's exclusive codes — the shared eastern-Länder
    // metrics belong to (and are re-seeded by) DE, so deleting them here would wipe
    // DE's data.
    const ids = divided ? DD_DIVIDED_REGION_IDS : DD_EXCLUSIVE_REGION_IDS;
    await db.collection("macroMetrics").deleteMany({ _id: { $in: ids } as never });
  }
  if (!divided) {
    log("[DD] skipped state metrics (unified era)");
    return;
  }
  // Both Cold-War bundles key the same eastern-Länder codes; each era carries
  // its own authored values. Mirror seedDDRegions' selectPresetBundle dispatch.
  const { ddStateMetrics } = await import("@/lib/seeds/dd/ddStateMetrics");
  const { ddStateMetrics1953 } = await import("@/lib/seeds/dd/ddStateMetrics1953");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  const { writeSplitMetricsBulk } = await import("@/lib/macroMetrics/split");
  const metrics = selectPresetBundle<StateMetrics[]>(
    preset,
    {
      "2019-default": [],
      "1953-default": ddStateMetrics1953,
      "1979-default": ddStateMetrics,
    },
    "seedDD:ddStateMetrics1953"
  );
  // SP5: split write — macro slice -> macroMetrics (all countries), political
  // remainder -> stateMetrics (non-playables). countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    metrics.map((m) => ({ ...m, countryId: "DD" }) as StateMetrics)
  );
  log(`Seeded ${metrics.length} DD state metrics (${preset})`);
}

export async function seedDDBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  const divided = isDividedGermanyEra(preset);
  if (reset) {
    // Baselines have no countryId, so scope by code: in a unified era only clean
    // DD's exclusive codes (the shared eastern-Länder baselines belong to DE).
    const ids = divided ? DD_DIVIDED_REGION_IDS : DD_EXCLUSIVE_REGION_IDS;
    await db.collection("stateBaselines").deleteMany({ _id: { $in: ids } as never });
  }
  if (!divided) {
    log("[DD] skipped baselines (unified era)");
    return;
  }
  const is1953 = preset === "1953-default";
  const is1979 = preset === "1979-default";
  // 1953 has a self-contained, era-authored baseline bundle (macro-region codes), so
  // it is seeded AS-IS — NO applyEra1953BaselineAdjustments on top. That transform
  // shifts a 2019-structured baseline down to 1953 (income ×0.06, lifeExpectancy −10,
  // urbanization ×0.75, …); applying it to already-1953 values would double-shift
  // them. The 1979 path keeps its existing derive-from-metrics + applyEra1979 adjust.
  if (is1953) {
    const { ddStateBaselines1953 } = await import("@/lib/seeds/dd/ddStateBaselines1953");
    for (const raw of ddStateBaselines1953) {
      const { _id, ...baselineData } = raw;
      await db
        .collection<StateMetricBaseline>("stateBaselines")
        .updateOne({ _id }, { $set: baselineData }, { upsert: true });
    }
    log(`Seeded ${ddStateBaselines1953.length} DD baselines (preset: ${preset})`);
    return;
  }
  const { ddStateBaselines } = await import("@/lib/seeds/dd/ddStateBaselines");
  const { applyEra1979BaselineAdjustments } = is1979
    ? await import("@/lib/seeds/reference/stateBaselines1979")
    : { applyEra1979BaselineAdjustments: <T>(x: T): T => x };
  for (const raw of ddStateBaselines) {
    const adjusted = is1979 ? applyEra1979BaselineAdjustments(raw) : raw;
    const { _id, ...baselineData } = adjusted;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }
  log(`Seeded ${ddStateBaselines.length} DD baselines (preset: ${preset})`);
}

/**
 * Seed DD's initial governmentFormation doc in "pending" status (mirrors
 * seedCNGovernmentFormation, the sibling one-party parliamentary state). The turn
 * processor appoints the General Secretary on turn 1 via the parliamentary
 * government phases, so a divided-Germany world doesn't open with a vacant
 * executive. Era-gated: DD only exists in the 1953/1979 presets.
 */
export async function seedDDGovernmentFormation(
  db: Db,
  log: (msg: string) => void,
  preset: string
) {
  if (!isDividedGermanyEra(preset)) {
    log("[DD] skipped government formation (unified era)");
    return;
  }
  const { ddGovernmentFormation } = await import("@/lib/seeds/dd/ddGovernmentFormation");
  const now = new Date();
  const { _id, ...formationData } = ddGovernmentFormation;
  await db
    .collection<GovernmentFormation>("governmentFormations")
    .updateOne(
      { _id },
      { $set: { ...formationData, createdAt: now, updatedAt: now } },
      { upsert: true }
    );
  log("Seeded DD government formation document");
}
