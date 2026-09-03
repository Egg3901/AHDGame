import type { Db } from "mongodb";
import type { ResetRunRecord } from "@/lib/admin/resetRunRecord";
import { runSeed } from "@/lib/admin/seed";
import { seedCohortVectors } from "@/lib/admin/seed/seedCohortVectors";
import { initializeGameState, ensurePerpetualElections, ensureUKElections } from "@/lib/turnSystem";
import { generateStockExchangeSnapshots } from "@/lib/turn/stockExchangeSnapshot";
import {
  ensureUKRegionalCouncilElections,
  ensureJPElections,
  ensureJPCouncillorElections,
  ensureDEElections,
  ensureBRElections,
  ensureNGElections,
  ensureIEElections,
  ensureIEUachtaranElections,
  ensureIELocalCouncilElections,
  ensureIECathaoirleachElections,
  ensureCNElections,
  ensureCNPeoplesCongressElections,
  ensureCNGovernorElections,
  ensureRUSupremeSovietElections,
  ensureRUNationalitiesElections,
  ensureRURepublicSovietElections,
  ensureRUGovernorElections,
  ensureDDVolkskammerElections,
  ensureDDGovernorElections,
  ensureFRElections,
  ensureFRSenateElections,
  ensureITElections,
  ensureITSenateElections,
  ensureESElections,
  ensureESSenateElections,
  ensureSEElections,
  ensureTRElections,
  ensureTRSenateElections,
  DEFAULT_DURATIONS,
  withElectionGameStateSnapshot,
} from "@/lib/turn/perpetualElections";
import { JP_SANGIIN_SEATS } from "@/lib/constants/states";
import { MS_PER_TURN, getStartingYearForPreset } from "@/lib/constants/turnTime";
import { getCycleAnchors } from "@/lib/elections/cycleAnchorContext";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { getSeatIdFromElection } from "@/lib/seats/seatId";
import type { Election, GameConfig } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import { seedColdWarFoundations } from "@/lib/admin/seed/seedColdWarFoundations";
import { seedHistoricalOfficials, seedFromSeats } from "@/lib/npp/seedHistorical";
import { getPresetSeats } from "@/lib/constants/historicalSeats";
import { initializeOfficials } from "@/lib/admin/bootstrap/initializeOfficials";
import { shouldSeedHistoricalOfficials } from "@/lib/admin/seed/historicalSeedGate";
import {
  seedStatePolicies,
  seedBudgets,
  seedUkBudgets,
  seedSeats,
  seedPartyBudgets,
  seedUnownedSectors,
  seedUnions,
  seedSovereignBondInstruments,
  seedScotus,
  seedIndexes,
  seedCountyMapData,
  seedUKRegions,
  seedUKParties,
  seedUKDemographics,
  seedUKStatePartyOrg,
  seedUKStateMetrics,
  seedUKBaselines,
  removeLegacyUKCeremonialIdentity,
  seedJPRegions,
  seedJPParties,
  seedJPDemographics,
  seedJPStatePartyOrg,
  seedJPStateMetrics,
  seedJPBaselines,
  seedJPGovernmentFormation,
  removeLegacyJPCeremonialIdentity,
  seedJpBudgets,
  seedDERegions,
  seedDEParties,
  seedDEDemographics,
  seedDEStatePartyOrg,
  seedDEStateMetrics,
  seedDEBaselines,
  seedDEGovernmentFormation,
  seedDeBudgets,
  seedBRRegions,
  seedBRParties,
  seedBRDemographics,
  seedBRStatePartyOrg,
  seedBRStateMetrics,
  seedBRBaselines,
  seedBRGovernmentFormation,
  seedBrBudgets,
  seedCNRegions,
  seedCNParties,
  seedCNDemographics,
  seedCNStateMetrics,
  seedCNBaselines,
  seedCNGovernmentFormation,
  seedRUGovernmentFormation,
  seedCnStatePartyOrg,
  seedRuStatePartyOrg,
  seedDdStatePartyOrg,
  seedCnBudgets,
  seedRuBudgets,
  seedFrBudgets,
  seedItBudgets,
  seedEsBudgets,
  seedSeBudgets,
  seedTrBudgets,
  seedGrBudgets,
  seedAtBudgets,
  seedFiBudgets,
  seedDdBudgets,
  seedCNWiki,
  seedNGWiki,
  seedIERegions,
  seedIEParties,
  seedIEDemographics,
  seedIEStatePartyOrg,
  seedIEStateMetrics,
  seedIEBaselines,
  seedIEGovernmentFormation,
  seedIeBudgets,
  seedRURegions,
  seedRUParties,
  seedRUDemographics,
  seedRUStateMetrics,
  seedRUBaselines,
  seedFRRegions,
  seedFRParties,
  seedFRDemographics,
  seedFRStateMetrics,
  seedFRBaselines,
  seedITRegions,
  seedITParties,
  seedITDemographics,
  seedITStateMetrics,
  seedITBaselines,
  seedESRegions,
  seedESParties,
  seedESDemographics,
  seedESStateMetrics,
  seedESBaselines,
  seedSERegions,
  seedSEParties,
  seedSEDemographics,
  seedSEStateMetrics,
  seedSEBaselines,
  seedTRRegions,
  seedTRParties,
  seedTRDemographics,
  seedTRStateMetrics,
  seedTRBaselines,
  seedGRRegions,
  seedGRParties,
  seedGRDemographics,
  seedGRStateMetrics,
  seedGRBaselines,
  seedATRegions,
  seedATParties,
  seedATDemographics,
  seedATStateMetrics,
  seedATBaselines,
  seedFIRegions,
  seedFIParties,
  seedFIDemographics,
  seedFIStateMetrics,
  seedFIBaselines,
  seedDDRegions,
  seedDDParties,
  seedDDDemographics,
  seedDDStateMetrics,
  seedDDBaselines,
  seedDDGovernmentFormation,
  seedNGRegions,
  seedNGParties,
  seedNGDemographics,
  seedNGStatePartyOrg,
  seedNGStateMetrics,
  seedNGBaselines,
  seedNGGovernmentFormation,
  seedNGGovernors,
  seedNgBudgets,
  seedForex,
  seedCommodityPrices,
  seedRegistrationLanes,
} from "@/lib/admin/seed";
import { runMigrations } from "@/lib/migrations/runner";
import { MIGRATIONS } from "@/lib/migrations/registry";
import { saveFiscalYearSnapshot } from "@/lib/budget/fiscalYear";
import type { FederalBudget } from "@/lib/db/types/budget";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { reconcileSignedTariffBills } from "@/lib/tariffs/reconcileTariffs";
import { seedOfficeStates } from "@/lib/governorOffice/seedOfficeStates";
import { seedEasternBlocCountry, seedEasternBlocBudget } from "@/lib/admin/seed/seedEasternBloc";
import { seedEasternBlocStatePartyOrg } from "@/lib/admin/seed/seedEasternBlocStatePartyOrg";
import { seedCountryGameStates } from "@/lib/admin/seed/seedCountryGameStates";
import { seedMacroCountries } from "@/lib/world/macro";
import { getHuSeedConfig } from "@/lib/seeds/hu/huSeed";
import { getPlSeedConfig } from "@/lib/seeds/pl/plSeed";
import { getRoSeedConfig } from "@/lib/seeds/ro/roSeed";
import { getYuSeedConfig } from "@/lib/seeds/yu/yuSeed";
import { getBgSeedConfig } from "@/lib/seeds/bg/bgSeed";
import { getCsSeedConfig } from "@/lib/seeds/cs/csSeed";
// Union republics promoted to their own playable countries: they share the
// satellites' one-party seeding shape even though their constitutional status
// inside the USSR differed.
import { getUaSeedConfig } from "@/lib/seeds/ua/uaSeed";
import { getBlrSeedConfig } from "@/lib/seeds/blr/blrSeed";
import { getBalSeedConfig } from "@/lib/seeds/bal/balSeed";
import { isEasternBlocEra } from "@/lib/seeds/presetSelector";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

