import { ObjectId, type Db } from "mongodb";
import {
  selectPresetBundle,
  eraForPreset,
  getPresetFallbacks,
  resetPresetFallbacks,
} from "@/lib/seeds/presetSelector";
import { selectStatesBundleForPreset } from "./seedStates";
import { policies } from "@/lib/seeds/reference/policies";
import { gameConfig } from "@/lib/seeds/reference/gameConfig";
import { demographicCategories } from "@/lib/seeds/demographicCategories";
import { registerAndGenerate, stateCensusData } from "@/lib/seeds/stateDemographics";
import { stateCensusData1953 } from "@/lib/seeds/stateCensusData1953";
import { stateCensusData1979 } from "@/lib/seeds/stateCensusData1979";
import { stateCensusData1991 } from "@/lib/seeds/stateCensusData1991";
import { stateCensusData1999 } from "@/lib/seeds/stateCensusData1999";
import { stateCensusData2007 } from "@/lib/seeds/stateCensusData2007";
import { stateCensusData2023 } from "@/lib/seeds/stateCensusData2023";
import { politicalParties } from "@/lib/seeds/reference/politicalParties";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import { generateStatePartyOrg } from "@/lib/seeds/reference/statePartyOrg";
import { stateBaselines } from "@/lib/seeds/reference/stateBaselines";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { adminLegislationTypes } from "@/lib/seeds/reference/legislationTypes.admin";
import { getAchievementDocsForSeed } from "@/lib/seeds/achievements";
import { getNextSequentialId, resetPartyCounters } from "@/lib/db/sequentialId";
import { seedBudgets } from "./seedBudgets";
import { seedRegionMetrics } from "./seedRegionMetrics";
import { seedStateResourceCapacity } from "./seedStateResourceCapacity";
import { seedStateSectorSpecializations } from "./seedStateSectorSpecializations";
import { seedInternationalOrganizations } from "./seedInternationalOrganizations";
import { seedTradeLanes } from "./seedTradeLanes";
import { seedCountryAlignments } from "@/lib/alignment/seedAlignment";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { getPresetById } from "@/lib/constants/historicalSeats";
import { seedStrategicSectors } from "./seedStrategicSectors";
import { seedMilitaryUnits } from "./seedMilitaryUnits";
import {
  captureSeedRosterUpkeepPin,
  clearSeedRosterUpkeepPinCache,
} from "@/lib/military/seedRosterUpkeepPin";
import { seedNationalManpower } from "./seedNationalManpower";
import { seedCabinetEstates } from "./seedCabinetEstates";
import { seedEnergyPlants } from "./seedEnergyPlants";
import { seedInfraProjects } from "./seedInfraProjects";
import { seedCongressionalDistricts } from "@/lib/redistricting/seedDistricts";
import type {
  State,
  Policy,
  GameConfig,
  DemographicCategory,
  StateDemographics,
  StateDemographicTurnout,
  PoliticalParty,
  StatePartyOrg,
  StateMetricBaseline,
  LegislationType,
  Achievement,
  User,
  Character,
} from "@/lib/db/types";

/**
 * What `runSeed`'s reset branch deletes, and how far.
 *
 * `runSeed` is the UNITED STATES pack. It seeds the US states bundle and US
 * reference data; every other country is seeded by its own `seedXX*` module,
 * each of which scopes its own reset with `deleteMany({ countryId: "XX" })`
 * (3-7 per country). So a global drop here is redundant on the bootstrap path —
 * and destructive on the two standalone ones.
 *
 * `POST /api/seed?reset=true` (SEED_SECRET, i.e. reachable from CI) and
 * `scripts/seed.ts --reset` call `runSeed` directly and never reach
 * `seedAllCountryData`. With a global drop those endpoints deleted 21
 * collections outright and re-seeded only the US: MEASURED at **1,995 documents
 * lost, `states` 24 countries -> 1**, with `statePartyOrg` 591 -> 100,
 * `politicalParties` 71 -> 2 and `politicalMetrics` 188 -> 51. Worse, the
 * region-keyed collections SURVIVED at full count (`unownedSectors` 3,842,
 * `congressionalDistricts` 435, `unions` 408), leaving them pointing at a
 * 51-row `states` — dangling references, not clean loss.
 *
 * Each entry below therefore says how it is scoped:
 *
 *  - `countryId` — `deleteMany({ countryId: "US" })`.
 *  - `stateIds`  — the collection keys on the region id in `_id`, so it is
 *                  scoped to the preset's US bundle.
 *  - `global`    — genuinely not country-scoped; the whole collection is
 *                  reference data `runSeed` owns and fully rebuilds.
 *
 * ⚠️ `gameConfig` is deliberately ABSENT and must stay absent. It is a singleton
 * whose ~113 fields are roughly ten seeded reference defaults and a hundred
 * pieces of live operational state — maintenance mode, the Discord webhook URLs,
 * and every admin feature gate (`labourSystemMode`, `marketSystemMode`,
 * `indexFundsMode`, `moneySupplyEnabled`, …). Dropping it re-seeded the ten and
 * silently discarded the hundred. Per-world markers are cleared explicitly via
 * {@link STALE_PER_WORLD_GAME_CONFIG_UNSET} instead.
 *
 * ⚠️ `stateRegistrationPool` is ALSO absent, for a different reason: `runSeed`
 * cannot rebuild it. Its only seeder, `seedRegistrationLanes`, lives in
 * `bootstrapGameWorld`. Dropping it here measured **51 -> 0** on the standalone
 * path with nothing to restore it. (The old drop-list comment claimed it was
 * "re-seeded below (seedRegistrationLanes / …)" — that function is not in this
 * file, and never was.) Scoping would not have helped: the US is who loses the
 * rows. Not dropping it is safe because the US region set is stable across
 * presets, so it cannot strand orphans the way a re-districted country would.
 */
