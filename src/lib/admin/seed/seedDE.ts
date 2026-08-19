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
  NPP,
  ElectedOfficial,
} from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { LegislationType } from "@/lib/db/types/legislation";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

/**
 * The region roster DE actually governs in a given preset.
 *
 * Germany is divided in the Cold War presets: in 1953 the FRG holds 11 Länder
 * and the eastern five (BB, MV, SN, ST, TH) belong to DD. Anything that writes
 * per-region DE docs must go through this, because `macroMetrics` is keyed by
 * the bare region code with no country namespace — so a DE writer using the
 * modern 16-Land bundle silently overwrites the GDR's own economy rows.
 */
async function deRegionRosterForPreset(preset: string) {
  const { deRegions } = await import("@/lib/seeds/de/deRegions");
  const { deRegions1953 } = await import("@/lib/seeds/de/deRegions1953");
  const { deRegions1979 } = await import("@/lib/seeds/de/deRegions1979");
  const { deRegions1991 } = await import("@/lib/seeds/de/deRegions1991");
  const { deRegions1999 } = await import("@/lib/seeds/de/deRegions1999");
  const { deRegions2007 } = await import("@/lib/seeds/de/deRegions2007");
  const { deRegions2023 } = await import("@/lib/seeds/de/deRegions2023");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  return selectPresetBundle(
    preset,
    {
      "1953-default": deRegions1953,
      "2019-default": deRegions,
      "1979-default": deRegions1979,
      "1991-default": deRegions1991,
      "1999-default": deRegions1999,
      "2007-default": deRegions2007,
      "2023-default": deRegions2023,
    },
    "seedDE:deRegions1953"
  );
}

