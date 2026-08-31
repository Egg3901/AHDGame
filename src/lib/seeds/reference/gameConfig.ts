import type { GameConfig } from "@/lib/db/types";

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

  // NPP economy, line of credit, and index funds are core systems — on by
  // default for every fresh world (no longer admin-gated). Index funds boot to
  // "full" mode; bootstrapGameWorld runs the fund-definition migrations so the
  // fund docs exist alongside this flag.
  nppEconomyEnabled: true,
  lineOfCreditEnabled: true,
  moneySupplyEnabled: true,
  indexFundsMode: "full",

  // Fresh worlds boot at the TOP of every rollout ladder (owner decision,
  // 2026-07-27; market ladder raised to "plants" 2026-08-08). Previously
  // `wages`/`ledger` left three whole tiers inert: union membership pressure is
  // only read at labour `full`, and brand loyalty plus quality-premium pricing
  // only accrue at market `clearing` or above — so a default world silently ran
  // with systems that existed but could never fire. Admins can still dial any
  // of these down per world. The "one-way" caution around the plants flip
  // (scripts/ops/plantsPreflight.ts) governs migrating a LIVE legacy economy; a
  // fresh world has no legacy revenue to rebase, so it does not apply here.
  labourSystemMode: "full",
  marketSystemMode: "plants",
  // Freight routes are observable from a fresh world, but the economic effect
  // requires an explicit, separately-soaked rollout.
  freightSettlementMode: "shadow",
  // Canonical freight billing (issue #897) ships dark: turning it on is a
  // balance change (a world-scale shipping bill becomes real money) and
  // requires a simulation report per CONTRIBUTING.md before any world enables it.
  canonicalFreightBillingEnabled: false,
  shortageResponsiveSourcingEnabled: false,
  indexFundBondLiquidityEnabled: false,
  nppMarketCoverageEnabled: false,
  nppFragileMarketSupplyEnabled: false,
  regionalConditionsOverviewEnabled: true,

  // Market launch guard: armed by default now that the market boots at the top
  // tier. It measures drawdown against what fundamentals justify, so an honest
  // monetary repricing no longer trips it — only a genuine decoupling of price
  // from value does.
  marketGuardEnabled: true,

  // Command economies (USSR, DDR, command-era China) modelled as planned rather
  // than market economies. Fail-safe in code, so this seed value is what turns
  // it on for a fresh world; without it every planned economy silently fell
  // through to the market path and its state enterprises were never simulated.
  commandEconomyEnabled: true,

  // Sovereignty transitions (decolonization). Safe as a default because the
  // phase carries its own era ceiling — a modern-preset world is a no-op even
  // with the flag on, so this only bites in worlds actually inside the era.
  worldTransitionsEnabled: true,

  // Bretton Woods exit. Inert until a world's in-game year reaches the gold
  // -cover pressure window (earliest 1968), so it costs a modern world nothing.
  brettonWoodsExitEnabled: true,

  // Structural-market and economy subsystems that were previously only ever
  // switched on by the sim harness.
  extractionOutputScaleEnabled: true,
  commodityScarcityDriftEnabled: true,
  qualityPremiumPricingEnabled: true,
  sectorQualityEnabled: true,
  stockCoverCapEnabled: true,
  supplyAgreementsEnabled: true,
  contractIssuanceEnabled: true,
  prospectingEnabled: true,
  brandLoyaltyEnabled: true,
  brandLoyaltySliceEnabled: true,
  nppCorporateAttacksEnabled: true,

  // Consumer demand: household consumption SUPERSEDES the demographics uplift
  // and the two must never both be on (nothing enforces it in code — the two
  // reads in commodityPriceTurn are independent ifs with no else, so enabling
  // both stacks a demographics uplift on a household basket at a size neither
  // model was calibrated for).
  householdConsumptionEnabled: true,
  demographicsDemandEnabled: false,

  // Shadow double-entry ledger runs in fresh worlds (owner decision
  // 2026-08-08: feature flags default ON except ops/maintenance and the sector
  // auto-seed). It was previously held dark pending a prod observe-mode week;
  // the sim harness (scripts/sim/runWorld.ts) has been the acceptance test bed.
  // Observe-only by construction — it never changes a balance. See the
  // shadow-ledger plan.
  ledgerShadow: true,

  // NPP corporations can be targeted by corporate attacks, per the same
  // flags-default-on rule; admins can still dial it down per world.
  nppCorpsAttackable: true,

  // First member to join a party with no chair becomes chair (can be turned off on admin dashboard).
  firstJoinerBecomesPartyChair: true,
};

export default gameConfig;
