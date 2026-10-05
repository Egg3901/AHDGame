import type { GameConfig } from "@/lib/db/types";
import { FRESH_WORLD_GAME_CONFIG_FLAGS } from "./featureFlagDefaults";

export const gameConfig: GameConfig = {
  _id: "default",

  // Starting resources for new characters
  startingFunds: 250000,
  startingActions: 25,
  startingFavorability: 50,
  startingInfamy: 0,
  startingPoliticalInfluence: 0,
  startingDonorBaseLevel: 1,

  // Turn system
  baseActionsPerTurn: 4,
  turnLengthMinutes: 60, // 1 hour turns

  // Office action bonuses per elected office type across all countries.
  // Chair of the central bank is tracked separately via `chairActionBonus`
  // because the role lives on `centralBanks`, not on `character.currentOffice`.
  officeActionBonus: {
    // US
    house: 1,
    senate: 2,
    stateSenate: 1,
    governor: 2,
    president: 4,
    vicePresident: 2,
    // UK
    commons: 1,
    primeMinister: 4,
    regionalCouncil: 1,
    // CA
    premier: 2,
    // DE
    bundestag: 1,
    bundesrat: 2,
    chancellor: 4,
    ministerPresident: 2,
    landtag: 1,
    // JP
    sangiin: 1,
    shugiin: 1,
    // CN
    npcDelegate: 1,
    peoplesCongress: 1,
    // Cabinet bonuses stack ON TOP of the holder's legislative seat (see
    // resolveOfficeActionBonus) — appointment overwrites currentOffice with the
    // cabinet key, so the seat is recovered from electedOfficials.
    // Parliamentary systems: DE, IE, JP.
    parliamentaryCabinet: 1,
    // UK cabinet
    ukCabinet: 1,
    // US cabinet (no legislative seat — Constitution bars dual service)
    usCabinet: 1,
  },
  chairActionBonus: 3,
  partyInfluencePoolMultiplier: 3,
  partyInfluenceMaxBonus: 6,

  // Admin registration is open on a fresh seed so the first admin can sign up
  // with ADMIN_REGISTRATION_KEY. Disable from the admin dashboard once filled.
  adminRegistrationEnabled: true,

  // Fresh-world gameplay flags: every gate on and every rollout ladder at its
  // top, per the policy in featureFlagDefaults.ts.
  ...FRESH_WORLD_GAME_CONFIG_FLAGS,
  // The rollout start turn is filled by the startup migration or the first
  // economy turn. Keeping the object present makes the feature explicit while
  // preserving the live world's exact start point.
  centralBankPricingPhaseIn: {},

  // Non-gameplay switches (see NON_GAMEPLAY_GAME_CONFIG_FIELDS for reasons).
  // Market launch guard: an automated safety kill switch, armed by default.
  marketGuardEnabled: true,
  // Era-derived: bootstrapGameWorld overwrites this from the preset.
  commandEconomyEnabled: true,
  // Superseded by householdConsumptionEnabled; enabling both double-counts
  // consumer demand.
  demographicsDemandEnabled: false,
  // Shadow double-entry ledger: observe-only reconciliation, never changes a
  // balance.
  ledgerShadow: true,
};

export default gameConfig;
