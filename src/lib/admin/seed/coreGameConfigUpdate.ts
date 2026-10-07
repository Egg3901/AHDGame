import type { UpdateFilter } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import { gameConfig } from "@/lib/seeds/reference/gameConfig";
import { playerInvestmentBankingSeedFlags } from "@/lib/banking/rules/charterAccess";
import { splitFreshWorldGameConfigFlags } from "@/lib/seeds/reference/featureFlagDefaults";

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

/**
 * Per-world state the turn engine, admin routes and rollout scripts stamp onto
 * `gameConfig`, cleared on reset.
 *
 * `gameConfig` is never dropped (see RESET_DROP_COLLECTIONS in runCoreSeed.ts),
 * so anything anchored to the outgoing world's turn counter outlives it unless
 * it is listed here. A fresh seed never writes any of these keys, so absent is
 * exactly the state a new world starts from. Measured on a world reset at turn
 * 1329: `retailDemandTransitionStartTurn: 514` kept Retail capacity frozen until
 * turn 706, and `commodityNominalPriceIndex: 1.957` divided every commodity
 * price ratio from turn 2 because the index never re-anchors backwards.
 *
 * Same shape and rationale as `STALE_PROGRESS_GAME_STATE_UNSET` on `gameState`:
 * an explicit `$unset` list, not a blanket drop, so the operational fields
 * beside them survive. Every turn-anchored GameConfig field is either listed
 * here or in TURN_ANCHORED_GAME_CONFIG_KEPT, enforced by
 * coreGameConfigUpdate.test.ts. ⚠️ The market-guard *configuration* knobs
 * (`marketGuardEnabled`, `marketGuardDropPct`, `marketGuardGraceTurns`) are
 * admin settings, not per-world state, and must NOT be listed here.
 */
export const STALE_PER_WORLD_GAME_CONFIG_UNSET: Readonly<Record<string, "">> = Object.freeze({
  // Launch guard reference (src/lib/market/launchGuard.ts): a new market's
  // drawdown must not be measured against the dead world's valuation.
  marketGuardReferenceMcap: "",
  marketGuardReferenceFundamentalMcap: "",
  marketGuardReferenceTurn: "",
  marketGuardTrippedAt: "",
  // Conserved sovereign financing (#3381) is an explicit per-world opt-in, not
  // a fresh-world default: it is qualified for no seed preset yet. A reset must
  // not carry the outgoing world's opt-in into the new world.
  conservedSovereignFinancingEnabled: "",
  // Retail demand unwind window (src/lib/market/retailDemandTransition.ts).
  // Capacity expansion is refused until start + turns.
  retailDemandTransitionStartTurn: "",
  retailDemandTransitionTurns: "",
  // Shared nominal commodity index. advanceCommodityNominalIndex clamps the
  // last turn to the current one, so a stale index is never re-based.
  commodityNominalPriceIndex: "",
  commodityNominalPriceIndexTurn: "",
  // Activation record left by the retired economy market program rollout.
  economyMarketProgramActivatedAt: "",
  economyMarketProgramActivatedBy: "",
  economyMarketProgramActivatedTurn: "",
  economyMarketProgramActivatedCommit: "",
  // Freight rollout provenance and ramp. A ramp start past the new turn holds
  // the active freight effect at zero (src/lib/logistics/settlement.ts).
  freightSettlementModeUpdatedBy: "",
  freightSettlementModeUpdatedAt: "",
  freightSettlementModeUpdatedTurn: "",
  freightSettlementRampStartTurn: "",
  freightSettlementRampTurns: "",
  // Governance plans whose start and review turns belong to the old world. The
  // admin routes refuse to re-enable against a plan that starts in the future.
  freightSettlementIntervention: "",
  shortageResponsiveSourcingIntervention: "",
  indexFundBondLiquidityIntervention: "",
  equityLiquidityFacilityIntervention: "",
  nppMarketCoverageIntervention: "",
  nppFragileMarketSupplyIntervention: "",
  // Construction finance admissions name loans the runtime sweep deleted; a
  // stale closing latch would block construction finance for the whole world.
  bankConstructionAdmissions: "",
  bankConstructionAdmissionClosing: "",
  bankConstructionAdmissionClosingToken: "",
});

/**
 * Turn-shaped GameConfig fields that a reset deliberately does NOT unset, and why.
 * Paired with STALE_PER_WORLD_GAME_CONFIG_UNSET so a new turn-anchored field
 * cannot ship without a decision.
 */
export const TURN_ANCHORED_GAME_CONFIG_KEPT: Readonly<Record<string, string>> = Object.freeze({
  baseActionsPerTurn: "economy setting, rewritten from the reference config by the core seed",
  marketGovernorRampTurns: "admin tuning knob (a duration, not an anchor)",
  marketGuardGraceTurns: "admin tuning knob (a duration, not an anchor)",
  centralBankPricingPhaseIn:
    "rewritten to {} from the reference config by the core seed; the engine restamps it on the first economy turn",
  marketSystemModeUpdatedTurn: "cleared by STALE_MARKET_MODE_STAMP_UNSET with the tier provenance",
});

/**
 * Configuration writes shared by core reset and non-destructive seed top-ups.
 *
 * A reset is a fresh world, so it writes the full fresh-world flag preset. A
 * top-up writes flag and switch fields only on insertion: it must never flip a
 * gate on a running world, in either direction.
 */
export function coreGameConfigUpdate(reset: boolean, seedYear: number): UpdateFilter<GameConfig> {
  const { settings, flags } = splitFreshWorldGameConfigFlags(gameConfig);
  const investmentBanking = playerInvestmentBankingSeedFlags(seedYear);
  return reset
    ? {
        $set: { ...settings, ...flags, ...investmentBanking, seedYear },
        $unset: STALE_MARKET_MODE_STAMP_UNSET,
      }
    : {
        $set: { ...settings, seedYear },
        $setOnInsert: { ...flags, ...investmentBanking },
      };
}
