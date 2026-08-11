/**
 * Headless seeded-balance sim harness.
 *
 * Bootstraps a fresh world on an ISOLATED sandbox MongoDB, forces full NPP
 * autonomy everywhere (src/lib/sim/forceFullAutonomy.ts), and advances the
 * real turn engine (processTurn(), src/lib/turnSystem.ts) N turns headlessly
 * — so a seed/preset can be balance-audited before going LIVE. See
 * HANDOFF.md / the npp-autonomy-v3 project memory for full background.
 *
 * Isolation mechanism: src/lib/mongodb.ts's getDb() is a global singleton
 * that selects its database from MONGODB_URI/MONGODB_DB at first use. This
 * script sets those env vars (plus NODE_ENV=test, to skip the strict env
 * schema in src/lib/env.ts which requires auth/admin secrets this harness
 * has no use for) BEFORE dynamically importing anything that touches Mongo,
 * so every getDb() call anywhere in the engine — including ones buried
 * inside bootstrapGameWorld's own callees — resolves to the sandbox.
 *
 * NEVER point SIM_MONGODB_URI at the production database. This agent
 * environment IS the production Hetzner box; there is no accidental-safety
 * net here beyond this script's own guardrails.
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018 \
 *     npx tsx scripts/sim/runWorld.ts --seed=run1 --preset=2019-default --turns=500
 *
 * Re-running the same --seed/--db against a DB that already has a
 * bootstrapped world SKIPS bootstrap and CONTINUES from the current turn —
 * safe to re-run after a crash, and how you extend a run past its original
 * --turns cap.
 */

// Type-only import — erased at compile time, does not trigger module evaluation,
// so it cannot race the env-var setup below (which must run before any *runtime*
// import that touches @/lib/mongodb).
import type { GameState } from "@/lib/db/types/gameState";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { MARKET_MODE_ORDER, type MarketSystemMode } from "@/lib/market/modes";
import { LABOUR_MODE_ORDER, type LabourSystemMode } from "@/lib/labour/modes";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

interface SimRunDoc {
  _id: string;
  runId: string;
  preset: string;
  seed: string;
  dbName: string;
  status: "running" | "completed" | "failed";
  currentTurn?: number;
  startedAt: Date;
  completedAt?: Date;
  updatedAt: Date;
  error: string | null;
  lastMessage?: string;
  lastWarnings?: string[];
  // Elections-only run metadata (sim-only).
  simTurnPhaseMode?: "full" | "elections-only";
  electionScope?: string[] | null;
  emptyCandidateSupplyCountries?: string[];
}

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((v) => v.startsWith(prefix));
  return found?.slice(prefix.length);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

/**
 * Autonomy tier the run forces. Defaults to v3, matching every previous run of
 * this harness. Pass `--autonomy=v4` to exercise the global tier — running the
 * same seed at v3 and v4 is the A/B that tells you whether letting autonomy into
 * player-enabled countries changed the balance.
 */
const AUTONOMY_LEVEL = (arg("autonomy") ?? "v3") as "v3" | "v4";
if (AUTONOMY_LEVEL !== "v3" && AUTONOMY_LEVEL !== "v4") {
  throw new Error(`--autonomy must be v3 or v4 (got "${AUTONOMY_LEVEL}")`);
}

const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI;
if (!SIM_MONGODB_URI) {
  console.error(
    "SIM_MONGODB_URI is required — point this at an ISOLATED sandbox MongoDB " +
      "(e.g. mongodb://127.0.0.1:27018), never production."
  );
  process.exit(1);
}

const seed = arg("seed") ?? "default";
const preset = arg("preset") ?? DEFAULT_SEED_PRESET;
const turns = Number(arg("turns") ?? "500");
// Structural market rework rollout tier. Defaults to unset (leaves the
// bootstrap default, i.e. "off") so existing runs are unchanged. Patched onto
// the sandbox gameConfig right after bootstrap so the whole run exercises it.
//
// Sourced from MARKET_MODE_ORDER rather than a local literal: the literal
// silently omitted every tier added after it was written (it stopped at
// "capital", so the harness could not run "plants" at all — the one tier that
// most needs sim validation before its flip). @/lib/market/modes is a pure
// constant module — no imports, no Mongo, no env — so importing it eagerly
// cannot race the env-var setup below, unlike @/lib/market/featureFlag.
const marketModeRaw = arg("market-mode");
if (marketModeRaw && !MARKET_MODE_ORDER.includes(marketModeRaw as MarketSystemMode)) {
  console.error(`--market-mode must be one of ${MARKET_MODE_ORDER.join(", ")}`);
  process.exit(1);
}
const marketMode = marketModeRaw as MarketSystemMode | undefined;

