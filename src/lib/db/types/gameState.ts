import type { ObjectId } from "mongodb";
import type { CountryId, CountryStatus } from "../../constants/countries";
import type { TurnPhaseTelemetryMap } from "./turnPhaseTelemetry";

export type NppEntryViabilityMode = "off" | "observe" | "enforce";

export type IterationType = "Alpha" | "Beta" | "Iteration";

/**
 * Smarter-NPP autonomy tier. The level says WHICH activities autonomous
 * politicians may perform — never how competently they perform them. How
 * competently is `SingleplayerConfig.difficulty` (local worlds only), which is
 * a separate axis and never unlocks or removes an activity.
 *
 *   - off: no autonomy anywhere.
 *   - v0:  currently-shipped behavior (chair, stalled-PM, bill sponsorship/voting,
 *          intl-org votes) in non-player countries.
 *   - v1:  v0 + the governing brain (agenda → executive → cabinet → ministerial
 *          action → fiscal → opposition) in non-player countries.
 *   - v2:  v1 + comingling with player-enabled countries / player corps.
 *   - v3:  v2 + full player-parity agency (career/economic action loop: NPPs
 *          campaign, fundraise, run for & win office, legislate, and manage
 *          personal finance like players). Acts in player-enabled countries
 *          like v2.
 *   - v4:  v3 applied globally (player-enabled countries included), with the
 *          tighter player-country sponsorship throttles.
 *   - v5:  v4 + persistent governing goals. A government keeps a bounded set of
 *          goal records across agenda recomputes, grades each one, feeds the
 *          verdicts into the next agenda, and holds its commitments instead of
 *          re-deciding every cycle. Adds no new lever: every V5 intent is
 *          executed through the same validation/execution paths v4 already
 *          uses. Singleplayer/Worldsim beta — see featureFlagDefaults.
 * See plans/2026-06-23-npp-autonomy-v1-v2-plan.md.
 */
export type NppAutonomyLevel = "off" | "v0" | "v1" | "v2" | "v3" | "v4" | "v5";
export type NppForeignPolicyMode = "off" | "shadow" | "active";
export type NppForeignPolicyStage = "votes" | "proposals" | "trade" | "support" | "war";

/** Local-only world mode. Hosted worlds never persist these fields. */
export type SingleplayerMode = "normal" | "head-of-state" | "worldsim";
export type SingleplayerDifficulty = "easy" | "normal" | "hard";

export interface SingleplayerConfig {
  mode: SingleplayerMode;
  difficulty: SingleplayerDifficulty;
  /** Existing NPP autonomy level remains independent from local difficulty. */
  nppAutonomyLevel: NppAutonomyLevel;
  featureFlags: Record<string, boolean>;
  /** Whether the local character is locked to the head-of-state career path. */
  permanentHeadOfState: boolean;
  configuredAt: Date;
}

export interface GameIteration {
  type: IterationType;
  number: number;
}

/**
 * Shared stamp fields written onto office-history records (cabinet/leadership
 * holders + confirmed nominations) so generated wiki office pages can group
 * tenure by iteration and render in-game Week/Year that stays correct across
 * resets. Stamped by `freezeOfficeHistoryIterations` (and the backfill
 * migration); `confirmedTurn` is derived from the record's timestamp.
 */
export interface IterationStampFields {
  iteration?: GameIteration;
  confirmedTurn?: number;
  iterationStartingYear?: number;
}

