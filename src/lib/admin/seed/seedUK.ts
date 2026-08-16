import { ObjectId, type Db } from "mongodb";
import type {
  State,
  PoliticalParty,
  DemographicCategory,
  StateDemographics,
  StateDemographicTurnout,
  StatePartyOrg,
  StateMetrics,
  Election,
  ElectedOfficial,
  NPP,
  NPPGender,
  NPPEthnicity,
} from "@/lib/db/types";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import { selectPoliticianImage, weightedRandomEthnicity } from "@/lib/npp/generator";
import { getMajorPartiesForRegion } from "@/lib/constants/countries";
import { UK_REGIONAL_COUNCIL_SEATS } from "@/lib/constants";
import { getSeatIdFromElection } from "@/lib/seats";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

export async function seedUKRegions(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "UK" });
  }
  const { ukRegions } = await import("@/lib/seeds/uk/ukRegions");
  const { ukRegions1953 } = await import("@/lib/seeds/uk/ukRegions1953");
  const { ukRegions1979 } = await import("@/lib/seeds/uk/ukRegions1979");
  const { ukRegions1991 } = await import("@/lib/seeds/uk/ukRegions1991");
  const { ukRegions1999 } = await import("@/lib/seeds/uk/ukRegions1999");
  const { ukRegions2007 } = await import("@/lib/seeds/uk/ukRegions2007");
  const { ukRegions2023 } = await import("@/lib/seeds/uk/ukRegions2023");
  const { selectPresetBundle } = await import("@/lib/seeds/presetSelector");
  const bundle = selectPresetBundle(
    preset,
    {
      "1953-default": ukRegions1953,
      "2019-default": ukRegions,
      "1979-default": ukRegions1979,
      "1991-default": ukRegions1991,
      "1999-default": ukRegions1999,
      "2007-default": ukRegions2007,
      "2023-default": ukRegions2023,
    },
    "seedUK:ukRegions1953"
  );
  const regionOps = bundle.map((region) => {
    const { _id, ...regionData } = region;
    return { updateOne: { filter: { _id }, update: { $set: regionData }, upsert: true } };
  });
  if (regionOps.length > 0)
    await db.collection<State>("states").bulkWrite(regionOps, { ordered: false });
  log(`Seeded ${bundle.length} UK regions (${preset})`);
}

export async function seedUKParties(db: Db, log: (msg: string) => void, preset?: string) {
  const { ukParties } = await import("@/lib/seeds/uk/ukParties");
  const { isPartyValidForPreset } = await import("@/lib/seeds/ensureDefaultParties");

  // Resolve the active preset: explicit arg wins, otherwise read from
  // gameState so admin "seed UK parties" runs respect the live game.
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  const eligibleParties = ukParties.filter((p) => isPartyValidForPreset(p, activePreset));
  const now = new Date();
  for (const party of eligibleParties) {
    const { seedOrder: _seedOrder, validForPresets: _validForPresets, ...partyData } = party;
    void _seedOrder;
    void _validForPresets;
    // Check if party already exists by name + country
    const existing = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ name: party.name, countryId: party.countryId });

    if (existing) {
      // Update existing party (preserve _id and sequentialId)
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: existing._id }, { $set: { ...partyData, updatedAt: now } });
    } else {
      // Insert new party with generated _id and sequentialId
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
  log(`Seeded ${eligibleParties.length} UK parties (preset: ${activePreset})`);
}

export async function seedNIParties(db: Db, log: (msg: string) => void) {
  const { ukParties } = await import("@/lib/seeds/uk/ukParties");
  const { isPartyValidForPreset } = await import("@/lib/seeds/ensureDefaultParties");
  // Respect the live preset gate — the DUP (founded 1971) must not be
  // re-introduced into a 1953 world by an ad-hoc NI reseed.
  const activePreset = await getGameStatePresetOrDefault(db);
  const niParties = ukParties.filter(
    (p) =>
      (p.abbreviation === "DUP" || p.abbreviation === "SF") &&
      isPartyValidForPreset(p, activePreset)
  );
  const now = new Date();
  // NI parties (DUP/SF) are Minor in the UK roster regardless of era (regional),
  // so the preset arg to resolveSeedPartyTier is immaterial here.
  for (const party of niParties) {
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
      log(`Updated existing party: ${party.name}`);
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
      log(`Created party: ${party.name} (sequentialId: ${sequentialId})`);
    }
  }
  log(`Seeded ${niParties.length} Northern Ireland parties (DUP, Sinn Féin)`);
}

