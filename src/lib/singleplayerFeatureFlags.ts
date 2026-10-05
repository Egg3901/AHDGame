import { DEFAULT_GAME_STATE_FLAGS } from "@/lib/seeds/reference/featureFlagDefaults";

type BooleanDefaultKey = {
  [K in keyof typeof DEFAULT_GAME_STATE_FLAGS]: (typeof DEFAULT_GAME_STATE_FLAGS)[K] extends boolean
    ? K
    : never;
}[keyof typeof DEFAULT_GAME_STATE_FLAGS];
export type SingleplayerFeatureFlagKey = Exclude<
  BooleanDefaultKey,
  "nppAutonomyEnabled" | "frontierEntryExperimentEnabled"
>;

export interface SingleplayerFeatureFlagOption {
  key: SingleplayerFeatureFlagKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

const LABELS: Record<SingleplayerFeatureFlagKey, string> = {
  forexEnabled: "Foreign exchange",
  playerRandomEventsEnabled: "Player random events",
  crisisInteractionEnabled: "Crisis decisions",
  autoDisastersEnabled: "Automatic crises and disasters",
  crisisAidBillsEnabled: "Crisis aid bills",
  rpgStatsEnabled: "Character stats",
  autoSectorSeedEnabled: "Automatic sector seeding",
  sectorTechTreesEnabled: "Sector technology trees",
  onboardingChecklistEnabled: "Onboarding checklist",
  worldEventsEnabled: "World events",
  legislationDemographicEffectsV2Enabled: "Legislation demographic effects",
  granularPollEnabled: "Granular polls",
  demographicsLayer1PositionsEnabled: "Detailed demographic positions",
  eraSystemEnabled: "Era progression",
  conflictsEnabled: "International conflicts",
  coldWarEnabled: "Cold War systems",
  redistrictingEnabled: "US House redistricting",
  subsidiaryCorporationsEnabled: "Subsidiary corporations",
  embargoTradeExposureEnabled: "Embargo trade exposure",
  liveElectionResultsEnabled: "Live election results",
  extractionAutoStrategyEnabled: "Extraction strategy automation",
  seasonRecapEnabled: "Season recap",
  corpDealsEnabled: "Corporate deals",
  intOrgAlignmentEnabled: "International alignment",
  nppCorpStrategyEnabled: "Autonomous corporate strategy",
  livingConflictsEnabled: "Living conflicts",
  nppOffensiveInitiationEnabled: "Autonomous offensive initiation",
  nppOffensiveJoinEnabled: "Autonomous offensive participation",
  intelligenceMilitarySabotageEnabled: "Military sabotage effects",
  nppIntelligenceOperationsEnabled: "Autonomous intelligence operations",
  granularElectorateEnabled: "Granular electorate",
  macroGrowthV1: "Macro growth convergence",
  settlementCrisisEnabled: "Settlement crises",
  departmentProgramSliceEnabled: "Department programs",
  departmentFinanceEnabled: "Department finance",
  lawAdministrationEnabled: "Law administration",
  regionalLegislationFinanceEnabled: "Regional legislation finance",
  canonicalPoliticalMetricsEnabled: "Canonical political metrics",
};

const descriptions: Partial<Record<SingleplayerFeatureFlagKey, string>> = {
  autoSectorSeedEnabled: "Periodically seed unowned sectors.",
  nppOffensiveInitiationEnabled: "Let autonomous countries start wars.",
  nppOffensiveJoinEnabled: "Let autonomous countries join offensives.",
};

/**
 * Boolean local-world controls, derived from the same defaults persisted by
 * setSingleplayerConfig. New defaults therefore cannot silently miss setup UI.
 */
export const SINGLEPLAYER_FEATURE_FLAGS: readonly SingleplayerFeatureFlagOption[] = Object.entries(
  DEFAULT_GAME_STATE_FLAGS
)
  .filter((entry): entry is [BooleanDefaultKey, boolean] => typeof entry[1] === "boolean")
  .filter(
    (entry): entry is [SingleplayerFeatureFlagKey, boolean] =>
      entry[0] !== "nppAutonomyEnabled" && entry[0] !== "frontierEntryExperimentEnabled"
  )
  .map(([key, defaultEnabled]) => ({
    key,
    label: LABELS[key],
    description: descriptions[key] ?? `Enable ${LABELS[key].toLowerCase()} in this local world.`,
    defaultEnabled,
  }));

export const DEFAULT_SINGLEPLAYER_FEATURE_FLAGS: Record<SingleplayerFeatureFlagKey, boolean> =
  Object.fromEntries(
    SINGLEPLAYER_FEATURE_FLAGS.map(({ key, defaultEnabled }) => [key, defaultEnabled])
  ) as Record<SingleplayerFeatureFlagKey, boolean>;