/** `runSeed` is the US pack; every other country has its own seeder. */
const US_COUNTRY_ID = "US";

export type ResetDropScope = "countryId" | "stateIds" | "global";

export const RESET_DROP_COLLECTIONS: ReadonlyArray<{
  name: string;
  scope: ResetDropScope;
  note?: string;
}> = [
  { name: "states", scope: "countryId" },
  { name: "stateDemographics", scope: "countryId" },
  { name: "demographicDefaults", scope: "countryId" },
  { name: "politicalParties", scope: "countryId" },
  { name: "statePartyOrg", scope: "countryId" },
  { name: "politicalMetrics", scope: "countryId" },
  {
    name: "macroMetrics",
    scope: "countryId",
    note:
      "Dropped for the same reason politicalMetrics is: the seeders UPSERT, so " +
      "without a delete every field the new preset does not write survives — " +
      "including accreted engine state (simBaseline, trend, outputGap) and any " +
      "region the old preset had and the new one does not. Categorised " +
      "`reference`, so resetGameWorld's runtime sweep does not cover it either.",
  },
  { name: "federalBudget", scope: "countryId" },
  { name: "stateBudgets", scope: "countryId" },
  { name: "stateResourceCapacity", scope: "countryId" },
  { name: "congressionalDistricts", scope: "countryId" },
  { name: "stateSectorSpecializations", scope: "countryId" },
  {
    name: "stateBaselines",
    scope: "stateIds",
    note: "`_id` IS the region id and no seeder stamps a countryId, so scope by the preset's US bundle.",
  },
  {
    name: "stateMetricBaselines",
    scope: "stateIds",
    note: "RETIRED — a legacy parallel of stateBaselines that no seeder has written since everything was pointed at stateBaselines. Cleared so a reset removes the stragglers the manifest note describes.",
  },
  {
    name: "stateMetrics",
    scope: "stateIds",
    note: "RETIRED — replaced by macroMetrics + the politicalMetrics board; nothing reads or writes it. Listed so a reset clears what an older build left behind.",
  },
  {
    name: "policies",
    scope: "global",
    note: "Two rows, not country-scoped, fully rebuilt below.",
  },
  {
    name: "legislationTypes",
    scope: "global",
    note: "The whole catalog is rebuilt below from `legislationTypes` + the admin set + the projected political laws.",
  },
  {
    name: "formulaGrants",
    scope: "global",
    note: "US-only by construction — seedBudgets drops and rebuilds it.",
  },
  {
    name: "demographicCategories",
    scope: "global",
    note:
      "⚠️ Looks global and is not, quite: `_id` is a category KEY, and 20 country " +
      "seeders each upsert their own. Only the ONE row the shared constant owns " +
      "(`voterGroups`) belongs to runSeed, so the delete is scoped to that " +
      "constant's ids rather than the collection.",
  },
];

/**
 * Per-world markers the turn engine stamps onto `gameConfig`, cleared on reset.
 *
 * These are the one thing the old blanket `gameConfig` drop legitimately bought.
 * `src/lib/market/launchGuard.ts` stamps a reference market cap and turn on the
 * config doc and compares later turns against it; carried into a new world they
 * would measure the new market's drawdown against the dead world's valuation.
 *
 * Same shape and rationale as `STALE_PROGRESS_GAME_STATE_UNSET` on `gameState`
 * — an explicit `$unset` list, not a blanket drop, so the ~100 operational
 * fields beside them survive. ⚠️ The market-guard *configuration* knobs
 * (`marketGuardEnabled`, `marketGuardDropPct`, `marketGuardGraceTurns`) are
 * admin settings, not per-world state, and must NOT be listed here.
 */
export const STALE_PER_WORLD_GAME_CONFIG_UNSET: Readonly<Record<string, "">> = Object.freeze({
  marketGuardReferenceMcap: "",
  marketGuardReferenceFundamentalMcap: "",
  marketGuardReferenceTurn: "",
  marketGuardTrippedAt: "",
});

/**
 * Provenance stamps for `marketSystemMode`, cleared only when a reset re-adopts
 * the reference tier. They name the human who set the *previous* world's tier,
 * so leaving them on a world whose tier the seed just chose would attribute a
 * seed default to an operator who never made that call for this world.
 */
export const STALE_MARKET_MODE_STAMP_UNSET: Readonly<Record<string, "">> = Object.freeze({
  marketSystemModeUpdatedBy: "",
  marketSystemModeUpdatedAt: "",
  marketSystemModeUpdatedTurn: "",
});