export async function seedUKDemographics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection("stateDemographics").deleteMany({ countryId: "UK" });
    await db.collection("demographicDefaults").deleteMany({ countryId: "UK" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "UK" });
  }
  const { ukDemographicCategories } = await import("@/lib/seeds/uk/ukDemographicCategories");
  const { default: ukRegionDemographicsStatic } =
    await import("@/lib/seeds/uk/ukRegionDemographics");
  const { ukDemographicTurnout } = await import("@/lib/seeds/uk/ukDemographicTurnout");
  const { calculateStateLean } = await import("@/lib/utils/demographics");
  const is1991 = preset === "1991-default";
  const { applyEra1991DemographicAdjustments } = is1991
    ? await import("@/lib/seeds/reference/stateDemographics1991")
    : { applyEra1991DemographicAdjustments: <T>(x: T): T => x };

  const { isLayer1PositionsEnabled } = await import("@/lib/seeds/layer1PositionsFlag");
  const useLayer1 = await isLayer1PositionsEnabled();
  let ukRegionDemographics: typeof ukRegionDemographicsStatic = ukRegionDemographicsStatic;
  if (useLayer1) {
    const { getCountryLayer1Model, buildModelRegionDemographics } =
      await import("@/lib/seeds/international");
    const { eraForPreset } = await import("@/lib/seeds/presetSelector");
    const { loadFullOverride } = await import("@/lib/seeds/loadEraPositionOverride");
    const era = eraForPreset(preset);
    const model = getCountryLayer1Model("UK", era);
    if (model) {
      const full = await loadFullOverride("UK", era);
      if (full) log(`[UK] Applying model override for era ${era}`);
      ukRegionDemographics = buildModelRegionDemographics(
        model,
        full?.positions ?? undefined,
        full ? { turnout: full.turnout, composition: full.composition } : undefined
      );
      log(
        `[UK] Using Layer-1-derived demographics (${ukRegionDemographics.length} regions, era ${era})`
      );
    }
  }

  for (const category of ukDemographicCategories) {
    const { _id, ...categoryData } = category;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: categoryData }, { upsert: true });
  }
  for (const rawSd of ukRegionDemographics) {
    const sd = is1991 ? applyEra1991DemographicAdjustments(rawSd, "UK") : rawSd;
    const { _id, ...sdData } = sd;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id }, { $set: sdData }, { upsert: true });
    await db
      .collection<StateDemographics>("demographicDefaults")
      .updateOne({ _id }, { $set: sdData }, { upsert: true });
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
  for (const doc of ukDemographicTurnout) {
    const { _id, ...turnoutData } = doc;
    await db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .updateOne({ _id }, { $set: turnoutData }, { upsert: true });
  }
  log(
    `Seeded UK demographics (preset: ${preset}): ${ukDemographicCategories.length} categories, ${ukRegionDemographics.length} region demographics, ${ukDemographicTurnout.length} turnout`
  );
}

