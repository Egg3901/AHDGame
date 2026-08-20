/**
 * Seed implementations for admin routes, CLI wrappers, and bootstrap.
 * Orchestration: `runSeed` (US reference core) + per-target helpers below.
 * See `docs/engineering/seed-bootstrap-call-graph.md` for admin seed vs setup vs bootstrap.
 */
export { runSeed, type RunSeedOptions } from "./runCoreSeed";
export { seedRegistrationLanes } from "./seedRegistrationLanes";
export { seedStates } from "./seedStates";
export { seedPolicies } from "./seedPolicies";
export { seedDemographics } from "./seedDemographics";
export { seedGameConfig } from "./seedGameConfig";
export { seedParties, seedStatePartyOrg } from "./seedParties";
export { seedRegionMetrics } from "./seedRegionMetrics";
export { seedLegislationTypes } from "./seedLegislationTypes";
export { seedAchievements } from "./seedAchievements";
export { seedForex } from "./seedForex";
export { seedCommodityPrices } from "./seedCommodityPrices";
export { seedUkLegislation } from "./seedUkLegislation";
export { seedStatePolicies } from "./seedStatePolicies";
export { seedBudgets } from "./seedBudgets";
export { seedUkBudgets } from "./seedUkBudgets";
export { seedJpBudgets } from "./seedJpBudgets";
export { seedSovereignBondInstruments } from "./seedSovereignBondInstruments";
export { seedSeats } from "./seedSeats";
export { seedPartyBudgets } from "./seedPartyBudgets";
export { seedUnownedSectors } from "./seedUnownedSectors";
export { seedUnions } from "./seedUnions";
export { seedScotus } from "@/lib/scotus/seedScotus";
export { seedStateResourceCapacity } from "./seedStateResourceCapacity";
export { seedStateSectorSpecializations } from "./seedStateSectorSpecializations";
export {
  seedIndexes,
  seedCoreIndexes,
  seedActivityIndexes,
  seedCabinetIndexes,
  seedPerfIndexes,
  seedSlowQueryIndexes,
  seedSearchIndexes,
  seedInternationalOrganizationIndexes,
  seedWriteGuardIndexes,
  seedPartyNppReworkIndexes,
  seedSovereignDefaultIndexes,
  seedObservabilityIndexes,
  seedFinancialTxLogIndexes,
  seedLedgerIndexes,
  seedCommodityPriceIndexes,
  seedIndexFundIndexes,
  seedApiAccessIndexes,
  seedSettlementIndexes,
} from "./seedIndexes";
export { seedCountyMapData } from "./seedMapData";
export {
  seedUKRegions,
  seedUKParties,
  seedUKDemographics,
  seedUKStatePartyOrg,
  seedUKStateMetrics,
  seedUKBaselines,
  removeLegacyUKCeremonialIdentity,
  seedUKRegionalCouncil,
  seedNIParties,
  seedUKElections,
  seedUKGovernors2020,
  seedUKGovernors1992,
} from "./seedUK";

export {
  seedJPRegions,
  seedJPParties,
  seedJPDemographics,
  seedJPStatePartyOrg,
  seedJPStateMetrics,
  seedJPBaselines,
  seedJPGovernmentFormation,
  removeLegacyJPCeremonialIdentity,
  seedJPGovernors2020,
  seedJPGovernors1991,
} from "./seedJP";

export {
  seedDERegions,
  seedDEParties,
  seedDEDemographics,
  seedDEStatePartyOrg,
  seedDEStateMetrics,
  seedDEBaselines,
  seedDEGovernmentFormation,
  seedDELegislation,
  seedDEElections,
  seedDEBundestag2021,
  seedDEMinisterPresidents2020,
} from "./seedDE";
export { seedDeBudgets } from "./seedDeBudgets";
export { seedInternationalOrganizations } from "./seedInternationalOrganizations";