export type RunSeedOptions = {
  db: Db;
  reset?: boolean;
  /**
   * Reset-preset id (e.g. `"2019-default"`, `"1991-default"`). Selects the
   * presidential-margin baseline used to calibrate initial US state-party
   * caps + Org. REQUIRED: it used to default to `"2019-default"`, so a caller
   * that omitted it silently seeded a modern world over a historical one.
   */
  preset: string;
  /**
   * Run the seeders that read `states` for their roster (see
   * {@link runRegionDerivedStage}). Default TRUE so the standalone callers keep
   * their existing contract.
   *
   * `seedAllCountryData` passes FALSE: `runSeed` seeds only the US bundle, and
   * the other 23 countries' regions arrive after it returns, so running the
   * stage here covered the US and nothing else — MEASURED as militaryUnits 13
   * docs across 1 country on a world with 226 states across 24.
   */
  includeRegionDerived?: boolean;
  /**
   * Seed the US budget bundle (federal budget, US enacted laws, US state
   * budgets, the US country-owned corporation, formula grants). Default TRUE so
   * `POST /api/seed` and `scripts/seed.ts` — which never reach
   * `bootstrapGameWorld` — keep rebuilding it.
   *
   * `seedAllCountryData` passes FALSE. `bootstrapGameWorld` calls `seedBudgets`
   * again as the US member of its per-country budget block, AFTER the
   * `commandEconomyEnabled` gate write those seeders read, so on that path this
   * call was a complete duplicate: same preset, same reset flag, and the late
   * call is the last word on every collection it touches.
   *
   * Safe because NOTHING between the two calls reads US budget data — checked
   * across `federalBudget`, `stateBudgets`, `formulaGrants` and US
   * `enactedLaws`. The in-window seeders (the UK/JP/DE/BR packs, the
   * Warsaw-Pact block) scope every budget write to their own `countryId`, and
   * the diagnostic, sovereign-bond and fiscal-year readers all run later.
   *
   * ⚠️ The already-seeded gate near the top of `runSeed` reads all three budget
   * collections. It is unaffected: it runs before either call and reports the
   * PREVIOUS run's state, which the late call still populates.
   */
  includeBudgets?: boolean;
  log?: (msg: string) => void;
};

/**
 * US reference data seed used by CLI (`scripts/seed.ts`), token `/api/seed`, auto-seed,
 * and `bootstrapGameWorld` (first step). Owns achievements, states, parties, legislation types, etc.
 *
 * Callers must supply a connected `db` (CLI uses `connectDb()` in `scripts/seed.ts`).
 */
