/**
 * The `stateEffectsAndNationalAggregation` turn-phase adapter, moved verbatim
 * out of turnPhaseRegistry.ts (pure code motion). getTurnPhaseRegistry splices
 * it back into the registry array at the exact same position, so phase
 * registration ORDER — which is behavior — is unchanged.
 */
import { processStatePolicyEffects } from "@/lib/policyEffects";
import { processAllStateDemographics } from "@/lib/demographicEffects";
import { processEraCheckpointsTurn } from "@/lib/turn/eraCheckpointTurn";
import { decayPolicyReactions } from "@/lib/policyReactions";
import { processArchetypeApprovalDecay } from "@/lib/turn/archetypeApprovalDecay";
import { processUnownedSectorGrowth } from "@/lib/turn/unownedSectorGrowth";
import { processMetricDecay } from "@/lib/turn/metricDecay";
import { processSubsidyBudget } from "@/lib/turn/subsidyBudgetTurn";
import { processRegionalBudgets } from "@/lib/turn/regionalBudget";
import { processJPRegionalBudgets } from "@/lib/turn/jpRegionalBudget";
import { processDERegionalBudgets } from "@/lib/turn/deRegionalBudget";
import { processCNRegionalBudgets } from "@/lib/turn/cnRegionalBudget";
import { processRURegionalBudgets } from "@/lib/turn/ruRegionalBudget";
import { processPoliticalMetricsDynamics } from "@/lib/turn/politicalMetricsDynamics";
import { syncAllPartyChairHeadsOfState } from "@/lib/turn/partyChairHeadOfState";
import { processCrisisTurn } from "@/lib/turn/crisisTurn";
import { processMinisterialOrders } from "@/lib/turn/ministerialOrderProcessing";
import { processTopSectorsRecompute } from "@/lib/turn/state/topSectorsRecompute";
import { processInvestorConfidenceDecay } from "@/lib/turn/investorConfidenceDecay";
import { processStateOwnershipConcentration } from "@/lib/turn/stateOwnershipConcentration";
import { runMetricEngine } from "@/lib/metricEngine/phase";
import { runDemographicFlows } from "@/lib/demographics/phase";
import { runCensus } from "@/lib/turn/census";
import { runStatehoodAdmission } from "@/lib/turn/statehood";
import { runEraCrossing, runMetricActivation } from "@/lib/turn/eraCrossing";
import { runCabinetYearCrossing } from "@/lib/turn/cabinetYearCrossing";
import { runMilitaryBranchYearCrossing } from "@/lib/turn/militaryBranchYearCrossing";
import { computeNationalMetrics } from "@/lib/nationalMetrics";
import { processFiscalBaseGrowth } from "@/lib/turn/fiscalBaseGrowth";
import { processEconomicModelTurn } from "@/lib/turn/economicModelTurn";
import { mirrorTradeGrowth } from "@/lib/turn/tradeGrowthMirror";
import { recalculateInflationPerTurn } from "@/lib/turn/inflationRecalc";
import { processCommandEconomyTurn } from "@/lib/turn/commandEconomyTurn";
import { processForexTurn } from "@/lib/turn/forexTurn";
import { isLedgerShadowEnabledFromConfig } from "@/lib/ledger/featureFlag";
import { writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { processCentralBankChairTurn } from "@/lib/turn/centralBankChairTurn";
import { processFomcMeetings } from "@/lib/turn/fomcMeetingTurn";
import { processNppMonetaryOperations } from "@/lib/moneySupply/nppPolicy";
import { processCentralBankChairExecutiveRemoval } from "@/lib/turn/centralBankChairExecutiveRemoval";
import { processCentralBankChairSelection } from "@/lib/turn/centralBankChairSelection";
import { processIndependenceDesireDrift } from "@/lib/turn/independenceDesireDrift";
import { processReferendumLifecycle } from "@/lib/referendum/processReferendumLifecycle";
import { reconcilePartyMemberCounts } from "@/lib/turn/partyOrg";
import { snapshotMetricHistory } from "@/lib/metricHistory";
import { snapshotApprovalHistory } from "@/lib/utils/governmentApproval";
import { snapshotInterestRateHistory } from "@/lib/turn/interestRateSnapshot";
import { snapshotPartyHistory } from "@/lib/turn/partyHistorySnapshot";
import {
  snapshotPortfolioValues,
  snapshotCorporationPortfolioValues,
} from "@/lib/turn/portfolioSnapshot";
import {
  generateStockExchangeSnapshots,
  generateInvestorRankingSnapshot,
  generateWealthListSnapshots,
} from "@/lib/turn/stockExchangeSnapshot";
import { processSuspiciousDetection } from "@/lib/turn/suspiciousDetection";
import { runAuditAnomalyScan } from "@/lib/audit/anomalyScan";
import { processGameHealthSnapshot } from "@/lib/turn/gameHealthSnapshot";
import { processNppStanceDrift } from "@/lib/turn/nppStanceDrift";
import { resetVicePresidentActions } from "@/lib/turn/vicePresidentActionReset";
import { resetRunningMateSurrogateActions } from "@/lib/turn/runningMateSurrogateActionReset";
import { resetJusticeActions } from "@/lib/turn/justiceActionReset";
import { COUNTRY_ORDER, COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { TurnPhaseAdapter } from "@/simulation/engine/types";

export const stateEffectsAndNationalAggregationPhase: TurnPhaseAdapter = {
  key: "stateEffectsAndNationalAggregation",
  async execute(context, runtime) {
    const {
      db,
      newTurn,
      currentYear,
      phaseResults,
      gameState,
      gameNow,
      startTimeMs,
      warnings,
      phaseStatuses,
    } = context;
    // S4 (2026-07-16 core-sim audit): crisisTurn, ministerialOrders, and
    // policyEffects all write the SAME stateMetrics "<category>.<metric>.value"
    // field paths — crisisTurn and ministerialOrders via $inc, policyEffects
    // via a read-modify-write that ends in $set. When these ran concurrently
    // inside the Promise.all below, a $inc landing between policyEffects'
    // read and its $set was silently overwritten (lost update), making turn
    // outcomes nondeterministic: crisis shocks or cabinet-order effects could
    // vanish, or clobber bill effects, depending on scheduling.
    //
    // Serialize ONLY these three writers; everything else stays parallel.
    // Chosen order: crisisTurn → ministerialOrders → policyEffects.
    //  - crisisTurn and ministerialOrders are pure $inc writers (commutative
    //    with each other), kept in their previous registry order.
    //  - policyEffects runs LAST because it is the read-modify-write: running
    //    it after the $inc shocks means its read observes the crisis- and
    //    order-adjusted values, so bill effects and baseline decay apply ON
    //    TOP of the shocked state — the intended semantics ($inc deltas were
    //    always meant to compose with, not race, the policy recompute).
    // Write mechanics ($set vs $inc) are deliberately unchanged in this fix.
    const serializedStateMetricsWriters = (async () => {
      const crisisResult = await runtime.runPhase("crisisTurn", () =>
        processCrisisTurn(db, newTurn)
      );
      const ministerialOrdersResult = await runtime.runPhase("ministerialOrders", () =>
        processMinisterialOrders(newTurn)
      );
      const policyResult = await runtime.runPhase("policyEffects", () =>
        processStatePolicyEffects(db)
      );
      return { crisisResult, ministerialOrdersResult, policyResult };
    })();
    const [
      { crisisResult, ministerialOrdersResult, policyResult },
      demoEffectResult,
      ,
      archetypeDecayResult,
      unownedResult,
      ,
      ,
      regionalBudgetResult,
      jpRegionalBudgetResult,
      deRegionalBudgetResult,
      cnRegionalBudgetResult,
      ruRegionalBudgetResult,
      politicalMetricsDynamicsResult,
      cnPresidentSyncResult,
      topSectorsResult,
    ] = await Promise.all([
      serializedStateMetricsWriters,
      // Era checkpoints (src/lib/demographics/eraCheckpoints.ts) write the SAME
      // stateDemographics.groups.<id>.<axis> fields processAllStateDemographics
      // does, so it runs strictly AFTER that call completes (never concurrently
      // in this Promise.all) to avoid the same lost-update race the S4 comment
      // above documents for the state-metrics writers. Its own result isn't
      // destructured (mirrors the append-only results below); only
      // demoEffectResult is.
      runtime.runPhase("demographicEffects", async () => {
        const result = await processAllStateDemographics(db);
        // Isolated so a checkpoint bug can't mark the whole demographics phase
        // failed (and discard its result) after the demographics writes above
        // have already persisted — the sequencing constraint is the only
        // coupling between the two.
        try {
          await processEraCheckpointsTurn(db, newTurn);
        } catch (err) {
          console.error("[eraCheckpoints] turn processing failed:", err);
        }
        return result;
      }),
      runtime.runPhase("policyReactionDecay", () => decayPolicyReactions(db, newTurn)),
      runtime.runPhase("archetypeApprovalDecay", () => processArchetypeApprovalDecay()),
      runtime.runPhase("unownedSectorGrowth", () => processUnownedSectorGrowth(db)),
      runtime.runPhase("metricDecay", () => processMetricDecay()),
      runtime.runPhase("subsidyBudget", () => processSubsidyBudget(db)),
      runtime.runPhase("regionalBudgetProcessing", () => processRegionalBudgets(db, newTurn)),
      runtime.runPhase("jpRegionalBudgetProcessing", () => processJPRegionalBudgets(db, newTurn)),
      runtime.runPhase("deRegionalBudgetProcessing", () =>
        processDERegionalBudgets(db, newTurn, gameState.preset)
      ),
      runtime.runPhase("cnRegionalBudgetProcessing", () =>
        processCNRegionalBudgets(db, newTurn, gameState.preset)
      ),
      runtime.runPhase("ruRegionalBudgetProcessing", () => processRURegionalBudgets(db, newTurn)),
      runtime.runPhase("politicalMetricsDynamics", () =>
        processPoliticalMetricsDynamics(db, newTurn)
      ),
      // Phase key deliberately keeps its original CN-only name even though the step
      // now reconciles every chair-synced country: it is the identifier turn logs and
      // the phase-history diagnostics are keyed by, and renaming it would read as the
      // phase disappearing and a new one appearing. See the TurnLog field doc.
      runtime.runPhase("cnPresidentSync", () => syncAllPartyChairHeadsOfState(db, gameNow)),
      runtime.runPhase("topSectorsRecompute", () =>
        processTopSectorsRecompute(db, newTurn, gameNow)
      ),
      // Appended last so the positional destructuring above is unaffected;
      // its result (countriesHealed) is intentionally not destructured.
      runtime.runPhase("investorConfidenceDecay", () => processInvestorConfidenceDecay(newTurn)),
      // Appended after confidence decay; result (countriesUpdated) intentionally
      // not destructured. Recomputes SOCI from live corp revenue each turn.
      runtime.runPhase("stateOwnershipConcentration", () =>
        processStateOwnershipConcentration(newTurn)
      ),
      // Appended last (result intentionally not destructured): slowly drift NPP
      // stances toward their state's political lean (#101).
      runtime.runPhase("nppStanceDrift", () => processNppStanceDrift(db, newTurn)),
      // Appended (result intentionally not destructured): refill the seated
      // vice-president's self-serve action pool once per Eastern-time day (#67).
      runtime.runPhase("vicePresidentActionReset", () => resetVicePresidentActions(db)),
      // Appended (result intentionally not destructured): refill each active
      // presidential ticket's shared running-mate surrogate action pool once per
      // Eastern-time day (mirrors vicePresidentActionReset above).
      runtime.runPhase("runningMateSurrogateActionReset", () =>
        resetRunningMateSurrogateActions(db)
      ),
      // Appended (result intentionally not destructured): refill seated
      // Justices' self-serve action pool once per Eastern-time day (#3598,
      // mirrors vicePresidentActionReset above).
      runtime.runPhase("justiceActionReset", () => resetJusticeActions(db)),
    ]);
    phaseResults.policyEffects = { statesProcessed: policyResult ?? 0 };
    phaseResults.demographicEffects = { statesProcessed: demoEffectResult ?? 0 };
    phaseResults.unownedSectorGrowth = { sectorsProcessed: unownedResult ?? 0 };
    phaseResults.regionalBudgetProcessing = regionalBudgetResult
      ? { regionsProcessed: regionalBudgetResult.regionsProcessed }
      : null;
    phaseResults.jpRegionalBudgetProcessing = jpRegionalBudgetResult
      ? { regionsProcessed: jpRegionalBudgetResult.regionsProcessed }
      : null;
    phaseResults.deRegionalBudgetProcessing = deRegionalBudgetResult
      ? { regionsProcessed: deRegionalBudgetResult.regionsProcessed }
      : null;
    phaseResults.cnRegionalBudgetProcessing = cnRegionalBudgetResult
      ? { regionsProcessed: cnRegionalBudgetResult.regionsProcessed }
      : null;
    phaseResults.ruRegionalBudgetProcessing = ruRegionalBudgetResult
      ? { regionsProcessed: ruRegionalBudgetResult.regionsProcessed }
      : null;
    phaseResults.politicalMetricsDynamics = politicalMetricsDynamicsResult
      ? {
          countriesProcessed: politicalMetricsDynamicsResult.countriesProcessed,
          regionsDrifted: politicalMetricsDynamicsResult.regionsDrifted,
        }
      : null;
    // The phase now reconciles every chair-synced country, not just CN. Reported as
    // the count that actually moved — a per-country action list would be mostly
    // "noop" and the diagnostics only need to know whether anything changed.
    phaseResults.cnPresidentSync = cnPresidentSyncResult
      ? {
          action: cnPresidentSyncResult.find((r) => r.action !== "noop")?.action ?? "noop",
          changed: cnPresidentSyncResult.filter((r) => r.action !== "noop").length,
        }
      : null;
    phaseResults.crisisTurn = { crisisesProcessed: crisisResult ?? 0 };
    phaseResults.ministerialOrders = ministerialOrdersResult ?? null;
    phaseResults.topSectorsRecompute = topSectorsResult ?? null;

    if (archetypeDecayResult) {
      phaseResults.archetypeApprovalDecay = {
        charactersProcessed: archetypeDecayResult.charactersProcessed,
        nppsProcessed: archetypeDecayResult.nppsProcessed,
      };
      console.log(
        `[Turn] Archetype approval decay: ${archetypeDecayResult.charactersProcessed} characters, ${archetypeDecayResult.nppsProcessed} NPPs`
      );
    }

    const metricEngineResult = await runtime.runPhase("metricEngine", () =>
      runMetricEngine(db, newTurn)
    );
    phaseResults.metricEngine = { statesProcessed: metricEngineResult ?? 0 };

    // Demographic cohort flows run AFTER the metric engine (they read the
    // birthRate / healthcare / migrationRate metrics it produces) and BEFORE
    // national aggregation (they write state.population + population metrics
    // that the national rollup consumes).
    const demographicFlowsResult = await runtime.runPhase("demographicFlows", () =>
      runDemographicFlows(db, newTurn)
    );
    phaseResults.demographicFlows = {
      regionsProcessed: demographicFlowsResult?.regionsProcessed ?? 0,
      circuitBreakerTrips: demographicFlowsResult?.circuitBreakerTrips ?? 0,
    };

    // Statehood admission: rolls each pending territory's era-windowed
    // admission pressure once per in-game year. Must run BEFORE the census so
    // that a territory admitted this year is already holding a seat when
    // reapportionment redistributes the 435, rather than waiting a full decade
    // to be counted. No-op for every preset whose apportionment map already
    // carries Alaska and Hawaii (1979 onward).
    const statehoodResult = await runtime.runPhase("statehood", () =>
      runStatehoodAdmission(db, newTurn)
    );
    phaseResults.statehood = {
      ran: statehoodResult?.ran ?? false,
      ...(statehoodResult?.year !== undefined ? { year: statehoodResult.year } : {}),
      admitted: statehoodResult?.admitted?.map((a) => a.stateId) ?? [],
    };

    // Decennial census (P1d-2): fires Week 1 of years ending in 0 and
    // reapportions US House seats from the now-updated populations; no-op
    // otherwise. Runs after demographicFlows (reads state.population) and
    // before elections consume the new state.houseDistricts.
    const censusResult = await runtime.runPhase("census", () => runCensus(db, newTurn));
    phaseResults.census = {
      ran: censusResult?.ran ?? false,
      ...(censusResult?.year !== undefined ? { year: censusResult.year } : {}),
      seatsChanged: censusResult?.deltas?.length ?? 0,
    };

    // Decade-era crossing: stamps gameState.currentEraId + posts wire news
    // in Week 1 of years ending in 0 (same trigger cadence as the census —
    // the decade rolls over once, both fire). Whole phase is gated on
    // eraSystemEnabled; on mid-decade enable it self-heals the marker
    // quietly (healed: true, no news).
    const eraCrossingResult = await runtime.runPhase("eraCrossing", () => runEraCrossing(db));
    phaseResults.eraCrossing = {
      ran: eraCrossingResult?.ran ?? false,
      ...(eraCrossingResult?.eraId ? { eraId: eraCrossingResult.eraId } : {}),
      ...(eraCrossingResult?.healed ? { healed: true } : {}),
    };

    // Metric activation news (era catalog): flavored world posts + Discord
    // news-channel webhook when the live year crosses a metric's window.
    // Flag-gated inside; quiet self-heal on first flag-on run (no burst).
    const metricActivationResult = await runtime.runPhase("metricActivation", () =>
      runMetricActivation(db)
    );
    phaseResults.metricActivation = {
      posted: metricActivationResult?.posted.length ?? 0,
      ...(metricActivationResult?.healed ? { healed: true } : {}),
    };

    // Cabinet year crossing: seat unlocks/renames/retirements vs the live
    // year. State reconcile (succession auto-transfer) always runs when year
    // data exists; news is gated on eraSystemEnabled inside. First run
    // self-heals quietly (no news burst).
    const cabinetYearResult = await runtime.runPhase("cabinetYearCrossing", () =>
      runCabinetYearCrossing(db)
    );
    phaseResults.cabinetYearCrossing = {
      ran: cabinetYearResult?.ran ?? false,
      transferred: cabinetYearResult?.transferred.length ?? 0,
      posted: cabinetYearResult?.posted.length ?? 0,
      ...(cabinetYearResult?.healed ? { healed: true } : {}),
    };

    // Military branch year crossing: stand up a service whose founding year the
    // world has now reached (the NVA in 1956, the Bundesheer in 1955). Without
    // this the bootstrap seeder's one-shot skip is permanent and the country
    // never gets an army at all. First run stands up active-but-empty branches
    // silently; later runs post one item per service raised.
    const militaryBranchResult = await runtime.runPhase("militaryBranchYearCrossing", () =>
      runMilitaryBranchYearCrossing(db)
    );
    phaseResults.militaryBranchYearCrossing = {
      ran: militaryBranchResult?.ran ?? false,
      branchesRaised: militaryBranchResult?.raised.length ?? 0,
      posted: militaryBranchResult?.posted.length ?? 0,
      ...(militaryBranchResult?.healed ? { healed: true } : {}),
    };

    const metricsResult = await runtime.runPhase("nationalMetrics", () =>
      computeNationalMetrics(db)
    );
    phaseResults.nationalMetrics = { countriesProcessed: metricsResult ?? 0 };

    // Per-turn fiscal base growth: applies a 1/TURNS_PER_YEAR slice of the
    // freshly-aggregated national wageGrowth/tradeGrowth/gdpGrowth to the tax
    // bases and recomputes federal revenue (the per-turn treasuryTurn accrues
    // it next turn). Runs AFTER nationalMetrics (fresh rates) and BEFORE
    // tradeGrowthMirror + inflationRecalc, which read the economicFactors
    // wageGrowth/tradeGrowth this phase writes.
    const fiscalBaseGrowthResult = await runtime.runPhase("fiscalBaseGrowth", () =>
      processFiscalBaseGrowth(newTurn)
    );
    phaseResults.fiscalBaseGrowth = {
      countriesProcessed: fiscalBaseGrowthResult?.countriesProcessed ?? 0,
      statesProcessed: fiscalBaseGrowthResult?.statesProcessed ?? 0,
    };

    // Economic-model classification (P7): reads the settled sector revenue,
    // spending mix, and active laws to derive each country's + region's economic
    // identity. Descriptive only (P7a); the effect channels are P7b.
    const economicModelResult = await runtime.runPhase("economicModel", () =>
      processEconomicModelTurn(newTurn, gameState.startingYear)
    );
    phaseResults.economicModel = {
      countriesProcessed: economicModelResult?.countriesProcessed ?? 0,
      regionsProcessed: economicModelResult?.regionsProcessed ?? 0,
    };

    if (gameState.forexEnabled) {
      const tradeGrowthResult = await runtime.runPhase("tradeGrowthMirror", () =>
        mirrorTradeGrowth(db)
      );
      if (tradeGrowthResult) {
        phaseResults.tradeGrowthMirror = tradeGrowthResult;
      }
    } else {
      await runtime.markPhaseSkipped(
        "tradeGrowthMirror",
        "featureDisabled",
        "Skipped because the forex system is disabled."
      );
    }

    await runtime.runPhase("inflationRecalc", () => recalculateInflationPerTurn(db, newTurn));

    // Command-economy macro state (monetary overhang, shortage, black-market
    // premium, second economy). Self-gates on commandEconomyEnabled; no-op for
    // market worlds. Runs after inflationRecalc so wage/gdp growth are fresh.
    await runtime.runPhase("commandEconomy", () =>
      processCommandEconomyTurn(db, newTurn, currentYear)
    );

    if (isLedgerShadowEnabledFromConfig(context.config)) {
      await runtime.runPhase("ledgerPreForexSnapshot", () =>
        writePreForexBalanceCheckpoint(db, newTurn)
      );
    } else {
      await runtime.markPhaseSkipped(
        "ledgerPreForexSnapshot",
        "featureDisabled",
        "Skipped because the shadow ledger is disabled."
      );
    }

    if (gameState.forexEnabled) {
      // Pass the world's reset preset so the macro-target anchor (baseRate)
      // stays the SEEDED era rate table for the world's life (1953/1979/1991
      // pegs, modern otherwise — re-anchoring on era crossings would snap
      // rates), and the CURRENT in-game year so the target's inflation/
      // prime-rate deviations are judged against the era monetary baselines
      // the world has graduated into (monetaryEra.ts).
      const forexResult = await runtime.runPhase("forexTurn", () =>
        processForexTurn(db, newTurn, gameState.preset, currentYear)
      );
      if (forexResult) {
        phaseResults.forexTurn = {
          countriesUpdated: forexResult.countriesUpdated,
          limitOrdersFilled: forexResult.limitOrdersFilled,
          limitOrdersExpired: forexResult.limitOrdersExpired,
          totalSpreadRevenue: forexResult.totalSpreadRevenue,
        };
      }
    } else {
      await runtime.markPhaseSkipped(
        "forexTurn",
        "featureDisabled",
        "Skipped because the forex system is disabled."
      );
    }

    const chairTurnResult = await runtime.runPhase("centralBankChairTurn", () =>
      processCentralBankChairTurn(db, newTurn)
    );
    if (chairTurnResult) {
      phaseResults.centralBankChairTurn = {
        banksProcessed: chairTurnResult.banksProcessed,
        chairsPenalized: chairTurnResult.chairsPenalized,
        bankWritesMatched: chairTurnResult.bankWritesMatched,
        bankWritesModified: chairTurnResult.bankWritesModified,
        highScrutinyDiagnostics: chairTurnResult.highScrutinyDiagnostics,
      };
    }
    const fomcResult = await runtime.runPhase("fomcMeetings", () =>
      processFomcMeetings(db, newTurn, currentYear, gameNow)
    );
    if (fomcResult) {
      phaseResults.fomcMeetings = {
        banksProcessed: fomcResult.banksProcessed,
        meetingsOpened: fomcResult.meetingsOpened,
        meetingsResolved: fomcResult.meetingsResolved,
        ratesChanged: fomcResult.ratesChanged,
        seatsReplaced: fomcResult.seatsReplaced,
      };
    }

    const nppMonetaryResult = await runtime.runPhase("nppMonetaryOperations", () =>
      processNppMonetaryOperations(db, newTurn, currentYear)
    );
    if (nppMonetaryResult) {
      phaseResults.nppMonetaryOperations = nppMonetaryResult;
    }

    const chairExecRemovalResult = await runtime.runPhase("centralBankChairExecutiveRemoval", () =>
      processCentralBankChairExecutiveRemoval(db, newTurn, gameNow)
    );
    if (chairExecRemovalResult) {
      phaseResults.centralBankChairExecutiveRemoval = {
        banksChecked: chairExecRemovalResult.banksChecked,
        chairsRemoved: chairExecRemovalResult.chairsRemoved,
        pendingCleared: chairExecRemovalResult.pendingCleared,
      };
    }

    const chairSelectionResult = await runtime.runPhase("centralBankChairSelection", () =>
      processCentralBankChairSelection(db, newTurn, gameNow)
    );
    if (chairSelectionResult) {
      phaseResults.centralBankChairSelection = {
        countriesChecked: chairSelectionResult.countriesChecked,
        selectionsTriggered: chairSelectionResult.selectionsTriggered,
        politicalPicks: chairSelectionResult.politicalPicks,
        economicPicks: chairSelectionResult.economicPicks,
        vacanciesRemaining: chairSelectionResult.vacanciesRemaining,
      };
    }

    // UK Independence/Reunification Desire drift. Runs after inflationRecalc
    // (so the inflation driver reads the just-updated value) and before
    // metricHistory (so the snapshot captures the new desire value).
    const independenceDesireResult = await runtime.runPhase("independenceDesireDrift", () =>
      processIndependenceDesireDrift(db, newTurn)
    );
    if (independenceDesireResult) {
      phaseResults.independenceDesireDrift = {
        regionsProcessed: independenceDesireResult.regionsProcessed,
      };
    }

    // Referendum lifecycle — advances any active UK independence/reunification
    // referendum's state machine. Runs after independenceDesireDrift so a
    // settled No-vote dampens the just-updated desire value.
    const referendumResult = await runtime.runPhase("referendumLifecycle", () =>
      processReferendumLifecycle(db, newTurn)
    );
    if (referendumResult) {
      phaseResults.referendumLifecycle = { processed: referendumResult.processed };
    }

    // Reconcile the denormalized party memberCount cache against live
    // membership before the party-history snapshot reads it. Runs here —
    // after all NPP/party churn for the turn has settled — so the stored
    // count (used by wiki / registration / coalition roster totals) stays
    // exact without manual heals. Cheap: two grouped aggregations + a
    // bulkWrite of only the parties that drifted.
    const memberCountReconcileResult = await runtime.runPhase("partyMemberCountReconcile", () =>
      reconcilePartyMemberCounts(db)
    );
    if (memberCountReconcileResult && memberCountReconcileResult.partiesUpdated > 0) {
      phaseResults.partyMemberCountReconcile = memberCountReconcileResult;
    }

    const [metricHistResult] = await Promise.all([
      runtime.runPhase("metricHistory", () => snapshotMetricHistory(db, newTurn)),
      runtime.runPhase("approvalSnapshot", async () => {
        const activeIds = COUNTRY_ORDER.filter((id) => COUNTRY_CONFIGS[id].status === "active");
        await Promise.all(activeIds.map((id) => snapshotApprovalHistory(db, id, newTurn)));
      }),
      runtime.runPhase("interestRateSnapshot", () => snapshotInterestRateHistory(db, newTurn)),
      runtime.runPhase("partyHistorySnapshot", () => snapshotPartyHistory(db, newTurn)),
    ]);
    phaseResults.metricHistory = { snapshotsTaken: metricHistResult ?? 0 };
    const activeCountryCount = COUNTRY_ORDER.filter(
      (id) => COUNTRY_CONFIGS[id].status === "active"
    ).length;
    phaseResults.approvalSnapshot = { countriesProcessed: activeCountryCount };

    const [portfolioSnapshotResult] = await Promise.all([
      runtime.runPhase("portfolioSnapshot", () => snapshotPortfolioValues(newTurn)),
      runtime.runPhase("corpPortfolioSnapshot", () => snapshotCorporationPortfolioValues(newTurn)),
      runtime.runPhase("stockExchangeSnapshot", () =>
        generateStockExchangeSnapshots(newTurn, context.db)
      ),
      runtime.runPhase("investorRankingSnapshot", () =>
        generateInvestorRankingSnapshot(newTurn, context.db)
      ),
      runtime.runPhase("wealthListSnapshot", () =>
        generateWealthListSnapshots(newTurn, context.db)
      ),
    ]);
    phaseResults.portfolioSnapshot = { charactersSnapshotted: portfolioSnapshotResult ?? 0 };

    // Anomaly scanners over the unified action-audit spine (forensics/alt-
    // detection rework plan §3.1 T3.1). Runs after activityLogging (already
    // completed earlier this turn) and before suspiciousDetection so a
    // future alt-scoring pass can consume the flags it stamps. Best-effort,
    // flag-gated (isAuditLogEnabled()) — a throw is caught by runPhase and
    // logged to Sentry without halting the turn.
    const anomalyScanResult = await runtime.runPhase("auditAnomalyScan", () =>
      runAuditAnomalyScan(db, newTurn)
    );
    if (anomalyScanResult) {
      phaseResults.auditAnomalyScan = {
        scannedRows: anomalyScanResult.scannedRows,
        flaggedRows: anomalyScanResult.flaggedRows,
      };
    }

    const suspiciousResult = await runtime.runPhase("suspiciousDetection", () =>
      processSuspiciousDetection(db, newTurn)
    );
    if (suspiciousResult) {
      phaseResults.suspiciousDetection = {
        flagged: suspiciousResult.flagged,
        cleared: suspiciousResult.cleared,
        deleted: suspiciousResult.deleted,
      };
    }

    const healthResult = await runtime.runPhase("gameHealthSnapshot", () =>
      processGameHealthSnapshot(
        db,
        newTurn,
        context.currentYear,
        Date.now() - startTimeMs,
        warnings.length === 0,
        [...warnings],
        phaseStatuses
      )
    );
    if (healthResult) {
      phaseResults.gameHealthSnapshot = healthResult;
    }
  },
};
