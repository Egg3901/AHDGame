import type { Db } from "mongodb";
import type { Character, GameState, User } from "@/lib/db/types";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { seedHistoricalOfficials } from "@/lib/npp/seedHistorical";
import { retireCharacter } from "@/lib/retireCharacter";
import { freezeOfficeHistoryIterations } from "@/lib/turn/history/freezeOfficeHistoryIterations";
import { orderIterations } from "@/lib/wiki/officeIteration";
import { getRuntimeCollectionNames } from "@/lib/admin/seed/seedManifest";
import { missingGameStateFlagDefaults } from "@/lib/seeds/reference/featureFlagDefaults";
import { buildSeasonRecaps } from "@/lib/recap/buildSeasonRecaps";
import type { CharacterRecap } from "@/lib/recap/types";
import type { GameIteration } from "@/lib/db/types/gameState";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { isSeasonRecapEnabled } from "@/lib/recap/featureFlag";

/**
 * Runtime collections that `resetGameWorld` handles with bespoke logic instead
 * of the blanket manifest-driven sweep. Each is wiped or managed elsewhere in
 * the function; excluding them keeps the sweep from clobbering special handling
 * (in-place updates, partial deletes, preset-aware cleanup) or double-deleting
 * the collections whose counts we capture for the result/adminLog.
 *
 * The reset/manifest contract test asserts this split is exhaustive: every
 * runtime collection is either swept or listed here.
 */
export const RUNTIME_WIPE_SPECIAL_CASES: ReadonlySet<string> = new Set<string>([
  // Re-initialized in place to turn 1 — never dropped.
  "gameState",
  // party_<country> counters survive (default parties keep their seqIds);
  // partial delete below.
  "counters",
  // Preset-aware charter cleanup (drop-all vs. keep-default) below.
  "partyCharters",
  // Deleted explicitly to capture deletedCount for the result/adminLog.
  "electedOfficials",
  "elections",
  "electionCandidates",
  "npps",
  "actionLogs",
  "bills",
  "stateBills",
  "statePartyElections",
]);

/**
 * `gameState._id: "current"` survives every reset in place (it is re-initialized,
 * never dropped — see RUNTIME_WIPE_SPECIAL_CASES), and the reset's `$set` covers
 * only a closed list of fields. Anything else the PREVIOUS world stamped onto the
 * doc therefore survives forever and is read by the new world's turn engine as if
 * it were its own progress. Every field below is a per-world progress marker
 * (a "last time this phase fired" guard or a derived per-world index), so each
 * must be cleared or the phase it guards mis-fires — or never fires at all — on
 * the new world.
 *
 * Confirmed live on a 1953 world reset from a 2010s world: `lastCensusYear: 2010`,
 * `lastAutoSeedTurn: 944`, `lastBundestagReconciledCycle: 6`, `currentEraId: "2010s"`.
 *
 * Keys are `$unset`, not `$set` to a default: absent is the documented "never
 * fired yet" state for every one of these guards, and re-deriving them is the
 * owning phase's job on the first turn of the new world.
 */
export const STALE_PROGRESS_GAME_STATE_UNSET: Readonly<Record<string, "">> = Object.freeze({
  // Decennial census guard: `shouldRunCensus` requires `currentYear > lastCensusYear`
  // (src/lib/turn/census.ts). Carrying 2010 into a 1953 world suppresses every
  // census/reapportionment until game-year 2020.
  lastCensusYear: "",
  // UI summary of the last census's seat deltas — belongs to the census above,
  // and would otherwise show the dead world's reapportionment on the new one.
  lastCensus: "",
  // Auto sector-seed cadence guard: `currentTurn - lastAutoSeedTurn < TURNS_PER_YEAR`
  // (src/lib/turn/autoSectorSeed.ts). Carrying 944 into a turn-1 world makes the
  // difference permanently negative, disabling auto-seeding for the whole game.
  lastAutoSeedTurn: "",
  // Same cadence-guard shape for the extraction auto-strategy phase.
  lastExtractionAutoStrategyTurn: "",
  // Germany AMS reconciliation high-water mark: `lastReconciled >= cycle` returns
  // early (src/lib/turn/election/germanyAMS.ts). Carrying 6 skips AMS top-up
  // allocation for the new world's cycles 0 through 6.
  lastBundestagReconciledCycle: "",
  // Cabinet year-crossing guard (seat unlock/retire/rename vs the live year).
  lastCabinetYearProcessed: "",
  // Era-crossing state. `eraCrossing.ts` self-heals `currentEraId` on the next
  // turn, but `lastEraCrossedYear` is a `currentYear > lastEraCrossedYear` guard
  // like the census one, so a 2010 value silences decade-crossing news until 2011.
  currentEraId: "",
  lastEraCrossedYear: "",
  // Era metric-activation guard — same `currentYear > last…` shape.
  lastMetricActivationYear: "",
  // Derived per-world economic indices, recomputed by `nationalMetrics.ts` from
  // the new world's GDP. Stale values feed era-scaled legislation costs and
  // spending estimates (budget/spending.ts, politicalLegislation/estimates.ts)
  // at the DEAD world's price level until the first recompute lands.
  eraGdpPerCapitaBaseline: "",
  incomeBandIndexByCountry: "",
  // Presidential term-limit ledger (src/lib/turn/election/presidentialTenureLedger.ts).
  // Counts terms served per country; the previous world's counts would term-limit
  // brand-new presidents in the new one.
  presidentialTenureByCountry: "",
});