async function seedInitialBudgetSnapshots(db: Db, log: (msg: string) => void): Promise<void> {
  const budgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
  // The budget docs are already in hand and the turn is one shared singleton,
  // so both are handed down rather than re-read once per country.
  const gameState = await db
    .collection("gameState")
    .findOne({ _id: "current" } as Record<string, unknown>, { projection: { currentTurn: 1 } });
  const currentTurn = (gameState as { currentTurn?: number } | null)?.currentTurn ?? 0;
  for (const budget of budgets) {
    const countryId = budget.countryId ?? COUNTRY_CONFIGS.US.id;
    const budgetDocId = String(budget._id);
    const fiscalYear = budget.fiscalYear ?? 2020;
    await saveFiscalYearSnapshot(db, countryId, budgetDocId, fiscalYear, { budget, currentTurn });
  }
  log(`Captured ${budgets.length} initial FY budget snapshot(s)`);
}

export type BootstrapMode = "historical" | "vacant";

export interface BootstrapOptions {
  db: Db;
  /**
   * The reset run's failure record. When present, the RECOVERABLE blocks below
   * are contained: a throw is recorded and the run continues, degrading its
   * outcome to `partial` rather than discarding a build that otherwise worked.
   *
   * Absent for direct callers (`scripts/bootstrap-full.ts`, tests), which keep
   * today's abort-on-anything behaviour.
   */
  run?: ResetRunRecord;
  mode?: BootstrapMode;
  preset?: string;
  skipRegionalCouncil?: boolean;
  resetReference?: boolean;
  /** If true, only run seeders — skip election spawning, official seeding, and game state init */
  seedOnly?: boolean;
  /**
   * Pre-iteration founding phase: seed officials in "priors" mode (chambers
   * vacant) and SKIP the JP Sangiin inline bootstrap so the founding-aware
   * ensure* battery seats both Sangiin classes together (cycle 0) instead.
   */
  preIteration?: boolean;
  log?: (msg: string) => void;
}

/**
 * Seeds every country's era-correct geographic + demographic data (regions,
 * parties, demographics, metrics, baselines, government formations) plus the
 * cohort vectors and per-state resource/sector data. Shared by bootstrap and the
 * in-world reset so an era switch re-seeds regions identically. Idempotent under
 * reset=true (each seeder wipes its country first).
 */