export async function runSeed(
  options: RunSeedOptions
): Promise<{ seeded: boolean; message: string }> {
  const {
    db,
    reset = false,
    preset,
    includeRegionDerived = true,
    includeBudgets = true,
    log = console.log,
  } = options;

  // Fresh record per run — the module-level list would otherwise accumulate
  // across runs in a long-lived process and report another run's gaps.
  resetPresetFallbacks();

  // Build US state-party-org rows scaled to the preset's presidential-margin
  // baseline (2019 → 2020 results, 1991 → 1988 results). `seedRegistrationLanes`
  // later overwrites `.organization` per the preset's lane templates; the
  // cap contributions computed here remain the starting point.
  const statePartyOrg = generateStatePartyOrg(preset);

  // Seed achievements if empty (runs regardless of main seed status)
  const achievementCount = await db.collection("achievements").countDocuments();
  let achievementDocs: Array<Achievement & { _id: ObjectId }>;
  if (achievementCount === 0) {
    achievementDocs = getAchievementDocsForSeed();
    await db.collection<Achievement>("achievements").insertMany(achievementDocs);
    await db
      .collection("achievements")
      .createIndex({ slug: 1 }, { unique: true })
      .catch(() => {});
    await db
      .collection("characterAchievements")
      .createIndex({ characterId: 1, achievementId: 1 }, { unique: true })
      .catch(() => {});
    await db
      .collection("characterAchievements")
      .createIndex({ achievementId: 1 })
      .catch(() => {});
    log(`Seeded ${achievementDocs.length} achievements`);
  } else {
    achievementDocs = (await db
      .collection<Achievement>("achievements")
      .find({})
      .toArray()) as Array<Achievement & { _id: ObjectId }>;
  }

  // Grant all achievements to admin characters (runs every seed)
  if (achievementDocs.length > 0) {
    const adminUsers = await db
      .collection<User>("users")
      .find({ $or: [{ isAdmin: true }, { role: "admin" }] })
      .toArray();
    const adminUserIds = adminUsers.map((u) => u._id);
    const adminCharacters =
      adminUserIds.length > 0
        ? await db
            .collection<Character>("characters")
            .find({ userId: { $in: adminUserIds } })
            .toArray()
        : [];
    let adminGrants = 0;
    for (const char of adminCharacters) {
      for (const a of achievementDocs) {
        try {
          await db.collection("characterAchievements").insertOne({
            _id: new ObjectId(),
            characterId: char._id,
            achievementId: a._id,
            earnedAt: new Date(),
          });
          adminGrants++;
        } catch {
          // Ignore duplicate (already has achievement)
        }
      }
    }
    if (adminGrants > 0) {
      log(
        `Granted all achievements to ${adminCharacters.length} admin character(s) (${adminGrants} total grants)`
      );
    }
  }

  // Check if already seeded (states collection has data and reset not requested)
  if (!reset) {
    const stateCount = await db.collection("states").countDocuments();
    const nationalBudgetCount = await db.collection("federalBudget").countDocuments();
    const stateBudgetCount = await db.collection("stateBudgets").countDocuments();
    const formulaGrantCount = await db.collection("formulaGrants").countDocuments();
    const budgetsSeeded = nationalBudgetCount > 0 && stateBudgetCount > 0 && formulaGrantCount > 0;

    if (stateCount > 0 && budgetsSeeded) {
      return {
        seeded: false,
        message: `Database already seeded (${stateCount} states and budget collections found). Use reset=true to re-seed.`,
      };
    }
  }

  // States — preset-aware. 2019-default uses 2020-Census population +
  // current GDP; 1991-default uses 1990 Census + 1991 nominal GSP.
  // Era map shared with the targeted admin "states" reseed (refs #3242).
  // Declared before the reset block because the scoped delete keys on its ids —
  // the same bundle the upsert below uses, so a drop and its re-seed cannot drift.
  const statesBundle = selectStatesBundleForPreset(preset);

  if (reset) {
    // Scoped to the US, because that is all `runSeed` rebuilds. See
    // RESET_DROP_COLLECTIONS for the measured cost of doing this globally.
    const usStateIds = statesBundle.map((st) => st._id as string);
    const ownedCategoryIds = demographicCategories.map((c) => c._id);
    let deleted = 0;
    for (const entry of RESET_DROP_COLLECTIONS) {
      const filter =
        entry.scope === "countryId"
          ? { countryId: US_COUNTRY_ID }
          : entry.scope === "stateIds"
            ? { _id: { $in: usStateIds } }
            : entry.name === "demographicCategories"
              ? { _id: { $in: ownedCategoryIds } }
              : {};
      const res = await db
        .collection(entry.name)
        // Untyped handles across a heterogeneous list; each filter is validated
        // by the scope contract test rather than by the collection's generic.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .deleteMany(filter as any)
        .catch(() => ({ deletedCount: 0 }));
      deleted += res.deletedCount ?? 0;
    }
    log(
      `RESET mode: cleared ${deleted} US row(s) across ${RESET_DROP_COLLECTIONS.length} collections`
    );
    // gameConfig is NOT dropped — see RESET_DROP_COLLECTIONS. Clear only the
    // per-world markers the turn engine stamped onto it, so the operational
    // half of the document (maintenance, webhooks, feature gates) survives.
    await db
      .collection<GameConfig>("gameConfig")
      .updateOne({ _id: gameConfig._id }, { $unset: STALE_PER_WORLD_GAME_CONFIG_UNSET })
      .catch(() => {});
    // Reset the US party counter so the US parties deleted above get consistent
    // ids on re-insert. Scoped: the other 23 countries' parties are untouched by
    // this function, so wiping their counters would hand the next insert a
    // colliding seqId.
    await resetPartyCounters(db, [US_COUNTRY_ID]);
  }

  for (const state of statesBundle) {
    await db
      .collection<State>("states")
      .updateOne({ _id: state._id }, { $set: state }, { upsert: true });
  }
  log(`Seeded ${statesBundle.length} states (${preset})`);

  // Country runtime state (per-country mutable fields promoted out of
  // COUNTRY_CONFIGS). Idempotent — skips countries that already have a doc,
  // so reset paths don't clobber in-flight runtime mutations.
  const { seedAllCountryStates } = await import("@/lib/countryState/seed");
  const countryStateResult = await seedAllCountryStates(db, preset);
  log(
    `Seeded countryState: created=${countryStateResult.created}, skipped=${countryStateResult.skipped}`
  );

  // Policies
  for (const policy of policies) {
    await db
      .collection<Policy>("policies")
      .updateOne({ _id: policy._id }, { $set: policy }, { upsert: true });
  }
  log(`Seeded ${policies.length} policies`);

  // Demographic categories
  for (const category of demographicCategories) {
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id: category._id }, { $set: category }, { upsert: true });
  }
  log(`Seeded ${demographicCategories.length} demographic categories`);

  // State demographics — era-aware. The preset's census bundle is generated
  // through the Layer-1 pipeline with that era's composition (turnout rates,
  // leans, weights from ERA_COMPOSITIONS). The post-hoc 1991 population
  // multiplier (`applyEra1991DemographicAdjustments`) is no longer used for US;
  // 1991 worlds now seed from independent 1991 Layer-1 census data.
  const { calculateStateLeanForCache } = await import("@/lib/demographics/cachedStateLean");
  const is1991 = preset === "1991-default";
  const era = eraForPreset(preset);
  const censusBundle = selectPresetBundle(
    preset,
    {
      "1953-default": stateCensusData1953, // 1979 shares proxy with 1979-authored positions stripped
      "1979-default": stateCensusData1979,
      "1991-default": stateCensusData1991,
      "1999-default": stateCensusData1999,
      "2007-default": stateCensusData2007,
      "2019-default": stateCensusData,
      "2023-default": stateCensusData2023,
    },
    "runCoreSeed:stateCensusData1953"
  );
  const { isLayer1PositionsEnabled } = await import("@/lib/seeds/layer1PositionsFlag");
  const layer1Positions = await isLayer1PositionsEnabled();
  const { loadEraFullOverride } = await import("@/lib/seeds/loadEraPositionOverride");
  const override = layer1Positions ? ((await loadEraFullOverride(era)) ?? undefined) : undefined;
  let seededDemographicsCount = 0;
  for (const [censusStateId, censusConfig] of Object.entries(censusBundle)) {
    const sd = registerAndGenerate(censusStateId, censusConfig, era, {
      layer1Positions,
      positions: override?.positions,
      turnout: override?.turnout,
    });
    const calculatedLean = calculateStateLeanForCache(sd, demographicCategories, {
      countryId: "US",
      stateId: sd._id,
      preset,
      demographicDefaults: sd,
    });
    const cachedDemographics = {
      ...sd,
      cachedEconomicLean: calculatedLean.economicLean,
      cachedSocialLean: calculatedLean.socialLean,
    };
    seededDemographicsCount++;
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id: sd._id }, { $set: cachedDemographics }, { upsert: true });
    await db
      .collection<StateDemographics>("demographicDefaults")
      .updateOne({ _id: sd._id }, { $set: cachedDemographics }, { upsert: true });
    await db.collection<State>("states").updateOne(
      { _id: sd._id },
      {
        $set: {
          cachedEconomicLean: calculatedLean.economicLean,
          cachedSocialLean: calculatedLean.socialLean,
          demographicsLastUpdated: new Date(),
        },
      }
    );
  }
  log(`Seeded ${seededDemographicsCount} state demographics (preset: ${preset}, era: ${era})`);

  // US stateDemographicTurnout (required for Turnout tab)
  const { STATE_IDS } = await import("@/lib/constants/states");
  const { DEMOGRAPHIC_TURNOUT_RATES } = await import("@/lib/seeds/demographicCategories");
  const usStateIds = [...STATE_IDS];
  const turnoutNow = new Date();
  const emptyModifiers: Record<string, Record<string, number>> = {
    race: Object.fromEntries(
      (Object.keys(DEMOGRAPHIC_TURNOUT_RATES.race) as string[]).map((k) => [k, 0])
    ),
    age: Object.fromEntries(
      (Object.keys(DEMOGRAPHIC_TURNOUT_RATES.age) as string[]).map((k) => [k, 0])
    ),
    education: Object.fromEntries(
      (Object.keys(DEMOGRAPHIC_TURNOUT_RATES.education) as string[]).map((k) => [k, 0])
    ),
    wealth: Object.fromEntries(
      (Object.keys(DEMOGRAPHIC_TURNOUT_RATES.wealth) as string[]).map((k) => [k, 0])
    ),
    ideology: Object.fromEntries(
      (Object.keys(DEMOGRAPHIC_TURNOUT_RATES.ideology) as string[]).map((k) => [k, 0])
    ),
  };
  for (const sid of usStateIds) {
    await db.collection<StateDemographicTurnout>("stateDemographicTurnout").updateOne(
      { _id: sid },
      {
        $set: {
          modifiers: emptyModifiers,
          lastDecayApplied: turnoutNow,
          lastUpdated: turnoutNow,
        },
      },
      { upsert: true }
    );
  }
  log(`Seeded ${usStateIds.length} US stateDemographicTurnout docs`);

  // Game config — persist seedYear so landing/login can read the active era
  // without a separate admin step. era is already in scope from eraForPreset(preset).
  //
  // D14 PROTECTION — on a NON-reset seed, `marketSystemMode` is deliberately
  // excluded from the `$set` and moved to `$setOnInsert`.
  //
  // The reference config is stamped over the live gameConfig with `$set` on
  // every core seed, and a core seed is NOT always a world reset: a seed run
  // WITHOUT reset — a preset top-up, a partial re-seed, any of the admin seed
  // steps that route through here — updates the existing doc in place. Under
  // the old blanket `$set` that silently rolled a world's market tier back to
  // the reference default and wiped the who/when/which-turn stamps with it.
  //
  // For every other tier that was a shrug. For `plants` it is not: the tier is
  // not a display toggle, it is an economy identity. Dropping a soaking world
  // from plants to capital mid-flight hands capital mode a plants-derived
  // nameplate to resume compounding from — the exact silent rebase that
  // `legacyRevenueShadow` and the D13 restore script exist to prevent — except
  // here it happens with no operator in the loop, no dry-run, and no adminLog
  // entry naming a human. A tier change must be an explicit act through the
  // admin route (which stamps `marketSystemModeUpdatedBy/At/Turn`), never a
  // side effect of a seed.
  //
  // A RESET is the exception to that exception. `gameConfig` is not dropped
  // (see RESET_DROP_COLLECTIONS), so under `$setOnInsert` alone the document
  // always already exists and every reset world inherits the DEAD world's tier
  // — permanently, because the next reset inherits it again. That is how prod
  // came back from a fresh 1953 reset still on "ledger" two raises of the
  // reference default later. A reset world has no economy to migrate and no
  // operator intent to protect, so it takes the reference tier, and the stamps
  // naming whoever chose the old world's tier go with it.
  const seedYear = parseInt(era, 10);
  const { marketSystemMode: referenceMarketSystemMode, ...gameConfigWithoutMarketMode } =
    gameConfig;
  await db.collection<GameConfig>("gameConfig").updateOne(
    { _id: gameConfig._id },
    reset
      ? {
          $set: {
            ...gameConfigWithoutMarketMode,
            seedYear,
            marketSystemMode: referenceMarketSystemMode,
          },
          $unset: STALE_MARKET_MODE_STAMP_UNSET,
        }
      : {
          $set: { ...gameConfigWithoutMarketMode, seedYear },
          $setOnInsert: { marketSystemMode: referenceMarketSystemMode },
        },
    { upsert: true }
  );
  log("Seeded game config");

  // Political parties — sort by seedOrder to guarantee deterministic sequentialId assignment
  const now = new Date();
  const sortedParties = [...politicalParties].sort(
    (a, b) => (a.seedOrder ?? 999) - (b.seedOrder ?? 999)
  );
  for (const party of sortedParties) {
    const { seedOrder: _seedOrder, ...partyData } = party;
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
        tier: resolveSeedPartyTier(party, preset),
        createdAt: now,
        updatedAt: now,
      };
      await db.collection<PoliticalParty>("politicalParties").insertOne(doc);
    }
  }
  log(`Seeded ${politicalParties.length} political parties`);

  // State party org
  for (const org of statePartyOrg) {
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id: org._id },
        { $set: { ...org, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
  }
  log(`Seeded ${statePartyOrg.length} state party org entries`);

  // Congressional districts (US House redistricting model). Seeded after states
  // + parties + state-party-org so apportionment (state.houseDistricts) and
  // registration pools are available. Idempotent; cosmetic until the
  // redistrictingEnabled flag is turned on.
  const districtResult = await seedCongressionalDistricts(db, { now, log });
  log(`Seeded ${districtResult.seeded} congressional districts`);

  // State metrics — preset-aware. 2019-era uses the modern dataset; 1991-era
  // uses `stateMetrics1991` (derived via `applyEra1991Adjustments`).
  // `reset: false` here — `runCoreSeed` already dropped `stateMetrics` above
  // in the RESET branch, so `seedRegionMetrics`'s own drop would double up.
  await seedRegionMetrics(db, false, log, preset);

  // Seed year for the projected political legislation catalog below.
  const { resolveWorldSeedYear } = await import("@/lib/era/context");
  const politicalSeedYear = await resolveWorldSeedYear(db, preset);

  // Political metrics v1 is NOT seeded here. It is gated on region existence as
  // well as on the playable/board roster, so running it at this point covers the
  // US alone and `runRegionDerivedStage` then re-seeds the same rows for every
  // country — the reason it was observed running three times per reset. The
  // stage is reached on every path that reaches this one: `seedAllCountryData`
  // calls it explicitly, and the standalone callers get it via
  // `includeRegionDerived`, which defaults true.

  // State baselines — preset-aware. Era adjustments apply the same field-level
  // shifts as the era stateMetrics so freshly-seeded worlds have baselines
  // aligned with the era-floored metrics (no decay pressure on day one).
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
  const { getRegionMetricPresets, applyMetricPresetToBaseline } =
    await import("@/lib/seeds/metricPresets");
  for (const raw of stateBaselines) {
    const adjusted = is1991
      ? applyEra1991BaselineAdjustments(raw)
      : is1953
        ? applyEra1953BaselineAdjustments(raw)
        : is1979
          ? applyEra1979BaselineAdjustments(raw)
          : raw;
    // Align the US decay targets with the authored metric values (both eras).
    const overlay = getRegionMetricPresets("US", String(raw._id), preset);
    const baseline = overlay ? applyMetricPresetToBaseline(adjusted, overlay) : adjusted;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id: baseline._id }, { $set: baseline }, { upsert: true });
  }
  log(`Seeded ${stateBaselines.length} state baselines (preset: ${preset})`);

  // Legislation types (seed + admin-created permanent)
  // First delete any deprecated types that were replaced in the rework
  const DEPRECATED_TYPE_IDS = [
    "immigration", // Split into border_security_enforcement + legal_immigration_visas
    "medicare", // Redundant with federal_healthcare_funding and drug_pricing_medicare
  ];
  const deleteResult = await db
    .collection<LegislationType>("legislationTypes")
    .deleteMany({ _id: { $in: DEPRECATED_TYPE_IDS } });
  if (deleteResult.deletedCount > 0) {
    log(`Deleted ${deleteResult.deletedCount} deprecated legislation types`);
  }

  // Old-seed exclusion sweep (political-legislation spec §6): on the 1953
  // deploy preset the OLD US/UK/RU/DD catalogs stop seeding; the projected
  // new-generation catalogs seed instead (a missing countryScope = legacy US).
  const { getProjectedPoliticalLegislationTypes, isPoliticalLegislationPreset } =
    await import("./seedPoliticalLegislation");
  const politicalLegislation = isPoliticalLegislationPreset(preset);
  const { isOldLegislationTypeExcluded } = await import("@/lib/politicalMetrics/pipelinePreset");
  const baseSeedTypes = politicalLegislation
    ? legislationTypes.filter((lt) => !isOldLegislationTypeExcluded(lt))
    : legislationTypes;
  const allLegislationTypes = [
    ...baseSeedTypes.map((lt) => ({ ...lt, source: "seed" as const })),
    ...(politicalLegislation
      ? getProjectedPoliticalLegislationTypes(politicalSeedYear).map((lt) => ({
          ...lt,
          source: "seed" as const,
        }))
      : []),
    ...adminLegislationTypes.map((lt) => ({
      ...lt,
      source: "admin" as const,
      isPermanent: true,
    })),
  ];
  if (allLegislationTypes.length > 0) {
    await db.collection<LegislationType>("legislationTypes").bulkWrite(
      allLegislationTypes.map((lt) => ({
        updateOne: { filter: { _id: lt._id }, update: { $set: lt }, upsert: true },
      })),
      { ordered: true }
    );
  }
  log(
    `Seeded ${baseSeedTypes.length} seed + ${adminLegislationTypes.length} admin legislation types` +
      (politicalLegislation
        ? ` + ${allLegislationTypes.length - baseSeedTypes.length - adminLegislationTypes.length} projected political laws`
        : "")
  );

  // Budgets — preset-aware. `seedBudgets` filters its FY1991 vs FY2020 config
  // by preset (see `getNationalBudgetSeedConfigsForPreset`). Without this arg
  // a 1991 caller would briefly upsert 2019 US budgets here before
  // `bootstrapGameWorld` re-calls `seedBudgets` with the correct preset
  // (wasted work), and the `/api/seed` external endpoint — which never
  // hits the bootstrap re-call — would always end up 2019-only.
  //
  // Skipped entirely on the orchestrated path, where that re-call makes this a
  // duplicate pass — see `includeBudgets`.
  if (includeBudgets) {
    await seedBudgets(db, reset, log, preset);
  }

  // International organizations: founding members + vacant leadership rows.
  // Pass preset so era-gated membership is correct (e.g. DE not in NATO pre-1955).
  await seedInternationalOrganizations(db, log, preset);

  // Era trade walls (1953 only): the iron curtain as durable embargo lanes,
  // consumed by the trade graph and the partitioned clearing books. No-op on
  // modern presets. Runs after orgs so COMECON/NATO memberships exist first.
  await seedTradeLanes(db, log, preset);

  // Opening alignments between the era's blocs, for the countries this preset
  // contains. Deliberately NOT gated on `intOrgAlignmentEnabled`: this is the
  // one alignment write that runs with the feature off, so enabling the gate on
  // a live world reveals a populated map rather than blank rows. Idempotent —
  // an existing row is never clobbered.
  const alignmentCountries = getPresetById(preset)?.countries ?? COUNTRY_ORDER;
  const alignmentsSeeded = await seedCountryAlignments(db, preset, alignmentCountries);
  log(`Country alignments seeded: ${alignmentsSeeded}`);

  // Default strategic-sector designations per country.
  // Idempotent — upserts on (countryId, sectorType); safe to re-run.
  await seedStrategicSectors(db, log);

  // Region-derived seeders (military, estates, energy, infra, manpower,
  // resource capacity, political metrics) do NOT run here — see
  // `runRegionDerivedStage`. `runSeed` seeds only the US states bundle, so
  // anything that reads `states` for its roster would cover the US and nothing
  // else. Default TRUE keeps the standalone callers (`/api/seed`,
  // `scripts/seed.ts`) behaving as before; `seedAllCountryData` passes FALSE and
  // runs the stage once every country has regions.
  if (includeRegionDerived) {
    await runRegionDerivedStage(db, { preset, log, reset });
  }

  // Indexes
  await db
    .collection("users")
    .createIndex({ email: 1 }, { unique: true })
    .catch(() => {});
  await db
    .collection("users")
    .createIndex({ username: 1 }, { unique: true })
    .catch(() => {});
  // Non-unique: multiple characters per userId are allowed in test mode and for admins.
  // The application enforces limits via activeCharacterCount on the user document.
  await db
    .collection("characters")
    .createIndex({ userId: 1 })
    .catch(() => {});
  await db
    .collection("characters")
    .createIndex({ homeState: 1 })
    .catch(() => {});
  await db
    .collection("states")
    .createIndex({ region: 1 })
    .catch(() => {});
  await db
    .collection("statePartyOrg")
    .createIndex({ stateId: 1 })
    .catch(() => {});
  log("Indexes ensured");

  // Which seed lanes had no bundle for this era and silently took 2019 data.
  // Reported as one list at the end rather than a line beside each call: the
  // useful artifact is the SHAPE of the gap for this preset, which is what
  // decides whether a lane is worth authoring next.
  const fallbacks = getPresetFallbacks();
  if (fallbacks.length > 0) {
    const lanes = [...new Set(fallbacks.map((f) => f.label))].sort();
    log(
      `⚠ ${lanes.length} seed lane(s) had no "${preset}" bundle and used 2019 data: ${lanes.join(", ")}`
    );
  }

  return {
    seeded: true,
    message: `Seeded successfully: ${statesBundle.length} states, ${politicalParties.length} parties, ${statePartyOrg.length} state-party orgs, ${seededDemographicsCount} state demographics, state metrics (${preset}), and budget records.`,
  };
}

