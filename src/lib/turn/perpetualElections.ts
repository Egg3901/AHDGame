/**
 * Perpetual election spawning — re-export barrel.
 *
 * The implementation lives under `perpetualElections/` (#586). This file keeps
 * the module's public surface identical so its 18 importers are untouched, and
 * so a single-country calendar change is a small diff instead of one against a
 * 4,000-line module.
 *
 *   engine.ts    timers, canonical spawn, duplicate/stale cleanup, batched
 *                announcements, the GameState snapshot, and the
 *                `ensurePerpetualElections` orchestrator
 *   shared.ts    helpers used by more than one country: regional delegates,
 *                beta parliament/senate, seceded chambers, regional governors,
 *                peer-race timing, and the per-country liveness gates
 *   countries/   one module per country calendar. The Eastern-bloc,
 *                beta-parliament and UK-devolved schedulers are grouped,
 *                because each is a thin wrapper over a shared helper and a
 *                file per country would be nine one-line modules.
 *   registry.ts  `SPAWN_ELECTIONS_REGISTRY`, which fans out to the countries
 */

export {
  advanceElectionTimers,
  buildCanonicalSpawn,
  buildHouseSeatHealOps,
  cleanupDuplicateElections,
  cleanupStaleElectionCandidates,
  electionGameStateSnapshot,
  endTimeToLarpTurn,
  ensurePerpetualElections,
  getCurrentTurnAndCtx,
  getGeneralWindow,
  justResolvedInSameTurn,
  ngElectionsLive,
  readCurrentTurnAndCtx,
  sendBatchedElectionAnnouncements,
  withElectionGameStateSnapshot,
} from "./perpetualElections/engine";
export type { TurnAndCtx } from "./perpetualElections/engine";
export {
  IE_LOCAL_COUNCIL_SEATS,
  SCO_REGIONAL_COUNCIL_SEATS,
  UK_GOVERNOR_REGIONS,
  WAL_REGIONAL_COUNCIL_SEATS,
  buildDelegateSeatHealOps,
  countryElectionsLive,
  ddElectionsLive,
  easternBlocElectionsLive,
  ensureBetaParliamentElections,
  ensureBetaSenateElections,
  ensureEasternBlocAssemblyElections,
  ensurePresidentialElection,
  ensureRegionalDelegateElections,
  ensureRegionalGovernorElections,
  ensureSecededChamberElections,
  mirrorPeerRaceTiming,
  ruElectionsLive,
  seatsFromRegionField,
} from "./perpetualElections/shared";
export type { RegionalDelegateSpec } from "./perpetualElections/shared";
export {
  ensureATElections,
  ensureESElections,
  ensureESSenateElections,
  ensureFIElections,
  ensureFRElections,
  ensureFRSenateElections,
  ensureGRElections,
  ensureITElections,
  ensureITSenateElections,
  ensureSEElections,
  ensureTRElections,
  ensureTRSenateElections,
} from "./perpetualElections/countries/betaParliaments";
export { ensureBRElections, ensureBRSenateElections } from "./perpetualElections/countries/br";
export {
  ensureCNElections,
  ensureCNGovernorElections,
  ensureCNPeoplesCongressElections,
} from "./perpetualElections/countries/cn";
export {
  ensureDDGovernorElections,
  ensureDDLandAssemblyElections,
  ensureDDVolkskammerElections,
} from "./perpetualElections/countries/dd";
export { ensureDEElections } from "./perpetualElections/countries/de";
export {
  ensureBALElections,
  ensureBGElections,
  ensureBLRElections,
  ensureCSElections,
  ensureHUElections,
  ensurePLElections,
  ensureROElections,
  ensureUKRElections,
  ensureYUElections,
} from "./perpetualElections/countries/easternBloc";
export {
  ensureIECathaoirleachElections,
  ensureIEElections,
  ensureIELocalCouncilElections,
  ensureIEUachtaranElections,
} from "./perpetualElections/countries/ie";
export {
  ensureJPCouncillorElections,
  ensureJPElections,
  ensureJPGovernorElections,
  ensureJPRegionalCouncilElections,
} from "./perpetualElections/countries/jp";
export {
  ensureNGElections,
  ensureNGGovernorElections,
  ensureNGPresidentialElection,
  ensureNGRegionalCouncilElections,
  ensureNGSenateElections,
  ensureNGZoneElections,
} from "./perpetualElections/countries/ng";
export {
  ensureRUGovernorElections,
  ensureRUNationalitiesElections,
  ensureRURepublicSovietElections,
  ensureRUSupremeSovietElections,
} from "./perpetualElections/countries/ru";
export {
  ensureUKElections,
  ensureUKGovernorElections,
  ensureUKRegionalCouncilElections,
} from "./perpetualElections/countries/uk";
export {
  ensureSCOElections,
  ensureSCOGovernorElections,
  ensureSCORegionalCouncilElections,
  ensureWALElections,
  ensureWALGovernorElections,
  ensureWALRegionalCouncilElections,
} from "./perpetualElections/countries/ukDevolved";
export { SPAWN_ELECTIONS_REGISTRY } from "./perpetualElections/registry";
export type { SpawnElectionsHandler, SpawnElectionsResult } from "./perpetualElections/registry";

// The DE Landtag/Minister-President spawners live in `election/germanyLandtag`;
// the original module re-exported them here for countryPhases.ts's barrel import.
export {
  ensureDELandtagElections,
  ensureDEMinisterPresidentElections,
} from "@/lib/turn/election/germanyLandtag";

// Re-exported so existing consumers (sync-date, snapElection, admin routes)
// that import DEFAULT_DURATIONS from this module keep working.
export { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
