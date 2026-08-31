import type { GameState } from "@/lib/db/types/gameState";

/**
 * Feature flags that ship ON for every fresh world. Mirrors the production
 * posture (2026-07): these systems have all been live on prod long enough to
 * be considered core, so new seeds start with them instead of a bare world an
 * admin has to hand-toggle after every reset.
 *
 * The full feature set ships ON for fresh worlds. The deliberate exceptions:
 *   - `autoSectorSeedEnabled` — the only feature toggle shipped OFF by owner
 *     decision (see below): the 48-turn automatic sector reseed favours the
 *     state corp over private/spun-out corps (#2926) and re-seeds a world an
 *     admin may have deliberately shaped.
 *   - `eurozoneEnabled` — NOT force-defaulted here: era-derived, seedForex sets
 *     it per preset (the euro didn't exist pre-1999).
 *   - `demographicsDemandEnabled` (gameConfig) — stays OFF: mutually exclusive
 *     with `householdConsumptionEnabled` (on); enabling both double-counts
 *     consumer demand.
 *   - `fastMode` (turn cadence, not a feature), `ledgerShadow` (internal shadow
 *     reconciliation), and the ops/security switches (testMode, IP detection,
 *     audit log, alt scoring, registration gates) are not gameplay features.
 *
 * Applied in two places:
 *   - `initializeGameState` — baked into the very first gameState doc.
 *   - `resetGameWorld` — fills in only flags that are absent on the existing
 *     doc, so an explicit admin choice (including an explicit `false`)
 *     survives a reset.
 */
export const DEFAULT_GAME_STATE_FLAGS = {
  forexEnabled: true,
  playerRandomEventsEnabled: true,
  crisisInteractionEnabled: true,
  autoDisastersEnabled: true,
  crisisAidBillsEnabled: true,
  rpgStatsEnabled: true,
  // Shipped OFF for fresh worlds: the 48-turn automatic sector reseed favours
  // the state corp over private/spun-out corps (#2926) and re-seeds a world an
  // admin (or the game-start seeder) has deliberately shaped. This is the one
  // feature toggle we hold off by default; every other gameplay flag is on.
  autoSectorSeedEnabled: false,
  sectorTechTreesEnabled: true,
  onboardingChecklistEnabled: true,
  // Top of the autonomy ladder. v0 seated NPPs but left them economically
  // passive; v4 is player-parity plus global economic behaviour, which is what
  // makes an NPP-run country behave like a real economy — and whatever NPPs
  // cannot do, players will find broken too.
  nppAutonomyLevel: "v4",
  // Kept in sync with nppAutonomyLevel for legacy readers.
  nppAutonomyEnabled: true,
  // Autonomous diplomacy ships active at its safest rollout stage. Countries
  // can cast scored organization votes, while proposals, trade, support, and
  // war remain unavailable until an admin advances the stage.
  nppForeignPolicyMode: "active",
  nppForeignPolicyStage: "votes",
  // World Events v1 (plan-world-events-v1) — validated via worldsim A/B in
  // Phase 4 (approval/treasury bounded, sectorDemandModifier stacking capped
  // below market-clearing sensitivity). Seed-on for fresh worlds only; this
  // does NOT flip the flag on any existing/live world (see
  // missingGameStateFlagDefaults below).
  worldEventsEnabled: true,
  // Legislation → demographics v2: lean/turnout DemographicEffect targets.
  // Runtime helper is fail-closed (absent = off) so existing worlds stay on
  // the legacy population-only channel until an admin flips the gate.
  legislationDemographicEffectsV2Enabled: true,
  // Granular poll breakdowns: cross-product Layer-1 electorate cells attached
  // to poll results. Default on for new worlds; additive to existing poll math.
  granularPollEnabled: true,
  // Layer-1 positions drive archetype econ/social derivation at seed/reseed
  // (deriveGroupLeanFromLayer1) instead of the legacy ideology-net path.
  // Default on for new worlds (1953-sim validation branch).
  demographicsLayer1PositionsEnabled: true,
  // Era/preset cost system: era-scaled legislation costs + potential growth.
  // Without this a fresh world silently runs the legacy per-country anchor
  // path regardless of preset. Default on for new worlds.
  eraSystemEnabled: true,
  // Granular-cell electorate engine: election vote shares computed over
  // IPF-raked Layer-1 cells instead of the 12 archetypes. Default ON for new
  // worlds on this 1953-sim validation branch; fail-closed at runtime, so
  // flag-off (existing worlds) stays byte-identical legacy behavior.
  // Remaining staged-rollout systems — flipped default-on (2026-07-20, product
  // decision: fresh worlds get the full feature set). NOTE: eurozoneEnabled is
  // intentionally NOT defaulted here — it is era-derived (seedForex sets it
  // false for pre-1999 presets; the euro didn't exist), not a feature toggle.
  conflictsEnabled: true,
  coldWarEnabled: true,
  redistrictingEnabled: true,
  subsidiaryCorporationsEnabled: true,
  embargoTradeExposureEnabled: true,
  liveElectionResultsEnabled: true,
  extractionAutoStrategyEnabled: true,
  // Existing and fresh worlds start by recording decisions only. Promotion to
  // enforce is an explicit admin action after the observation gate passes.
  nppEntryViabilityMode: "observe",
  seasonRecapEnabled: true,
  // Corporate M&A / deal-making subsystem (agreed corp-to-corp acquisitions).
  // Runtime helper is fail-closed (absent = off); default on for fresh worlds.
  corpDealsEnabled: true,
  // International-organisation alignment. Staged rollout, fail-closed at
  // runtime; default on for fresh worlds so the full feature set ships.
  intOrgAlignmentEnabled: true,
  nppCorpStrategyEnabled: true,
  // Release 1.3 living-conflict campaigns. The engine is in the turn loop and
  // fresh worlds start on the persistent global-response system.
  livingConflictsEnabled: true,
} as const satisfies Partial<GameState>;

export type DefaultGameStateFlagKey = keyof typeof DEFAULT_GAME_STATE_FLAGS;

/**
 * Subset of DEFAULT_GAME_STATE_FLAGS that is missing (undefined) on `existing`.
 * The NPP-autonomy pair is treated as one flag: if either the level or the
 * legacy boolean has been set, neither default is applied — a legacy explicit
 * `nppAutonomyEnabled: false` must not be resurrected to "v0" by a reset.
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