/**
 * The seeders that read the `states` collection to decide what to create.
 *
 * They must not run until EVERY country has its regions. `runSeed` seeds only
 * the US states bundle; the other 23 countries arrive later, from
 * `seedAllCountryData`'s per-country packs and the Warsaw-Pact block. Called
 * from inside `runSeed`, four of these therefore produced a US-only world —
 * MEASURED on a fresh 1953 bootstrap with 226 states across 24 countries:
 *
 *     militaryUnits    13 docs /  1 country
 *     energyPlants      7 docs /  1 country
 *     infraProjects     5 docs /  1 country
 *     cabinetEstates   65 docs /  6 countries (partial)
 *
 * The four that were noticed grew catch-up re-runs instead — `runSeed` +
 * `bootstrapGameWorld` + a bloc-specific pass — so `seedStateResourceCapacity`
 * ran three times per bootstrap to reach the coverage one correctly-placed call
 * gives. The four that were NOT noticed grew a `scripts/backfill-*.ts` each.
 * Both are gone now: one call site, after every region exists.
 *
 * ⚠️ Runs AFTER `reconcileStateGdpWithNationalSeeds`. None of these eight reads
 * `state.gdp` (checked), so the barrier is not a correctness requirement for
 * them — but sitting after it means they can never be the reason a future
 * gdp-reading seeder is placed too early.
 */