export async function seedUKStatePartyOrg(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset?: string
) {
  if (reset) {
    await db.collection("statePartyOrg").deleteMany({ countryId: "UK" });
  }

  // Resolve preset: explicit arg wins, otherwise read from gameState
  // so admin "seed UK state party org" runs respect the live game.
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  const { calculateUKStatePartyOrgs } = await import("@/lib/seeds/uk/ukStatePartyOrgCalculations");
  const now = new Date();
  const orgs = await calculateUKStatePartyOrgs(db, activePreset);
  for (const org of orgs) {
    const { _id, ...orgData } = org;
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id },
        { $set: { ...orgData, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
  }
  log(`Seeded ${orgs.length} UK state party org entries (preset: ${activePreset})`);
}

/**
 * Reconcile UK statePartyOrg rows with the calculated seed set, used during
 * world reset:
 *  - Deletes rows for regional parties (SNP/Plaid/DUP/SF/UUP) outside their
 *    home regions. These shouldn't exist — those parties don't operate
 *    outside their home nation IRL. Catches stale rows from pre-fix
 *    bootstraps that seeded them with the 5% MIN_ORG floor.
 *  - Inserts polling-derived rows for (region, party) pairs that don't
 *    already exist (e.g. UUP's NIR row when a 1991 reset coming from a
 *    2019 game). Player-modified org values on existing rows are preserved
 *    — never overwrites a row that's there.
 */
export async function ensureMissingUKStatePartyOrgRows(
  db: Db,
  log: (msg: string) => void,
  preset?: string
): Promise<void> {
  // Resolve preset: explicit arg wins, otherwise read from gameState.
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  const { calculateUKStatePartyOrgs } = await import("@/lib/seeds/uk/ukStatePartyOrgCalculations");
  const now = new Date();
  const orgs = await calculateUKStatePartyOrgs(db, activePreset);

  // ── 1. Sweep regional-party rows in non-home regions ──────────────────────
  // The set of (region, partyId) keys we expect to exist; anything else
  // bearing a regional-party slug for a non-home region is stale.
  const expectedKeys = new Set(orgs.map((o) => o._id));
  const { UK_REGIONAL_PARTY_SLUGS } = await import("@/lib/parties/regionalContest");
  const { buildUKPartySlugToSeqId } = await import("@/lib/seeds/uk/ukStatePartyOrgCalculations");
  const slugToSeqId = await buildUKPartySlugToSeqId(db);
  const regionalSeqIds = UK_REGIONAL_PARTY_SLUGS.map((slug) => slugToSeqId[slug]).filter(
    (seq): seq is string => seq != null
  );
  if (regionalSeqIds.length > 0) {
    const allRegionalOrgs = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ countryId: "UK", partyId: { $in: regionalSeqIds } })
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    const stale = allRegionalOrgs.map((r) => String(r._id)).filter((id) => !expectedKeys.has(id));
    if (stale.length > 0) {
      const swept = await db
        .collection<StatePartyOrg>("statePartyOrg")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .deleteMany({ _id: { $in: stale as any } } as any);
      log(`Swept ${swept.deletedCount} stale regional-party org row(s) from non-home regions`);
    }
  }

  // ── 2. Insert missing expected rows ───────────────────────────────────────
  const ids = orgs.map((o) => o._id);
  const existing = await db
    .collection<StatePartyOrg>("statePartyOrg")
    // _id is a string composite ("REGION_partyId") — cast for the typed filter.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    .find({ _id: { $in: ids as any } } as any)
    /* eslint-enable @typescript-eslint/no-explicit-any */
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  const existingIds = new Set(existing.map((r) => String(r._id)));

  let inserted = 0;
  for (const org of orgs) {
    if (existingIds.has(org._id)) continue;
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .insertOne({ ...org, createdAt: now, updatedAt: now });
    inserted++;
  }
  if (inserted > 0) {
    log(`Inserted ${inserted} missing UK state party org row(s) for newly-added defaults`);
  }
}

const UK_REGION_IDS = [
  "LON",
  "SEE",
  "SWE",
  "EAE",
  "EMI",
  "WMI",
  "YHU",
  "NWE",
  "NEE",
  "SCO",
  "WAL",
  "NIR",
];

/** 1991-default overrides for `independenceDesire`. The static seed file
 *  carries 2019-era values; for the 1991 preset we substitute pre-devolution
 *  baselines (see docs/design/uk-devolution-policy.md). */
const INDEPENDENCE_DESIRE_1991_OVERRIDES: Record<string, number> = {
  SCO: 25, // Pre-1997 referendum mood
  WAL: 10, // 1979 referendum failed badly
  NIR: 30, // Reunification desire at height of Troubles
};

export async function seedUKStateMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset?: string
) {
  if (reset) {
    // UK_REGION_IDS is string[] — MongoDB filter $in accepts string[] but the typed collection's
    // _id infers as ObjectId in the UpdateFilter, requiring a cast here
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await db.collection("macroMetrics").deleteMany({ _id: { $in: UK_REGION_IDS as any } });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  // Resolve preset (explicit arg wins, else gameState, else 2019-default).
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }
  const is1991 = activePreset === "1991-default";

  const { ukStateMetrics } = await import("@/lib/seeds/uk/ukStateMetrics");
  const { applyEra1991Adjustments } = await import("@/lib/seeds/reference/stateMetrics1991");
  // There was no 1953 branch here at all, only 1991 — so a 1953 UK seeded its
  // MODERN metrics (London at medianIncome 42,000, costOfLiving 145,
  // lifeExpectancy 81.5, broadbandAccess 97). seedUKBaselines already handled
  // all three eras, so the decay targets were 1953 while the metrics were 2021
  // and the country spent hundreds of turns gliding down; anything outside the
  // adjusted set stayed modern for the life of the world.
  const { applyEra1953Adjustments } = await import("@/lib/seeds/reference/stateMetricsEra1953");
  const is1953Metrics = activePreset === "1953-default";
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  const { writeSplitMetrics } = await import("@/lib/macroMetrics/split");
  for (const m of ukStateMetrics) {
    const adjusted = is1991
      ? applyEra1991Adjustments(m)
      : is1953Metrics
        ? applyEra1953Adjustments(m)
        : m;
    // Overlay the per-region/era authored values for the new ROOT metrics (both eras authored).
    const overlay = getRegionMetricPresets("UK", String(m._id), activePreset);
    const withPresets = overlay ? applyMetricPresetToMetrics(adjusted, overlay) : adjusted;
    // Stamp countryId so country-scoped lookups (approval/economy) resolve —
    // the source metrics data omits it and the read path filters by countryId.
    const full: StateMetrics = { ...withPresets, countryId: "UK" };
    // Apply 1991 independenceDesire override for SCO/WAL/NIR. The shape of
    // the field matches the existing StateMetricValue; trend stays 0 at seed.
    if (is1991 && full._id in INDEPENDENCE_DESIRE_1991_OVERRIDES) {
      full.governance = {
        ...full.governance,
        independenceDesire: {
          value: INDEPENDENCE_DESIRE_1991_OVERRIDES[full._id],
          trend: 0,
        },
      };
    }
    // SP5: split write — the UK is playable, so the splitter emits ONLY the
    // macroMetrics doc (economic/population + hoisted independenceDesire);
    // no stateMetrics doc exists (subsumes SP4's strip at seed time).
    await writeSplitMetrics(db, full);
  }
  log(`Seeded ${ukStateMetrics.length} UK state metrics (preset: ${activePreset})`);
}

