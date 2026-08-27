import type { ObjectId } from "mongodb";
import type { TurnPhaseTelemetryMap } from "./turnPhaseTelemetry";
import type { GameIteration } from "./gameState";

/**
 * Verbose turn processing log stored every hour.
 * TTL index auto-deletes after 24 hours.
 */
export interface TurnLog {
  _id: ObjectId;
  turn: number;
  year: number;
  /** Iteration marker used to keep turn-log repair scoped to the current world. */
  iteration?: GameIteration;
  gameTime: Date;
  realTime: Date;
  durationMs: number;
  success: boolean;
  warnings: string[];
  phaseStatuses?: TurnPhaseTelemetryMap;

  phases: {
    actionRefresh: {
      charactersProcessed: number;
      totalActionsGranted: number;
    } | null;

    caucusTax?: {
      caucusesProcessed: number;
      membersTaxed: number;
      totalTaxed: number;
    } | null;

    fundGeneration: {
      charactersProcessed: number;
      totalGenerated: number;
      bySource: Record<string, number>;
    } | null;

    lineOfCreditTurn: {
      charactersProcessed: number;
      paymentsInternal: number;
    } | null;

    turnoutProcessing: {
      statesDecayed: number;
      gotvBudgetsProcessed: number;
      canvassingProcessed: number;
    } | null;

    partyElections: {
      stateElectionsCompleted: number;
      nationalElectionsCompleted: number;
      committeeElectionsCompleted: number;
    } | null;

    partyActions: {
      totalActionsGenerated: number;
    } | null;

    nppRelationshipMaintenance?: {
      relationshipsDecayed: number;
      caucusMembershipsRemoved: number;
    } | null;

    nppBehavior: {
      nppsEntered: number;
      billVotesCast: number;
      speakerVotesCast: number;
    } | null;

    billLifecycle: {
      billsProcessed: number;
      billsPassed: number;
      billsFailed: number;
      billsVetoed: number;
    } | null;

    ukBillLifecycle: {
      enacted: number;
      failed: number;
    } | null;

    jpBillLifecycle?: {
      enacted: number;
      failed: number;
      overrides: number;
      cabinetPassed: number;
      skipped?: boolean;
    } | null;

    deBillLifecycle?: {
      enacted: number;
      failed: number;
    } | null;

    ieBillLifecycle?: {
      enacted: number;
      failed: number;
    } | null;

    stateBillTimers: {
      billsProcessed: number;
    } | null;

    cabinetNominations: {
      nominationsProcessed: number;
    } | null;

    scotusTurn?: {
      tenure: {
        seatsAdvanced: number;
        seatsVacatedByHistory: number;
        seatsVacatedByHazard: number;
      };
      docket: {
        casesFired: number;
        casesAffirmed: number;
        casesDiverged: number;
      };
      surpriseCase?: {
        spawned: boolean;
        caseKey?: string;
        majoritySide?: -1 | 0 | 1;
      };
      nominations: {
        nominationsProcessed: number;
        confirmed: number;
        rejected: number;
      };
    } | null;

    ukJrSurpriseTurn?: {
      spawned: boolean;
      caseKey?: string;
      majoritySide?: -1 | 0 | 1;
    } | null;

    voteAccumulation: {
      electionsProcessed: number;
    } | null;

    campaignTurn: {
      campaignsProcessed: number;
      totalFundsGenerated: number;
      totalActionsGenerated: number;
    } | null;

    playerRandomEvents: {
      swept: number;
      offered: number;
      skippedOffers: number;
    } | null;

    worldEventsMaintenance: {
      expiredModifiers: number;
    } | null;

    worldEventsScheduler: {
      offered: number;
      skipped: number;
    } | null;

    campaignSpendReset: {
      campaignsReset: number;
    } | null;

    electionTimers: {
      electionsAdvanced: number;
    } | null;

    primarySnapshots: {
      snapshotsTaken: number;
    } | null;

    electionResolution: {
      electionsResolved: number;
      winners: Array<{
        electionType: string;
        state: string;
        winnerName: string;
        winnerParty: string;
      }>;
    } | null;

    ukGovernment: {
      governmentFormed: boolean;
      noConfidenceProcessed: number;
      confidenceProcessed: number;
    } | null;

    perpetualElections: {
      electionsCreated: number;
    } | null;

    leadershipElections: {
      electionsResolved: number;
    } | null;

    leadershipVacated: {
      positionsVacated: number;
    } | null;

    staleCandidateCleanup: {
      candidatesRemoved: number;
    } | null;

    fiscalYear: {
      processed: boolean;
      newFiscalYear: number | null;
    } | null;

    policyEffects: {
      statesProcessed: number;
    } | null;

    demographicEffects: {
      statesProcessed: number;
    } | null;

    archetypeApprovalDecay: {
      charactersProcessed: number;
      nppsProcessed: number;
    } | null;

    nationalMetrics: {
      countriesProcessed: number;
    } | null;

    fiscalBaseGrowth?: {
      countriesProcessed: number;
      statesProcessed: number;
    } | null;

    economicModel?: {
      countriesProcessed: number;
      regionsProcessed: number;
    } | null;

    metricHistory: {
      snapshotsTaken: number;
    } | null;

    approvalSnapshot: {
      countriesProcessed: number;
    } | null;

    bannedShareholderRelease: {
      usersProcessed: number;
      sharesReleasedToFloat: number;
      ceoCorpsVacated: number;
      ordersCancelled: number;
      listingsCancelled: number;
      offersCancelled: number;
    } | null;

    inactiveShareholderShareRelease: {
      usersProcessed: number;
      corpsProcessed: number;
      corpsWarned: number;
      warningsSent: number;
      sharesReleasedToFloat: number;
      sharePositionsReleased: number;
      ordersCancelled: number;
      listingsCancelled: number;
      offersCancelled: number;
    } | null;

    corporationTurn: {
      corporationsProcessed: number;
      sectorsProcessed: number;
      totalRevenueGenerated: number;
      totalIncomeGenerated: number;
    } | null;

    bondTurn: {
      bondsProcessed: number;
      couponsPaid: number;
      bondsMatured: number;
      bondsDefaulted: number;
      totalCouponsPaid: number;
      bondHistorySnapshots: number;
    } | null;

    commodityPrices: {
      commoditiesUpdated: number;
      statesWithActivity: number;
    } | null;

    savingsInterestTurn: {
      /** Bulk write ops (per currency bucket credited) */
      charactersProcessed: number;
      totalInterest: number;
    } | null;

    npcBankPolicyTurn: {
      banksChecked: number;
      banksUpdated: number;
    } | null;

    bankingTurn: {
      banksProcessed: number;
      depositInterestPaid: number;
      loanInterestCollected: number;
      loanPrincipalRepaid: number;
      defaultsWrittenOff: number;
      npcDepositDelta: number;
    } | null;

    /** A8: employer pension contributions into union schemes. */
    pensionTurn?: {
      schemesCharged: number;
      contributionsAnchor: number;
      topUpsAnchor: number;
      accrualsAnchor: number;
      shortfalls: number;
      /** Phase 2: benefits in payment. */
      benefitsPaidAnchor: number;
      benefitsUnpaidAnchor: number;
      /** Schemes that had to cut a pension because the assets were not there. */
      schemesCutting: number;
      /** Phase 2: scheme assets put into index funds this turn. */
      investedAnchor: number;
      schemesInvesting: number;
    } | null;

    bankSolvencyTurn: {
      banksEvaluated: number;
      fled: number;
      failures: number;
      contagionTriggered: number;
    } | null;

    /** B7 supervision: capital adequacy, stress test, forced recapitalization. */
    bankSupervision?: {
      banksAssessed: number;
      stressed: number;
      undercapitalized: number;
      chartersRevoked: number;
    } | null;

    treasuryTurn: {
      /** Country federalBudgets whose treasury balance was accrued this turn. */
      countriesProcessed: number;
    } | null;

    portfolioSnapshot: {
      charactersSnapshotted: number;
    } | null;

    financialSuspectScan: true | null;

    emptyPartyCleanup: {
      partiesDeleted: number;
      stateOrgsDeleted: number;
    } | null;

    centralBankChairTurn: {
      banksProcessed: number;
      chairsPenalized: number;
      bankWritesMatched?: number;
      bankWritesModified?: number;
      highScrutinyDiagnostics?: Array<{
        bankId: string;
        countryId: string;
        previousInfamy: number;
        newInfamy: number;
        inflationRate: number;
        targetInflation: number;
        gdpGrowth: number;
        scrutinyDelta: number;
      }>;
    } | null;

    fomcMeetings: {
      banksProcessed: number;
      meetingsOpened: number;
      meetingsResolved: number;
      ratesChanged: number;
      seatsReplaced: number;
    } | null;

    fomcNominations: {
      nominationsProcessed: number;
      confirmed: number;
      rejected: number;
    } | null;

    centralBankChairExecutiveRemoval: {
      banksChecked: number;
      chairsRemoved: number;
      pendingCleared: number;
    } | null;

    centralBankChairSelection: {
      countriesChecked: number;
      selectionsTriggered: number;
      politicalPicks: number;
      economicPicks: number;
      vacanciesRemaining: number;
    } | null;

    nppFundGeneration?: {
      nppsProcessed: number;
      totalGenerated: number;
      totalStateTax: number;
      totalNationalTax: number;
    } | null;

    nppActionProcessing?: {
      nppsProcessed: number;
      actionsExecuted: number;
      buildDonorBase: number;
      campaign: number;
      advertise: number;
      partyDonation: number;
      skipped: number;
    } | null;

    unownedSectorGrowth?: {
      sectorsProcessed: number;
    } | null;

    metricEngine?: {
      statesProcessed: number;
    } | null;

    demographicFlows?: {
      regionsProcessed: number;
      /** Internal-migration circuit-breaker trips this turn (§4.4 cap events). */
      circuitBreakerTrips?: number;
    } | null;

    /** Decennial census/reapportionment (P1d-2); `ran` false on non-census turns. */
    census?: {
      ran: boolean;
      year?: number;
      seatsChanged?: number;
    } | null;

    /**
     * Statehood admission; `ran` false when the in-game year was already
     * evaluated. `admitted` lists the state ids that joined the Union this
     * year — empty on the overwhelming majority of turns, and always empty for
     * presets whose apportionment map already carries every state.
     */
    statehood?: {
      ran: boolean;
      year?: number;
      admitted?: string[];
    } | null;

    /** Decade-era crossing (era spine); `ran` false off decade rollovers or while eraSystemEnabled is off. */
    eraCrossing?: {
      ran: boolean;
      eraId?: string;
      /** Marker stamped without news (mid-decade enable self-heal). */
      healed?: boolean;
    } | null;

    /** Metric activation news (era catalog); counts posts made this turn. */
    metricActivation?: {
      posted: number;
      /** Guard stamped without posting (first flag-on run). */
      healed?: boolean;
    } | null;

    /** Cabinet year crossing: seat unlocks/renames/retirements vs the live year. */
    cabinetYearCrossing?: {
      ran: boolean;
      /** Incumbents auto-transferred across a seat succession this turn. */
      transferred: number;
      posted: number;
      /** Guard stamped + retirements reconciled silently (first run). */
      healed?: boolean;
    } | null;

    /** Military branch year crossing: services stood up as their founding year arrives. */
    militaryBranchYearCrossing?: {
      ran: boolean;
      /** Branches that received their authored order of battle this turn. */
      branchesRaised: number;
      posted: number;
      /** Guard stamped + active-but-empty branches stood up silently (first run). */
      healed?: boolean;
    } | null;

    unemploymentDerivation?: {
      statesProcessed: number;
    } | null;

    regionalBudgetProcessing?: {
      regionsProcessed: number;
    } | null;

    jpRegionalBudgetProcessing?: {
      regionsProcessed: number;
    } | null;

    deRegionalBudgetProcessing?: {
      regionsProcessed: number;
    } | null;

    cnRegionalBudgetProcessing?: {
      regionsProcessed: number;
    } | null;

    /** RU regional budgets (political-legislation rebuild, spec §5.2). */
    ruRegionalBudgetProcessing?: {
      regionsProcessed: number;
    } | null;

    /** SP2 political-metrics dynamics (laws drift the metrics). */
    politicalMetricsDynamics?: {
      countriesProcessed: number;
      regionsDrifted: number;
    } | null;

    /**
     * Ceremonial head-of-state reconciliation. Covers every country whose head of
     * state follows the ruling-party chair — the CN President and the Warsaw Pact
     * council chairmanships — not just CN, despite the phase's original name.
     */
    cnPresidentSync?: {
      /** The first non-noop action this tick, or "noop" when nothing moved. */
      action:
        | "noop"
        | "seated"
        | "replaced"
        | "vacated"
        | "skipped_no_ruling_party"
        | "skipped_no_office";
      /** How many countries actually changed hands this tick. */
      changed: number;
    } | null;

    crisisTurn?: {
      crisisesProcessed: number;
    } | null;

    ministerialOrders?: {
      ordersExpired: number;
      ordersActive: number;
      settingsApplied: number;
      actionsRegenerated: number;
    } | null;

    socialAxisDrift?: {
      countriesProcessed: number;
      lawsCounted: number;
    } | null;

    officeStateSeed?: {
      inserted: number;
      skipped: number;
    } | null;

    governorAPRegen?: {
      actionsGranted: number;
    } | null;

    governorExecutiveOrders?: {
      expired: number;
      superseded: number;
    } | null;

    governorAddressExpiry?: {
      approvalExpired: number;
      demographicExpired: number;
    } | null;

    governorEndorsements?: {
      withdrawn: number;
      byReason: Record<string, number>;
    } | null;

    executiveEndorsements?: {
      withdrawn: number;
      byReason: Record<string, number>;
    } | null;

    /** Ticket #1179 — player endorsements withdrawn for primary-phase party misalignment. */
    playerEndorsementPartySweep?: {
      withdrawn: number;
    } | null;

    governorLegislationQueue?: {
      fired: number;
      cancelled: number;
    } | null;

    gameHealthSnapshot?: {
      snapshotWritten: boolean;
      integrityCheckRan: boolean;
    } | null;

    activityLogging?: {
      summariesInserted: number;
    } | null;

    suspiciousDetection?: {
      flagged: number;
      cleared: number;
      deleted: number;
    } | null;

    /** Forensics/alt-detection rework plan §3.1 T3.1 — best-effort anomaly
     * scanners over the `actionAuditLog` spine. Runs after `activityLogging`,
     * before `suspiciousDetection`. */
    auditAnomalyScan?: {
      scannedRows: number;
      flaggedRows: number;
    } | null;

    tradeGrowthMirror?: { countriesUpdated: number } | null;

    forexTurn?: {
      countriesUpdated: number;
      limitOrdersFilled: number;
      limitOrdersExpired: number;
      totalSpreadRevenue: number;
    } | null;

    internationalOrganizations?: {
      proposalsResolved: number;
      legislationResolved: number;
      electionsResolved: number;
    } | null;

    /** Cold War alignment drift. Zeroes when the feature gate is off. */
    alignment?: {
      countriesDrifted: number;
      erasCrossed: number;
      spheresSynced: number;
      rowsHealed: number;
      playsResolved: number;
      /** Members that left a bloc because their alignment collapsed. */
      defections: number;
      /** Player-controlled members flagged as wobbling but left alone. */
      defectionWarnings: number;
      /** Non-player nations that asked to join a bloc they have swung toward. */
      joinRequests: number;
      /** Flashpoints opened this turn. */
      crisesOpened: number;
      /** Flashpoints settled this turn. */
      crisesResolved: number;
    } | null;

    /** Settlement crises (the German Question). Zeroes when the gate is off. */
    settlement?: {
      playsResolved: number;
      institutionsMoved: number;
      crisesResolved: number;
      /** Ladder rung after this tick. */
      heat: number;
      /** Settlement index after this tick, in hundredths. */
      position: number;
      /** Seat countries charged a mobilisation levy for standing at rung 5. */
      countriesLevied: number;
      /** World News dispatches filed this tick. */
      wirePosts: number;
    } | null;

    /** Phase 3 — passive Org→Reg drift + Reg decay phase. */
    regDriftDecay?: {
      statesScanned: number;
      statesProcessed: number;
      partyRowsUpdated: number;
      poolRowsUpdated: number;
      ledgerRowsWritten: number;
    } | null;

    /** Phase 3 — per-geography PS pressure decay phase. */
    pressureDecay?: {
      rowsScanned: number;
      rowsDecayed: number;
      rowsAtFloor: number;
    } | null;

    /** Phase 3 — Priority Region cluster validator (auto-evicts ineligible states). */
    priorityRegionDecay?: {
      partiesScanned: number;
      partiesWithCluster: number;
      statesEvicted: number;
    } | null;

    /** D5 — per-turn Major/Minor party tier recompute + PS-cap clamp. */
    partyTierTurn?: {
      partiesScanned: number;
      partiesUpdated: number;
      promoted: number;
      demoted: number;
      warningsStarted: number;
      warningsCleared: number;
      psClampedDown: number;
    } | null;

    /** Phase F — candidate Support regression-to-mean each turn. */
    supportDecay?: {
      candidatesUpdated: number;
    } | null;

    /** Phase B — rally trailing-drip accrual tick each turn. */
    supportAccrual?: {
      candidatesUpdated: number;
    } | null;

    /** Phase F — `$unset` of `support` on candidates of resolved elections. */
    clearResolvedSupport?: {
      candidatesCleared: number;
    } | null;

    /** Phase 6 — per-turn charter expiry sweep (D4 deadlines). */
    expireCharters?: {
      expiredFromPending: number;
      expiredFromReplacement: number;
    } | null;

    /** State Overview — per-turn top-sectors cache recompute. */
    topSectorsRecompute?: {
      statesProcessed: number;
      statesWithActivity: number;
    } | null;

    /** UK SCO/WAL/NIR Independence/Reunification Desire drift. */
    independenceDesireDrift?: {
      regionsProcessed: number;
    } | null;

    /** UK independence/reunification referendum lifecycle transitions. */
    referendumLifecycle?: {
      processed: number;
    } | null;

    /** Per-turn reconciliation of the denormalized party memberCount cache. */
    partyMemberCountReconcile?: {
      partiesChecked: number;
      partiesUpdated: number;
    } | null;

    /** Index fund cron — NAV updates, float purchases, rebalances, redemptions. */
    indexFunds?: {
      fundsProcessed: number;
      navUpdates: number;
      floatPurchases: number;
      rebalances: number;
      redemptionsPaid: number;
      bondDeployments: number;
      nppsProcessed: number;
      nppInvested: number;
    } | null;
    moneySupplySnapshot?: {
      currenciesProcessed: number;
    } | null;
    nppMonetaryOperations?: {
      banksProcessed: number;
      evaluationsRecorded: number;
      operationsExecuted: number;
    } | null;
    ledgerBalanceSnapshot?: {
      accountsSnapshotted: number;
    } | null;
    /** Snap elections fired for countries whose system conversion promised one. */
    postConversionElections?: {
      fired: number;
    } | null;
    ledgerReconcile?: {
      status: "green" | "amber" | "red";
      entriesChecked: number;
      unbalancedCount: number;
      stockVsFlowDivergences: number;
    } | null;
  };

  // TTL index field - MongoDB will auto-delete 24 hours after this timestamp
  createdAt: Date;
}
