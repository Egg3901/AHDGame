import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GameState } from "@/lib/db/types/gameState";

/**
 * Fresh-world feature flag policy.
 *
 * Standing rule: every fresh world (first bootstrap or a reset) starts with
 * EVERY gameplay feature flag ON, at the top of every rollout ladder, with one
 * exclusion: NPP autonomy stays at v4 rather than v5 (see
 * FRESH_WORLD_FLAG_EXCLUSIONS). The two presets below are that policy, one per
 * document the flags live on.
 *
 * Fields that look like flags but are not gameplay features (ops kill switches,
 * maintenance and access gates, security tooling, sim-only harness switches,
 * runtime state, era-derived values, deprecated aliases, superseded
 * alternatives) are listed in NON_GAMEPLAY_GAME_STATE_FIELDS and
 * NON_GAMEPLAY_GAME_CONFIG_FIELDS with the reason each keeps its own default.
 * featureFlagDefaults.test.ts reads the GameState and GameConfig types and fails
 * when a flag field is in none of these lists, so a new flag cannot ship
 * without either being on for fresh worlds or carrying a recorded exclusion.
 *
 * Applied by:
 *   - `initializeGameState` (first gameState doc) and `resetGameWorld` (every
 *     reset) for the gameState preset;
 *   - the reference gameConfig (`seeds/reference/gameConfig.ts`), written by
 *     the core seed, plus `resetGameWorld` for the gameConfig preset.
 *
 * Existing running worlds are never flipped by this policy. Non-reset seed
 * top-ups write these keys with `$setOnInsert` only, and the startup
 * migration that adopts reference gates leaves them alone past a world's first
 * game day.
 */

/** Gameplay flags held below their maximum on fresh worlds, and why. */
export const FRESH_WORLD_FLAG_EXCLUSIONS = {
  nppAutonomyLevel: {
    value: "v4",
    reason:
      "NPP v5 (persistent governing goals) is the one owner-excluded flag. Fresh worlds seed v4, the top of the ladder below v5.",
  },
} as const;

export const DEFAULT_GAME_STATE_FLAGS = {
  forexEnabled: true,
  playerRandomEventsEnabled: true,
  crisisInteractionEnabled: true,
  autoDisastersEnabled: true,
  crisisAidBillsEnabled: true,
  rpgStatsEnabled: true,
  autoSectorSeedEnabled: true,
  sectorTechTreesEnabled: true,
  onboardingChecklistEnabled: true,
  nppAutonomyLevel: FRESH_WORLD_FLAG_EXCLUSIONS.nppAutonomyLevel.value,
  // Kept in sync with nppAutonomyLevel for legacy readers.
  nppAutonomyEnabled: true,
  nppForeignPolicyMode: "active",
  nppForeignPolicyStage: "war",
  nppOffensiveInitiationEnabled: true,
  nppOffensiveJoinEnabled: true,
  intelligenceMilitarySabotageEnabled: true,
  nppIntelligenceOperationsEnabled: true,
  worldEventsEnabled: true,
  legislationDemographicEffectsV2Enabled: true,
  granularPollEnabled: true,
  granularElectorateEnabled: true,
  demographicsLayer1PositionsEnabled: true,
  eraSystemEnabled: true,
  macroGrowthV1: true,
  conflictsEnabled: true,
  livingConflictsEnabled: true,
  coldWarEnabled: true,
  settlementCrisisEnabled: true,
  redistrictingEnabled: true,
  subsidiaryCorporationsEnabled: true,
  embargoTradeExposureEnabled: true,
  liveElectionResultsEnabled: true,
  extractionAutoStrategyEnabled: true,
  nppEntryViabilityMode: "enforce",
  frontierEntryExperimentEnabled: true,
  seasonRecapEnabled: true,
  corpDealsEnabled: true,
  intOrgAlignmentEnabled: true,
  nppCorpStrategyEnabled: true,
} as const satisfies Partial<GameState>;

export type DefaultGameStateFlagKey = keyof typeof DEFAULT_GAME_STATE_FLAGS;

/** Gameplay gates and rollout modes on `gameConfig` for every fresh world. */
export const FRESH_WORLD_GAME_CONFIG_FLAGS = {
  nppEconomyEnabled: true,
  nppCorpsAttackable: true,
  nppCorporateAttacksEnabled: true,
  nppFundRedemptionEnabled: true,
  nppMarketCoverageEnabled: true,
  nppFragileMarketSupplyEnabled: true,
  lineOfCreditEnabled: true,
  moneySupplyEnabled: true,
  indexFundsMode: "full",
  indexFundBondLiquidityEnabled: true,
  equityLiquidityFacilityEnabled: true,
  playerFundSponsorshipEnabled: true,
  labourSystemMode: "full",
  marketSystemMode: "plants",
  freightSettlementMode: "active",
  canonicalFreightBillingEnabled: true,
  interstateMoneyWiringEnabled: true,
  shortageResponsiveSourcingEnabled: true,
  commodityScarcityDriftEnabled: true,
  stockCoverCapEnabled: true,
  extractionOutputScaleEnabled: true,
  qualityPremiumPricingEnabled: true,
  sectorQualityEnabled: true,
  brandLoyaltyEnabled: true,
  brandLoyaltySliceEnabled: true,
  supplyAgreementsEnabled: true,
  explicitPlantCostsEnabled: true,
  householdConsumptionEnabled: true,
  productLinesV2Enabled: true,
  mediaProductSlatesEnabled: true,
  mediaEditorialEnabled: true,
  mediaOperatingModelsEnabled: true,
  mediaRegulationEnabled: true,
  politicalMediaMarketEnabled: true,
  privateBankingEnabled: true,
  playerAdvancedBankChartersEnabled: true,
  bankPropTradingEnabled: true,
  bankPropForexFeesEnabled: true,
  bankTreasuryEnabled: true,
  bankSovereignPrimaryEnabled: true,
  bankUnderwritingEnabled: true,
  bankContagionEnabled: true,
  bankFailurePoliticsEnabled: true,
  bankConstructionFinanceEnabled: true,
  treasuryCashLedgerEnabled: true,
  sovereignIssuanceConsolidationEnabled: true,
  domesticSovereignBondCoverageEnabled: true,
  worldTransitionsEnabled: true,
  brettonWoodsExitEnabled: true,
  prospectingEnabled: true,
  contractIssuanceEnabled: true,
  campaignEraPriceLevelEnabled: true,
  regionalConditionsOverviewEnabled: true,
  firstJoinerBecomesPartyChair: true,
} as const satisfies Partial<GameConfig>;