interface ResetGameWorldOptions {
  deleteProfiles: boolean;
  preset?: string;
  seedHistorical?: boolean;
  adminUsername?: string;
  iteration?: import("@/lib/db/types/gameState").GameIteration;
  /**
   * When true, start the world in a live pre-iteration "founding" phase: seed
   * chambers VACANT ("priors" seed mode) and stamp `preIteration.active` so the
   * founding election (cycle 0) seats every political nation before the real
   * game begins. See foundingElections / detectPreIterationComplete.
   */
  preIteration?: boolean;
  /**
   * Progress sink. Every line this function emits — including everything its
   * sub-seeders log — is prefixed with `[reset] ` before reaching the callback,
   * because `resetAndBootstrapGameWorld` runs `bootstrapGameWorld` immediately
   * afterwards and many of the same seeders log identical text there. Without
   * the tag the two phases are indistinguishable in the admin log and in the
   * SSE stream.
   *
   * Omit for silence (the previous behaviour).
   */
  log?: (msg: string) => void;
}

export interface ResetGameWorldResult {
  success: true;
  message: string;
  details: {
    officialsDeleted: number;
    officialsSeeded: number;
    electionsDeleted: number;
    candidatesDeleted: number;
    nppsDeleted: number;
    nppsSeeded: number;
    statePartyElectionsDeleted: number;
    billsDeleted: number;
    stateBillsDeleted: number;
    charactersDeleted?: number;
    usersDeleted?: number;
    charactersRetired?: number;
    actionLogsCleared: number;
    demographicsReset: number;
    customPartiesDeleted: number;
    partyOrgRecordsDeleted: number;
    budgetSeedLog: string[];
  };
}