export async function seedDERegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "DE" });
  }
  const bundle = await deRegionRosterForPreset(preset);
  const regionOps = bundle.map((region) => ({
    updateOne: { filter: { _id: region._id }, update: { $set: region }, upsert: true },
  }));
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} DE states (${preset})`);
}

export async function seedDEParties(db: Db, log: (msg: string) => void, preset?: string) {
  const { deParties } = await import("@/lib/seeds/de/deParties");
  const { isPartyValidForPreset, prunePresetMismatchedDefaultParties } =
    await import("@/lib/seeds/ensureDefaultParties");

  // Resolve the active preset: explicit arg wins, otherwise read from
  // gameState so admin "seed DE parties" runs respect the live game.
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  await prunePresetMismatchedDefaultParties(db, deParties, activePreset);

  const filtered = deParties.filter((seed) => isPartyValidForPreset(seed, activePreset));
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
      };
      await db.collection<PoliticalParty>("politicalParties").insertOne(doc);
    }
  }
  log(`Seeded ${filtered.length} DE parties (preset: ${activePreset})`);
}

export async function seedDEDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("stateDemographics").deleteMany({ countryId: "DE" });
    await db.collection("demographicDefaults").deleteMany({ countryId: "DE" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "DE" });
  }

  const { deDemographicCategories } = await import("@/lib/seeds/de/deDemographicCategories");
  const { deRegionDemographics: deRegionDemographicsStatic } =
    await import("@/lib/seeds/de/deRegionDemographics");
  const { deDemographicTurnout } = await import("@/lib/seeds/de/deDemographicTurnout");
  const { calculateStateLean } = await import("@/lib/utils/demographics");
  const is1991 = preset === "1991-default";
  const { applyEra1991DemographicAdjustments } = is1991
    ? await import("@/lib/seeds/reference/stateDemographics1991")
    : { applyEra1991DemographicAdjustments: <T>(x: T): T => x };

  const { isLayer1PositionsEnabled } = await import("@/lib/seeds/layer1PositionsFlag");
  const useLayer1 = await isLayer1PositionsEnabled();
  let deRegionDemographics: typeof deRegionDemographicsStatic = deRegionDemographicsStatic;
  if (useLayer1) {
    const { getCountryLayer1Model, buildModelRegionDemographics } =
      await import("@/lib/seeds/international");
    const { eraForPreset } = await import("@/lib/seeds/presetSelector");
    const { loadFullOverride } = await import("@/lib/seeds/loadEraPositionOverride");
    const era = eraForPreset(preset);
    const model = getCountryLayer1Model("DE", era);
    if (model) {
      const full = await loadFullOverride("DE", era);
      if (full) log(`[DE] Applying model override for era ${era}`);
      deRegionDemographics = buildModelRegionDemographics(
        model,
        full?.positions ?? undefined,
        full ? { turnout: full.turnout } : undefined
      );
      log(
        `[DE] Using Layer-1-derived demographics (${deRegionDemographics.length} regions, era ${era})`
      );
    }
  }

  for (const category of deDemographicCategories) {
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id: category._id }, { $set: category }, { upsert: true });
  }

  for (const raw of deRegionDemographics) {
    const sd = is1991 ? applyEra1991DemographicAdjustments(raw, "DE") : raw;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id: sd._id }, { $set: sd }, { upsert: true });
    await db
      .collection<StateDemographics>("demographicDefaults")
      .updateOne({ _id: sd._id }, { $set: sd }, { upsert: true });

    const allCategories = await db
      .collection<DemographicCategory>("demographicCategories")
      .find({})
      .toArray();
    const lean = calculateStateLean(sd, allCategories);
    await db.collection<State>("states").updateOne(
      { _id: sd._id },
      {
        $set: {
          cachedEconomicLean: lean.economicLean,
          cachedSocialLean: lean.socialLean,
          demographicsLastUpdated: new Date(),
        },
      }
    );
  }

  for (const turnout of deDemographicTurnout) {
    await db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .updateOne({ _id: turnout._id }, { $set: turnout }, { upsert: true });
  }

  log(
    `Seeded DE demographics (preset: ${preset}, ${deDemographicCategories.length} categories, ${deRegionDemographics.length} regions, ${deDemographicTurnout.length} turnout)`
  );
}

export async function seedDEStatePartyOrg(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset?: string
) {
  if (reset) {
    await db.collection("statePartyOrg").deleteMany({ countryId: "DE" });
  }

  // Resolve preset: explicit arg wins, otherwise read from gameState
  // so admin "seed DE state party org" runs respect the live game.
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  const { calculateDEStatePartyOrgs } = await import("@/lib/seeds/de/deStatePartyOrgCalculations");
  const orgs = await calculateDEStatePartyOrgs(db, activePreset);
  const now = new Date();
  for (const org of orgs) {
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id: org._id },
        { $set: { ...org, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
  }
  log(`Seeded ${orgs.length} DE state party org records (preset: ${activePreset})`);
}

/**
 * Non-destructive variant of `seedDEStatePartyOrg`: inserts polling-derived
 * rows for (Land, party) pairs that don't already exist (e.g. PDS rows in
 * East Berlin / new Länder when switching to 1991-default from a 2019 game).
 * Player-modified org values on existing rows are preserved — never
 * overwrites a row that's there.
 */
export async function ensureMissingDEStatePartyOrgRows(
  db: Db,
  log: (msg: string) => void,
  preset?: string
): Promise<void> {
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  const { calculateDEStatePartyOrgs } = await import("@/lib/seeds/de/deStatePartyOrgCalculations");
  const now = new Date();
  const orgs = await calculateDEStatePartyOrgs(db, activePreset);

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
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne(
          { _id: org._id },
          { $set: { ...org, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        );
    }
    log(`Inserted ${missing.length} missing DE state party org row(s) (preset: ${activePreset})`);
  }
}

export async function seedDEStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  // The roster DE governs in THIS preset — never the modern 16-Land bundle, or
  // both the reset delete and the write below reach into DD's rows.
  const roster = await deRegionRosterForPreset(preset);
  const ownedRegionIds = new Set(roster.map((region) => String(region._id)));
  if (reset) {
    await db
      .collection("macroMetrics")
      .deleteMany({ _id: { $in: [...ownedRegionIds] as never[] } });
  }
  const { deStateMetrics } = await import("@/lib/seeds/de/deStateMetrics");
  const { applyEra1991Adjustments } = await import("@/lib/seeds/reference/stateMetrics1991");
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  const { applyEra1953Adjustments } = await import("@/lib/seeds/reference/stateMetricsEra1953");
  const transformed =
    preset === "1991-default"
      ? deStateMetrics.map(applyEra1991Adjustments)
      : preset === "1953-default"
        ? // Only the UK had a 1953 metrics branch, so DE/JP/BR/NG seeded MODERN
          // values into a 1953 world (2019 broadband 92/88/78/35, life expectancy
          // 82.1/83.2/72/51). The baselines were era-adjusted while the metrics
          // were not, so each country also spent hundreds of turns gliding down
          // toward a target it never started near.
          deStateMetrics.map(applyEra1953Adjustments)
        : deStateMetrics;
  // Overlay the per-region/era authored values for the new ROOT metrics (both eras authored).
  const bundle = transformed
    .filter((metric) => ownedRegionIds.has(String(metric._id)))
    .map((metric) => {
      const overlay = getRegionMetricPresets("DE", String(metric._id), preset);
      return overlay ? applyMetricPresetToMetrics(metric, overlay) : metric;
    });
  // SP5: split write — macro slice -> macroMetrics, political remainder ->
  // stateMetrics. countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    bundle.map((m) => ({ ...m, countryId: "DE" }) as StateMetrics)
  );
  log(`Seeded ${bundle.length} DE state metrics (${preset})`);
}

export async function seedDEBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    const { deRegions } = await import("@/lib/seeds/de/deRegions");
    await db.collection("stateBaselines").deleteMany({
      _id: { $in: deRegions.map((region) => region._id) as never[] },
    });
  }
  const { deStateBaselines } = await import("@/lib/seeds/de/deStateBaselines");
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
  for (const raw of deStateBaselines) {
    const adjusted = is1991
      ? applyEra1991BaselineAdjustments(raw)
      : is1953
        ? applyEra1953BaselineAdjustments(raw)
        : is1979
          ? applyEra1979BaselineAdjustments(raw)
          : raw;
    // Align decay targets with the authored metric values (both eras). No-op only where
    // the country authors nothing for a metric (falls through to uniformMetricDefault).
    const overlay = getRegionMetricPresets("DE", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(adjusted, overlay) : adjusted;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id: baseline._id }, { $set: baseline }, { upsert: true });
  }
  log(`Seeded ${deStateBaselines.length} DE baselines (preset: ${preset})`);
}

export async function seedDEGovernmentFormation(
  db: Db,
  log: (msg: string) => void,
  preset: string
) {
  const { deGovernmentFormation } = await import("@/lib/seeds/de/deGovernmentFormation");
  const now = new Date();
  // 1953 Bundestag had 402 seats (pre-1957 electoral reform expanded it).
  // Majority threshold: 202 (floor(402/2) + 1).
  const eraOverride = preset === "1953-default" ? { totalSeats: 402, majorityThreshold: 202 } : {};
  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: deGovernmentFormation._id },
    {
      $set: { ...deGovernmentFormation, ...eraOverride, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  log("Seeded DE government formation document");
}

/**
 * Re-seed DE legislation types in isolation.
 *
 * NOTE: `runCoreSeed` already covers every DE legislation type via the main
 * `legislationTypes.ts` spread (`...deLegislationTypes` at the bottom of that
 * file). This function is kept as a targeted re-seed for the admin UI and the
 * sandbox script — bootstrap no longer calls it as a separate step, since the
 * upserts were duplicate. JP/IE/CN never had an equivalent helper for the
 * same reason; DE's existed historically. Safe to invoke independently when
 * an admin wants to refresh only DE legislation without touching other
 * countries' types.
 */
export async function seedDELegislation(db: Db, log: (msg: string) => void) {
  const { deLegislationTypes } = await import("@/lib/seeds/de/deLegislationTypes");
  const now = new Date();
  for (const legislationType of deLegislationTypes) {
    await db
      .collection<LegislationType>("legislationTypes")
      .updateOne(
        { _id: legislationType._id },
        { $set: { ...legislationType, source: "seed" as const, updatedAt: now } },
        { upsert: true }
      );
  }
  log(`Seeded ${deLegislationTypes.length} DE legislation types`);
}

export async function seedDEElections(log: (msg: string) => void) {
  const { ensureDEElections } = await import("@/lib/turn/perpetualElections");
  await ensureDEElections(new Date());
  log("Spawned missing DE Bundestag elections");
}

/**
 * Admin-only destructive re-seed of DE Bundestag NPP officials for the
 * 2020 preset (post-2021 election composition scaled to game seat budget).
 *
 * NOT called from `bootstrapGameWorld` — the bootstrap path seeds these
 * officials via the `DE_BUNDESTAG_2021` historical-seat array embedded
 * in `getPresetSeats("2019-default")`. This function exists only as the
 * `/api/admin/seed` target `"deBundestag2021"` for destructive re-seed
 * operations.
 */
export async function seedDEBundestag2021(db: Db, reset: boolean, log: (msg: string) => void) {
  if (reset) {
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId: "DE", officeType: "bundestag", isNPP: true })
      .project<{ nppId?: ObjectId }>({ nppId: 1 })
      .toArray();
    const nppIds = officials.map((o) => o.nppId).filter((id): id is ObjectId => id != null);

    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany({ countryId: "DE", officeType: "bundestag", isNPP: true });

    if (nppIds.length > 0) {
      await db.collection<NPP>("npps").updateMany(
        { _id: { $in: nppIds }, "currentOffice.type": "bundestag" },
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
      `Reset: deleted ${officials.length} Bundestag NPP officials, retired ${nppIds.length} NPPs`
    );
  }

  const { DE_BUNDESTAG_2021 } = await import("@/lib/constants/historicalSeats");
  const { seedFromSeats } = await import("@/lib/npp/seedHistorical");
  const result = await seedFromSeats(db, DE_BUNDESTAG_2021);
  log(
    `Seeded DE Bundestag (2021): ${result.nppsCreated} NPPs, ${result.officialsCreated} officials`
  );
}

/**
 * Admin-only destructive re-seed of DE Ministerpräsidenten (Land
 * executives) for the 2020 preset.
 *
 * NOT called from `bootstrapGameWorld` — the bootstrap path seeds these
 * officials via the `DE_MINISTERPRAESIDENTEN_2020` historical-seat array
 * embedded in `getPresetSeats("2019-default")`. This function exists
 * only as the `/api/admin/seed` target `"deMinisterPresidents2020"` for
 * destructive re-seed operations.
 */
export async function seedDEMinisterPresidents2020(
  db: Db,
  reset: boolean,
  log: (msg: string) => void
) {
  if (reset) {
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId: "DE", officeType: "ministerPresident", isNPP: true })
      .project<{ nppId?: ObjectId }>({ nppId: 1 })
      .toArray();
    const nppIds = officials.map((o) => o.nppId).filter((id): id is ObjectId => id != null);

    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany({ countryId: "DE", officeType: "ministerPresident", isNPP: true });

    if (nppIds.length > 0) {
      await db.collection<NPP>("npps").updateMany(
        { _id: { $in: nppIds }, "currentOffice.type": "ministerPresident" },
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
      `Reset: deleted ${officials.length} Minister-President NPP officials, retired ${nppIds.length} NPPs`
    );
  }

  const { DE_MINISTERPRAESIDENTEN_2020 } = await import("@/lib/constants/historicalSeats");
  const { seedFromSeats } = await import("@/lib/npp/seedHistorical");
  const result = await seedFromSeats(db, DE_MINISTERPRAESIDENTEN_2020);
  log(
    `Seeded DE Minister-Presidents (2020): ${result.nppsCreated} NPPs, ${result.officialsCreated} officials`
  );
}