export type FreshWorldGameConfigFlagKey = keyof typeof FRESH_WORLD_GAME_CONFIG_FLAGS;

/** gameState fields shaped like flags that this policy deliberately does not set. */
export const NON_GAMEPLAY_GAME_STATE_FIELDS: Readonly<Record<string, string>> = {
  isActive: "runtime state: the turn cron runs only after an admin starts the world",
  isProcessing: "runtime state: turn lock",
  startingPartiesMode: "reset option chosen per reset, not a feature",
  wikiDisabled: "ops access gate for the wiki",
  corporationActionsPaused: "ops kill switch for corporate actions",
  playerTransfersPaused: "ops kill switch for player transfers",
  defenceProcurementPaused: "ops kill switch for defence procurement",
  autoCrisisPaused: "ops pause switch; the crisis system itself is on",
  freePartyMovesOpen: "launch window state opened and closed by an admin",
  fastMode: "turn cadence, not a feature",
  eurozoneEnabled: "era-derived: seedForex sets it per preset (no euro before 1999)",
};

/** gameConfig fields shaped like flags that this policy deliberately does not set. */
export const NON_GAMEPLAY_GAME_CONFIG_FIELDS: Readonly<Record<string, string>> = {
  maintenanceMode: "ops maintenance switch",
  pollBannerEnabled: "ops announcement banner",
  publicReviewMode: "ops access gate for anonymous page reads",
  publicViewingMode: "ops access gate for anonymous API reads",
  testMode: "ops registration gate",
  adminRegistrationEnabled: "security: admin registration side channel",
  registrationEnabled: "ops kill switch for new registrations",
  ipCollisionCheckEnabled: "security tooling",
  ipDetectionEnabled: "security tooling (third-party IP lookups)",
  auditLog: "security forensics tooling",
  altScoringEnabled: "security forensics tooling",
  marketGuardEnabled: "automated safety kill switch; keeps its reference default (armed)",
  ledgerShadow: "internal reconciliation observer; keeps its reference default (on)",
  simSandbox: "sim harness only, never set on a hosted world",
  simTurnPhaseMode: "sim harness only, never set on a hosted world",
  bankConstructionAdmissionClosing: "runtime state: admission close latch",
  savingsAccountsMode:
    "storage migration (legacy fields to account rows) driven cohort by cohort from the banking rollout route, not a gameplay feature",
  indexFundsEnabled: "deprecated alias of indexFundsMode",
  commandEconomyEnabled:
    "era-derived: bootstrap sets it from the preset (on for 1953 and 1979 command regimes)",
  demographicsDemandEnabled:
    "superseded alternative to householdConsumptionEnabled; enabling both double-counts consumer demand",
};

/**
 * Subset of DEFAULT_GAME_STATE_FLAGS that is missing (undefined) on `existing`.
 * Used by sim tooling that replays existing-world upgrades; a reset applies the
 * full preset instead. The NPP-autonomy pair is treated as one flag: if either
 * the level or the legacy boolean has been set, neither default is applied.
 */
export function missingGameStateFlagDefaults(
  existing: Partial<GameState> | null | undefined
): Partial<GameState> {
  const out: Record<string, unknown> = {};
  const nppTouched =
    existing?.nppAutonomyLevel !== undefined || existing?.nppAutonomyEnabled !== undefined;
  for (const [key, value] of Object.entries(DEFAULT_GAME_STATE_FLAGS)) {
    if (key === "nppAutonomyLevel" || key === "nppAutonomyEnabled") {
      if (!nppTouched) out[key] = value;
      continue;
    }
    if (existing?.[key as keyof GameState] === undefined) out[key] = value;
  }
  return out as Partial<GameState>;
}

/**
 * Split a gameConfig update into fields every seed run may write and the
 * fresh-world flag fields, which a non-reset top-up must only insert so it
 * never flips a running world.
 */
export function splitFreshWorldGameConfigFlags<T extends Record<string, unknown>>(
  config: T
): { settings: Record<string, unknown>; flags: Record<string, unknown> } {
  const settings: Record<string, unknown> = {};
  const flags: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key in FRESH_WORLD_GAME_CONFIG_FLAGS || key in NON_GAMEPLAY_GAME_CONFIG_FIELDS) {
      flags[key] = value;
    } else {
      settings[key] = value;
    }
  }
  return { settings, flags };
}