// --labour-mode is the exact counterpart of --market-mode. Both tiers were
// raised together (wages->full, ledger->capital) when fresh worlds adopted the
// production posture, but only the market half could be exercised here, so a
// harness A/B silently held labour at the preset default and reported itself as
// a clean comparison. Sourced from @/lib/labour/modes for the same purity
// reason the market import documents.
const labourModeRaw = arg("labour-mode");
if (labourModeRaw && !LABOUR_MODE_ORDER.includes(labourModeRaw as LabourSystemMode)) {
  console.error(`--labour-mode must be one of ${LABOUR_MODE_ORDER.join(", ")}`);
  process.exit(1);
}
const labourMode = labourModeRaw as LabourSystemMode | undefined;
// Clone mode: the sandbox DB was pre-loaded with a restore of the LIVE world
// (mongorestore), so skip bootstrap AND the "real world" users guardrail, and
// instead autonomize the human players' corporations so the whole economy runs
// AI-driven. Used to soak-test a market tier against today's actual price
// state rather than a fresh preset bootstrap.
const cloneMode = hasFlag("clone-mode");
// Scarcity drift A/B (week-1 clearing balance pass): seeds
// commodityScarcityDriftEnabled on the sandbox gameConfig so the run
// exercises the persistent-imbalance price integrator.
const scarcityDrift = hasFlag("scarcity-drift");
// Brand loyalty A/B (Package A): --brand-loyalty seeds brandLoyaltyEnabled;
// --brand-loyalty-slice additionally enables the loyal-slice pre-pass.
const brandLoyalty = hasFlag("brand-loyalty");
const brandLoyaltySlice = hasFlag("brand-loyalty-slice");
const sectorQuality = hasFlag("quality");
const demographicsDemand = hasFlag("demographics");
// Command Economy v2 A/B: --command-economy enables commandEconomyEnabled on the
// sandbox gameConfig. Unlike the other tier flags this MUST be set BEFORE
// bootstrap (below), because the multi-SOE split in the budget seed reads the
// flag at seed time — flip it after bootstrap and RU/CN seed as single NatCorps.
const commandEconomy = hasFlag("command-economy");
// Founding phase override. Leave unset to get the preset's own default
// (`presetDefaultsToFoundingPhase`, currently 1953-default only), mirroring
// `resetAndBootstrapGameWorld`'s semantics exactly. Pass `--pre-iteration` /
// `--no-pre-iteration` to force it on/off (e.g. to found 1979-default, which
// has founding-shaped seed data but stays opt-in on the admin path too; see
// presetSelector.ts). Without this, the sim never ran the founding phase at
// all: bootstrapGameWorld() was called directly, never threading the
// `preIteration` option resetAndBootstrapGameWorld supplies, so the founding
// election's every-seat-at-once cycle-0 race never spawned.
const preIterationOverride = hasFlag("pre-iteration")
  ? true
  : hasFlag("no-pre-iteration")
    ? false
    : undefined;

// SIM-ONLY turn-phase profile. --mode=elections-only makes processTurn() skip
// the economy/finance/ledger phases (src/simulation/phases/simTurnProfiles.ts)
// and run only the political/election/approval/campaign phases, so an
// election-balance run isn't paying for corporationTurn/markets/forex. Applied
// to the sandbox gameConfig below (like --market-mode). Default: full turn.
const SIM_TURN_PHASE_MODES = ["full", "elections-only"];
const modeRaw = arg("mode");
if (modeRaw && !SIM_TURN_PHASE_MODES.includes(modeRaw)) {
  console.error(`--mode must be one of ${SIM_TURN_PHASE_MODES.join(", ")}`);
  process.exit(1);
}
const simTurnPhaseMode = modeRaw as "full" | "elections-only" | undefined;
const electionsOnly = simTurnPhaseMode === "elections-only";

// Election country scope: comma-separated allowlist (e.g. --countries=US,UK,DE).
// Omitted → global (the preset's default election roster). Narrows seeding and,
// via countryGameStates.status, which countries actually spawn/run elections.
// IDs are validated against ALL_COUNTRY_IDS inside main() (after the dynamic
// import), keeping this top-level block free of runtime @/lib imports.
const countriesRaw = arg("countries");
const electionScope: Set<string> | null = countriesRaw
  ? new Set(
      countriesRaw
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
    )
  : null;

