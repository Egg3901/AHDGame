/**
 * gameConfig fields the corporation turn reads in its preamble. Kept apart
 * from the turn module so adding a flag does not push that file over the
 * architecture size limit.
 */
export const CORPORATION_TURN_GAME_CONFIG_PROJECTION = {
  marketSystemMode: 1,
  marketGovernorGlideStartTurn: 1,
  marketGovernorGlideTurns: 1,
  marketGovernorGlideMode: 1,
  marketGovernorGlideFloor: 1,
  extractionNoBuyerPhaseOutStartTurn: 1,
  placementRevenuePhaseStartTurn: 1,
  productLinesV2Enabled: 1,
  marketGovernorCap: 1,
  marketGovernorRampTurns: 1,
  brandLoyaltyEnabled: 1,
  brandLoyaltySliceEnabled: 1,
  sectorQualityEnabled: 1,
  qualityPremiumPricingEnabled: 1,
  politicalMediaMarketEnabled: 1,
  explicitPlantCostsEnabled: 1,
  commodityFixStage: 1,
  shortageBuildSpeedupEnabled: 1,
  supplyAgreementsEnabled: 1,
  groupSupplyCoordinationEnabled: 1,
  prospectingEnabled: 1,
  commandEconomyEnabled: 1,
  privateBankingEnabled: 1,
  bankUnderwritingEnabled: 1,
  interstateMoneyWiringEnabled: 1,
  freightSettlementMode: 1,
  canonicalFreightBillingEnabled: 1,
  treasuryCashLedgerEnabled: 1,
  mediaEditorialEnabled: 1,
  mediaOperatingModelsEnabled: 1,
  mediaRegulationEnabled: 1,
} as const;