export async function seedAllCountryData(
  db: Db,
  resetReference: boolean,
  log: (msg: string) => void,
  preset: string,
  /** See `BootstrapOptions.run`. Absent => today's abort-on-anything behaviour. */
  run?: ResetRunRecord
) {
  // `includeRegionDerived: false` — the region-derived seeders run once from
  // `runRegionDerivedStage` below, after every country has its regions. Running
  // them from inside `runSeed` covers the US and nothing else (only the US
  // states bundle exists at this point), so the later stage re-did all of it.
  // `runRegionDerivedStage`'s own docstring already described this as the
  // intended shape; the flag it added for the purpose was simply never passed.
  //
  // `includeBudgets: false` — `bootstrapGameWorld` calls `seedBudgets` itself as
  // the US member of its per-country budget block, after the
  // `commandEconomyEnabled` write those seeders read. That call is the last word
  // on every collection seedBudgets touches, and nothing in between reads US
  // budget data, so doing it here as well was a duplicate ~170-round-trip pass.
  await runSeed({
    db,
    reset: resetReference,
    preset,
    log,
    includeRegionDerived: false,
    includeBudgets: false,
  });

  // ─── Country packs ─────────────────────────────────────────────────────────
  // Packs run CONCURRENTLY; the seeders WITHIN a pack stay sequential.
  //
  // Every pack is scoped to its own countryId, and the counters they allocate
  // from are per-country (`party`/`coalition` are keyed `<type>_<countryId>`,
  // see sequentialId.ts). The one GLOBAL counter reachable from here is `npp`,
  // and only the UK pack touches it, so nothing contends for it. The steps that
  // genuinely need every country — cohort vectors, the GDP reconcile, the
  // region-derived stage — are the barriers below and stay sequential.
  //
  // ⚠️ Pack logs are BUFFERED and flushed in declaration order, so the emitted
  // log does not depend on which country finishes first. The seed op-profiler
  // parses that log for phase gaps and repeated passes; interleaved output would
  // corrupt the reading. Same reason seedIndexes buffers per module (D1) and the
  // founding sweep buffers per country (D6).
  const packBuffers: string[][] = [];
  const pack = (body: (log: (msg: string) => void) => Promise<void>) => {
    const buffer: string[] = [];
    packBuffers.push(buffer);
    return () => body((msg) => buffer.push(msg));
  };

  await Promise.all([
    pack(async (log) => {
      await seedUKRegions(db, resetReference, log, preset);
      await seedUKParties(db, log, preset);
      await seedUKDemographics(db, resetReference, log, preset);
      await seedUKStatePartyOrg(db, resetReference, log, preset);
      await seedUKStateMetrics(db, resetReference, log, preset);
      await seedUKBaselines(db, resetReference, log, preset);
      await removeLegacyUKCeremonialIdentity(db, log);
    })(),

    pack(async (log) => {
      await seedJPRegions(db, resetReference, log, preset);
      await seedJPParties(db, log, preset);
      await seedJPDemographics(db, resetReference, log, preset);
      await seedJPStatePartyOrg(db, resetReference, log, preset);
      await seedJPStateMetrics(db, resetReference, log, preset);
      await seedJPBaselines(db, resetReference, log, preset);
      await seedJPGovernmentFormation(db, log);
      await removeLegacyJPCeremonialIdentity(db, log);
    })(),

    pack(async (log) => {
      await seedDERegions(db, resetReference, log, preset);
      await seedDEParties(db, log, preset);
      await seedDEDemographics(db, resetReference, log, preset);
      await seedDEStatePartyOrg(db, resetReference, log, preset);
      await seedDEStateMetrics(db, resetReference, log, preset);
      await seedDEBaselines(db, resetReference, log, preset);
      await seedDEGovernmentFormation(db, log, preset);
    })(),

    pack(async (log) => {
      await seedBRRegions(db, resetReference, log, preset);
      await seedBRParties(db, log, preset);
      await seedBRDemographics(db, resetReference, log, preset);
      await seedBRStatePartyOrg(db, resetReference, log, preset);
      await seedBRStateMetrics(db, resetReference, log, preset);
      await seedBRBaselines(db, resetReference, log, preset);
      await seedBRGovernmentFormation(db, log);
    })(),

    // CN and RU share one chain on purpose. `seedRuStatePartyOrg` sits between
    // them today — after the CN pack, BEFORE `seedRURegions` — and keeping that
    // relative order is the conservative choice: splitting them into separate
    // concurrent chains would race the CPSU regional org against RU’s own region
    // seeder, which is a behaviour change this refactor has no business making.
    pack(async (log) => {
      await seedCNRegions(db, resetReference, log, preset);
      await seedCNParties(db, log);
      await seedCNDemographics(db, resetReference, log, preset);
      await seedCNStateMetrics(db, resetReference, log, preset);
      await seedCNBaselines(db, resetReference, log, preset);
      await seedCNGovernmentFormation(db, log);
      await seedCnStatePartyOrg(db, resetReference, log, preset);
      // CPSU regional org only in Cold-War eras — mirrors the RU-regions gate
      // below (the seeder also self-guards on preset). (refs #3269)
      if (isEasternBlocEra(preset)) {
        await seedRuStatePartyOrg(db, resetReference, log, preset);
      }

      // The USSR exists in the 1953 and 1979 eras — other eras use the modern
      // Russian Federation (RU), which owns the Russian landmass. Without this
      // gate, seedRU would fall back to the 2019 bundle and seed the USSR
      // everywhere.
      if (isEasternBlocEra(preset)) {
        await seedRURegions(db, resetReference, log, preset);
        await seedRUParties(db, log, preset);
        await seedRUDemographics(db, resetReference, log, preset);
        await seedRUStateMetrics(db, resetReference, log, preset);
        await seedRUBaselines(db, resetReference, log, preset);
      }
    })(),

    pack(async (log) => {
      await seedIERegions(db, resetReference, log, preset);
      await seedIEParties(db, log, preset);
      await seedIEDemographics(db, resetReference, log, preset);
      await seedIEStatePartyOrg(db, resetReference, log, preset);
      await seedIEStateMetrics(db, resetReference, log, preset);
      await seedIEBaselines(db, resetReference, log, preset);
      await seedIEGovernmentFormation(db, log, preset);
    })(),

    pack(async (log) => {
      await seedFRRegions(db, resetReference, log, preset);
      await seedFRParties(db, log, preset);
      await seedFRDemographics(db, resetReference, log, preset);
      await seedFRStateMetrics(db, resetReference, log, preset);
      await seedFRBaselines(db, resetReference, log, preset);
    })(),

    pack(async (log) => {
      await seedITRegions(db, resetReference, log, preset);
      await seedITParties(db, log, preset);
      await seedITDemographics(db, resetReference, log, preset);
      await seedITStateMetrics(db, resetReference, log, preset);
      await seedITBaselines(db, resetReference, log, preset);
    })(),

    pack(async (log) => {
      await seedESRegions(db, resetReference, log, preset);
      await seedESParties(db, log, preset);
      await seedESDemographics(db, resetReference, log, preset);
      await seedESStateMetrics(db, resetReference, log, preset);
      await seedESBaselines(db, resetReference, log, preset);
    })(),

    pack(async (log) => {
      await seedSERegions(db, resetReference, log, preset);
      await seedSEParties(db, log, preset);
      await seedSEDemographics(db, resetReference, log, preset);
      await seedSEStateMetrics(db, resetReference, log, preset);
      await seedSEBaselines(db, resetReference, log, preset);
    })(),

    pack(async (log) => {
      await seedTRRegions(db, resetReference, log, preset);
      await seedTRParties(db, log, preset);
      await seedTRDemographics(db, resetReference, log, preset);
      await seedTRStateMetrics(db, resetReference, log, preset);
      await seedTRBaselines(db, resetReference, log, preset);
    })(),

    pack(async (log) => {
      await seedGRRegions(db, resetReference, log, preset);
      await seedGRParties(db, log, preset);
      await seedGRDemographics(db, resetReference, log, preset);
      await seedGRStateMetrics(db, resetReference, log, preset);
      await seedGRBaselines(db, resetReference, log, preset);
    })(),

    pack(async (log) => {
      await seedATRegions(db, resetReference, log, preset);
      await seedATParties(db, log, preset);
      await seedATDemographics(db, resetReference, log, preset);
      await seedATStateMetrics(db, resetReference, log, preset);
      await seedATBaselines(db, resetReference, log, preset);
    })(),

    pack(async (log) => {
      await seedFIRegions(db, resetReference, log, preset);
      await seedFIParties(db, log, preset);
      await seedFIDemographics(db, resetReference, log, preset);
      await seedFIStateMetrics(db, resetReference, log, preset);
      await seedFIBaselines(db, resetReference, log, preset);
    })(),

    pack(async (log) => {
      await seedDDRegions(db, resetReference, log, preset);
      await seedDDParties(db, log, preset);
      await seedDDDemographics(db, resetReference, log, preset);
      await seedDDStateMetrics(db, resetReference, log, preset);
      await seedDDBaselines(db, resetReference, log, preset);
      await seedDDGovernmentFormation(db, log, preset);
      // National Front regional org/registration only in divided eras — mirrors
      // the RU-regions gate (the seeder also self-guards on preset). (refs #3269)
      if (isEasternBlocEra(preset)) {
        await seedDdStatePartyOrg(db, resetReference, log, preset);
      }
    })(),

    pack(async (log) => {
      await seedNGRegions(db, resetReference, log, preset);
      await seedNGParties(db, log, preset);
      await seedNGDemographics(db, resetReference, log, preset);
      await seedNGStatePartyOrg(db, resetReference, log, preset);
      await seedNGStateMetrics(db, resetReference, log, preset);
      await seedNGBaselines(db, resetReference, log, preset);
      await seedNGGovernmentFormation(db, log);
    })(),

    // Warsaw-Pact one-party states. Seeded HERE, alongside the other country
    // packs, rather than after `seedAllCountryData` returns — they are countries
    // like any other, and the region-derived stage below has to see their states.
    // Their BUDGETS stay in bootstrapGameWorld: budgets are region-CONSUMING and
    // must follow the reconcile barrier.
    //
    // Only existed in the Cold-War (1953/1979) eras; in 1991/2019 the successor
    // democracies own this landmass, so gate the whole block rather than seeding
    // Soviet-era structures into a post-Soviet world (refs #3269). The seeders
    // also self-guard on preset.
    pack(async (log) => {
      if (!isEasternBlocEra(preset)) return;
      // The nine one-party states are independent of one another; the shared
      // statePartyOrg seeder below must follow all of them.
      //
      // Ukraine, Byelorussia and the Baltic republics ARE seeded here. They were
      // constituent union republics rather than satellites, but each ran its own
      // republican party apparatus, its own Supreme Soviet and its own council of
      // ministers, so they model cleanly as separate one-party countries with the
      // USSR as sponsor. They are no longer folded into RU as regions.
      await Promise.all(
        [
          getHuSeedConfig(preset),
          getPlSeedConfig(preset),
          getRoSeedConfig(preset),
          getYuSeedConfig(preset),
          getBgSeedConfig(preset),
          getCsSeedConfig(preset),
          getUaSeedConfig(preset),
          getBlrSeedConfig(preset),
          getBalSeedConfig(preset),
        ].map((cfg) => seedEasternBlocCountry(db, resetReference, log, preset, cfg))
      );
      // One-party ruling-party regional org/registration
      // (PL/HU/RO/BG/CS/YU + UKR/BLR/BAL).
      // The USSR and the GDR run their own bespoke seeders; the satellites are
      // one-party each and share this one.
      await seedEasternBlocStatePartyOrg(db, resetReference, log, preset);
    })(),
  ]);

  for (const buffer of packBuffers) for (const line of buffer) log(line);

  // Stand up the per-region age/sex cohort vectors (the demographic SSOT the turn
  // engine evolves) and stamp turn-0 derived population metrics (sexRatio /
  // dependencyRatio / realizedMigrationRate), now that every country's states and
  // stateMetrics (with era-correct medianAge/birthRate) exist. Era-aware via preset.
  await seedCohortVectors(db, preset, log);

  // Normalize regional gdp so Σ state.gdp matches each country's authored
  // national GDP (pre-1999 eras only + tolerance-guarded; see
  // reconcileStateGdp.ts, refs #3247). Must run after every region seeder above
  // and BEFORE the state-budget seeders / seedUnownedSectors, which derive
  // absolute values from state.gdp.
  const { reconcileStateGdpWithNationalSeeds } = await import("./seed/reconcileStateGdp");
  await reconcileStateGdpWithNationalSeeds(db, log, preset);

  // Everything that reads `states` for its roster, in ONE place, now that every
  // country — including the Warsaw Pact — has regions. This replaces four
  // catch-up re-runs that existed because `runSeed` called these while only the
  // US existed; the four seeders nobody added a catch-up for were simply
  // producing a US-only world (militaryUnits 13 docs across 1 country).
  const { runRegionDerivedStage } = await import("./seed/runCoreSeed");
  // Contained: a failure here leaves the region-derived collections short,
  // which the diagnostic's coverage checks now report rather than hide.
  const stage = () => runRegionDerivedStage(db, { preset, log, reset: resetReference });
  await (run ? run.step("build", "runRegionDerivedStage", stage) : stage());
}