// Country scope: for non-Cold-War presets, restrict seat-backfill and
// corp-spawning to an ALLOWLIST of countries with genuinely complete, era-
// appropriate seed data (US/UK/DE/JP/CN/BR/NG/IE — the same 8 the production
// admin corp-spawn route already curates, see NPP_CAPITAL_STATES usage below).
// Everything else falls into one of two buckets, both wrong to populate here:
// (1) Cold-War-only entities (USSR, East Germany, Yugoslavia, Czechoslovakia,
// Poland, Romania, Hungary, Bulgaria, Belarus, the Baltics) — historically
// dissolved/nonexistent by 1990-93, seeded ONLY under the 1953/1979 preset
// maps (src/lib/admin/seed/seedCountryGameStates.ts's PRESET_ENABLEMENT,
// where every one is tier "NPP", never player-enabled in any preset) —
// populating them in a 1991/2019-default run is a real anachronism, not a
// scope preference; (2) France/Italy/Spain/Sweden/Turkey — historically
// fine but "coming-soon" for a different reason (incomplete build-out, not
// nonexistence), still not ready to carry a 500-turn balance audit.
// UNLESS the preset is explicitly 1953/1979-default, where the Cold-War
// entities have real dedicated seed data (huSeed.ts, plSeed.ts, yuSeed.ts,
// csSeed.ts, bgSeed.ts, bySeed.ts, balSeed.ts, seedDD.ts, seedRU.ts) and the
// allowlist restriction is lifted entirely (ALL_COUNTRY_IDS, unfiltered).
const SIM_HARNESS_COUNTRIES = new Set(["US", "UK", "DE", "JP", "CN", "BR", "NG", "IE"]);
const isColdWarPreset = preset === "1953-default" || preset === "1979-default";
const inSimScope = (countryId: string) =>
  (isColdWarPreset || SIM_HARNESS_COUNTRIES.has(countryId)) &&
  (!electionScope || electionScope.has(countryId));
const dbName = arg("db") ?? `ahd_sim_${seed}`.replace(/[^a-zA-Z0-9_-]/g, "_");
const checkpointEvery = Number(arg("checkpoint-every") ?? "10");
const runId = arg("run-id") ?? `${seed}-${dbName}`;

if (!Number.isFinite(turns) || turns <= 0) {
  console.error(`--turns must be a positive number, got ${arg("turns")}`);
  process.exit(1);
}

// Must happen before any @/lib import that might transitively touch mongodb.ts.
// NODE_ENV is typed read-only by @types/node; this is the standard escape hatch.
(process.env as { NODE_ENV: string }).NODE_ENV = "test";
process.env.MONGODB_URI = SIM_MONGODB_URI;
process.env.MONGODB_DB = dbName;
// Seeds src/lib/turn/nppActionProcessing.ts's per-NPP action RNG. NOTE: this is
// the only turn-path RNG site retrofitted for seeding so far (see commit
// 87adca94c) — src/lib/turn/npp/leadershipVoting.ts and the corp
// rdInnovation/marketCapSnapshot turn phases still call Math.random()
// directly, so cross-run bit-for-bit reproducibility is NOT yet guaranteed,
// only the NPP campaign/finance decision trajectory is seeded. Documented
// gap, not silently swallowed — see the printed RNG_DETERMINISM note below.
process.env.SIM_RNG_SALT = seed;

function log(msg: string) {
  console.log(`[sim:${runId}] ${msg}`);
}

/**
 * Clone-mode transform: convert every human-run corporation into an NPP-run
 * one so the whole economy runs AI-driven. `ceoType: "npp"` is the single
 * field that gates all autonomous corp turn phases (pricing/investment/attacks/
 * R&D); `ceoId` is reassigned to a real active NPP in the same country
 * (round-robin) so personality + fund accounting resolve, matching the
 * production caretaker-CEO handover (src/lib/corporations/caretakerCeo.ts).
 * State-owned corps (countryOwnerId set) are left alone — they run their own
 * path. Sim-only; only ever touches a sandbox clone DB.
 */