export async function resetGameWorld(
  db: Db,
  options: ResetGameWorldOptions
): Promise<ResetGameWorldResult> {
  const preset = options.preset ?? DEFAULT_SEED_PRESET;
  const seedHistorical = options.seedHistorical !== false;
  const preIteration = options.preIteration === true;
  const now = new Date();

  // Tagged progress sink — see ResetGameWorldOptions.log for why the prefix is
  // load-bearing rather than cosmetic. Handed to every sub-seeder below; the
  // ones that used to receive `() => {}` are why a reset looked like a hang.
  const sink = options.log;
  const log = sink ? (msg: string) => sink(`[reset] ${msg}`) : () => {};

  // ── Season Recap ("Wrapped") pre-build ─────────────────────────────────────
  // Build every character's end-of-season recap BEFORE the runtime wipe below
  // destroys actionLogs/bills/ranking snapshots (they're gone by the deleteMany
  // block that starts a few lines down). Held in memory and stamped onto each
  // RetiredCharacter as the retire loop runs. Skipped on a full reset (the
  // retiredCharacters archive is discarded anyway) and when the gate is off.
  // The recap season is the OUTGOING gameState.iteration, still valid here — it
  // isn't advanced until the gameState update near the end of this function.
  let seasonRecaps: Map<string, CharacterRecap> | null = null;
  let recapIteration: GameIteration | undefined;
  if (!options.deleteProfiles) {
    const gsForRecap = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { iteration: 1, currentTurn: 1, seasonRecapEnabled: 1 } }
      );
    if (isSeasonRecapEnabled(gsForRecap)) {
      recapIteration = gsForRecap?.iteration;
      const charsForRecap = await db.collection<Character>("characters").find({}).toArray();
      seasonRecaps = await buildSeasonRecaps(db, charsForRecap, {
        iteration: recapIteration,
        currentTurn: gsForRecap?.currentTurn ?? 1,
      });
    }
  }

  // ── Runtime wipe (manifest-driven) ─────────────────────────────────────────
  // Clear every `runtime` collection in the seed manifest so no prior-iteration
  // state (cooldowns, ledgers, in-flight votes, snapshots, …) leaks into the
  // fresh world. Driven by getRuntimeCollectionNames() rather than a
  // hand-maintained list so a newly-added runtime collection can't silently
  // survive resets — the class of bug this replaces. A few runtime collections
  // need bespoke handling and are excluded via RUNTIME_WIPE_SPECIAL_CASES; they
  // are wiped/managed elsewhere in this function.
  //
  // These counts are surfaced in the result + adminLog, so we delete them
  // explicitly to capture deletedCount (and exclude them from the sweep).
  const officialsResult = await db.collection("electedOfficials").deleteMany({});
  const electionsResult = await db.collection("elections").deleteMany({});
  const candidatesResult = await db.collection("electionCandidates").deleteMany({});
  const nppsResult = await db.collection("npps").deleteMany({});
  const logsResult = await db.collection("actionLogs").deleteMany({});
  const billsResult = await db.collection("bills").deleteMany({});
  const stateBillsResult = await db.collection("stateBills").deleteMany({});
  const statePartyElectionsResult = await db.collection("statePartyElections").deleteMany({});

  const sweepCollections = getRuntimeCollectionNames().filter(
    (name) => !RUNTIME_WIPE_SPECIAL_CASES.has(name)
  );
  // Use drop() rather than deleteMany({}): the sweep includes append-only log
  // collections that accumulate to millions of rows on a long-lived world
  // (indexFundTransactions ~2.7M, financialTxLog, treasuryTransactions,
  // corporationHistory, …). deleteMany scans row-by-row (minutes), which stalls
  // the reset request until the proxy times out mid-wipe, leaving a half-reset
  // world. drop() is an O(1) metadata operation regardless of size. Indexes are
  // recreated by seedIndexes() in the bootstrap that follows every reset path
  // (bootstrapGameWorld runs it before the seedOnly short-circuit). Ignore
  // NamespaceNotFound for collections that don't exist yet.
  await Promise.all(
    sweepCollections.map((name) =>
      db
        .collection(name)
        .drop()
        .catch(() => {})
    )
  );
  log(
    `Wiped ${sweepCollections.length} runtime collections ` +
      `(${officialsResult.deletedCount} officials, ${electionsResult.deletedCount} elections, ` +
      `${nppsResult.deletedCount} NPPs, ${billsResult.deletedCount} bills counted separately)`
  );

  // Clear imperial-character references on admin accounts, but preserve the
  // characters themselves so head-of-state NPPs survive across resets.
  await db
    .collection<User>("users")
    .updateMany(
      { activeImperialCharacterId: { $exists: true } },
      { $unset: { activeImperialCharacterId: "", activeCharacterType: "" } }
    );

  // Clear regular-character pointers too — both reset modes either delete or
  // retire all characters, so any `activeCharacterId` still pointing at one
  // of those rows is stale. Leaving it set causes a redirect loop on /profile
  // (findOne returns null → "Authentication required" → /login → repeat).
  // Admin users survive the wipe but still need this cleared.
  await db
    .collection<User>("users")
    .updateMany({ activeCharacterId: { $exists: true } }, { $unset: { activeCharacterId: "" } });

  // Clear the turn-based corporation-founding cooldown on every (preserved)
  // user. It gates founding off `currentTurn - lastCorporationFoundedTurn`,
  // and currentTurn resets to 1 below, so a stale high value would block
  // founding for the whole new game. `lastRetiredAt` is intentionally left
  // alone — it's a wall-clock anti-abuse cooldown, not game-turn state.
  await db
    .collection<User>("users")
    .updateMany(
      { lastCorporationFoundedTurn: { $exists: true } },
      { $unset: { lastCorporationFoundedTurn: "" } }
    );

  // ⚠️ LEGACY BRANCH — dead on every real path, and it does NOT seed the world.
  //
  // `resetAndBootstrapGameWorld` is this function's only caller and always passes
  // `seedHistorical: false`, because bootstrap's seeders re-create the default
  // parties and officials must follow them so party `sequentialId`s line up.
  // Officials are therefore bootstrap's job (`shouldSeedHistoricalOfficials`).
  //
  // This function no longer seeds regions or parties at all — that was the
  // double-seed, see finalizeResetGameWorld — so a direct caller passing
  // `seedHistorical: true` would seat officials against whatever the OUTGOING
  // preset left behind, and any seat whose state does not resolve becomes a
  // phantom US legislator (`npp/generator.ts`'s `config.countryId ?? "US"`).
  // Kept only so the exported signature does not change under callers this repo
  // does not own; do not start using it.
  const seedResult = seedHistorical
    ? await seedHistoricalOfficials(db, preset, preIteration ? "priors" : "winners")
    : { nppsCreated: 0, officialsCreated: 0 };

  let charactersDeleted = 0;
  let charactersReset = 0;
  let usersDeleted = 0;

  if (options.deleteProfiles) {
    const deleteResult = await db.collection("characters").deleteMany({});
    charactersDeleted = deleteResult.deletedCount;

    // Preserve admin accounts — only delete non-admin users
    const usersResult = await db.collection("users").deleteMany({ isAdmin: { $ne: true } });
    usersDeleted = usersResult.deletedCount;

    await db.collection("retiredCharacters").deleteMany({});
    await db.collection("characterAchievements").deleteMany({});
    log(`Deleted ${charactersDeleted} character(s) and ${usersDeleted} non-admin user(s)`);
  } else {
    const allCharacters = await db.collection<Character>("characters").find({}).toArray();
    charactersReset = allCharacters.length;

    // `retireCharacter` is ~25 sequential writes per character, so on a
    // long-lived world this loop is the phase most likely to look like a hang.
    // Announce it up front, then report the total.
    if (charactersReset > 0) log(`Retiring ${charactersReset} character(s)…`);
    for (const character of allCharacters) {
      await retireCharacter(db, character, character.userId, "game_reset", {
        iteration: recapIteration,
        recap: seasonRecaps?.get(character._id.toString()),
      });
    }
    log(`Retired ${charactersReset} character(s)`);
  }

  // Freeze the outgoing run's office history under its current iteration BEFORE
  // the clock resets to turn 1, so post-reset reads keep correct Week/Year and
  // iteration grouping. Uses the still-valid outgoing anchor.
  const outgoing = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  if (outgoing?.iteration) {
    await freezeOfficeHistoryIterations(db, outgoing.iteration, {
      currentTurn: outgoing.currentTurn ?? 1,
      lastTurnProcessed: new Date(outgoing.lastTurnProcessed ?? now),
      startingYear: outgoing.startingYear ?? getStartingYearForPreset(preset),
    });
  }

  const startingYear = getStartingYearForPreset(preset);
  const gameStateUpdate: Record<string, unknown> = {
    currentTurn: 1,
    currentYear: startingYear,
    startingYear,
    preset,
    isActive: false,
    lastTurnProcessed: now,
    nextScheduledTurn: null,
    pausedAt: null,
    pauseReason: null,
    pauseKind: null,
    corporationActionsPaused: false,
    playerTransfersPaused: false,
    updatedAt: now,
    // Reset preserves explicit feature-flag choices but fills in the
    // production-default posture for any flag never touched on this world.
    ...missingGameStateFlagDefaults(outgoing),
  };
  if (options.iteration) {
    gameStateUpdate.iteration = options.iteration;
    // Maintain the global iteration registry so generated wiki office pages can
    // always show every known iteration section (Alpha 1, Beta 1, Beta 2, …).
    gameStateUpdate.iterationHistory = orderIterations(outgoing?.iterationHistory ?? [], [
      options.iteration,
    ]);
  }

  // Pre-iteration founding phase: pin the calendar (offset 0 → clamp to era
  // start while active) and flag the founding phase. A normal reset clears any
  // stale flag from a prior world so the calendar/schedule behave normally.
  const gameStateUnset: Record<string, ""> = { ...STALE_PROGRESS_GAME_STATE_UNSET };
  gameStateUpdate.preIterationTurns = 0;
  if (preIteration) {
    gameStateUpdate.preIteration = { active: true, startedTurn: 1 };
  } else {
    gameStateUnset.preIteration = "";
  }

  await db
    .collection<GameState>("gameState")
    .updateOne(
      { _id: "current" },
      Object.keys(gameStateUnset).length > 0
        ? { $set: gameStateUpdate, $unset: gameStateUnset }
        : { $set: gameStateUpdate },
      { upsert: true }
    );

  // `gameState` is exempt from the manifest-driven sweep (it is re-initialized in
  // place), and the update above is filtered to `_id: "current"` — so ANY other
  // document in this collection is unreachable by every reset path and lives
  // forever. `triggerDebtCeilingCrisis` (src/lib/budget/debt.ts) writes exactly
  // one such squatter: `_id: "debt_ceiling_crisis"`. A live 1953 world still
  // carried an `active: true` crisis stamped `triggeredYear: 1993`. It is the
  // only non-`current` id written to this collection anywhere in `src/`, but the
  // filter is deliberately generic so a future squatter can't reintroduce the
  // same class of bug. Runs AFTER the upsert so `current` always exists first.
  await db
    .collection("gameState")
    // Untyped collection — GameState's `_id` is the literal "current", which
    // doesn't type-check against a `$ne` filter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .deleteMany({ _id: { $ne: "current" } } as any);

  // The corporation economy (corporations, bonds, shares, financialTxLog, …) was
  // wiped by the manifest-driven sweep above — which runs before this counter
  // reset, so the next founded corp can't reuse a sequentialId behind the unique
  // index, and financialTxLog can't strand rows pointing at deleted corp/char ids.
  //
  // Reset sequential ID counters so new entities start from 1.
  // Excludes party_* counters — surviving default parties keep their
  // sequentialIds in the non-deleteAllParties branch below, and wiping
  // their counter would make the next ensureDefaultParties insert
  // (e.g. UUP when switching to 1991) hand out seqId 1, colliding with
  // Labour. The deleteAllParties branch explicitly calls
  // resetPartyCounters() after wiping every party, so it's covered too.
  // Untyped collection — the default `_id: ObjectId` inference doesn't fit
  // our string counter ids, so cast the filter through `any`.
  await db
    .collection("counters")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .deleteMany({ _id: { $not: { $regex: /^party_/ } } } as any);

  // Reference collections that runtime seeders re-populate with $setOnInsert (so
  // they won't overwrite stale accumulated state) must be wiped explicitly — the
  // manifest-driven sweep only touches `runtime` collections. statePolicies is
  // re-seeded by seedStatePolicies below; commodity/forex by their seeders.
  await db.collection("statePolicies").deleteMany({});
  await db.collection("commodityPrices").deleteMany({});
  await db.collection("exchangeRates").deleteMany({});
  await db.collection("centralBanks").deleteMany({});

  log("Teardown complete — bootstrap builds the new world, then finalize cleans up");

  // The adminLog row is written by `finalizeResetGameWorld`, not here: the
  // cleanup counts it reports (demographics reset, custom parties and party-org
  // rows deleted) are only knowable after the new world exists.
  return {
    success: true,
    message: options.deleteProfiles
      ? "Game fully reset - all data deleted"
      : "Game reset successfully",
    details: {
      officialsDeleted: officialsResult.deletedCount,
      officialsSeeded: seedResult.officialsCreated,
      electionsDeleted: electionsResult.deletedCount,
      candidatesDeleted: candidatesResult.deletedCount,
      nppsDeleted: nppsResult.deletedCount,
      nppsSeeded: seedResult.nppsCreated,
      statePartyElectionsDeleted: statePartyElectionsResult.deletedCount,
      billsDeleted: billsResult.deletedCount,
      stateBillsDeleted: stateBillsResult.deletedCount,
      charactersDeleted: options.deleteProfiles ? charactersDeleted : undefined,
      usersDeleted: options.deleteProfiles ? usersDeleted : undefined,
      charactersRetired: options.deleteProfiles ? undefined : charactersReset,
      actionLogsCleared: logsResult.deletedCount,
      // Filled in by `finalizeResetGameWorld` and merged by the orchestrator —
      // these describe cleanup against the SEEDED world, which does not exist
      // yet at this point.
      demographicsReset: 0,
      customPartiesDeleted: 0,
      partyOrgRecordsDeleted: 0,
      budgetSeedLog: [],
    },
  };
}