export async function runRegionDerivedStage(
  db: Db,
  options: { preset: string; log: (msg: string) => void; reset?: boolean }
): Promise<void> {
  const { preset, log, reset = false } = options;

  // Preset-aware for era gating; must follow the states seed.
  await seedStateResourceCapacity(db, reset, log, preset);
  await seedStateSectorSpecializations(db, reset, log);

  // Per-region political board for the playable + board-country set. Gated on
  // that roster rather than on region existence, so this stage must not change
  // its coverage — 188 rows across 18 countries on 1953-default.
  const { resolveWorldSeedYear } = await import("@/lib/era/context");
  const { seedPoliticalMetrics } = await import("./seedPoliticalMetrics");
  await seedPoliticalMetrics(db, false, log, await resolveWorldSeedYear(db, preset), preset);

  // Defense order-of-battle. Era-gated per country via `getBranches`, so a 1953
  // world gives DE nothing (its branches carry establishedYear 1955).
  await seedMilitaryUnits(db, preset);

  // Pin THIS world's upkeep denominators, from the code that just seeded it.
  //
  // Written unconditionally, not only when missing. `gameConfig` is manifest category
  // `reference` so teardown does not sweep it, and a pin left from the previous world
  // would otherwise hold this one to the old world's numbers, which is a worse version
  // of the bug the pin exists to fix. See `seedRosterUpkeepPin.ts`.
  await db
    .collection("gameConfig")
    .updateOne(
      { _id: "default" as unknown as never },
      { $set: { seedRosterUpkeep: captureSeedRosterUpkeepPin(preset) } },
      { upsert: true }
    );
  clearSeedRosterUpkeepPinCache();

  // Replacement-manpower pool at 25% of each nation's ceiling. Population is
  // read from `states`; running earlier silently wrote zeros — which is why the
  // seeder defers a country rather than writing a zero row.
  await seedNationalManpower(db, log);

  // Cabinet estates per in-scope (country, seat). Only six countries have estate
  // seats, and all six already had their foreign-portfolio rows — the gain here
  // is region-sited estates, not new countries.
  await seedCabinetEstates(db);

  // Energy fleet + infrastructure pipeline per owning seat. Both are gated on a
  // per-country position map (six countries each), not on region existence.
  await seedEnergyPlants(db, preset);
  await seedInfraProjects(db, preset);

  // Historical nuclear programmes for the capable powers, era-aware by seed
  // year. Runs once here (the single post-regions stage every seed path
  // reaches). Reset drops the runtime collection first; ordinary re-seeds skip
  // countries whose doc already has adopted nodes, so live progress wins.
  const { resolveWorldSeedYear: resolveNuclearSeedYear } = await import("@/lib/era/context");
  const { seedNuclearPrograms } = await import("./seedNuclearPrograms");
  const nuclearYear = await resolveNuclearSeedYear(db, preset);
  const nuclear = await seedNuclearPrograms(db, { year: nuclearYear });
  log(
    `Seeded nuclear programmes (year ${nuclearYear}): seeded=[${nuclear.seeded.join(", ")}], skipped=[${nuclear.skipped.join(", ")}]`
  );
}