async function autonomizePlayerCorps(db: any, logFn: (m: string) => void): Promise<number> {
  const npps: Array<{ _id: unknown; countryId: string }> = await db
    .collection("npps")
    .find({ retiredAt: null }, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const byCountry = new Map<string, unknown[]>();
  for (const n of npps) {
    if (!byCountry.has(n.countryId)) byCountry.set(n.countryId, []);
    byCountry.get(n.countryId)!.push(n._id);
  }
  const rr = new Map<string, number>();
  const cursor = db.collection("corporations").find({
    ceoType: { $in: ["character", "player", null] },
    countryOwnerId: { $exists: false },
  });
  let converted = 0;
  let noNpp = 0;
  for await (const corp of cursor) {
    const pool = byCountry.get(corp.countryId) ?? [];
    let nppId = corp.ceoId;
    if (pool.length) {
      const i = (rr.get(corp.countryId) ?? 0) % pool.length;
      rr.set(corp.countryId, i + 1);
      nppId = pool[i];
    } else {
      noNpp++; // no NPP in-country: still flip ceoType (acts with default "cautious" personality)
    }
    await db.collection("corporations").updateOne(
      { _id: corp._id },
      {
        $set: {
          ceoType: "npp",
          ceoId: nppId,
          ceoVacant: false,
          ceoSalary: 0,
          updatedAt: new Date(),
        },
        $unset: { pendingCeoCharacterId: "" },
      }
    );
    converted++;
  }
  if (noNpp > 0)
    logFn(`[clone] ${noNpp} corp(s) had no in-country NPP — kept prior ceoId, default personality`);
  return converted;
}

async function main() {
  const { getDb } = await import("@/lib/mongodb");
  const { bootstrapGameWorld } = await import("@/lib/admin/bootstrapGameWorld");
  const { forceFullAutonomy, stampInitialGameClock } = await import("@/lib/sim/forceFullAutonomy");
  const { backfillMissingSeats } = await import("@/lib/sim/backfillMissingSeats");
  const { batchSpawnNppCorporations, NPP_CAPITAL_STATES } =
    await import("@/lib/admin/spawnNppCorporation");
  const { processTurn, initializeGameState } = await import("@/lib/turnSystem");
  const { presetDefaultsToFoundingPhase } = await import("@/lib/seeds/presetSelector");
  const { ALL_COUNTRY_IDS } = await import("@/lib/constants/countries");
  const { snapshotParliamentSeats } = await import("@/lib/turn/parliamentSeatsSnapshot");
  const { snapshotCorporationsByCountry } = await import("@/lib/turn/corporationCountrySnapshot");

  const db = await getDb();

  // Guardrail: refuse to run against a DB that looks like a real world — a
  // misconfigured SIM_MONGODB_URI/--db combo would otherwise get bulldozed by
  // bootstrap's seeders, or worse, have its NPPs hijacked by forceFullAutonomy.
  const userCount = await db
    .collection("users")
    .countDocuments()
    .catch(() => 0);
  if (userCount > 0 && !cloneMode) {
    throw new Error(
      `Refusing to run: target DB "${dbName}" already has ${userCount} user(s) registered — ` +
        "this looks like a real world, not a sandbox. Use a fresh --db name, or pass --clone-mode " +
        "if this DB is a deliberate restore of the live world to be run AI-driven."
    );
  }

  log(
    `RNG_DETERMINISM: the election/NPP DECISION RNG (nppActionProcessing, electionEntry ` +
      `challengers, leadershipVoting, centralBankChairSelection) is seeded via ` +
      `SIM_RNG_SALT="${seed}" — so election trajectories vary by seed and reproduce for the ` +
      "same seed on the same bootstrapped db. Still unseeded: bootstrap initial NPP stat rolls " +
      "(seed*.ts, one-time) and the corp rdInnovation/marketCapSnapshot phases (the latter " +
      "don't run under --mode=elections-only). So cross-seed variance is real; bit-for-bit " +
      "reproducibility across fresh bootstraps is not yet guaranteed."
  );

  const simRuns = db.collection<SimRunDoc>("simRuns");
  const existing = await simRuns.findOne({ _id: runId });

  const officialsCount = await db.collection("electedOfficials").countDocuments();
  const nppsCount = await db.collection("npps").countDocuments({ retiredAt: null });
  const alreadyBootstrapped = officialsCount > 0 || nppsCount > 0;

  // Single source of truth for the rest of this run - see the CLI-flag
  // comment above for why LEAVE-UNSET falls back to the preset default.
  const preIteration = preIterationOverride ?? presetDefaultsToFoundingPhase(preset);

  if (!alreadyBootstrapped) {
    // Order matters: bootstrapGameWorld's OWN internal initializeGameState()
    // call is idempotent (returns the existing doc untouched if one already
    // exists) — so the gameState clock must be created and stamped to the
    // right preset BEFORE bootstrapGameWorld runs, not after. Found the hard
    // way: stamping after bootstrap left region/demographic data correctly
    // 1991-flavored but every election bootstrapGameWorld spawns internally
    // (ensurePerpetualElections/ensureUKElections/etc., all called using
    // whatever gameState already existed at call time) anchored to the
    // 2019-ish default instead — 364 of 424 elections came back with years in
    // the 2020s. Pre-stamping here means those calls see the right preset
    // from the start.
    log(
      `Initializing game clock for ${preset} before bootstrap (so internally-seeded elections anchor correctly)`
    );
    await initializeGameState();
    await stampInitialGameClock(db, preset);

    // Pre-iteration founding phase: stamp the SAME `gameState.preIteration`
    // flag the admin path's resetGameWorld() sets - bootstrapGameWorld()'s own
    // `preIteration` option (passed below) only controls SEEDING (priors-mode
    // officials, the founding spawn sweep, skipping the JP inline bootstrap).
    // It does NOT write this flag. Every canonical-cycle spawner
    // (pickNextCanonicalCycle) and the turn loop's founding-phase suppression
    // (turnPhaseRegistry.ts) read `preIteration.active` FRESH FROM gameState
    // via cycleAnchorContextFromGameState - so without this stamp, spawned
    // elections silently fall back to their ordinary multi-year schedule
    // instead of the unified 24h-primary + 24h-general cycle-0 race, and the
    // calendar/cycle counters are never pinned. Must land before
    // bootstrapGameWorld() runs its ensure*Elections battery below. Verified
    // live: a fresh 1953 sandbox bootstrapped without this stamp produced a
    // ordinary cycle-1 UK Commons election (240-turn window), zero cycle-0
    // races anywhere, and no `preIteration` field on gameState at all.
    if (preIteration) {
      await db
        .collection<GameState>("gameState")
        .updateOne(
          { _id: "current" },
          { $set: { preIteration: { active: true, startedTurn: 1 }, preIterationTurns: 0 } }
        );
      log(
        `Pre-iteration founding phase ON for ${preset}${
          preIterationOverride === undefined ? " (preset default)" : " (explicit)"
        }: chambers seed vacant, a cycle-0 founding election seats every seat ` +
          "simultaneously, and the calendar/cycle/end-date stay pinned to the era start until it resolves"
      );
    }

    // Command Economy v2: the flag must be live BEFORE bootstrap so the budget
    // seed splits RU/CN into per-sector SOEs (and the whole run exercises the
    // planned-economy phases). Set here, not in the post-bootstrap tier block.
    if (commandEconomy) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne({ _id: "default" }, { $set: { commandEconomyEnabled: true } }, { upsert: true });
      log("Set commandEconomyEnabled=true on sandbox gameConfig (before bootstrap)");
    }

    log(
      `Bootstrapping world (preset=${preset}, db=${dbName}${preIteration ? ", pre-iteration" : ""})`
    );
    await bootstrapGameWorld({ db, mode: "historical", preset, log, preIteration });

    // Apply the structural-market rollout tier for this run (if requested).
    // Sim-only: patches the sandbox gameConfig so every turn resolves
    // getMarketSystemMode() to this tier — the NPP auto-posture path in the
    // clearing engine then drives pricing for all AI/unowned sectors.
    if (marketMode) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne(
          { _id: "default" },
          { $set: { marketSystemMode: marketMode } },
          { upsert: true }
        );
      log(`Set marketSystemMode="${marketMode}" on sandbox gameConfig`);
    }
    if (labourMode) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne(
          { _id: "default" },
          { $set: { labourSystemMode: labourMode } },
          { upsert: true }
        );
      log(`Set labourSystemMode="${labourMode}" on sandbox gameConfig`);
    }
    if (scarcityDrift) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne(
          { _id: "default" },
          { $set: { commodityScarcityDriftEnabled: true } },
          { upsert: true }
        );
      log(`Set commodityScarcityDriftEnabled=true on sandbox gameConfig`);
    }
    if (brandLoyalty || brandLoyaltySlice) {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: {
            brandLoyaltyEnabled: true,
            ...(brandLoyaltySlice ? { brandLoyaltySliceEnabled: true } : {}),
          },
        },
        { upsert: true }
      );
      log(
        `Set brandLoyaltyEnabled=true${brandLoyaltySlice ? " + brandLoyaltySliceEnabled=true" : " (shadow)"} on sandbox gameConfig`
      );
    }
    if (sectorQuality) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne({ _id: "default" }, { $set: { sectorQualityEnabled: true } }, { upsert: true });
      log(`set sectorQualityEnabled=true`);
    }
    if (demographicsDemand) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne(
          { _id: "default" },
          { $set: { demographicsDemandEnabled: true } },
          { upsert: true }
        );
      log(`set demographicsDemandEnabled=true`);
    }

    log(`Forcing full NPP autonomy (${AUTONOMY_LEVEL}, every country off the player rail)`);
    await forceFullAutonomy(db, AUTONOMY_LEVEL);

    // Some countries' authored historical seat data (historicalSeats.ts) falls
    // short of that country's own configured legislature size — found via this
    // harness: Nigeria's ENTIRE 1991 legislature (360 House + 109 Senate seats)
    // was unseeded beyond the presidency, UK Commons was short 14/665. Backfill
    // with synthetic (not fabricated-historical) NPPs so the sim starts fully
    // populated. Sim-only — never touches the live game's bootstrap/reset path.
    //
    // NOT under --pre-iteration: the founding cycle is DEFINED by chambers
    // seeding vacant so the cycle-0 races are what seats them. Backfilling
    // here would hand every founding race a full slate of synthetic
    // incumbents, whose Phase-1 incumbent-defense filing then supplies the
    // candidates and whose incumbency advantage drives the vote model — i.e.
    // the harness would be measuring a re-election, not a founding.
    if (preIteration) {
      log("Skipping seat backfill — --pre-iteration requires chambers to start VACANT");
    } else {
      log("Backfilling any legislative chambers short of their configured seat count");
    }
    let seatsBackfilled = 0;
    for (const countryId of preIteration ? [] : ALL_COUNTRY_IDS) {
      if (!inSimScope(countryId)) continue;
      const { house, senate, subNational } = await backfillMissingSeats(db, countryId);
      if (house || senate || subNational) {
        log(
          `  ${countryId}: +${house} lower-chamber, +${senate} upper-chamber, +${subNational} sub-national NPP seats`
        );
        seatsBackfilled += house + senate + subNational;
      }
    }
    log(`Backfill complete: ${seatsBackfilled} seats filled across all countries`);

    // Bootstrap seeds no tradeable corporations at all (only 8 non-tradeable
    // country-owned entities, one per country) — found via this harness: 50
    // turns of NPP bond/stock/index-fund investing produced 384 bond
    // positions but ZERO share positions, because there was nothing to buy.
    // Corporation creation has always been player-driven (found-a-corp
    // action) or admin-batch-seeded (batchSpawnNppCorporations, used by
    // /api/admin/corporations/spawn-npp-all in production) — never automatic
    // during turn processing. Mirror that same admin tool here, once, so a
    // pure-NPP sim world actually has a corporate sector for NPPs to invest
    // in. Three corps per sector (17 sectors) per country, NPP CEO + 49%
    // public float each, for real intra-sector competition — market-share
    // dynamics ratio all competing corps against a shared, bounded market
    // (marketShare.ts), so this models competition rather than inflating
    // aggregate output. Sim-only, never touches the live game's bootstrap
    // /reset path.
    // elections-only freezes the economy (corporationTurn is skipped), so NPP
    // corporations would just sit idle — skip the (slow) spawn to speed seeding.
    if (electionsOnly) {
      log("elections-only: skipping NPP corporation spawn (economy is frozen this run)");
    } else {
      log(
        "Spawning NPP-owned corporations (bootstrap seeds none — needed for stock/index-fund investing)"
      );
      let countriesSpawned = 0;
      for (const countryId of ALL_COUNTRY_IDS) {
        if (!inSimScope(countryId)) continue;
        if (!NPP_CAPITAL_STATES[countryId]) continue; // coming-soon: no seeded capital state
        const existing = await db
          .collection("corporations")
          .countDocuments({ ceoType: "npp", countryId });
        if (existing > 0) continue;
        try {
          const spawned = await batchSpawnNppCorporations(db, countryId, { perSectorCount: 3 });
          if (spawned.length > 0) {
            log(`  ${countryId}: spawned ${spawned.length} NPP corporations`);
            countriesSpawned++;
          }
        } catch (error) {
          log(
            `  ${countryId}: corp spawn failed — ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      log(`Corporation spawn complete: ${countriesSpawned} countries seeded`);
    }

    await simRuns.updateOne(
      { _id: runId },
      {
        $setOnInsert: { runId, preset, seed, dbName, startedAt: new Date() },
        $set: { status: "running", currentTurn: 0, error: null, updatedAt: new Date() },
      },
      { upsert: true }
    );
  } else {
    log(
      `World already bootstrapped (${officialsCount} officials, ${nppsCount} NPPs) — ` +
        `${existing ? "resuming" : "adopting un-tracked"} run, skipping bootstrap`
    );
    await simRuns.updateOne(
      { _id: runId },
      {
        $setOnInsert: { runId, preset, seed, dbName, startedAt: new Date() },
        $set: { status: "running", error: null, updatedAt: new Date() },
      },
      { upsert: true }
    );
  }

  // Shadow ledger: ON in the sim harness (OFF in prod seeds). The headless sim
  // on a known-clean world is the reconciler's acceptance test — every turn
  // mirrors financialTxLog into ledgerEntries, snapshots balances, and runs the
  // per-turn reconciler. See docs/plans/2026-07-05-shadow-ledger-plan.md §3.
  await db
    .collection<{ _id: string; ledgerShadow?: boolean }>("gameConfig")
    .updateOne({ _id: "default" }, { $set: { ledgerShadow: true } }, { upsert: true });
  log("Shadow ledger enabled for this run (ledgerShadow=true)");

  if (cloneMode) {
    // The DB is a restore of the live world. Make it AI-driven: patch the
    // market tier, flip every human-run corp to an NPP-run one, and open the
    // world-level autonomy gates (forceFullAutonomy). Order: market mode and
    // corp conversion before autonomy gates, so the first turn already sees a
    // fully autonomous economy at the requested tier.
    if (marketMode) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne(
          { _id: "default" },
          { $set: { marketSystemMode: marketMode } },
          { upsert: true }
        );
      log(`[clone] set marketSystemMode="${marketMode}" on cloned gameConfig`);
    }
    if (labourMode) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne(
          { _id: "default" },
          { $set: { labourSystemMode: labourMode } },
          { upsert: true }
        );
      log(`[clone] set labourSystemMode="${labourMode}" on cloned gameConfig`);
    }
    if (scarcityDrift) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne(
          { _id: "default" },
          { $set: { commodityScarcityDriftEnabled: true } },
          { upsert: true }
        );
      log(`[clone] set commodityScarcityDriftEnabled=true on cloned gameConfig`);
    }
    if (brandLoyalty || brandLoyaltySlice) {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: {
            brandLoyaltyEnabled: true,
            ...(brandLoyaltySlice ? { brandLoyaltySliceEnabled: true } : {}),
          },
        },
        { upsert: true }
      );
      log(
        `[clone] set brandLoyaltyEnabled=true${brandLoyaltySlice ? " + brandLoyaltySliceEnabled=true" : " (shadow)"} on cloned gameConfig`
      );
    }
    if (sectorQuality) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne({ _id: "default" }, { $set: { sectorQualityEnabled: true } }, { upsert: true });
      log(`set sectorQualityEnabled=true`);
    }
    if (demographicsDemand) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne(
          { _id: "default" },
          { $set: { demographicsDemandEnabled: true } },
          { upsert: true }
        );
      log(`set demographicsDemandEnabled=true`);
    }
    const converted = await autonomizePlayerCorps(db, log);
    log(`[clone] autonomized ${converted} human-run corporations → ceoType=npp`);
    log(`[clone] forcing full NPP autonomy (world/country gates → ${AUTONOMY_LEVEL})`);
    await forceFullAutonomy(db, AUTONOMY_LEVEL);
  }

  // ── SIM-ONLY: mark this database as a sandbox world ───────────────────────
  // Unconditional and idempotent, and it must stay that way: the guard this
  // disables (turnSystem.ts's cron-drift auto-pause) fires precisely on RESUMED
  // worlds, whose last completed turn is hours or days old. Stamping this only
  // at bootstrap would leave every pre-existing sandbox db unmarked — i.e. it
  // would fix nothing for exactly the worlds that need it.
  await db
    .collection<GameConfig>("gameConfig")
    .updateOne({ _id: "default" }, { $set: { simSandbox: true } }, { upsert: true });

  // ── SIM-ONLY: elections-only turn profile + country scope ──────────────────
  // Runs for fresh, resumed AND clone worlds (idempotent) so the profile always
  // takes effect before the turn loop, mirroring how --market-mode is applied.
  if (simTurnPhaseMode) {
    await db
      .collection<GameConfig>("gameConfig")
      .updateOne({ _id: "default" }, { $set: { simTurnPhaseMode } }, { upsert: true });
    log(
      `Set simTurnPhaseMode="${simTurnPhaseMode}" on sandbox gameConfig` +
        (electionsOnly ? " — economy/finance/ledger phases skipped each turn" : "")
    );
  }
  if (electionScope) {
    const known = new Set<string>(ALL_COUNTRY_IDS as readonly string[]);
    const unknown = [...electionScope].filter((c) => !known.has(c));
    if (unknown.length) {
      throw new Error(
        `--countries has unknown id(s): ${unknown.join(", ")}. Known: ${[...known].join(",")}`
      );
    }
    // Turn election spawning ON for scoped countries (status "active" — lights up
    // NG/CN/etc. that gate spawning on countryGameStates.status via
    // countryElectionsLive) and OFF for other seedable countries. US is the
    // ungated base country and always runs; the report filters to scope anyway.
    for (const countryId of electionScope) {
      await db
        .collection<{ _id: string; status: string }>("countryGameStates")
        .updateOne({ _id: countryId }, { $set: { status: "active" } }, { upsert: true });
    }
    const disabled = (ALL_COUNTRY_IDS as readonly string[]).filter(
      (c) =>
        c !== "US" && !electionScope.has(c) && (isColdWarPreset || SIM_HARNESS_COUNTRIES.has(c))
    );
    for (const countryId of disabled) {
      await db
        .collection<{ _id: string; status: string }>("countryGameStates")
        .updateOne({ _id: countryId }, { $set: { status: "coming-soon" } }, { upsert: true });
    }
    log(
      `Election scope: [${[...electionScope].join(",")}] active; ` +
        `${disabled.length} other seedable countries set coming-soon (US always runs)`
    );
  }
  await simRuns.updateOne(
    { _id: runId },
    {
      $set: {
        simTurnPhaseMode: simTurnPhaseMode ?? "full",
        electionScope: electionScope ? [...electionScope] : null,
      },
    }
  );

  // Candidate-supply guard (#3253): some seeds (FR/IT/ES/SE/TR) ship no NPPs, so
  // their elections resolve empty. Flag scoped countries with no NPP supply so
  // the election report can distinguish "no candidates" from "uncontested".
  {
    const scopeToCheck: string[] = electionScope
      ? [...electionScope]
      : isColdWarPreset
        ? [...ALL_COUNTRY_IDS]
        : [...SIM_HARNESS_COUNTRIES];
    const emptyCountries: string[] = [];
    for (const countryId of scopeToCheck) {
      const npps = await db.collection("npps").countDocuments({ countryId, retiredAt: null });
      if (npps === 0) emptyCountries.push(countryId);
    }
    if (emptyCountries.length) {
      log(
        `⚠ No NPP candidate supply for: ${emptyCountries.join(", ")} — ` +
          "their elections will resolve empty (see #3253)"
      );
      await simRuns.updateOne(
        { _id: runId },
        { $set: { emptyCandidateSupplyCountries: emptyCountries } }
      );
    }
  }

  const gameStateBefore = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const startTurn = (gameStateBefore?.currentTurn as number | undefined) ?? 0;
  const targetTurn = startTurn + turns;
  log(`Advancing from turn ${startTurn} to turn ${targetTurn} (${turns} turns)`);

  try {
    let lastTurn = startTurn;
    let iterations = 0;
    let skippedSinceMs: number | null = null;
    while (lastTurn < targetTurn) {
      const result = await processTurn();
      iterations++;
      // A turn that "processed with N warning(s)" reports success=false but is
      // NOT a failure — warnings are informational (e.g. "characters received
      // action points"). Only abort on a genuine failure so a 120-turn A/B
      // isn't killed by a benign per-turn warning.
      // A turn stopped mid-flight leaves a crashed-turn marker. processTurn's
      // recovery path handles it correctly — it advances the clock past the
      // partial turn, clears the lock, and reports success:false with a warning
      // rather than re-running and double-applying. That is a recovery, not a
      // failure, and aborting the run on it makes pausing a 1000-turn sim
      // impossible: every checkpoint stop kills the next resume.
      const isCrashRecovery = /Recovered crashed turn/i.test(result.message ?? "");
      const isWarningOnly =
        /processed with \d+ warning/i.test(result.message ?? "") || isCrashRecovery;
      if (!result.success && !isWarningOnly) {
        throw new Error(`processTurn failed at turn ${lastTurn + 1}: ${result.message}`);
      }
      if (result.message.startsWith("Skipped:")) {
        // Another holder has the turn lock. In a dedicated sandbox DB that
        // holder is almost always a dead process from a mid-turn restart, so
        // don't busy-loop on turn 0 until TURN_LOCK_STALE_MS elapses: back
        // off, and after 2 minutes of no progress force-clear the lock.
        skippedSinceMs ??= Date.now();
        if (Date.now() - skippedSinceMs > 2 * 60 * 1000) {
          log(
            `Turn lock held with no progress for 2m at turn ${lastTurn} — clearing stale sandbox lock`
          );
          await db
            .collection<GameState>("gameState")
            .updateOne(
              { _id: "current", isProcessing: true },
              { $set: { isProcessing: false, processingKind: null, processingPhase: null } }
            );
          skippedSinceMs = null;
        } else {
          await new Promise((r) => setTimeout(r, 5000));
        }
        continue;
      }
      skippedSinceMs = null;
      lastTurn = result.turn;

      // Sim-harness-only snapshots (seats, corporations-by-country) for the
      // experiments report — deliberately NOT wired into the live
      // turnPhaseRegistry.ts, so there's zero behavior/write-volume change to
      // the live game. partyHistorySnapshot (party org) is already wired into
      // the registry and ran as part of processTurn() above — no separate
      // call needed for that one.
      await snapshotParliamentSeats(db, lastTurn);
      await snapshotCorporationsByCountry(db, lastTurn);

      if (iterations % checkpointEvery === 0 || lastTurn >= targetTurn) {
        log(
          `turn ${lastTurn} (${lastTurn - startTurn}/${turns})` +
            (result.warnings.length ? ` — ${result.warnings.length} warning(s)` : "")
        );
        await simRuns.updateOne(
          { _id: runId },
          {
            $set: {
              currentTurn: lastTurn,
              lastMessage: result.message,
              lastWarnings: result.warnings,
              updatedAt: new Date(),
            },
          }
        );
      }
    }

    await simRuns.updateOne(
      { _id: runId },
      { $set: { status: "completed", completedAt: new Date(), updatedAt: new Date() } }
    );
    log(`Run complete at turn ${lastTurn}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await simRuns
      .updateOne(
        { _id: runId },
        { $set: { status: "failed", error: message, updatedAt: new Date() } }
      )
      .catch(() => {});
    throw err;
  }
}

if (hasFlag("help") || hasFlag("h")) {
  console.log(
    "Usage: SIM_MONGODB_URI=... npx tsx scripts/sim/runWorld.ts " +
      "--seed=<id> [--preset=2019-default] [--turns=500] [--db=<name>] [--autonomy=v3|v4] " +
      "[--run-id=<id>] [--checkpoint-every=10] [--pre-iteration|--no-pre-iteration]"
  );
  process.exit(0);
}

// getDb()'s pooled MongoClient (maxIdleTimeMS: 0, see src/lib/mongodb.ts) never
// idle-times-out, so the process would otherwise hang open forever after a
// successful run — explicit exit is required for a one-shot script.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[sim:${runId}] FAILED:`, error);
    process.exit(1);
  });
