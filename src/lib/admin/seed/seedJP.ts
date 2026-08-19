import { ObjectId, type Db } from "mongodb";
import { writeSplitMetricsBulk } from "@/lib/macroMetrics/split";
import type {
  State,
  PoliticalParty,
  DemographicCategory,
  StateDemographics,
  StateDemographicTurnout,
  StatePartyOrg,
  StateMetrics,
  ElectedOfficial,
  NPP,
} from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

export async function seedJPRegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "JP" });
  }
  const { jpRegions } = await import("@/lib/seeds/jp/jpRegions");
  const { jpRegions1953 } = await import("@/lib/seeds/jp/jpRegions1953");
  const { jpRegions1979 } = await import("@/lib/seeds/jp/jpRegions1979");
  const { jpRegions1991 } = await import("@/lib/seeds/jp/jpRegions1991");
  const { jpRegions1999 } = await import("@/lib/seeds/jp/jpRegions1999");
  const { jpRegions2007 } = await import("@/lib/seeds/jp/jpRegions2007");
  const { jpRegions2023 } = await import("@/lib/seeds/jp/jpRegions2023");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  const bundle = selectPresetBundle(
    preset,
    {
      "1953-default": jpRegions1953,
      "2019-default": jpRegions,
      "1979-default": jpRegions1979,
      "1991-default": jpRegions1991,
      "1999-default": jpRegions1999,
      "2007-default": jpRegions2007,
      "2023-default": jpRegions2023,
    },
    "seedJP:jpRegions1953"
  );
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} JP regions (${preset})`);
}

export async function seedJPParties(db: Db, log: (msg: string) => void, preset?: string) {
  const { jpParties } = await import("@/lib/seeds/jp/jpParties");
  const { isPartyValidForPreset, prunePresetMismatchedDefaultParties } =
    await import("@/lib/seeds/ensureDefaultParties");

  // Resolve the active preset: explicit arg wins, otherwise read from
  // gameState so admin "seed JP parties" runs respect the live game.
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  await prunePresetMismatchedDefaultParties(db, jpParties, activePreset);

  const filtered = jpParties.filter((seed) => isPartyValidForPreset(seed, activePreset));
  const now = new Date();
  for (const party of filtered) {
    const { seedOrder: _seedOrder, validForPresets: _vfp, ...partyData } = party;
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
  log(`Seeded ${filtered.length} JP parties (preset: ${activePreset})`);
}

export async function seedJPDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("demographicCategories").deleteMany({ _id: "jp_voterGroups" as never });
    await db.collection("stateDemographics").deleteMany({ countryId: "JP" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "JP" });
  }

  const { jpDemographicCategories } = await import("@/lib/seeds/jp/jpDemographicCategories");
  for (const cat of jpDemographicCategories) {
    const { _id, ...catData } = cat;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: catData }, { upsert: true });
  }

  const { jpRegionDemographics: jpRegionDemographicsStatic } =
    await import("@/lib/seeds/jp/jpRegionDemographics");
  const is1991 = preset === "1991-default";
  const { applyEra1991DemographicAdjustments } = is1991
    ? await import("@/lib/seeds/reference/stateDemographics1991")
    : { applyEra1991DemographicAdjustments: <T>(x: T): T => x };

  const { isLayer1PositionsEnabled } = await import("@/lib/seeds/layer1PositionsFlag");
  const useLayer1 = await isLayer1PositionsEnabled();
  let jpRegionDemographics: typeof jpRegionDemographicsStatic = jpRegionDemographicsStatic;
  if (useLayer1) {
    const { getCountryLayer1Model, buildModelRegionDemographics } =
      await import("@/lib/seeds/international");
    const { eraForPreset } = await import("@/lib/seeds/presetSelector");
    const { loadFullOverride } = await import("@/lib/seeds/loadEraPositionOverride");
    const era = eraForPreset(preset);
    const model = getCountryLayer1Model("JP", era);
    if (model) {
      const full = await loadFullOverride("JP", era);
      if (full) log(`[JP] Applying model override for era ${era}`);
      jpRegionDemographics = buildModelRegionDemographics(
        model,
        full?.positions ?? undefined,
        full ? { turnout: full.turnout } : undefined
      );
      log(
        `[JP] Using Layer-1-derived demographics (${jpRegionDemographics.length} regions, era ${era})`
      );
    }
  }
  for (const raw of jpRegionDemographics) {
    const demo = is1991 ? applyEra1991DemographicAdjustments(raw, "JP") : raw;
    const { _id, ...demoData } = demo;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id }, { $set: demoData }, { upsert: true });
  }

  const { jpDemographicTurnout } = await import("@/lib/seeds/jp/jpDemographicTurnout");
  for (const turnout of jpDemographicTurnout) {
    const { _id, ...turnoutData } = turnout;
    await db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .updateOne({ _id }, { $set: turnoutData }, { upsert: true });
  }

  log(
    `Seeded JP demographics (preset: ${preset}, ${jpDemographicCategories.length} categories, ${jpRegionDemographics.length} regions, ${jpDemographicTurnout.length} turnout)`
  );
}

export async function seedJPStatePartyOrg(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset?: string
) {
  if (reset) {
    await db.collection("statePartyOrg").deleteMany({ countryId: "JP" });
  }

  // Resolve preset: explicit arg wins, otherwise read from gameState
  // so admin "seed JP state party org" runs respect the live game.
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  const { calculateJPStatePartyOrgs } = await import("@/lib/seeds/jp/jpStatePartyOrgCalculations");
  const orgs = await calculateJPStatePartyOrgs(db, activePreset);
  const now = new Date();
  for (const org of orgs) {
    const { _id, ...orgData } = org;
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne({ _id }, { $set: { ...orgData, updatedAt: now } }, { upsert: true });
  }
  log(`Seeded ${orgs.length} JP state party org records (preset: ${activePreset})`);
}

/**
 * Non-destructive variant of `seedJPStatePartyOrg`: inserts polling-derived
 * rows for (region, party) pairs that don't already exist (e.g. JSP / DSP
 * rows when switching to 1991-default from a 2019 game). Player-modified org
 * values on existing rows are preserved — never overwrites a row that's there.
 */
export async function ensureMissingJPStatePartyOrgRows(
  db: Db,
  log: (msg: string) => void,
  preset?: string
): Promise<void> {
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  const { calculateJPStatePartyOrgs } = await import("@/lib/seeds/jp/jpStatePartyOrgCalculations");
  const now = new Date();
  const orgs = await calculateJPStatePartyOrgs(db, activePreset);

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
    log(`Inserted ${missing.length} missing JP state party org row(s) (preset: ${activePreset})`);
  }
}

export async function seedJPStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("macroMetrics").deleteMany({
      _id: { $in: ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"] } as never,
    });
  }
  const { jpStateMetrics } = await import("@/lib/seeds/jp/jpStateMetrics");
  const { applyEra1991Adjustments } = await import("@/lib/seeds/reference/stateMetrics1991");
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  const { applyEra1953Adjustments } = await import("@/lib/seeds/reference/stateMetricsEra1953");
  const transformed =
    preset === "1991-default"
      ? jpStateMetrics.map(applyEra1991Adjustments)
      : preset === "1953-default"
        ? // Only the UK had a 1953 metrics branch, so DE/JP/BR/NG seeded MODERN
          // values into a 1953 world (2019 broadband 92/88/78/35, life expectancy
          // 82.1/83.2/72/51). The baselines were era-adjusted while the metrics
          // were not, so each country also spent hundreds of turns gliding down
          // toward a target it never started near.
          jpStateMetrics.map(applyEra1953Adjustments)
        : jpStateMetrics;
  // Overlay the per-region/era authored values for the new ROOT metrics (both eras authored).
  const bundle = transformed.map((metric) => {
    const overlay = getRegionMetricPresets("JP", String(metric._id), preset);
    return overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
  });
  // SP5: split write — macro slice -> macroMetrics (all countries), political
  // remainder -> stateMetrics (non-playables). countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    bundle.map((m) => ({ ...m, countryId: "JP" }) as StateMetrics)
  );
  log(`Seeded ${bundle.length} JP state metrics (${preset})`);
}

export async function seedJPBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  // policyEffects.ts reads from `stateBaselines`; the legacy seeder wrote to a
  // sibling `stateMetricBaselines` collection that nothing read, so JP regions
  // were silently using global defaults at runtime. Phase 5 of the reset/seed
  // cleanup standardised on `stateBaselines` — see KNOWN_INCONSISTENCIES in
  // seedManifest.ts.
  if (reset) {
    await db.collection("stateBaselines").deleteMany({
      _id: { $in: ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"] } as never,
    });
  }
  const { jpStateBaselines } = await import("@/lib/seeds/jp/jpStateBaselines");
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
  for (const raw of jpStateBaselines) {
    const adjusted = is1991
      ? applyEra1991BaselineAdjustments(raw)
      : is1953
        ? applyEra1953BaselineAdjustments(raw)
        : is1979
          ? applyEra1979BaselineAdjustments(raw)
          : raw;
    // Align decay targets with the authored metric values (both eras).
    const overlay = getRegionMetricPresets("JP", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(adjusted, overlay) : adjusted;
    const { _id, ...baselineData } = baseline;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }
  log(`Seeded ${jpStateBaselines.length} JP baselines (preset: ${preset})`);
}

export async function seedJPGovernmentFormation(db: Db, log: (msg: string) => void) {
  const { jpGovernmentFormation } = await import("@/lib/seeds/jp/jpGovernmentFormation");
  const now = new Date();
  const { _id, ...formationData } = jpGovernmentFormation;
  await db
    .collection<GovernmentFormation>("governmentFormations")
    .updateOne(
      { _id },
      { $set: { ...formationData, createdAt: now, updatedAt: now } },
      { upsert: true }
    );
  log("Seeded JP government formation document");
}

/** Remove the retired real-person ceremonial NPP written by older seeders. */
export async function removeLegacyJPCeremonialIdentity(
  db: Db,
  log: (msg: string) => void
): Promise<void> {
  const result = await db.collection("npps").deleteMany({
    countryId: "JP",
    name: "Emperor Naruhito",
    politicalInfluence: 0,
    currentOffice: null,
    retiredAt: { $ne: null },
  });
  if (result.deletedCount > 0) {
    log(`Removed ${result.deletedCount} legacy JP ceremonial identity record(s)`);
  }
}

/**
 * Admin-only destructive re-seed of JP regional governor NPP officials
 * for the 2020 preset.
 *
 * One seat per JP game-region (8 total, all LDP-aligned at game start).
 * Uses the `governor` officeType — see
 * `docs/design/uk-jp-devolved-executives.md`. Mirrors
 * `seedDEMinisterPresidents2020`.
 *
 * NOT called from `bootstrapGameWorld` — the bootstrap path seeds these
 * officials via the `JP_GOVERNORS_2020` historical-seat array embedded
 * in `getPresetSeats("2019-default")`. This function exists only as the
 * `/api/admin/seed` target `"jpGovernors2020"` for destructive re-seed
 * operations.
 */
export async function seedJPGovernors2020(db: Db, reset: boolean, log: (msg: string) => void) {
  if (reset) {
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId: "JP", officeType: "governor", isNPP: true })
      .project<{ nppId?: ObjectId }>({ nppId: 1 })
      .toArray();
    const nppIds = officials.map((o) => o.nppId).filter((id): id is ObjectId => id != null);

    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany({ countryId: "JP", officeType: "governor", isNPP: true });

    if (nppIds.length > 0) {
      await db.collection<NPP>("npps").updateMany(
        { _id: { $in: nppIds }, "currentOffice.type": "governor" },
        {
          $set: {
            retiredAt: new Date(),
            currentOffice: null,
            updatedAt: new Date(),
          },
        }
      );
    }

    log(
      `Reset: deleted ${officials.length} JP Regional Governor NPP officials, retired ${nppIds.length} NPPs`
    );
  }

  const { JP_GOVERNORS_2020 } = await import("@/lib/constants/historicalSeats");
  const { seedFromSeats } = await import("@/lib/npp/seedHistorical");
  const result = await seedFromSeats(db, JP_GOVERNORS_2020);
  log(
    `Seeded JP Regional Governors (2020): ${result.nppsCreated} NPPs, ${result.officialsCreated} officials`
  );
}

/**
 * Admin-only destructive re-seed of JP regional governor NPP officials
 * for the 1991-default preset.
 *
 * Same shape as the 2020 variant. All 8 regions LDP-aligned at the 1990
 * historical anchor — matches `JP_GOVERNORS_1991` in `historicalSeats.ts`
 * (suffix renamed from `_1990` so it aligns with the `1991-default`
 * preset id; the underlying baseline composition is unchanged).
 *
 * NOT called from `bootstrapGameWorld` — the bootstrap path seeds these
 * officials via the `JP_GOVERNORS_1991` historical-seat array embedded
 * in `getPresetSeats("1991-default")`. This function exists only as the
 * `/api/admin/seed` target `"jpGovernors1991"` for destructive re-seed
 * operations.
 */
export async function seedJPGovernors1991(db: Db, reset: boolean, log: (msg: string) => void) {
  if (reset) {
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId: "JP", officeType: "governor", isNPP: true })
      .project<{ nppId?: ObjectId }>({ nppId: 1 })
      .toArray();
    const nppIds = officials.map((o) => o.nppId).filter((id): id is ObjectId => id != null);

    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany({ countryId: "JP", officeType: "governor", isNPP: true });

    if (nppIds.length > 0) {
      await db.collection<NPP>("npps").updateMany(
        { _id: { $in: nppIds }, "currentOffice.type": "governor" },
        {
          $set: {
            retiredAt: new Date(),
            currentOffice: null,
            updatedAt: new Date(),
          },
        }
      );
    }

    log(
      `Reset: deleted ${officials.length} JP Regional Governor NPP officials, retired ${nppIds.length} NPPs`
    );
  }

  const { JP_GOVERNORS_1991 } = await import("@/lib/constants/historicalSeats");
  const { seedFromSeats } = await import("@/lib/npp/seedHistorical");
  const result = await seedFromSeats(db, JP_GOVERNORS_1991);
  log(
    `Seeded JP Regional Governors (1991): ${result.nppsCreated} NPPs, ${result.officialsCreated} officials`
  );
}