export interface GameState {
  _id: string;
  /** Setup chosen by the local singleplayer launcher; absent on hosted worlds. */
  singleplayerConfig?: SingleplayerConfig;
  /** Last compact local turn sample used by opt-in performance analytics. */
  singleplayerTurnMetrics?: {
    turn: number;
    durationMs: number;
    success: boolean;
    warningCount: number;
    slowestPhases: Array<{ phase: string; durationMs: number }>;
  };
  /**
   * Turn on which the Cold War was resolved in-game, or null/absent while it is
   * still being fought.
   *
   * DELIBERATELY NOT A YEAR. The alignment eras flip to post-cold-war at 1991,
   * but a game still contesting the Cold War in 1992 has not ended it — the
   * calendar is not allowed to decide. Nothing sets this yet; it exists so the
   * bloc designation (`resolveOrgCategory`) has an off switch the day an ending
   * is built, rather than an implicit one hanging off the date.
   */
  coldWarEndedTurn?: number | null;
  currentTurn: number;
  currentYear: number;
  /**
   * Calendar year of turn 1 for the active reset preset (1991, 2019, etc.).
   * Set by `resetGameWorld` at bootstrap from the preset's mapping in
   * `getStartingYearForPreset()`. When undefined (legacy rows pre-2026-05-20),
   * readers fall back to the global `STARTING_YEAR` constant.
   */
  startingYear?: number;
  /**
   * Calendar year of the most recent decennial census/reapportionment (P1d-2).
   * The census phase fires in Week 1 of years ending in 0 and stamps this to
   * avoid re-firing within the same year. Absent until the first census runs.
   */
  lastCensusYear?: number;
  /**
   * Compact summary of the most recent census reapportionment (P1d-3 UI). The
   * region population route reads `deltas` to show a per-region "gained/lost N
   * House seats" notice. Absent until the first census runs.
   */
  lastCensus?: {
    year: number;
    deltas: Array<{ state: string; from: number; to: number; delta: number }>;
  };
  /**
   * Last in-game year statehood admission was evaluated, so a year is rolled
   * for at most once. The roll itself is keyed on the year and is therefore
   * idempotent, but this also spares the work on every other turn of the year.
   * Absent until the first evaluation. Only 1953-era worlds have candidates.
   *
   * @see src/lib/turn/statehood.ts
   */
  lastStatehoodYear?: number;
  /**
   * The reset-preset id that produced this game world (e.g. `"2019-default"`,
   * `"1991-default"`). Drives `canonicalTurnsForCycle` lookup of real-world
   * election years per era. Defaults to `"2019-default"` when undefined.
   */
  preset?: string;
  /**
   * Pre-iteration "founding" election phase (see foundingElections). When
   * `active`, every political nation is running a one-off full-seating election
   * to establish its starting composition, the turn counter advances normally,
   * but the displayed calendar date is PINNED to the era start (turn 1) so all
   * nations enter the real game with a fresh mandate at the same moment. Cleared
   * by `detectPreIterationComplete` once every in-scope nation has resolved.
   * Absent on normal (non-pre-iteration) worlds → behaves exactly as before.
   */
  preIteration?: {
    active: boolean;
    /** Raw `currentTurn` at which the founding phase began (always 1 today). */
    startedTurn: number;
    /** Raw `currentTurn` at which the founding phase completed. */
    completedTurn?: number;
  };
  /**
   * Additive turn offset that decouples the displayed calendar from the raw
   * turn counter: `calendarTurn = max(1, currentTurn − preIterationTurns)` (see
   * `calendarTurn()` in gameDate.ts). Zero/undefined on normal worlds (identity).
   * Stamped to `completedTurn − 1` when the pre-iteration finishes, so the
   * calendar resumes at the era start (turn 1) the moment the real game begins
   * and every canonical election anchor shifts forward by the same amount (see
   * `getCycleAnchors`), preserving the historical calendar mapping.
   */
  preIterationTurns?: number;
  /**
   * Consecutive-tenure ledger for the executive head-of-government office, per
   * country. Updated when a presidential (head-of-government) election resolves:
   * same winning party → `consecutiveTerms + 1`; party flip → reset to `{ party,
   * 1 }`. Read by the party-tenure voter-fatigue penalty in the incumbency
   * driver. `consecutiveTerms` counts terms ALREADY held (so the incumbent is
   * seeking `consecutiveTerms + 1`). Absent until the first presidential
   * resolution / backfill.
   */
  presidentialTenureByCountry?: Partial<
    Record<CountryId, { party: string; consecutiveTerms: number }>
  >;
  isActive: boolean;
  lastTurnProcessed: Date;
  nextScheduledTurn: Date | null;
  pausedAt: Date | null;
  /** Human-readable reason set when the cron pauses (manual or auto). null when active. */
  pauseReason?: string | null;
  /** Discriminator for pause source. "manual" for admin pause, "auto-drift" for the 4h drift guard. null when active. */
  pauseKind?: "manual" | "auto-drift" | null;
  /**
   * Wall-clock moment the turn system was last activated by `startTurnSystem`.
   * Floors the auto-pause drift anchor: after a long pause, the very first
   * post-resume turn would otherwise see drift = entire pause duration and
   * trip the 4h guard. With this floor, drift starts counting from resume.
   * Null on legacy rows; treated as "never resumed" (no floor applied).
   */
  lastResumedAt?: Date | null;
  /** Current game iteration (e.g. Alpha 1, Beta 3) - set on reset */
  iteration?: GameIteration;
  /**
   * Ordered registry of every iteration the game has known (Alpha 1, Beta 1,
   * Beta 2, …). Drives the "always show known iterations" sections on generated
   * wiki office pages. The current iteration is always present and last. Seeded
   * by the office-history backfill migration; appended on reset and on the
   * Admin "Set Now" iteration path.
   */
  iterationHistory?: GameIteration[];
  /** When true, the wiki is hidden from non-admin users (redirects to profile) */
  wikiDisabled?: boolean;
  /** When true, player-initiated sector splits and attacks are blocked */
  corporationActionsPaused: boolean;
  /** When true, player-to-player transfers are blocked */
  playerTransfersPaused: boolean;
  /**
   * When true, each player may make one cooldown-free party move (see the join
   * route). Admin-controlled: flip on while staging a launch so players can
   * settle into a party during the pause, off at go-live. Explicit rather than
   * inferred from the pause state, because a staged launch unpauses for
   * verification turns and re-pauses, making the window indistinguishable from
   * an ordinary mid-game admin pause.
   */
  freePartyMovesOpen?: boolean;
  /** When true, the forex exchange rate system is active */
  forexEnabled?: boolean;
  /** When true, PREE offers new player random events. Default false until admin enables. */
  playerRandomEventsEnabled?: boolean;
  playerRandomEventsEnabledBy?: string;
  playerRandomEventsEnabledAt?: string;
  /**
   * When true, country-scope World Events v1 offers new events (Phase 0: only
   * manual admin-trigger produces them — no scheduler yet). Default false.
   */
  worldEventsEnabled?: boolean;
  worldEventsEnabledBy?: string;
  worldEventsEnabledAt?: string;
  /** When true, the crisis interaction system (decision trees, collective contributions, input nodes) is active. */
  crisisInteractionEnabled?: boolean;
  crisisInteractionEnabledBy?: string;
  crisisInteractionEnabledAt?: string;
  /** Master gate for the automatic crisis system (disasters + economic/political). */
  autoDisastersEnabled?: boolean;
  autoDisastersEnabledBy?: string;
  autoDisastersEnabledAt?: string;
  /**
   * Multiplier applied to random-tier crisis spawnChance (autoCrisisSpawn.ts).
   * Undefined/absent → 1 (production default, per-template tuned rates
   * unchanged). The headless sim sets this above 1 so crises are a more active
   * force over a long audit run than the base ~0.002-0.004/turn rates yield.
   */
  crisisSpawnChanceMultiplier?: number;
  /**
   * Smarter-NPP autonomy tier (off / v0 / v1 / v2 / v3 / v4 / v5). Replaces the
   * legacy `nppAutonomyEnabled` boolean — a legacy `true` reads as "v0" and an
   * absent field with no legacy boolean reads as "off", so an existing world is
   * never silently re-tiered. Fresh worlds seed v4; setup requests that omit the
   * level default to v4. V5 is opt-in. Below v2, autonomy acts ONLY in
   * disabled/econ-only countries; v2 comingles with player-enabled countries.
   * Resolved per country by getNppAutonomyLevelForCountry.
   */
  nppAutonomyLevel?: NppAutonomyLevel;
  /** @deprecated Use `nppAutonomyLevel`. Kept in sync (level !== "off") for back-compat readers. */
  nppAutonomyEnabled?: boolean;
  nppAutonomyEnabledBy?: string;
  nppAutonomyEnabledAt?: string;
  /**
   * Foreign-policy planner rollout. Absent defaults to shadow so autonomous
   * countries produce auditable intent without changing world state.
   */
  nppForeignPolicyMode?: NppForeignPolicyMode;
  nppForeignPolicyModeBy?: string;
  nppForeignPolicyModeAt?: string;
  /** Highest autonomous action family permitted while foreign policy is active. */
  nppForeignPolicyStage?: NppForeignPolicyStage;
  nppForeignPolicyStageBy?: string;
  nppForeignPolicyStageAt?: string;
  /**
   * May an NPP belligerent declare an offensive of its own? When false the
   * `conduct_war` choice is never offered, so the country spends its foreign-policy
   * slot elsewhere instead of queueing a battle declaration. Default false.
   * Toggled from Admin → World → Conflicts. Player governments are unaffected:
   * they declare through the cabinet battle route either way.
   *
   * Governs the DECISION, not the queue. A declaration already filed still resolves
   * on the following turn after this is switched off, because an offensive always
   * resolves a turn after it is declared — that gap is the defender's window, and
   * cancelling a filed order here would be a hole in it. Expect at most one more tick
   * of NPP offensives after turning this off.
   */
  nppOffensiveInitiationEnabled?: boolean;
  nppOffensiveInitiationEnabledBy?: string;
  nppOffensiveInitiationEnabledAt?: string;
  /**
   * May an NPP belligerent join an ally's offensive at a front where it already has
   * troops posted? When true it is treated as having a standing auto-join order on
   * every front it is deployed to, without one being written to `theaterState`.
   * Default false, which leaves NPP allies fighting defensively only. Player
   * governments keep their own explicit `theaterState.autoJoin` orders either way.
   */
  nppOffensiveJoinEnabled?: boolean;
  nppOffensiveJoinEnabledBy?: string;
  nppOffensiveJoinEnabledAt?: string;
  /**
   * When true, NPP-run countries build intelligence networks and run operations
   * of their own. Default false, which leaves them purely defensive.
   *
   * This gates INITIATIVE only. Counter-intelligence posture is derived for every
   * NPP country each turn regardless of this switch, because defence needs no
   * order: a country nobody is playing still resists being spied on.
   */
  /**
   * When true, a successful military covert action actually degrades the
   * target's front supply and formation readiness. Default false.
   *
   * Off because it is a BALANCE change and the balance report that CLAUDE.md
   * requires could not be produced: the live world has no engaged front to
   * measure against (see scripts/sim/reports/). The code ships reviewed and
   * inert; turning it on is a deliberate act that should follow the report.
   */
  intelligenceMilitarySabotageEnabled?: boolean;
  intelligenceMilitarySabotageEnabledBy?: string;
  intelligenceMilitarySabotageEnabledAt?: string;
  nppIntelligenceOperationsEnabled?: boolean;
  nppIntelligenceOperationsEnabledBy?: string;
  nppIntelligenceOperationsEnabledAt?: string;
  /** When true, crisis international-aid nodes use the slider + legislature-bill flow. */
  crisisAidBillsEnabled?: boolean;
  crisisAidBillsEnabledBy?: string;
  crisisAidBillsEnabledAt?: string;
  /** Temporary pause: the system stays enabled/configured but no new crises or
   *  disasters spawn while true. Existing crises continue to run. */
  autoCrisisPaused?: boolean;
  /** When true, seed/reseed derives archetype econ/social from Layer-1 positions
   *  (deriveGroupLeanFromLayer1) instead of the legacy ideology-net path. Default false. */
  demographicsLayer1PositionsEnabled?: boolean;
  demographicsLayer1PositionsEnabledBy?: string;
  demographicsLayer1PositionsEnabledAt?: string;
  /** When true, the Conflicts subsystem is live: the "Conflicts" link appears in
   *  the World navbar and the public /world/conflicts page is surfaced. Default
   *  false (hidden). Toggled from Admin → World → Conflicts → General. */
  conflictsEnabled?: boolean;
  conflictsEnabledBy?: string;
  conflictsEnabledAt?: string;
  /** Living-conflict engine: generic phased conflicts/pandemics with per-role
   *  responses and an event broadcast bus. Default off; fail-closed at runtime. */
  livingConflictsEnabled?: boolean;
  livingConflictsEnabledBy?: string;
  livingConflictsEnabledAt?: string;
  /** Temporary freeze on NEW defence procurement. When true, no new contracts may be
   *  awarded and no pending offer may be accepted, but existing active contracts keep
   *  delivering and settling in the turn sweep, and ministers may still cancel. Mirrors
   *  `autoCrisisPaused`: the subsystem stays configured, only new activity stops. Default
   *  false (procurement open). Set to halt a live procurement-drain exploit without a deploy
   *  once this gate is live. */
  defenceProcurementPaused?: boolean;
  defenceProcurementPausedBy?: string;
  defenceProcurementPausedAt?: string;
  /** Master switch for the Cold War conflict subsystem. All Cold War features
   *  on this branch are gated behind this flag. Default false (system inert). */
  coldWarEnabled?: boolean;
  coldWarEnabledBy?: string;
  coldWarEnabledAt?: string;
  /** Master switch for the corporate M&A / deal-making subsystem (agreed
   *  corp-to-corp acquisitions). Default false — the Deals tab and the
   *  acquisition endpoints are inert until an admin enables it. */
  corpDealsEnabled?: boolean;
  corpDealsEnabledBy?: string;
  corpDealsEnabledAt?: string;
  /**
   * When true, the RPG stat system is live: character creation allocates stats,
   * grandfathered characters are prompted to allocate, stat efficacy/drift apply,
   * and the election-debate subsystem can fire. Default false (system inert).
   */
  rpgStatsEnabled?: boolean;
  rpgStatsEnabledBy?: string;
  rpgStatsEnabledAt?: string;
  /** When true, turns run at 30-minute cycles instead of 60-minute cycles */
  fastMode?: boolean;
  /** Concurrency guard - true while a turn is being processed */
  isProcessing?: boolean;
  /** Which workflow currently owns the processing lock */
  processingKind?: "turn" | "forexMigration" | null;
  /** When the active turn lock was acquired; used to recover stale locks after crashed runs */
  processingStartedAt?: Date | null;
  /** The turn number currently being processed while the lock is held */
  processingTargetTurn?: number | null;
  /** Updated before each phase so a future turn can tell whether the lock is stale */
  processingHeartbeatAt?: Date | null;
  /** Last phase name to refresh the processing heartbeat; helps debug stuck turns */
  processingPhase?: string | null;
  /** Per-phase lifecycle state for the active turn; used to debug skips, failures, and stalls */
  processingPhaseStatuses?: TurnPhaseTelemetryMap | null;
  /** Master gate for the automatic sector seeding system (fires every 48 turns). */
  autoSectorSeedEnabled?: boolean;
  autoSectorSeedEnabledBy?: string;
  autoSectorSeedEnabledAt?: string;
  /** Turn on which the auto-sector seeding last fired. Guards the 48-turn interval. */
  lastAutoSeedTurn?: number;
  /**
   * Master gate for extraction auto strategy adoption (Phase 1a of the
   * extraction-capacity remediation): nudges standard miners on shortage
   * deposits onto the matching focused mining strategy. Default off.
   */
  extractionAutoStrategyEnabled?: boolean;
  extractionAutoStrategyEnabledBy?: string;
  extractionAutoStrategyEnabledAt?: string;
  /**
   * Safety rollout for the realized-viability check on autonomous NPP mine
   * founding. Absent resolves to observe so existing worlds collect evidence
   * without changing placement. Only enforce can reject a candidate.
   */
  nppEntryViabilityMode?: NppEntryViabilityMode;
  nppEntryViabilityModeBy?: string;
  nppEntryViabilityModeAt?: string;
  /** Turn the extraction auto-strategy phase last acted. Guards its cadence. */
  lastExtractionAutoStrategyTurn?: number;
  /** Master gate for the US House districted-redistricting system. Default off. */
  /**
   * NPP corporation strategy loop. DEFAULT ON: absent means enabled, so
   * existing worlds keep the behaviour they were promoted with. Only an
   * explicit `false` disables it, and disabling pins every corp to the `expand`
   * levers, which are byte-identical to the pre-strategy-loop brain.
   *
   * Unrelated to `NppAutonomyLevel`'s v5 tier despite the shared version digit —
   * this flag was the fifth iteration of the CORPORATE brain and predates the
   * autonomy ladder reaching v5. Renamed in comments/labels so the two cannot be
   * mistaken for each other; the persisted field name is unchanged.
   */
  nppCorpStrategyEnabled?: boolean;
  nppCorpStrategyEnabledBy?: string;
  nppCorpStrategyEnabledAt?: string;
  redistrictingEnabled?: boolean;
  redistrictingEnabledBy?: string;
  redistrictingEnabledAt?: string;
  /** Master gate for the decade-gated sector tech trees. Default off. */
  sectorTechTreesEnabled?: boolean;
  sectorTechTreesEnabledBy?: string;
  sectorTechTreesEnabledAt?: string;
  /** Master gate for subsidiary corporations (acquisition management + spin-off). Default off. */
  subsidiaryCorporationsEnabled?: boolean;
  subsidiaryCorporationsEnabledBy?: string;
  subsidiaryCorporationsEnabledAt?: string;
  /**
   * Trade-exposure embargo model. When on, a total embargo strips only a
   * foreign sector's cross-border (export-exposed) revenue instead of
   * mothballing the whole sector, preserving domestic host sales. Default off
   * (legacy total-mothball behaviour). See TRADE_EMBARGO_EXPORT_LOSS_SHARE.
   */
  embargoTradeExposureEnabled?: boolean;
  embargoTradeExposureEnabledBy?: string;
  embargoTradeExposureEnabledAt?: string;
  /** Master gate for the live election results page (/elections/[id]/results). Default off. */
  liveElectionResultsEnabled?: boolean;
  liveElectionResultsEnabledBy?: string;
  liveElectionResultsEnabledAt?: string;
  /**
   * Master gate for legislation demographic effects v2: lean/turnout
   * DemographicEffect targets (economicLean/socialLean/turnout) plus their
   * decay-toward-baseline. The legacy population channel is NOT gated. Absent
   * reads as false (fail-closed); fresh worlds seed it true via
   * DEFAULT_GAME_STATE_FLAGS.
   */
  legislationDemographicEffectsV2Enabled?: boolean;
  legislationDemographicEffectsV2EnabledBy?: string;
  legislationDemographicEffectsV2EnabledAt?: string;
  /**
   * Master gate for the new-player onboarding checklist (profile checklist
   * card, page-visit step tracking, welcome mail, completion reward). When
   * off, the profile shows the legacy NewPlayerBanner and no onboarding
   * writes happen. Fresh worlds seed this on (featureFlagDefaults.ts).
   */
  onboardingChecklistEnabled?: boolean;
  onboardingChecklistEnabledBy?: string;
  onboardingChecklistEnabledAt?: string;
  /**
   * Master gate for the end-of-iteration Season Recap ("Wrapped"). When on,
   * `resetGameWorld` builds each character's recap before the runtime wipe and
   * stamps it onto their `retiredCharacters` doc, the post-reset gate surfaces
   * it on next login, and it becomes re-viewable in character history. Voluntary
   * and admin retirements also build a recap while on. Fail-closed: absent/false
   * = system inert (no recaps written, gate returns nothing). Default OFF (staged
   * rollout — not in DEFAULT_GAME_STATE_FLAGS); an explicit enable survives
   * future resets via missingGameStateFlagDefaults.
   */
  seasonRecapEnabled?: boolean;
  seasonRecapEnabledBy?: string;
  seasonRecapEnabledAt?: string;
  /**
   * Master gate for IntOrg alignment. When false or absent the system is inert:
   * the alignment turn phase writes nothing, no drift accrues, plays cannot be
   * committed, and neither the Cold War Ledger nor the Influence tab renders.
   * Seeding is the deliberate exception — opening values are written regardless
   * so flipping this on a live world shows a populated map, not blank rows.
   * Fail-closed: only an explicit `true` enables. NOT in
   * DEFAULT_GAME_STATE_FLAGS — staged rollout, default off; an explicit enable
   * survives resets.
   */
  intOrgAlignmentEnabled?: boolean;
  intOrgAlignmentEnabledBy?: string;
  intOrgAlignmentEnabledAt?: string;
  /**
   * Master gate for settlement crises (the German Question). Fail-closed: only
   * an explicit `true` enables. NOT in DEFAULT_GAME_STATE_FLAGS — staged
   * rollout, default off; an explicit enable survives resets.
   */
  settlementCrisisEnabled?: boolean;
  settlementCrisisEnabledBy?: string;
  settlementCrisisEnabledAt?: string;
  /**
   * Highest Bundestag cycle whose AMS list-seat reconciliation has completed.
   * Scopes `maybeReconcileBundestag` so each cycle reconciles exactly once and
   * a later cycle still reconciles after an earlier cycle was healed. Absent on
   * legacy rows (treated as -1 / never reconciled).
   */
  lastBundestagReconciledCycle?: number;
  /**
   * When true, the Eurozone currency union (EUR) is active for DE and IE.
   * Seeded false for pre-1999 presets (1979-default, 1991-default); all
   * modern presets seed it true. Flips to true in-game when all
   * EU_EUROZONE_MEMBERS enact an EuroAdoptionProvision bill.
   * Defaults to true when absent so existing 2019-default rows are unaffected.
   */
  eurozoneEnabled?: boolean;
  /**
   * Countries that have enacted an EuroAdoptionProvision bill. When this
   * includes all EU_EUROZONE_MEMBERS, eurozoneEnabled flips to true.
   * Seeded to ["DE", "IE"] for modern presets, [] for pre-1999 presets.
   */
  euroAdoptedCountries?: CountryId[];
  /**
   * Voting-age threshold set by enacted franchise legislation
   * (`ElectoralLawProvision.votingAge`). Absent = derive from the year:
   * 21 before the 26th Amendment, 18 after. See `resolveVotingAgeEligible`.
   *
   * GLOBAL. Retained only so worlds written before the per-country map existed
   * still resolve; nothing writes it any more. Read AFTER
   * `votingAgeEligibleByCountry`, which supersedes it.
   */
  votingAgeEligible?: number;
  /**
   * Per-country franchise, keyed by countryId. Electoral law is national law:
   * a Japanese franchise bill must not set the American voting age.
   */
  votingAgeEligibleByCountry?: Partial<Record<string, number>>;
  /**
   * Registration-access law, -50 (restricted) .. +50 (automatic registration).
   * GLOBAL legacy field, superseded by `registrationAccessBiasByCountry`.
   */
  registrationAccessBias?: number;
  /**
   * Per-country registration-access law, keyed by countryId. Scales the passive
   * Org→Reg drift and Reg decay for that country's states only.
   */
  registrationAccessBiasByCountry?: Partial<Record<string, number>>;
  /**
   * Master switch for the era system. When true, the era-crossing turn phase
   * stamps decade eras + posts wire news, and approval/metric scoring is
   * era-aware: thresholds drift with the live in-game year via era-normal
   * expectation curves (src/lib/era/). Default false — flag-off behavior is
   * byte-identical to legacy scoring and no era markers are written.
   * Toggled from Admin; flip only after reviewing the dry-run diff
   * (scripts/debug/era-approval-dryrun.ts).
   */
  eraSystemEnabled?: boolean;
  eraSystemEnabledBy?: string;
  eraSystemEnabledAt?: string;
  /**
   * Macro-growth v1 (design 2026-07-09 §4): enables the Solow convergence term
   * (O2) + sector-signal blend (O3) on potential growth. Staged rollout, OFF by
   * default — flip only after reviewing scripts/debug/macro-growth-dryrun.mjs
   * (per-country openness gate + convergence bonus). Independent of
   * eraSystemEnabled; flag-off is byte-identical to legacy potential growth.
   */
  macroGrowthV1?: boolean;
  macroGrowthV1By?: string;
  macroGrowthV1At?: string;
  /**
   * Master gate for granular poll breakdowns: cross-product Layer-1 electorate
   * cells (race × age × education × wealth) attached to poll results. Default
   * false; US-only and purely additive to existing poll math.
   */
  granularPollEnabled?: boolean;
  granularPollEnabledBy?: string;
  granularPollEnabledAt?: string;
  /**
   * Granular-cell electorate engine: per-state vote-share/appeal computation
   * in elections runs over IPF-raked Layer-1 demographic cells instead of the
   * 12 voter archetypes (see `src/lib/demographics/granularElectorate.ts`).
   * Fail-closed: false/absent = byte-identical legacy archetype behavior.
   */
  granularElectorateEnabled?: boolean;
  /**
   * Per-country GDP-per-capita baseline for the era income band (metric era
   * catalog). Self-healed by computeNationalMetrics on the first flag-on turn
   * (back-solved from realized income vs the era income anchor — continuity:
   * no score jump at enable). Local-currency base units.
   */
  eraGdpPerCapitaBaseline?: Partial<Record<string, number>>;
  /**
   * Per-country realized-growth index (current GDP/capita ÷ baseline), written
   * each turn by computeNationalMetrics while eraSystemEnabled. Consumed by
   * medianIncome scoring (band = anchor × shape × index).
   */
  incomeBandIndexByCountry?: Partial<Record<string, number>>;
  /**
   * Player-facing decade era id ("2000s"), stamped by the era-crossing turn
   * phase at decade rollover. Display/news only — scoring never reads it
   * (scoring computes continuously from currentYear).
   */
  currentEraId?: string;
  /** Decade year the era-crossing phase last fired for (guards re-fire). */
  lastEraCrossedYear?: number;
  /**
   * Year the metric-activation news check last covered (guards re-posting).
   * First flag-on run quietly self-heals to the current year without posting.
   */
  lastMetricActivationYear?: number;
  /**
   * Guard year for the cabinetYearCrossing turn phase (seat unlock/retire/rename
   * vs the live year). First run quietly self-heals: reconciles retired-occupied
   * seats and stamps without posting news.
   */
  lastCabinetYearProcessed?: number;
  /**
   * Guard year for the militaryBranchYearCrossing turn phase (standing up a service
   * whose `establishedYear` the world has now reached, e.g. the NVA in 1956). First
   * run quietly stands up every active-but-empty branch and stamps without posting.
   */
  lastMilitaryBranchYearProcessed?: number;
  /**
   * Cabinet seat ids brought into existence early by a create_department bill,
   * regardless of their era `yearEnabled` (e.g. "secretary_of_education" after the
   * Department of Education Act). Read by rosterEra.isSeatActive / resolveSeatName.
   */
  manuallyEnabledSeats?: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Per-country game state for multi-country support.
 * Tracks electoral cycle timing independently per country.
 * US uses the global GameState; additional countries use CountryGameState.
 */
export interface CountryGameState {
  /** Country ID - acts as document _id */
  _id: CountryId;
  currentTurn: number;
  currentYear: number;
  /** Turn on which the current electoral cycle began */
  cycleStartTurn: number;
  /** Turn on which the next general election is scheduled (if known) */
  nextElectionTurn?: number;
  /** True when a snap election has been triggered and is pending scheduling */
  snapElectionPending: boolean;
  isActive: boolean;
  lastTurnProcessed: Date;
  nextScheduledTurn: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Whether non-admin players can access this country's pages and data */
  enabledForPlayers?: boolean;
  /** DB-driven country status - overrides CountryConfig.status at runtime */
  status?: CountryStatus;
  /**
   * Turn this country ceased to exist — absorbed into another state.
   *
   * The registry could previously only ever ADD: `registeredBase` returns
   * `[...COUNTRY_ORDER, ...activated]`, so a country compiled into the static
   * base list could be hidden from players but never retired from the engine.
   * A merge needs the opposite, and leaving an emptied country enumerated by
   * every site that walks the country list is how you get elections with no
   * regions and budgets over no states.
   *
   * A DATE-STAMPED FIELD rather than a new `CountryStatus` member on purpose:
   * `status` is read at 90-odd sites and widening its union risks silently
   * changing behaviour in code that switches on it. This is additive, and the
   * two enumeration chokepoints are the only readers.
   *
   * Retirement is not deletion. The documents stay for history, the wiki, and
   * any future restoration; the country simply stops being simulated.
   */
  dissolvedTurn?: number | null;
  /**
   * When true, non-admin players can view economy-only pages (map, metrics,
   * stockmarket, central bank, budget, forex) even while `enabledForPlayers`
   * is false. Political routes (elections, legislature, parties, etc.) remain
   * hidden. Used for phased country launches where the economy is live but
   * political gameplay hasn't opened yet.
   */
  economyPreview?: boolean;
  /** Turn the last automatic natural disaster fired for this country. */
  lastDisasterTurn?: number;
  /**
   * Set true by `detectPreIterationComplete` once this nation's one-off founding
   * (full-seating) election has resolved and its government has formed during a
   * pre-iteration reset. Used to detect when ALL in-scope nations are seated so
   * the pre-iteration can end. Absent/false on normal worlds. (The US uses the
   * global GameState, so its founding-resolution is tracked separately there.)
   */
  foundingCycleResolved?: boolean;
  /**
   * Last Tier-1 NPP strategic decision cycle claimed for this country (#3724).
   * Cycle index is `floor((turn - 1) / 6)`. Claim-before-act prevents a
   * restarted worker from double-firing the same six-hour bucket.
   */
  lastNppStrategicDecisionCycle?: number;
}

export type ActionType =
  | "fundraise"
  | "campaign"
  | "advertise"
  | "buildDonorBase"
  | "poll"
  | "pollLarge"
  | "convertCash"
  | "rest"
  | "debatePrep";

export interface ActionLog {
  _id: ObjectId;
  characterId: ObjectId;
  userId: ObjectId;
  actionType: ActionType;
  targetState?: string;
  actionCost: number;
  result: {
    success: boolean;
    fundsChange?: number;
    politicalInfluenceChange?: number;
    favorabilityChange?: number;
    infamyChange?: number;
    donorBaseLevelChange?: number;
    cashOnHandChange?: number;
    message: string;
  };
  turn: number;
  createdAt: Date;
  /** Denormalized identity (set at write time post-2026-05-31; backfilled on deletion). */
  characterName?: string;
  username?: string;
  countryId?: CountryId;
  /** Set when the owning character/account is deleted; row is retained, not purged. */
  characterDeletedAt?: Date;
}