export async function bootstrapGameWorld(options: BootstrapOptions) {
  const mode = options.mode ?? "historical";
  const preset = options.preset ?? DEFAULT_SEED_PRESET;
  const skipRegionalCouncil = options.skipRegionalCouncil ?? false;
  const resetReference = options.resetReference ?? false;
  const seedOnly = options.seedOnly ?? false;
  const preIteration = options.preIteration ?? false;
  const log = options.log ?? (() => {});
  const { db } = options;

  // Contain a RECOVERABLE block. Without a run record this is a bare call, so
  // direct callers are unaffected.
  //
  // ⚠️ Structural work is deliberately NOT routed through this — `runSeed`'s
  // core (seedAllCountryData), `initializeGameState`, the clock stamp and the
  // commandEconomy gate write must still abort, because a world missing them is
  // not a world and everything after would seed on top of the damage.
  const guarded = <T>(name: string, fn: () => Promise<T>): Promise<T | null> =>
    options.run ? options.run.step("build", name, fn) : fn().then((v) => v as T | null);

  log(seedOnly ? "Re-seeding reference data" : `Bootstrapping clean world (${mode})`);

  // "Is this world empty?" MUST be measured before any seeder in this run
  // writes. Several country seeders below (notably `seedNGGovernors`) always
  // insert officials + NPPs, so a count taken later reports a non-empty world
  // on a genuinely fresh bootstrap — which is exactly how the authored
  // historical rosters (US 83rd Congress under 1953-default, every other
  // preset's chambers) stopped being seeded. See historicalSeedGate.ts.
  const [preExistingOfficialsCount, preExistingNppsCount] = await Promise.all([
    db.collection("electedOfficials").countDocuments(),
    db.collection("npps").countDocuments({ retiredAt: null }),
  ]);

  await seedAllCountryData(db, resetReference, log, preset, options.run);

  // Command Economy v2 gates RU/CN's multi-SOE seed (seedRuBudgets/seedCnBudgets,
  // below) behind `gameConfig.commandEconomyEnabled`. Tie it to era on every
  // bootstrap — see resetGameWorld.ts for the matching in-world-reset path and
  // the full rationale, including why this MUST follow seedAllCountryData rather
  // than precede it (`runSeed` re-seeds gameConfig from a static object that
  // hardcodes the flag to true, so an earlier write is silently overwritten).
  // It still lands before the budget seeders below, which are what read it.
  const commandEconomyEnabled = isEasternBlocEra(preset);
  await db.collection<GameConfig>("gameConfig").updateOne(
    { _id: "default" },
    {
      $set: {
        commandEconomyEnabled,
        commandEconomyEnabledBy: "system:bootstrap",
        commandEconomyEnabledAt: new Date().toISOString(),
      },
    },
    { upsert: true }
  );

  await seedStatePolicies(db, resetReference, log, preset);
  await guarded("seedBudgets", () => seedBudgets(db, resetReference, log, preset));
  await seedUkBudgets(db, resetReference, log, preset);
  await seedJpBudgets(db, resetReference, log, preset);
  await seedDeBudgets(db, resetReference, log, preset);
  await seedBrBudgets(db, resetReference, log, preset);
  await seedCnBudgets(db, resetReference, log, preset);
  await seedRuBudgets(db, resetReference, log, preset);
  await seedFrBudgets(db, resetReference, log, preset);
  await seedItBudgets(db, resetReference, log, preset);
  await seedEsBudgets(db, resetReference, log, preset);
  await seedSeBudgets(db, resetReference, log, preset);
  await seedTrBudgets(db, resetReference, log, preset);
  await seedGrBudgets(db, resetReference, log, preset);
  await seedAtBudgets(db, resetReference, log, preset);
  await seedFiBudgets(db, resetReference, log, preset);
  await seedDdBudgets(db, resetReference, log, preset);

  // Warsaw-Pact BUDGETS. The countries themselves are seeded in
  // `seedAllCountryData` with every other country pack; only their budgets live
  // here, because budgets are region-CONSUMING and must follow the reconcile
  // barrier that closes that function.
  //
  // Ukraine, Byelorussia and the Baltics are included: they are now full
  // countries with their own `states` rows, republican budgets and republican
  // legislatures, so they need the same federalBudget + enactedLaws treatment as
  // the satellites. (The historical hazard this comment used to warn about was
  // budget rows for country ids with zero regions; that no longer applies.)
  if (isEasternBlocEra(preset)) {
    for (const cid of ["HU", "PL", "RO", "YU", "BG", "CS", "UKR", "BLR", "BAL"] as const) {
      await guarded(`seedEasternBlocBudget:${cid}`, () =>
        seedEasternBlocBudget(db, resetReference, log, preset, cid)
      );
    }
  }

  // Every command-economy seeder above reads `commandEconomyEnabled` itself and
  // falls back to the legacy single-corp shape via a silent `return` or an empty
  // filter. Read back what they actually produced. A command country that came
  // up with no enterprises or no producing sectors is an unplayable economy, and
  // it must stop the bootstrap here rather than ship and be found by players 73
  // turns later. See verifyCommandEconomySeed for the incident this encodes.
  {
    const { verifyCommandEconomySeed } = await import("@/lib/admin/seed/verifyCommandEconomySeed");
    const report = await verifyCommandEconomySeed(db, preset);
    for (const issue of report.issues) log(`[command-economy] ${issue}`);
    if (report.fatal.length > 0) {
      throw new Error(
        `Command-economy seed failed for ${report.fatal.join(", ")}: ${report.issues.join(" | ")}`
      );
    }
    if (report.checked && report.issues.length === 0) {
      log(`[command-economy] ${report.countries.length} command country(s) verified`);
    }
  }

  // Political-legislation v2 (spec §7): the authored 1953 enacted baseline +
  // one budget sync. Runs after states AND budgets exist (it prices baseline
  // laws on the regional-rollup fiscal base). No-op on other presets.
  {
    const { isPoliticalLegislationPreset, seedPoliticalLegislationBaseline } =
      await import("@/lib/admin/seed/seedPoliticalLegislation");
    if (isPoliticalLegislationPreset(preset)) {
      const { resolveWorldSeedYear } = await import("@/lib/era/context");
      await seedPoliticalLegislationBaseline(db, log, await resolveWorldSeedYear(db, preset));
    }
  }
  await seedCNWiki(db);
  await seedNGWiki(db);
  await seedIeBudgets(db, resetReference, log, preset);
  await seedNgBudgets(db, resetReference, log, preset);
  // Materialize scalar debt.principal into tradeable sovereign bond series.
  // Must run after every national-budget + NatCorp seeder so US/UK (and any
  // other surplus country) open with a bond float matching WWII/postwar debt
  // rather than an orphaned principal with zero instruments (#3370 P3).
  await guarded("seedSovereignBondInstruments", () => seedSovereignBondInstruments(db, log, 0));
  await seedCountryGameStates(db, preset, getStartingYearForPreset(preset), log);
  await seedMacroCountries(db, preset, log);
  await reconcileSignedTariffBills(db);

  // Capture FY2020 baseline snapshot so the budget history dropdown has an initial entry
  await guarded("seedInitialBudgetSnapshots", () => seedInitialBudgetSnapshots(db, log));
  await seedSeats(db, resetReference, log, preset);
  // SCOTUS (#3598): US-only, preset-gated (mirrors seedPoliticalLegislationBaseline's
  // placement above). No-ops until the per-preset roster/docket content tickets
  // (#3599-#3602) land — see src/lib/scotus/presetData/index.ts.
  await seedScotus(db, log, preset, resetReference);
  await seedNGGovernors(db, resetReference, log, preset);
  await seedPartyBudgets(db, resetReference, log);
  // Reg/Org bootstrap: every per-(state, party) `statePartyOrg` row exists
  // by this point. Seed registration shares + non-party pool from the
  // curated lane templates for the active preset. Unknown presets skip.
  await seedRegistrationLanes(db, preset, log);
  // Refresh markets on a hard reference reset so they track the GDP the region
  // seeders just $set above. Without this, a preset/GDP switch on an existing
  // world leaves the $setOnInsert market docs frozen at the old scale (the
  // 2026-05 1991-reset bug). A soft idempotent fill (resetReference=false)
  // stays insert-only so any captured pools on a live world are preserved.
  await guarded("seedUnownedSectors", () => seedUnownedSectors(db, log, 1, preset, resetReference));
  await guarded("seedUnions", () => seedUnions(db, log, preset, resetReference));
  await seedIndexes(db, log);
  await seedCountyMapData(log);
  // Baseline commodity prices: one row per CommodityType at base price. Runs
  // before seedOnly returns because these are reference rows, not gameplay
  // state. The runtime turn processor takes over price movement from here.
  // The `preset` arg is development's — commodity baselines are era-authored.
  await guarded("seedCommodityPrices", () => seedCommodityPrices(db, resetReference, log, preset));

  // Forex layer: exchange rates + central banks + money-supply baselines +
  // indexes + the gameState flag.
  //
  // ⚠️ MUST stay ABOVE the seedOnly return. `resetGameWorld` deletes
  // `exchangeRates` and `centralBanks`, and this is their only re-seeder — so
  // with it below the return, the admin "Reset Only" AND "Delete All Data"
  // buttons (both post without `bootstrap: true`) left a world with no exchange
  // rates and no central banks, recoverable only by pressing a different button.
  // `tradeHistory`/`currencyOrders` lost their indexes there too, since
  // `createForexIndexes` is called from here.
  //
  // ⚠️ `development` still calls this BELOW the return; moving it is this
  // branch's fix. Keep the position on any future merge — reverting it
  // reinstates that bug.
  //
  // Its old comment claimed it had to follow `initializeGameState` because it
  // flips `gameState.forexEnabled`. Only the closing flag write touches
  // gameState, and every path into `bootstrapGameWorld` already has the doc:
  // the admin/CLI path because `resetGameWorld` upserts it, and the two direct
  // callers (`scripts/bootstrap-full.ts`, `scripts/sim/runWorld.ts`) because
  // both call `initializeGameState()` themselves first, as this file's own
  // `stampInitialGameClock` docstring instructs.
  await guarded("seedForex", () => seedForex(db, log, preset));

  // Seed NPP-run market corporations now that the unowned-sector pool, commodity
  // prices, and forex all exist. Player-enabled countries get 1 corp/sector,
  // econ-preview market democracies get 2/sector; planned economies are excluded
  // (their SOEs come from the budget seeders). MUST stay below seedUnownedSectors
  // + seedForex (each corp captures from the unowned pool and converts through
  // getCorpFxRate) and above generateStockExchangeSnapshots so the corps appear
  // in the initial exchange snapshot. Runs before the seedOnly gate so seed-only
  // worlds are populated too — corps are economic, not political.
  await guarded("seedNppCorporations", async () => {
    const { seedNppCorporations } = await import("@/lib/admin/seed/seedNppCorporations");
    const r = await seedNppCorporations(db, preset, getStartingYearForPreset(preset), log);
    log(`NPP corporations seeded: ${r.totalSpawned} corps`);
  });

  // NPC retail banks: NPP financial corps + real issueCharter path. After
  // seedNppCorporations / seedForex so HQ states, FX, and capital maths work.
  // Idempotent; not gated on privateBankingEnabled (runtime flag gates policy).
  await guarded("seedNpcBanks", async () => {
    const { seedNpcBanks } = await import("@/lib/admin/seed/seedNpcBanks");
    const r = await seedNpcBanks(db, log);
    log(`NPC banks seeded: created=${r.created} existing=${r.skippedExisting}`);
  });

  if (seedOnly) {
    log("Seed-only complete — skipped elections, officials, and game state init");
    return;
  }

  const gameState = await initializeGameState();
  log(`Game state ready at turn ${gameState.currentTurn}`);
  const coldWarFoundation = await seedColdWarFoundations(
    db,
    gameState.currentYear ?? getStartingYearForPreset(preset),
    gameState.currentTurn
  );
  log(
    `Cold War foundation: ${coldWarFoundation.programsInserted} programmes, ${coldWarFoundation.conflictsInserted} campaigns`
  );

  // Build the initial stock-exchange snapshot so the market page is populated
  // immediately after a reset, even while the game is paused / in maintenance.
  // Normally the snapshot is (re)built each turn and by the 15-minute refresh
  // cron, but both skip while paused — so a freshly-reset world would otherwise
  // show an empty exchange (no corps, including the country National
  // Corporations) until the first turn runs. All corporations are seeded above
  // (the budget seeders), so this captures them. Idempotent — safe to re-run.
  //
  // ⚠️ MUST stay BELOW `seedForex`. This converts each corp through
  // `getCorpFxRate`, which returns 1.0 when no rate document exists. Built
  // first, the snapshot was internally inconsistent in units — NG converted
  // (its rate is written early by `seedNgBudgets`), every other country not.
  // And it does not self-heal on any useful timescale: `/api/stock-exchange`
  // serves this document directly, both rebuild paths skip while paused, and a
  // freshly reset world is sealed in maintenance mode — which is exactly when
  // an admin is inspecting the new world and the market page is what they check.
  await guarded("generateStockExchangeSnapshots", () =>
    generateStockExchangeSnapshots(gameState.currentTurn, db)
  );
  log("Built initial stock-exchange snapshot");

  // Index funds ship on by default (gameConfig.indexFundsMode = "full"); run the
  // idempotent fund-definition bootstrap migrations so the fund docs exist to
  // back that flag on a fresh world. Mirrors the on-demand run in the admin
  // index-funds enable route.
  const forceIndexFundBootstrap =
    (await db.collection("indexFunds").countDocuments({}, { limit: 1 })) === 0;
  const indexFundBootstrap = await runMigrations(db, {
    migrations: MIGRATIONS,
    dryRun: false,
    // resetGameWorld drops indexFunds and indexFundPositions together. Their
    // historical migration markers deliberately survive, so force these
    // idempotent bootstraps to recreate a clean definition + reserve ledger.
    force: forceIndexFundBootstrap,
    only: [
      "2026-06-01-index-fund-foundation",
      "2026-06-01-index-fund-seed",
      "2026-06-02-index-fund-real-bonds",
      // Derived headroomUnits on every unowned pool. seedUnownedSectors (above)
      // now writes the field inline, so on a clean bootstrap this is a no-op;
      // it stays here to cover pools created by paths that do not go through
      // that seeder (nationalization redirects, restores) and to keep a fresh
      // world byte-identical to a backfilled one. Idempotent + derived-only.
      "2026-08-01-backfill-unowned-headroom-units",
    ],
  });
  log(`Bootstrap migrations: ran ${indexFundBootstrap.ranIds.length}`);

  const [officialsCount, nppsCount] = await Promise.all([
    db.collection("electedOfficials").countDocuments(),
    db.collection("npps").countDocuments({ retiredAt: null }),
  ]);

  if (mode === "vacant") {
    if (officialsCount === 0) {
      const result = await initializeOfficials(db);
      log(result.message);
    } else {
      log(`Skipped vacant-world official bootstrap (${officialsCount} officials already exist)`);
    }
    // In a pre-iteration founding reset, ALWAYS seed the priors candidate pool
    // even if a country seeder (e.g. seedNGGovernors) already created a handful
    // of officials/NPPs during seedAllCountryData — otherwise this gate skips the
    // whole historical seed and the founding elections start with almost no
    // candidate field. Priors mode only creates unseated NPPs (no electedOfficials),
    // so there is no double-seat risk from running it here.
  } else if (
    shouldSeedHistoricalOfficials({
      mode,
      preIteration,
      preExistingOfficials: preExistingOfficialsCount,
      preExistingNpps: preExistingNppsCount,
    })
  ) {
    const result = await seedHistoricalOfficials(db, preset, preIteration ? "priors" : "winners");
    log(
      `Seeded ${preIteration ? "priors (candidate pool, vacant chambers) for" : "historical world:"} ${
        result.officialsCreated
      } officials, ${result.nppsCreated} NPPs`
    );
  } else {
    log(
      `Skipped historical officeholder bootstrap (${preExistingOfficialsCount} officials, ` +
        `${preExistingNppsCount} NPPs already existed before this run; ` +
        `${officialsCount} officials / ${nppsCount} NPPs now)`
    );
  }

  // Backfill preset national executives independently of the gate above.
  // Historically this was load-bearing rather than a safety net: the gate used
  // to re-count officials mid-run, `seedNGGovernors` (a few steps earlier)
  // always seeds NG-governor NPPs, so the skip branch was ALWAYS taken and
  // `getPresetSeats` never ran — the executives seeded here were the only part
  // of the preset roster that reached a fresh world. That is fixed (the gate
  // now reads the pre-run snapshot, see historicalSeedGate.ts); this block
  // stays as an idempotent net for seed-only / partially-populated worlds where
  // the gate legitimately skips. Legislatures and most executives refill through election
  // resolution, but a preset-defined executive with no near-term race sits
  // vacant: the 1953 US President + VP (1952 Republican landslide) and BR
  // President (PTB ticket from the 1950 election) never seat because the US
  // cycle anchors to 1956 and BR perpetual elections only spawn chamber races.
  // Seed missing president/VP rows per country from the preset roster.
  // Idempotent (per-country existence check) and scoped to president/VP so
  // legislatures can't double-seat against election-seated deputies.
  // In a pre-iteration founding reset the executive is elected by the founding
  // election (a president cycle-0 race), so do NOT pre-seat it here.
  if (mode !== "vacant" && !preIteration) {
    const executiveSeats = getPresetSeats(preset).filter(
      (s) => s.officeType === "president" || s.officeType === "vicePresident"
    );
    if (executiveSeats.length > 0) {
      // Group by country code carried in `state` for national offices.
      const byCountry = new Map<string, typeof executiveSeats>();
      for (const seat of executiveSeats) {
        const list = byCountry.get(seat.state) ?? [];
        list.push(seat);
        byCountry.set(seat.state, list);
      }
      for (const [countryId, seats] of byCountry) {
        const existingExecutive = await db.collection("electedOfficials").countDocuments({
          officeType: { $in: ["president", "vicePresident"] },
          countryId,
        });
        if (existingExecutive === 0) {
          const execResult = await seedFromSeats(db, seats);
          log(
            `Seeded ${countryId} national executive: ${execResult.officialsCreated} officials, ${execResult.nppsCreated} NPPs`
          );
        }
      }
    }

    // Same backfill for the RU executive pair (Premier + Chairman of the
    // Presidium): the Cold-War presets define them in the SU seat arrays, but
    // the historical gate above may have been taken. Idempotent + RU-scoped.
    const ruExecutiveSeats = getPresetSeats(preset).filter(
      (s) => s.officeType === "premier" || s.officeType === "chairmanOfPresidium"
    );
    if (ruExecutiveSeats.length > 0) {
      const existingRuExecutive = await db.collection("electedOfficials").countDocuments({
        officeType: { $in: ["premier", "chairmanOfPresidium"] },
        countryId: "RU",
      });
      if (existingRuExecutive === 0) {
        const execResult = await seedFromSeats(db, ruExecutiveSeats);
        log(
          `Seeded RU executive: ${execResult.officialsCreated} officials, ${execResult.nppsCreated} NPPs`
        );
      }
    }

    // Formation docs must follow the executive seed so the Premier / President
    // NPP exists to link (RU starts FORMED; BR links the seeded PTB president).
    await seedRUGovernmentFormation(db, log);
    await seedBRGovernmentFormation(db, log);
  }

  // Econ-tier democracies (FR/IT/ES/SE/TR) run election cycles but have no
  // authored chambers in historicalSeats.ts, so cycles resolve empty without
  // candidate supply (#3253). Seed statePartyOrg presence + a minimal
  // major-party incumbent roster. Skipped for the deliberately-empty "vacant"
  // world; priors (founding) mode seeds presence only and leaves chambers
  // vacant for the founding elections.
  if (mode !== "vacant") {
    const { seedEconTierRosters, seedEconTierRostersForCountry } =
      await import("@/lib/admin/seed/seedEconTierRosters");
    const econRosters = await seedEconTierRosters(db, preIteration ? "priors" : "winners", log);
    log(
      `Seeded econ-tier rosters (FR/IT/ES/SE/TR): ${econRosters.orgRows} org rows, ` +
        `${econRosters.nppsCreated} NPPs, ${econRosters.officialsCreated} officials`
    );

    // UK's Commons has the identical root cause as the econ-tier five
    // (#3253) in exactly the two presets getPresetSeats() documents it as
    // vacant: "1953-default" ("Democratic legislatures (US/UK/...) start
    // vacant") and "1979-default" ("The multiparty players (US/UK)... start
    // vacant"). historicalSeats.ts authors UK_COMMONS_1992/2020 for every
    // other preset via the earlier historical gate, so calling this
    // unconditionally would fabricate duplicate incumbents on top of those
    // already-correct historical rosters. (`seedFromSeats` now skips chambers
    // that already hold seated NPPs when asked — which this path asks for — but
    // the preset gate is still the right guard: it expresses WHICH presets leave
    // the Commons vacant, rather than relying on a dedup to clean up after an
    // unconditional call.) seedHistorical.ts's own comment
    // calls the 1953 UK legislature "deliberately-vacant... filled by
    // backfillMissingSeats", but that function is only ever invoked from the
    // worldsim script, never real bootstrap — this wires the equivalent fix
    // into the real path. UK is player-enabled (not econ-tier), so it gets
    // its own scoped call rather than joining ECON_TIER_ROSTER_COUNTRIES,
    // reusing the identical underlying seeder.
    if (preset === "1953-default" || preset === "1979-default") {
      // seedOrgRows: false — `seedUKStatePartyOrg` (run earlier in this
      // bootstrap) already seeded UK's real, regionally-calibrated
      // statePartyOrg rows (era polling per region, SNP/Plaid/Sinn Féin
      // confined to their home region). Letting this call's org-row step run
      // too overwrites that data with a flat nationwide grid and re-adds
      // presence rows for the regionally-confined parties everywhere — #3895.
      // Only the incumbent-seat step (below) is what UK actually needs from
      // this seeder.
      const ukRoster = await seedEconTierRostersForCountry(
        db,
        "UK",
        preIteration ? "priors" : "winners",
        log,
        { seedOrgRows: false }
      );
      log(
        `Seeded UK ${preset} Commons roster: ${ukRoster.orgRows} org rows, ` +
          `${ukRoster.nppsCreated} NPPs, ${ukRoster.officialsCreated} officials`
      );
    }
  }

  // Seed governorOfficeState rows for every regional executive seat so the
  // office AP system and Devolution Policy defaults are in place before the
  // first action. Idempotent — safe to run alongside vacant/historical seeds.
  const officeStateResult = await seedOfficeStates(db, gameState.currentTurn, preset);
  log(
    `Seeded office states: ${officeStateResult.inserted} inserted, ${officeStateResult.skipped} skipped`
  );

  const now = new Date();
  // Every spawner below opens with the SAME GameState read (`getCurrentTurnAndCtx`
  // — currentTurn, currentYear, and the preset's cycle anchors). Read it once for
  // the whole battery instead of once per spawner.
  //
  // Sound here specifically: bootstrap runs no turns, and every gameState write
  // on this path — the seal, `initializeGameState`, `stampInitialGameClock` —
  // has already happened by the time the battery starts. The scope is the
  // callback's dynamic extent only, so it cannot outlive this block. The
  // per-turn callers deliberately do not use it; they must see their own turn.
  // Grouped by country: each country's families stay in order (a few mirror a
  // sibling race created moments earlier, e.g. a Senate after its lower chamber),
  // but the countries themselves run concurrently rather than 28 round-trip
  // chains end to end. No family mirrors a race in a DIFFERENT country, and the
  // turn loop already drives this same registry fully concurrently every turn,
  // so per-country sequencing is the conservative half of that.
  await guarded("electionBattery", () =>
    withElectionGameStateSnapshot(db, async () => {
      await Promise.all(
        [
          async () => {
            await ensurePerpetualElections(now, gameState.currentTurn);
          },
          async () => {
            await ensureUKElections(now);
          },
          async () => {
            await ensureJPElections(now);
          },
          async () => {
            await ensureDEElections(now);
          },
          async () => {
            await ensureBRElections(now);
          },
          async () => {
            await ensureNGElections(now);
          },
          async () => {
            await ensureIEElections(now);
            await ensureIEUachtaranElections(now);
            await ensureIELocalCouncilElections(now);
            await ensureIECathaoirleachElections(now);
          },
          async () => {
            await ensureCNElections(now);
            await ensureCNPeoplesCongressElections(now);
            await ensureCNGovernorElections(now);
          },
          // RU (status+era gated — no-ops unless the preset enables the Soviet Union).
          async () => {
            await ensureRUSupremeSovietElections(now);
            await ensureRUNationalitiesElections(now);
            await ensureRURepublicSovietElections(now);
            await ensureRUGovernorElections(now);
          },
          // DD (status+era gated — no-ops unless the preset enables East Germany).
          async () => {
            await ensureDDVolkskammerElections(now);
            await ensureDDGovernorElections(now);
          },
          // Beta parliamentary countries (#3239) — status-gated no-ops unless the
          // country is beta/active; ES additionally era-gated (1953: no elections).
          // Upper chambers / Senates (#3791) — same status gate, and each stays
          // after its own lower chamber; SE has no elected upper chamber
          // (unicameral since 1970), so no ensureSESenateElections.
          async () => {
            await ensureFRElections(now);
            await ensureFRSenateElections(now);
          },
          async () => {
            await ensureITElections(now);
            await ensureITSenateElections(now);
          },
          async () => {
            await ensureESElections(now);
            await ensureESSenateElections(now);
          },
          async () => {
            await ensureSEElections(now);
          },
          async () => {
            await ensureTRElections(now);
            await ensureTRSenateElections(now);
          },
        ].map((run) => run())
      );
    })
  );

  // Seat every chair-synced ceremonial head of state from its ruling party's chairId
  // — the CN President and the Warsaw Pact council chairmanships. The turn pipeline
  // re-runs this every turn; seeding it here makes a freshly bootstrapped world
  // correct before turn 1 fires, rather than showing "Vacant" until the first tick.
  const { syncAllPartyChairHeadsOfState } = await import("@/lib/turn/partyChairHeadOfState");
  const chairHosResults = await syncAllPartyChairHeadsOfState(db, now);
  const seated = chairHosResults.filter((r) => r.action !== "noop");
  log(
    `Party-chair head-of-state sync (bootstrap): ${seated.length}/${chairHosResults.length} seated ` +
      `(${seated.map((r) => `${r.countryId}:${r.action}`).join(", ") || "none"})`
  );

  // Bootstrap JP Sangiin elections — both classes for all regions, anchored to LARP calendar.
  // Class 1 ends Turn 123 (Jul 2022), Class 2 ends Turn 267 (Jul 2025).
  // ensureJPCouncillorElections uses duration-based timing (not LARP-anchored), so we
  // create the bootstrap elections directly like sync-date does.
  //
  // Pre-iteration: this LARP-anchored inline path would stagger the two Sangiin
  // classes (Jul 2022 / Jul 2025) instead of founding them together. Route
  // through the founding-aware ensureJPCouncillorElections instead, which spawns
  // both classes as a synchronized cycle-0 race like every other body.
  if (preIteration) {
    await ensureJPCouncillorElections(now);
    log("Spawned JP Sangiin founding elections (both classes, cycle 0)");
  } else {
    const jpRegions = await db
      .collection("states")
      .find({ countryId: "JP" }, { projection: { _id: 1 } })
      .toArray();
    const sangiinDur = DEFAULT_DURATIONS.sangiin;
    const sangiinToInsert: Omit<Election, "_id">[] = [];

    for (const region of jpRegions) {
      const regionId = String(region._id);
      const totalRegionSeats = JP_SANGIIN_SEATS[regionId] ?? 2;
      const classSeats = Math.ceil(totalRegionSeats / 2);

      for (const chamberClass of [1, 2] as const) {
        // Check if election already exists for this region + class
        const existing = await db.collection("elections").findOne({
          electionType: "sangiin",
          countryId: "JP",
          chamberClass,
          state: regionId,
          status: { $in: ["active", "upcoming"] },
        });
        if (existing) continue;

        const presetAnchors = getCycleAnchors({
          startingYear: getStartingYearForPreset(preset),
          preset,
        });
        const endTurn =
          chamberClass === 2 ? presetAnchors.jpSangiinClass2 : presetAnchors.jpSangiinClass1;
        const endTime = new Date(now.getTime() + endTurn * MS_PER_TURN);
        const primaryEndTime = new Date(
          endTime.getTime() - sangiinDur.generalDurationHours * MS_PER_TURN
        );
        // Absolute turn bounds mirroring the Dates above (turnToWallClock
        // invariant: turn = currentTurn + offset-from-now). `endTurn` here is
        // the offset-from-now anchor, not an absolute turn.
        const endTurnAbs = gameState.currentTurn + endTurn;
        const primaryEndTurnAbs = endTurnAbs - sangiinDur.generalDurationHours;

        sangiinToInsert.push({
          countryId: "JP",
          electionType: "sangiin",
          state: regionId,
          chamberClass,
          seatId: getSeatIdFromElection({
            countryId: "JP",
            electionType: "sangiin",
            state: regionId,
            chamberClass,
          }),
          cycle: 1,
          electionYear: electionToLarpYear("sangiin", 1, undefined, chamberClass, {
            startingYear: getStartingYearForPreset(preset),
            preset,
          }),
          status: "active",
          totalSeats: classSeats,
          startTime: now,
          primaryEndTime,
          endTime,
          startTurn: gameState.currentTurn,
          primaryEndTurn: primaryEndTurnAbs,
          endTurn: endTurnAbs,
          durationHours: sangiinDur.durationHours,
          primaryDurationHours: sangiinDur.primaryDurationHours,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (sangiinToInsert.length > 0) {
      await db.collection<Election>("elections").insertMany(sangiinToInsert as Election[]);
      log(`Spawned ${sangiinToInsert.length} JP Sangiin elections (both classes, all regions)`);
    }
  }

  if (!skipRegionalCouncil) {
    await ensureUKRegionalCouncilElections(now);
    log("Ensured UK Regional Council elections");
  }

  // ── Founding spawn sweep (pre-iteration only) ──────────────────────────────
  // The hand-maintained ensure* battery above has drifted from the registry the
  // TURN LOOP iterates, and the turn loop suppresses every canonical spawner
  // while the founding phase is active — so anything the battery misses would
  // stay vacant for the entire phase (on 1953-default: the whole Warsaw Pact).
  // Re-drive the spawn from that registry instead. Idempotent + status/era
  // gated, so this is a no-op for the families already spawned above.
  // See `spawnFoundingElections` for the full rationale.
  if (preIteration) {
    const { spawnFoundingElections } = await import("@/lib/turn/foundingElections");
    // Same GameState snapshot the ensure* battery uses. The sweep drives all 54
    // families through the same `getCurrentTurnAndCtx` funnel, so without a
    // scope it re-read gameState once per family. This was measured as 53 of the reset's
    // gameState reads. Sound for the same reason the battery is: bootstrap runs
    // no turns, every gameState write on this path has already happened, and
    // `spawnFoundingElections` never writes it.
    await guarded("spawnFoundingElections", () =>
      withElectionGameStateSnapshot(db, () =>
        spawnFoundingElections(db, now, { skipRegionalCouncil, log })
      )
    );

    // General NPP priors population - makes the founding candidate pool
    // independent of historicalSeats.ts, which only authors a roster for a
    // handful of countries (US/RU/CN/DD + Warsaw Pact six under 1953-default).
    // Every other seeded country's founding elections would otherwise have no
    // candidates at all. Runs AFTER the founding sweep so it can size each
    // region's population from its real cycle-0 RACE count (one candidate per
    // race, not per seat - sizing off seat counts produced a 29k-NPP inert
    // bench) rather than any hardcoded per-country number. Additive/idempotent: only
    // tops up parties/regions short of their target, and - like every other
    // priors path - never writes `electedOfficials`.
    const { seedNppPriorsPopulation } = await import("@/lib/npp/seedNppPriorsPopulation");
    const priorsPopulation = await seedNppPriorsPopulation(db, log);
    log(
      `NPP priors population: ${priorsPopulation.nppsCreated} NPPs added across ` +
        `${Object.keys(priorsPopulation.byCountry).length} countries`
    );
  }

  const [
    stateCount,
    seatCount,
    electionCount,
    officialCount,
    partyBudgetCount,
    unownedSectorCount,
  ] = await Promise.all([
    db.collection("states").countDocuments(),
    db.collection("seats").countDocuments(),
    db.collection("elections").countDocuments(),
    db.collection("electedOfficials").countDocuments(),
    db.collection("partyBudget").countDocuments(),
    db.collection("unownedSectors").countDocuments(),
  ]);

  const summary = {
    states: stateCount,
    seats: seatCount,
    elections: electionCount,
    electedOfficials: officialCount,
    partyBudget: partyBudgetCount,
    unownedSectors: unownedSectorCount,
  };

  log("Bootstrap summary:");
  log(`- states: ${summary.states}`);
  log(`- seats: ${summary.seats}`);
  log(`- elections: ${summary.elections}`);
  log(`- electedOfficials: ${summary.electedOfficials}`);
  log(`- partyBudget: ${summary.partyBudget}`);
  log(`- unownedSectors: ${summary.unownedSectors}`);

  return summary;
}

/**
 * Stamps gameState.currentYear/startingYear/preset for the given preset.
 *
 * bootstrapGameWorld() above seeds every country's region/party/demographic
 * data correctly for the requested `preset` (seedAllCountryData receives and
 * threads it throughout) — but it does NOT set the game-clock fields on the
 * gameState document. Those are normally set by the separate, higher-level
 * resetGameWorld() (src/lib/admin/resetGameWorld.ts) BEFORE it calls
 * bootstrapGameWorld() — bootstrapGameWorld's own internal
 * initializeGameState() call is idempotent (no-ops if a gameState doc
 * already exists), so resetGameWorld's earlier stamp survives. The
 * admin reset flow (resetAndBootstrapGameWorld → resetGameWorld then
 * bootstrapGameWorld) already gets this right.
 *
 * bootstrapGameWorld() is deliberately left alone here rather than made to
 * stamp the clock itself: it's also used to re-seed reference data on an
 * EXISTING, already-running world (resetReference re-seeds without
 * resetting), where forcibly resetting currentYear back to the preset's
 * starting year would be wrong.
 *
 * Direct callers that bootstrap a genuinely FRESH/EMPTY database — and
 * therefore DO need the clock to land correctly — must call this BEFORE
 * bootstrapGameWorld(), via initializeGameState() first (so the doc exists)
 * then this. See scripts/bootstrap-full.ts and scripts/sim/runWorld.ts.
 * Found the hard way: stamping after bootstrap (instead of before) leaves
 * region data correctly era-flavored but every election bootstrapGameWorld
 * spawns internally still anchors to whatever preset was in gameState at
 * call time — i.e. still wrong, just less obviously.
 */
export async function stampInitialGameClock(db: Db, preset: string): Promise<void> {
  const startingYear = getStartingYearForPreset(preset);
  await db
    .collection<GameState>("gameState")
    .updateOne(
      { _id: "current" },
      { $set: { currentYear: startingYear, startingYear, preset, updatedAt: new Date() } }
    );
}