export async function seedUKBaselines(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    // UK_REGION_IDS is string[] — untyped collection filter requires cast for string _id array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("stateBaselines").deleteMany({ _id: { $in: UK_REGION_IDS as any } });
  }
  const { ukStateBaselines } = await import("@/lib/seeds/uk/ukStateBaselines");
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
  for (const raw of ukStateBaselines) {
    const adjusted = is1991
      ? applyEra1991BaselineAdjustments(raw)
      : is1953
        ? applyEra1953BaselineAdjustments(raw)
        : is1979
          ? applyEra1979BaselineAdjustments(raw)
          : raw;
    // Align decay targets with the authored metric values (both eras).
    const overlay = getRegionMetricPresets("UK", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(adjusted, overlay) : adjusted;
    const { _id, ...baselineData } = baseline;
    // _id is a string region key — untyped collection filter requires cast
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await db
      .collection("stateBaselines")
      .updateOne({ _id: _id as any }, { $set: baselineData }, { upsert: true });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
  log(`Seeded ${ukStateBaselines.length} UK region baselines (preset: ${preset})`);
}

export async function seedUKElections(log: (msg: string) => void) {
  const { ensureUKElections } = await import("@/lib/turnSystem");
  const now = new Date();
  await ensureUKElections(now);
  log("Spawned missing UK Commons elections");
}

// ── UK Regional Council Seeder ──────────────────────────────────────────────

/** Map party slug → { name, abbreviation } for DB lookups (try name first, abbreviation as fallback) */
const SLUG_TO_PARTY: Record<string, { name: string; abbr: string }> = {
  uk_labour: { name: "Labour Party", abbr: "LAB" },
  uk_conservative: { name: "Conservative Party", abbr: "CON" },
  uk_libdem: { name: "Liberal Democrats", abbr: "LD" },
  uk_snp: { name: "Scottish National Party", abbr: "SNP" },
  uk_plaid: { name: "Plaid Cymru", abbr: "PC" },
  uk_green: { name: "Green Party", abbr: "GRN" },
  uk_dup: { name: "Democratic Unionist Party", abbr: "DUP" },
  uk_sf: { name: "Sinn Féin", abbr: "SF" },
  uk_reform: { name: "Reform UK", abbr: "REF" },
};

/**
 * Seeds UK Regional Council data:
 * 1. Updates stateSenateSeats on each UK region
 * 2. Spawns regionalCouncil elections synced to active/upcoming Commons elections
 * 3. Populates NPP elected officials for regions that lack them
 */
export async function seedUKRegionalCouncil(db: Db, reset: boolean, log: (msg: string) => void) {
  const now = new Date();

  if (reset) {
    const regionIds = Object.keys(UK_REGIONAL_COUNCIL_SEATS);
    // Delete Regional Council elections
    const delElections = await db
      .collection("elections")
      .deleteMany({ electionType: "regionalCouncil", stateId: { $in: regionIds } });
    // Delete Regional Council elected officials
    const delOfficials = await db
      .collection("electedOfficials")
      .deleteMany({ officeType: "regionalCouncil", state: { $in: regionIds } });
    // Retire NPPs that only held Regional Council office
    const rcNpps = await db
      .collection<NPP>("npps")
      .find({ "currentOffice.type": "regionalCouncil", countryId: "UK", retiredAt: null })
      .toArray();
    if (rcNpps.length > 0) {
      await db
        .collection<NPP>("npps")
        .updateMany(
          { _id: { $in: rcNpps.map((n) => n._id) } },
          { $set: { retiredAt: now, currentOffice: null, updatedAt: now } }
        );
    }
    log(
      `Reset: deleted ${delElections.deletedCount} elections, ${delOfficials.deletedCount} officials, retired ${rcNpps.length} NPPs`
    );
  }

  // ── Step 1: Update seat counts ──────────────────────────────────────────
  let seatUpdates = 0;
  for (const [regionId, seats] of Object.entries(UK_REGIONAL_COUNCIL_SEATS)) {
    const result = await db
      .collection<State>("states")
      .updateOne({ _id: regionId }, { $set: { stateSenateSeats: seats } });
    if (result.modifiedCount > 0 || result.upsertedCount > 0) seatUpdates++;
  }
  log(`Updated stateSenateSeats on ${seatUpdates} UK regions`);

  // ── Step 2: Spawn the synchronized transition cycle ────────────────────
  let electionsCreated = 0;
  for (const regionId of Object.keys(UK_REGIONAL_COUNCIL_SEATS)) {
    // Check if a regionalCouncil election already exists for this region
    const existingRC = await db
      .collection<Election>("elections")
      .findOne({ countryId: "UK", electionType: "regionalCouncil", state: regionId });
    if (existingRC) continue;

    // Find the current active or upcoming Commons election for this region
    const commonsElection = await db.collection<Election>("elections").findOne(
      {
        countryId: "UK",
        electionType: "commons",
        state: regionId,
        status: { $in: ["active", "upcoming"] },
      },
      { sort: { startTime: 1 } }
    );

    if (!commonsElection) {
      log(`No active/upcoming Commons election for ${regionId} — skipping RC election`);
      continue;
    }

    const rcElection: Election = {
      _id: new ObjectId(),
      countryId: "UK",
      electionType: "regionalCouncil",
      state: regionId,
      seatId: getSeatIdFromElection({
        countryId: "UK",
        electionType: "regionalCouncil",
        state: regionId,
      }),
      totalSeats: UK_REGIONAL_COUNCIL_SEATS[regionId],
      // The synchronized election is cycle 0. Once it resolves, the perpetual
      // spawner opens cycle 1 on the region's annual cohort schedule.
      cycle: 0,
      // Mirror the paired Commons election's baked year so both races label
      // identically; falls back to the Commons cycle if the field is missing
      // on the legacy Commons doc.
      electionYear:
        commonsElection.electionYear ??
        electionToLarpYear("regionalCouncil", commonsElection.cycle, undefined, undefined),
      status: commonsElection.status,
      startTime: commonsElection.startTime,
      primaryEndTime: commonsElection.primaryEndTime,
      endTime: commonsElection.endTime,
      startTurn: commonsElection.startTurn,
      primaryEndTurn: commonsElection.primaryEndTurn,
      endTurn: commonsElection.endTurn,
      durationHours: commonsElection.durationHours,
      primaryDurationHours: commonsElection.primaryDurationHours,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection<Election>("elections").insertOne(rcElection);
    electionsCreated++;
  }
  log(`Created ${electionsCreated} Regional Council transition elections (synced to Commons)`);

  // ── Step 3: Populate NPP officials ──────────────────────────────────────
  // Load all UK regions to get parentRegionId for party lookups
  const ukRegions = await db.collection<State>("states").find({ countryId: "UK" }).toArray();
  const regionMap = new Map(ukRegions.map((r) => [r._id, r]));

  // Cache for party slug → sequentialId lookups
  const partyCache = new Map<string, string>();

  // Get existing NPP names to avoid duplicates
  const existingNPPs = await db
    .collection<NPP>("npps")
    .find({ retiredAt: null })
    .project({ name: 1 })
    .toArray();
  const existingNames = new Set(existingNPPs.map((n) => n.name));

  const { generateUniqueNPPName } = await import("@/lib/npp/nameGenerator");

  let officialsCreated = 0;
  let nppsCreated = 0;

  for (const [regionId, totalSeats] of Object.entries(UK_REGIONAL_COUNCIL_SEATS)) {
    // Check how many seats are currently filled
    const existingOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: "regionalCouncil", state: regionId })
      .toArray();
    const filledSeats = existingOfficials.reduce((sum, o) => sum + (o.seatsHeld ?? 1), 0);

    if (filledSeats >= totalSeats) {
      log(`${regionId}: ${filledSeats}/${totalSeats} seats already populated (historical seed)`);
      continue;
    }

    const seatsToFill = totalSeats - filledSeats;

    const region = regionMap.get(regionId);
    if (!region) {
      log(`${regionId}: region not found in DB — skipping`);
      continue;
    }
    const parentRegionId = region.parentRegionId;

    // Determine parties for this region
    const majorPartySlugs = getMajorPartiesForRegion("UK", parentRegionId);

    // Resolve party slugs to sequentialIds (try name, then abbreviation, then fallback)
    const resolvedParties: { slug: string; seqId: string }[] = [];
    for (const slug of majorPartySlugs) {
      let seqId = partyCache.get(slug);
      if (!seqId) {
        const info = SLUG_TO_PARTY[slug];
        if (info) {
          // Try by name first
          let party = await db
            .collection<PoliticalParty>("politicalParties")
            .findOne({ name: info.name, countryId: "UK" });
          // Fallback: try by abbreviation
          if (!party) {
            party = await db
              .collection<PoliticalParty>("politicalParties")
              .findOne({ abbreviation: info.abbr, countryId: "UK" });
          }
          if (party) {
            seqId = String(party.sequentialId);
            partyCache.set(slug, seqId);
          }
        }
      }
      if (!seqId) {
        // Final fallback: use Labour or Conservative
        const fallback = await db.collection<PoliticalParty>("politicalParties").findOne({
          countryId: "UK",
          abbreviation: { $in: ["LAB", "CON"] },
        });
        if (fallback) {
          seqId = String(fallback.sequentialId);
          partyCache.set(slug, seqId);
          log(`Fallback: using ${fallback.name} for slug ${slug}`);
        }
      }
      if (seqId) {
        resolvedParties.push({ slug, seqId });
      } else {
        log(`Could not resolve party for slug: ${slug}`);
      }
    }

    log(
      `${regionId}: parentRegion=${parentRegionId}, filled=${filledSeats}/${totalSeats}, need ${seatsToFill} more, resolved=${resolvedParties.length} parties`
    );

    if (resolvedParties.length === 0) {
      log(`No parties resolved for ${regionId} — skipping NPP officials`);
      continue;
    }

    // Distribute new seats proportionally based on existing party ratios,
    // or evenly if no existing officials
    const existingByParty = new Map<string, number>();
    for (const o of existingOfficials) {
      const key = o.party ?? "unknown";
      existingByParty.set(key, (existingByParty.get(key) ?? 0) + (o.seatsHeld ?? 1));
    }

    // Build target proportions: use existing ratios if available, else equal split
    const partyTargets: { slug: string; seqId: string; newSeats: number }[] = [];
    if (filledSeats > 0 && existingByParty.size > 0) {
      // Scale existing proportions to the total seat count, then compute deficit per party
      const entries = resolvedParties.map(({ slug, seqId }) => {
        const currentSeats = existingByParty.get(seqId) ?? 0;
        const targetShare = currentSeats / filledSeats;
        const targetTotal = Math.round(targetShare * totalSeats);
        const deficit = Math.max(0, targetTotal - currentSeats);
        return { slug, seqId, deficit };
      });
      // Also add seats for parties not yet represented
      const unrepresented = entries.filter((e) => !existingByParty.has(e.seqId));
      if (unrepresented.length > 0) {
        // Give unrepresented parties a fair share of remaining seats
        const representedDeficit = entries
          .filter((e) => existingByParty.has(e.seqId))
          .reduce((s, e) => s + e.deficit, 0);
        const leftover = Math.max(0, seatsToFill - representedDeficit);
        const perUnrep = Math.floor(leftover / unrepresented.length);
        let unrepRemainder = leftover - perUnrep * unrepresented.length;
        for (const e of unrepresented) {
          e.deficit = perUnrep + (unrepRemainder > 0 ? 1 : 0);
          if (unrepRemainder > 0) unrepRemainder--;
        }
      }
      // Largest-remainder allocation to ensure exact total
      const totalDeficit = entries.reduce((s, e) => s + e.deficit, 0);
      if (totalDeficit > 0) {
        const rawShares = entries.map((e) => (e.deficit / totalDeficit) * seatsToFill);
        const floors = rawShares.map((s) => Math.floor(s));
        let floorsTotal = floors.reduce((s, f) => s + f, 0);
        const remainders = rawShares.map((s, i) => ({ i, r: s - floors[i] }));
        remainders.sort((a, b) => b.r - a.r);
        for (const { i } of remainders) {
          if (floorsTotal >= seatsToFill) break;
          floors[i]++;
          floorsTotal++;
        }
        for (let i = 0; i < entries.length; i++) {
          partyTargets.push({
            slug: entries[i].slug,
            seqId: entries[i].seqId,
            newSeats: floors[i],
          });
        }
      } else {
        for (const e of entries) {
          partyTargets.push({ slug: e.slug, seqId: e.seqId, newSeats: 0 });
        }
      }
    } else {
      // No existing officials — even distribution
      const seatsPerParty = Math.floor(seatsToFill / resolvedParties.length);
      let remainder = seatsToFill - seatsPerParty * resolvedParties.length;
      for (const { slug, seqId } of resolvedParties) {
        const seats = seatsPerParty + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        partyTargets.push({ slug, seqId, newSeats: seats });
      }
    }

    const nppsToInsert: NPP[] = [];
    const officialsToInsert: ElectedOfficial[] = [];

    for (const { slug, seqId, newSeats } of partyTargets) {
      if (newSeats <= 0) continue;

      // Check if this party already has an NPP official — if so, add seats to them
      const existingOfficial = existingOfficials.find(
        (o) => o.party === seqId && o.isNPP && o.nppId
      );
      if (existingOfficial) {
        await db
          .collection<ElectedOfficial>("electedOfficials")
          .updateOne(
            { _id: existingOfficial._id },
            { $inc: { seatsHeld: newSeats }, $set: { updatedAt: now } }
          );
        // Also update the NPP's currentOffice
        if (existingOfficial.nppId) {
          await db.collection<NPP>("npps").updateOne(
            { _id: existingOfficial.nppId },
            {
              $inc: { "currentOffice.seatsHeld": newSeats },
              $set: { updatedAt: now },
            }
          );
        }
        officialsCreated++;
        continue;
      }

      // Create new NPP for this party
      let name = generateUniqueNPPName(Array.from(existingNames), 100, "UK");
      if (!name) {
        name = `NPP ${Math.random().toString(36).substring(7)}`;
      }
      existingNames.add(name);

      const sequentialId = await getNextSequentialId(db, "npp");
      const nppId = new ObjectId();

      // Assign demographics and portrait using the same pipeline as dynamic NPP generation
      const gender: NPPGender = Math.random() < 0.5 ? "male" : "female";
      const ethnicity: NPPEthnicity = weightedRandomEthnicity("UK");
      const avatarUrl = selectPoliticianImage("UK", gender, ethnicity, name);

      // Determine default policy positions based on party slug
      const policies =
        slug.includes("labour") || slug.includes("snp") || slug.includes("sf")
          ? { economic: -2, social: -2 }
          : slug.includes("conservative") || slug.includes("dup")
            ? { economic: 2, social: 1 }
            : { economic: 0, social: 0 };

      const npp: NPP = {
        _id: nppId,
        sequentialId,
        name,
        countryId: "UK",
        homeState: regionId,
        gender,
        ethnicity,
        ...(avatarUrl && { avatarUrl }),
        politicalInfluence: 10,
        favorability: 50 + Math.random() * 20 - 10,
        policies,
        party: seqId,
        currentOffice: { type: "regionalCouncil", state: regionId, seatsHeld: newSeats },
        personality: {
          loyalty: 50 + Math.random() * 30 - 15,
          ambition: 50 + Math.random() * 40 - 20,
          stubbornness: 40 + Math.random() * 30 - 15,
        },
        generatedAt: now,
        retiredAt: null,
        influenceState: { totalTimesInfluenced: 0 },
        // Economy fields — initialized at creation so NPPs are ready for
        // economy actions immediately without requiring a migration backfill.
        funds: 0,
        donorBaseLevel: 0,
        actionPoints: 0,
        lastActionProcessedTurn: 0,
        archetypeApprovals: {},
        electionCooldowns: {},
        createdAt: now,
        updatedAt: now,
      };

      const official: ElectedOfficial = {
        _id: new ObjectId(),
        countryId: "UK",
        officeType: "regionalCouncil",
        state: regionId,
        isAppointment: false,
        seatsHeld: newSeats,
        characterId: null,
        characterName: name,
        party: seqId,
        isNPP: true,
        nppId,
        electedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      nppsToInsert.push(npp);
      officialsToInsert.push(official);
    }

    if (nppsToInsert.length > 0) {
      await db.collection<NPP>("npps").insertMany(nppsToInsert);
      nppsCreated += nppsToInsert.length;
    }
    if (officialsToInsert.length > 0) {
      await db.collection<ElectedOfficial>("electedOfficials").insertMany(officialsToInsert);
      officialsCreated += officialsToInsert.length;
    }
  }

  log(`Created ${nppsCreated} NPPs and ${officialsCreated} Regional Council officials`);
}

/** Remove the retired real-person ceremonial NPP written by the legacy CLI seeder. */
export async function removeLegacyUKCeremonialIdentity(
  db: Db,
  log: (msg: string) => void
): Promise<void> {
  const result = await db.collection("npps").deleteMany({
    _id: new ObjectId("6770000000000000000000a1"),
    countryId: "UK",
    name: "King Charles III",
    politicalInfluence: 0,
    currentOffice: null,
    retiredAt: { $ne: null },
  });
  if (result.deletedCount > 0) {
    log(`Removed ${result.deletedCount} legacy UK ceremonial identity record(s)`);
  }
}

/**
 * Admin-only destructive re-seed of UK devolved-executive NPP officials
 * for the 2020 preset:
 *   - First Ministers of Scotland (SNP), Wales (Labour), Northern Ireland (DUP)
 *   - Mayor of London (Labour)
 *
 * Uses the recycled `governor` officeType — see
 * `docs/design/uk-jp-devolved-executives.md`. English non-London regions
 * (SEE/SWE/EAE/EMI/WMI/YHU/NWE/NEE) have no devolved executive and are
 * skipped. Mirrors `seedDEMinisterPresidents2020`.
 *
 * NOT called from `bootstrapGameWorld` — the bootstrap path seeds these
 * officials via the `UK_FIRST_MINISTERS_2020` historical-seat array
 * embedded in `getPresetSeats("2019-default")`. This function exists
 * only as the `/api/admin/seed` target `"ukGovernors2020"` for
 * destructive re-seed operations.
 */
export async function seedUKGovernors2020(db: Db, reset: boolean, log: (msg: string) => void) {
  if (reset) {
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId: "UK", officeType: "governor", isNPP: true })
      .project<{ nppId?: ObjectId }>({ nppId: 1 })
      .toArray();
    const nppIds = officials.map((o) => o.nppId).filter((id): id is ObjectId => id != null);

    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany({ countryId: "UK", officeType: "governor", isNPP: true });

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
      `Reset: deleted ${officials.length} UK FM/Mayor NPP officials, retired ${nppIds.length} NPPs`
    );
  }

  const { UK_FIRST_MINISTERS_2020 } = await import("@/lib/constants/historicalSeats");
  const { seedFromSeats } = await import("@/lib/npp/seedHistorical");
  const result = await seedFromSeats(db, UK_FIRST_MINISTERS_2020);
  log(
    `Seeded UK First Ministers + Mayor of London (2020): ${result.nppsCreated} NPPs, ${result.officialsCreated} officials`
  );
}