export {
  seedIERegions,
  seedIEParties,
  seedIEDemographics,
  seedIEStatePartyOrg,
  seedIEStateMetrics,
  seedIEBaselines,
  seedIEGovernmentFormation,
  ensureMissingIEStatePartyOrgRows,
} from "./seedIE";
export { seedIeBudgets } from "./seedIeBudgets";

export {
  seedBRRegions,
  seedBRParties,
  seedBRDemographics,
  seedBRStatePartyOrg,
  seedBRStateMetrics,
  seedBRBaselines,
  seedBRGovernmentFormation,
} from "./seedBR";
export { seedBrBudgets } from "./seedBrBudgets";

export {
  seedCNRegions,
  seedCNParties,
  seedCNDemographics,
  seedCNStateMetrics,
  seedCNBaselines,
  seedCNGovernmentFormation,
  seedCnStatePartyOrg,
} from "./seedCN";
export { seedCnBudgets } from "./seedCnBudgets";
export { seedRuBudgets } from "./seedRuBudgets";
export { seedFrBudgets } from "./seedFrBudgets";
export { seedItBudgets } from "./seedItBudgets";
export { seedEsBudgets } from "./seedEsBudgets";
export { seedSeBudgets } from "./seedSeBudgets";
export { seedTrBudgets } from "./seedTrBudgets";
export { seedGrBudgets } from "./seedGrBudgets";
export { seedAtBudgets } from "./seedAtBudgets";
export { seedFiBudgets } from "./seedFiBudgets";
export { seedDdBudgets } from "./seedDdBudgets";
export { seedCNWiki } from "./seedCNWiki";
export { seedNGWiki } from "./seedNGWiki";

export {
  seedRURegions,
  seedRUParties,
  seedRUDemographics,
  seedRUStateMetrics,
  seedRUBaselines,
  seedRUGovernmentFormation,
} from "./seedRU";
export { seedRuStatePartyOrg } from "./seedRuStatePartyOrg";
export { seedDdStatePartyOrg } from "./seedDdStatePartyOrg";
export { seedEasternBlocStatePartyOrg } from "./seedEasternBlocStatePartyOrg";
export {
  seedFRRegions,
  seedFRParties,
  seedFRDemographics,
  seedFRStateMetrics,
  seedFRBaselines,
} from "./seedFR";
export {
  seedITRegions,
  seedITParties,
  seedITDemographics,
  seedITStateMetrics,
  seedITBaselines,
} from "./seedIT";
export {
  seedESRegions,
  seedESParties,
  seedESDemographics,
  seedESStateMetrics,
  seedESBaselines,
} from "./seedES";
export {
  seedSERegions,
  seedSEParties,
  seedSEDemographics,
  seedSEStateMetrics,
  seedSEBaselines,
} from "./seedSE";
export {
  seedTRRegions,
  seedTRParties,
  seedTRDemographics,
  seedTRStateMetrics,
  seedTRBaselines,
} from "./seedTR";
export {
  seedGRRegions,
  seedGRParties,
  seedGRDemographics,
  seedGRStateMetrics,
  seedGRBaselines,
} from "./seedGR";
export {
  seedATRegions,
  seedATParties,
  seedATDemographics,
  seedATStateMetrics,
  seedATBaselines,
} from "./seedAT";
export {
  seedFIRegions,
  seedFIParties,
  seedFIDemographics,
  seedFIStateMetrics,
  seedFIBaselines,
} from "./seedFI";
export {
  seedDDRegions,
  seedDDParties,
  seedDDDemographics,
  seedDDStateMetrics,
  seedDDBaselines,
  seedDDGovernmentFormation,
} from "./seedDD";

export {
  seedNGRegions,
  seedNGParties,
  seedNGDemographics,
  seedNGStatePartyOrg,
  seedNGStateMetrics,
  seedNGBaselines,
  seedNGGovernmentFormation,
  seedNGGovernors,
} from "./seedNG";
export { seedNgBudgets } from "./seedNgBudgets";