/**
 * Admin-only destructive re-seed of UK devolved-executive NPP officials
 * for the 1991/1992 preset.
 *
 * Same shape as the 2020 variant — recycled `governor` officeType for
 * SCO/WAL/NIR/LON. Anachronistic for 1991 (devolution didn't exist until
 * 1998-99, Mayor of London until 2000), but the game models these offices
 * across both presets. Party-stamping reflects the regional Westminster
 * majority in 1992 (Labour for SCO/WAL/LON; UUP for NIR — the 1991-only
 * `uk_uup` default is seeded under the 1991-default preset, so the NIR
 * FM seat can party-stamp to UUP directly without folding to DUP).
 *
 * NOT called from `bootstrapGameWorld` — the bootstrap path seeds these
 * officials via the `UK_FIRST_MINISTERS_1992` historical-seat array
 * embedded in `getPresetSeats("1991-default")`. This function exists
 * only as the `/api/admin/seed` target `"ukGovernors1992"` for
 * destructive re-seed operations.
 */
export async function seedUKGovernors1992(db: Db, reset: boolean, log: (msg: string) => void) {
  if (reset) {
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId: "UK", officeType: "governor", isNPP: true })
      .project<{ nppId?: ObjectId }>({ nppId: 1 })
      .toArray();
    const nppIds = officials.map((o) => o.nppId).filter((id): id is ObjectId => id != null);

    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany({ countryId: "UK", officeType: "governor", isNPP: true });

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
      `Reset: deleted ${officials.length} UK FM/Mayor NPP officials, retired ${nppIds.length} NPPs`
    );
  }

  const { UK_FIRST_MINISTERS_1992 } = await import("@/lib/constants/historicalSeats");
  const { seedFromSeats } = await import("@/lib/npp/seedHistorical");
  const result = await seedFromSeats(db, UK_FIRST_MINISTERS_1992);
  log(
    `Seeded UK First Ministers + Mayor of London (1992): ${result.nppsCreated} NPPs, ${result.officialsCreated} officials`
  );
}
