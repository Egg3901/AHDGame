import { getEraContext } from "@/lib/era/context";
import { processStatePartyElections } from "@/lib/statePartyElections";
import { processNationalPartyElections } from "@/lib/nationalPartyElections";
import { processNationalCommitteeElections } from "@/lib/nationalCommitteeElections";
import { processNPPTurn } from "@/lib/turn/nppBehavior";
import { processChallengerGeneration } from "@/lib/turn/npp/challengerSupply";
import { processNppBillSponsorship } from "@/lib/turn/npp/billSponsorship";
import { processBillLifecycle } from "@/lib/billLifecycle";
import { processStateBillTimers } from "@/lib/turn/billLifecycle/regionalEngine";
import { processCabinetNominationLifecycle } from "@/lib/cabinetNominationLifecycle";
import { processFomcNominationLifecycle } from "@/lib/fomcNominationLifecycle";
import { processScotusTurn } from "@/lib/turn/scotusTurn";
import { processUkJrSurpriseTurn } from "@/lib/turn/ukJrSurpriseTurn";
import { processSocialAxisDrift } from "@/lib/turn/socialAxisDrift";
import { processGovernorAPRegen } from "@/lib/turn/governorAPRegen";
import { seedOfficeStates } from "@/lib/governorOffice/seedOfficeStates";
import { processGovernorExecutiveOrders } from "@/lib/turn/governorOrders";
import { processGovernorAddressExpiry } from "@/lib/turn/governorAddressExpiry";
import { processGovernorEndorsements } from "@/lib/turn/governorEndorsements";
import { processExecutiveEndorsements } from "@/lib/turn/executiveEndorsements";
import { processGovernorLegislationQueue } from "@/lib/turn/governorLegislationQueue";
import { processActionRefresh } from "@/lib/turn/actionRefresh";
import { processCaucusTax } from "@/lib/turn/caucusTax";
import { processFundGeneration } from "@/lib/turn/fundGeneration";
import { processPartyActionGeneration } from "@/lib/turn/partyActionGeneration";
import { processPartyTierTurn } from "@/lib/turn/partyTierTurn";
import { processCampaignTurn } from "@/lib/turn/campaignTurn";
import { processPlayerRandomEventsTurn } from "@/lib/events/pree/driver";
import { sweepExpiredCountryModifiers } from "@/lib/events/substrate/countryModifiers";
import { processWorldEventsTurn } from "@/lib/events/worldEvents/driver";
import { processCampaignSpendReset } from "@/lib/turn/elections/campaignSpendReset";
import { resolveGeneralElections } from "@/lib/turn/electionResolution";
import {
  resolvePrimariesIfNeeded,
  recordPrimarySnapshots,
  accumulateGeneralElectionVotes,
} from "@/lib/turn/primaryResolution";
import {
  advanceElectionTimers,
  ensurePerpetualElections,
  cleanupStaleElectionCandidates,
} from "@/lib/turn/perpetualElections";
import {
  resolveExpiredLeadershipElections,
  vacateLeadershipAfterElections,
} from "@/lib/congress/leadershipElections";
import { processAlignmentTurn } from "@/lib/turn/alignmentPhase";
import { processSettlementTurn } from "@/lib/turn/settlementPhase";
import { processInternationalOrganizationsTurn } from "@/lib/turn/internationalOrganizationsPhase";
import { applyDecayToAllStates, processPartyGOTV } from "@/lib/turn/demographicTurnoutTurn";
import {
  processPartyOrgTurn,
  cleanupEmptyParties,
  processCaucusRelationshipMaintenance,
} from "@/lib/turn/partyOrg";
import { expireCharters } from "@/lib/turn/charters/expireCharters";
import { processRegDriftDecay } from "@/lib/turn/partyOrg/regDriftDecay";
import { processPressureDecay } from "@/lib/turn/politicalStrength/pressureDecay";
import { processCampaignBoostDecay } from "@/lib/turn/campaignBoostDecay";
import { processPriorityRegionDecay } from "@/lib/turn/politicalStrength/priorityRegionDecay";
import {
  processSupportDecay,
  processClearResolvedSupport,
} from "@/lib/turn/elections/supportDecay";
import { processSupportAccrualTick } from "@/lib/turn/elections/supportAccrual";
import { resolveExpiredDisbandVotes } from "@/lib/turn/coalitionDisbandCheck";
import {
  COUNTRY_BILL_PHASES,
  COUNTRY_ELECTION_PHASES,
  runPostElectionGovernmentPhases,
  runParliamentaryGovernmentPhases,
  runParliamentaryVacancyWatcher,
} from "@/lib/turn/countryPhases";
import { runNppGovernmentPhases } from "@/lib/nppAutonomy/processNppGovernment";
import { TURNS_PER_YEAR, STARTING_YEAR } from "@/lib/constants/turnTime";
import { isFiscalYearEnd, calculateFiscalYear, processFiscalYear } from "@/lib/budget/fiscalYear";
import { processAutoDisasterTurn } from "@/lib/turn/autoDisasterTurn";
import { processAutoCrisisTurn } from "@/lib/turn/autoCrisisTurn";
import { processColdWarTensionTurn } from "@/lib/turn/coldWarTensionTurn";
import { processAutoSectorSeed } from "@/lib/turn/autoSectorSeed";
import { processExtractionAutoStrategy } from "@/lib/turn/extractionAutoStrategy";
import { processCorporationTurn } from "@/lib/turn/corporationTurn";
import { processUnionsTurn } from "@/lib/turn/unions";
import { processNppUnionBehavior } from "@/lib/turn/unions/nppUnionBehavior";
import { processDecolonizationTurn } from "@/lib/turn/decolonizationTurn";
import { runNppCorporateAttacksPhase } from "@/lib/turn/nppCorporateAttacks";
import { processTreasuryTurn } from "@/lib/turn/treasuryTurn";
import { processCommodityPriceTurn } from "@/lib/turn/commodityPriceTurn";
import { processMacroCountryTurn } from "@/lib/world/macro";
import { processSphereSponsorTurn } from "@/lib/world/spheres";
import { getAllCountryAccess } from "@/lib/countryAccess";
import type { SphereSponsorController } from "@/lib/world/spheres";
import { resolveProspects } from "@/lib/turn/prospecting/resolveProspects";
import { settleExtractionContracts } from "@/lib/turn/extraction/contractSettlement";
import { isProspectingEnabled, isContractIssuanceEnabled } from "@/lib/extraction/featureFlag";
import { processBondTurn } from "@/lib/turn/bondTurn";
import { processDefenceWindfallRecoveryTurn } from "@/lib/turn/defenceWindfallRecoveryTurn";
import { recomputeSharePricesAfterBondTurn } from "@/lib/turn/corporation/recomputeSharePrices";
import { processSavingsInterestTurn } from "@/lib/turn/savingsInterestTurn";
import { processNpcBankPolicyTurn } from "@/lib/banking/npcBanks";
import { processBankingTurn } from "@/lib/turn/bankingTurn";
import { runPensionTurn } from "@/lib/pensions/pensionTurn";
import { processBankSolvencyTurn } from "@/lib/turn/bankSolvencyTurn";
import { processBankSupervision } from "@/lib/banking/supervision";
import { processLineOfCreditTurn } from "@/lib/turn/lineOfCreditTurn";
import { processNppFundGeneration } from "@/lib/turn/nppFundGeneration";
import { processNppActions } from "@/lib/turn/nppActionProcessing";
import { processExpiredBannedShareholders } from "@/lib/account/processExpiredBannedShareholders";
import { processInactiveShareholderShares } from "@/lib/account/processInactiveShareholderShares";
import { processInactiveCeoCorpShares } from "@/lib/account/processInactiveCeoCorpShares";
import { processPartyInfluenceTurn } from "@/lib/turn/partyInfluenceTurn";
import { processPresidentialSuccession } from "@/lib/turn/presidentialSuccession";
import { processImpeachmentLifecycle } from "@/lib/turn/impeachmentLifecycle";
import { processByElectionWatcher } from "@/lib/turn/byElections";
import { detectPreIterationComplete } from "@/lib/turn/preIterationLifecycle";
import { processActivityLogging } from "@/lib/turn/activityLogging";
import { runFinancialSuspectScan } from "@/lib/financialTxLog/suspectScan";
import { isLedgerShadowEnabledFromConfig } from "@/lib/ledger/featureFlag";
import { writeBalanceSnapshot } from "@/lib/ledger/balanceSnapshot";
import { snapshotMoneySupply } from "@/lib/moneySupply/snapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import { snapshotEconomicVitalSigns } from "@/lib/economy/economicVitalSigns";
import { runAutoReelectionEntry } from "@/lib/turn/autoReelectionEntry";
import { withdrawInactiveCandidates } from "@/lib/turn/withdrawInactiveCandidates";
import { stateEffectsAndNationalAggregationPhase } from "./stateEffectsPhase";
import type { TurnPhaseAdapter } from "@/simulation/engine/types";

export function getTurnPhaseRegistry(): TurnPhaseAdapter[] {
  return [
    {
      key: "expiredBannedShareholderCleanup",
      async execute(context, runtime) {
        const { db, realNow, newTurn, gameState, phaseResults } = context;
        const result = await runtime.runPhase("bannedShareholderRelease", () =>
          processExpiredBannedShareholders(db, {
            now: realNow,
            currentTurn: newTurn,
            forexEnabled: gameState.forexEnabled === true,
          })
        );
        if (result) {
          phaseResults.bannedShareholderRelease = {
            usersProcessed: result.usersProcessed,
            sharesReleasedToFloat: result.sharesReleasedToFloat,
            ceoCorpsVacated: result.ceoCorpsVacated,
            ordersCancelled: result.ordersCancelled,
            listingsCancelled: result.listingsCancelled,
            offersCancelled: result.offersCancelled,
          };
        }
      },
    },
    {
      key: "inactiveShareholderShareRelease",
      async execute(context, runtime) {
        const { db, realNow, gameState, phaseResults } = context;
        const result = await runtime.runPhase("inactiveShareholderShareRelease", async () => {
          const forexEnabled = gameState.forexEnabled === true;
          // User-side: personally-held shares of inactive users. Corp-side:
          // cross-corp equity held by corps whose CEO is inactive. Both before
          // the corporation turn so float/holdings are settled for dividends.
          const userSide = await processInactiveShareholderShares(db, {
            now: realNow,
            forexEnabled,
          });
          const corpSide = await processInactiveCeoCorpShares(db, {
            now: realNow,
            forexEnabled,
          });
          return {
            usersProcessed: userSide.usersProcessed,
            corpsProcessed: corpSide.corpsProcessed,
            corpsWarned: corpSide.corpsWarned,
            warningsSent: corpSide.warningsSent,
            sharesReleasedToFloat: userSide.sharesReleasedToFloat + corpSide.sharesReleasedToFloat,
            sharePositionsReleased:
              userSide.sharePositionsReleased + corpSide.sharePositionsReleased,
            ordersCancelled: userSide.ordersCancelled + corpSide.ordersCancelled,
            listingsCancelled: userSide.listingsCancelled + corpSide.listingsCancelled,
            offersCancelled: userSide.offersCancelled + corpSide.offersCancelled,
          };
        });
        if (result) {
          phaseResults.inactiveShareholderShareRelease = result;
        }
      },
    },
    {
      key: "resourceAndFinanceStart",
      async execute(context, runtime) {
        const { characters, config, gameNow, stateMap, gameState, newTurn, phaseResults } = context;
        // When an admin pauses corporation actions, the corporate turn phase
        // (sector revenue, operating income, dividends, market-cap/history
        // snapshots) is skipped entirely, this is what makes the admin toggle's
        // "corporate phases will be skipped during turn processing" promise true.
        // Bond servicing (processBondTurn) is intentionally NOT skipped here: it
        // settles existing contractual coupons/maturities, including sovereign
        // bonds held by players, which are not "corporation actions".
        //
        // That is still true of SETTLEMENT, but processBondTurn now gates its own
        // default DETECTION on this same flag (ticket #1198). Paying a coupon out
        // of a corp whose revenue this pause just switched off is contractual;
        // liquidating it for the resulting cash hole is the pause's own doing.
        // Corporation #624 was defaulted twice that way. See Phase 3 in
        // `bondTurn.ts` for the full argument.
        const corpActionsPaused = gameState.corporationActionsPaused === true;
        // Skip the disaster spawner while corporate actions are paused: the
        // corporation turn (which applies the onset margin penalty) is skipped
        // below, so spawning now would stamp lastDisasterTurn and waste the
        // full-strength onset turn on an inert economy. Deferring keeps the
        // cadence honest, it fires on the next unpaused turn instead.
        if (!corpActionsPaused) {
          await runtime.runPhase("autoDisasterTurn", () =>
            processAutoDisasterTurn(context.db, newTurn, gameState)
          );
          await runtime.runPhase("autoCrisisTurn", () =>
            processAutoCrisisTurn(context.db, newTurn, gameState)
          );
        }
        // Global cold-war tension relaxes toward its standing-pressure floor.
        // Deliberately OUTSIDE the corpActionsPaused gate: tension is world
        // politics, not a corporation action, and pausing the economy should
        // not freeze the temperature of the Cold War. Gated internally on
        // gameState.coldWarEnabled; a world with the subsystem off is a no-op.
        await runtime.runPhase("coldWarTension", () =>
          processColdWarTensionTurn(context.db, newTurn, gameState)
        );
        await runtime.runPhase("autoSectorSeed", () =>
          processAutoSectorSeed(context.db, newTurn, gameState)
        );
        // Extraction auto strategy adoption (remediation Phase 1a). Runs right
        // after auto-seed and BEFORE the corporation turn so a newly-adopted
        // focused mining strategy is in effect when this turn's supply/revenue
        // is computed. Reads the prior turn's commodity S/D (one-turn lag, same
        // as auto-seed); writes only sector strategy fields. Inert unless
        // gameState.extractionAutoStrategyEnabled.
        await runtime.runPhase("extractionAutoStrategy", () =>
          processExtractionAutoStrategy(context.db, newTurn, gameState)
        );
        const [, fundGenResults, corpTurnResults] = await Promise.all([
          runtime.runPhase("actionRefresh", () =>
            processActionRefresh(characters, config, gameNow)
          ),
          runtime.runPhase("fundGeneration", () =>
            processFundGeneration(characters, gameNow, stateMap, gameState.forexEnabled, newTurn)
          ),
          corpActionsPaused
            ? Promise.resolve(null)
            : runtime.runPhase("corporationTurn", () => processCorporationTurn(newTurn)),
        ]);

        if (corpActionsPaused) {
          await runtime.markPhaseSkipped(
            "corporationTurn",
            "manualPause",
            "Skipped because an admin paused corporation actions."
          );
        } else {
          // NPP Autonomy V2.2, autonomous NPP corporate aggression. Runs after
          // the corporation phase settles finances/MS so attacks see the turn's
          // up-to-date balances. Self-gates per attacker country on
          // nppAutonomyAtLeast(v2); a no-op below the comingle tier.
          await runtime.runPhase("nppCorporateAttacks", () =>
            runNppCorporateAttacksPhase(gameNow, newTurn)
          );
        }

        // Union dues v1: union treasury accrual (dues income minus service
        // cost, services lapsing rather than overdrawing) + approval trend
        // toward its target. Runs right after corporationTurn since
        // sectorCalculations.ts reads each represented union's approval THIS
        // same turn (via unionizationDriftTarget), sequencing after keeps the
        // read using last turn's persisted value, consistent with the rest of
        // the labour system's one-turn lag.
        await runtime.runPhase("unionsTurn", () => processUnionsTurn(context.db));

        // NPP industrial-relations parity. This elects NPP union leaders and
        // opens employer-scoped campaigns for them, and lets autonomous unions
        // and CEOs use the shared offer, mediation, escalation, and agreement
        // lifecycle. Runs after unionsTurn so deadline transitions and dues
        // are already visible.
        await runtime.runPhase("nppUnionBehavior", () =>
          processNppUnionBehavior(context.db, newTurn)
        );

        // Decolonization. The sovereignty-transition engine in
        // src/lib/world/transitions had NO turn-path caller at all, so the
        // colonial map never changed: Ghana 1957, Somalia and the Congo 1960,
        // Algeria 1962, Guyana 1966 and South Yemen 1967 all fall inside a
        // 1953 world's 1000-turn span and none of them happened. Runs on the
        // in-game year boundary only.
        await runtime.runPhase("decolonization", () =>
          processDecolonizationTurn(context.db, newTurn, gameState.currentYear)
        );

        await runtime.runPhase("partyInfluenceTurn", () =>
          processPartyInfluenceTurn(characters, config, gameNow)
        );

        const caucusTaxResult = await runtime.runPhase("caucusTax", () =>
          processCaucusTax(gameState.forexEnabled === true, newTurn)
        );
        if (caucusTaxResult) {
          phaseResults.caucusTax = {
            caucusesProcessed: caucusTaxResult.caucusesProcessed,
            membersTaxed: caucusTaxResult.membersTaxed,
            totalTaxed: caucusTaxResult.totalTaxed,
          };
        }

        phaseResults.actionRefresh = {
          charactersProcessed: characters.length,
          totalActionsGranted: characters.length * Math.max(config?.baseActionsPerTurn ?? 0, 4),
        };

        if (fundGenResults) {
          phaseResults.fundGeneration = {
            charactersProcessed: characters.length,
            totalGenerated: fundGenResults.totalGenerated,
            bySource: {
              stateTaxes: fundGenResults.totalStateTaxes,
              nationalTaxes: fundGenResults.totalNationalTaxes,
            },
          };
        }

        if (corpTurnResults) {
          phaseResults.corporationTurn = {
            corporationsProcessed: corpTurnResults.corporationsProcessed,
            sectorsProcessed: corpTurnResults.sectorsProcessed,
            totalRevenueGenerated: corpTurnResults.totalRevenueGenerated,
            totalIncomeGenerated: corpTurnResults.totalIncomeGenerated,
          };
        }

        // Live fiscal accrual into the signed treasury balance. Runs after the
        // corporation turn so SOE remittance/draws have settled into the treasury
        // this turn before the budget's primary slice is applied.
        const treasuryResult = await runtime.runPhase("treasuryTurn", () =>
          processTreasuryTurn(newTurn)
        );
        if (treasuryResult) {
          phaseResults.treasuryTurn = {
            countriesProcessed: treasuryResult.countriesProcessed,
          };
        }

        const nppFundResult = await runtime.runPhase("nppFundGeneration", () =>
          processNppFundGeneration(context.db, newTurn, stateMap)
        );
        if (nppFundResult) {
          phaseResults.nppFundGeneration = nppFundResult;
        }

        const savingsInterestResult = await runtime.runPhase("savingsInterestTurn", () =>
          processSavingsInterestTurn(context.db, newTurn)
        );
        if (savingsInterestResult) {
          phaseResults.savingsInterestTurn = {
            charactersProcessed: savingsInterestResult.charactersProcessed,
            totalInterest: Math.round(savingsInterestResult.totalInterest * 100) / 100,
          };
        }

        // NPC bank rate policy - BEFORE bankingTurn so mid-corridor offsets
        // apply to this turn's deposit/loan pricing. Seeds run at bootstrap only.
        const npcBankPolicyResult = await runtime.runPhase("npcBankPolicyTurn", () =>
          processNpcBankPolicyTurn(context.db, newTurn)
        );
        if (npcBankPolicyResult) {
          phaseResults.npcBankPolicyTurn = {
            banksChecked: npcBankPolicyResult.banksChecked,
            banksUpdated: npcBankPolicyResult.banksUpdated,
          };
        }

        // Private-bank deposits/loans - AFTER savingsInterestTurn so CB-held
        // accounts mint first and bank-held accounts are paid from bank cash here.
        const bankingResult = await runtime.runPhase("bankingTurn", () =>
          processBankingTurn(context.db, newTurn)
        );
        if (bankingResult) {
          phaseResults.bankingTurn = {
            banksProcessed: bankingResult.banksProcessed,
            depositInterestPaid: Math.round(bankingResult.depositInterestPaid * 100) / 100,
            loanInterestCollected: Math.round(bankingResult.loanInterestCollected * 100) / 100,
            loanPrincipalRepaid: Math.round(bankingResult.loanPrincipalRepaid * 100) / 100,
            defaultsWrittenOff: Math.round(bankingResult.defaultsWrittenOff * 100) / 100,
            npcDepositDelta: Math.round(bankingResult.npcDepositDelta * 100) / 100,
          };
        }

        // A8 pension contributions - AFTER corporationTurn, which is what
        // writes the `laborCost` this reads, so the charge is always against
        // THIS turn's wage bill rather than last turn's.
        const pensionResult = await runtime.runPhase("pensionTurn", () =>
          runPensionTurn(context.db, newTurn)
        );
        if (pensionResult) {
          phaseResults.pensionTurn = {
            schemesCharged: pensionResult.schemesCharged,
            contributionsAnchor: Math.round(pensionResult.contributionsAnchor * 100) / 100,
            topUpsAnchor: Math.round(pensionResult.topUpsAnchor * 100) / 100,
            accrualsAnchor: Math.round(pensionResult.accrualsAnchor * 100) / 100,
            shortfalls: pensionResult.shortfalls,
            benefitsPaidAnchor: Math.round(pensionResult.benefits.benefitsPaidAnchor * 100) / 100,
            benefitsUnpaidAnchor:
              Math.round(pensionResult.benefits.benefitsUnpaidAnchor * 100) / 100,
            schemesCutting: pensionResult.benefits.schemesCutting,
            investedAnchor: Math.round(pensionResult.investing.investedAnchor * 100) / 100,
            schemesInvesting: pensionResult.investing.schemesInvesting,
          };
        }

        // Resource prospecting resolution, runs AFTER corporationTurn (so this
        // turn's corp state/rdScore is settled) and BEFORE commodityPrices (so a
        // survey's new capacity is visible to this turn's extraction S/D). No-op
        // unless prospectingEnabled. Emits notifications only; the survey cost
        // was charged at launch.
        if (await isProspectingEnabled(config)) {
          // getEraContext, NOT gameState.currentYear: currentYear is set on every
          // world regardless of `eraSystemEnabled`, so passing it directly
          // applied era scaling in worlds with the era clock OFF, and left
          // duration (which DOES go through getEraContext at launch) gated
          // differently from success and yield.
          const prospectEraYear = (await getEraContext(context.db)).year;
          const prospectResult = await runtime.runPhase("prospectingResolution", () =>
            resolveProspects(context.db, newTurn, context.realNow, undefined, prospectEraYear)
          );
          if (prospectResult) {
            (phaseResults as Record<string, unknown>).prospectingResolution = prospectResult;
          }
        } else {
          await runtime.markPhaseSkipped(
            "prospectingResolution",
            "featureDisabled",
            "Skipped because resource prospecting is disabled."
          );
        }

        // Tier-2 sphere-macro kernel, MUST run before commodityPrices so a
        // same-turn refresh is visible in this turn's global market calculation.
        // Non-tick turns are a cheap no-op; held contributions persist.
        const macroCountryResult = await runtime.runPhase("macroCountryTurn", () =>
          processMacroCountryTurn(context.db, newTurn)
        );
        if (macroCountryResult) {
          (phaseResults as Record<string, unknown>).macroCountryTurn = {
            countriesUpdated: macroCountryResult.countriesUpdated,
            updatedEntityIds: macroCountryResult.updatedEntityIds,
          };
        }

        // NPP sphere sponsorship (#3718), cadence-gated relationship drift
        // before commodity/sphere routing so same-turn membership changes apply.
        const sphereSponsorResult = await runtime.runPhase("sphereSponsorTurn", async () => {
          const access = await getAllCountryAccess(context.db);
          const controllerBySponsor = new Map<string, SphereSponsorController>();
          for (const [countryId, row] of Object.entries(access)) {
            controllerBySponsor.set(countryId, row.enabledForPlayers ? "player" : "npp");
          }
          return processSphereSponsorTurn(context.db, newTurn, controllerBySponsor);
        });
        if (sphereSponsorResult) {
          (phaseResults as Record<string, unknown>).sphereSponsorTurn = {
            entitiesConsidered: sphereSponsorResult.entitiesConsidered,
            decisions: sphereSponsorResult.decisions.length,
            skippedSponsors: sphereSponsorResult.skippedSponsors,
          };
        }

        const [bondTurnResult, commodityResult] = await Promise.all([
          runtime.runPhase("bondTurn", () => processBondTurn(newTurn)),
          runtime.runPhase("commodityPrices", () => processCommodityPriceTurn(newTurn)),
        ]);

        // Collect a staged procurement-windfall assessment after bond coupons
        // and maturities land, while preserving the supplier's operating reserve.
        // This runs before share-price recomputation so the balance sheet and
        // price snapshot agree in the same turn.
        const windfallRecovery = await runtime.runPhase("defenceWindfallRecovery", () =>
          processDefenceWindfallRecoveryTurn(context.db, newTurn, context.realNow)
        );
        if (windfallRecovery) {
          (phaseResults as Record<string, unknown>).defenceWindfallRecovery = windfallRecovery;
        }

        // Extraction-contract settlement, runs AFTER commodityPrices because
        // the per-turn royalty is priced off this turn's market. No-op unless
        // contractIssuanceEnabled. Charges corps, credits issuers, lapses expired
        // offers/terms, and defaults on repeated non-payment.
        if (await isContractIssuanceEnabled(config)) {
          const settlementResult = await runtime.runPhase("contractSettlement", () =>
            settleExtractionContracts(context.db, newTurn, context.realNow)
          );
          if (settlementResult) {
            (phaseResults as Record<string, unknown>).contractSettlement = settlementResult;
          }
        } else {
          await runtime.markPhaseSkipped(
            "contractSettlement",
            "featureDisabled",
            "Skipped because extraction-contract issuance is disabled."
          );
        }

        const lineOfCreditResult = await runtime.runPhase("lineOfCreditTurn", () =>
          processLineOfCreditTurn(
            context.db,
            newTurn,
            corpTurnResults?.currencyIncomeInternalByCharacterId ?? new Map(),
            corpTurnResults?.currencyIncomeFaceByCharacterId ?? new Map(),
            gameState.forexEnabled === true
          )
        );
        if (lineOfCreditResult) {
          phaseResults.lineOfCreditTurn = {
            charactersProcessed: lineOfCreditResult.charactersProcessed,
            paymentsInternal: Math.round(lineOfCreditResult.paymentsInternal * 1e6) / 1e6,
          };
        }

        await runtime.runPhase("recomputeSharePrices", () =>
          recomputeSharePricesAfterBondTurn(newTurn)
        );

        // Private-bank solvency/flight/contagion - AFTER recomputeSharePrices so
        // prop-book marking (phase 7) can land against fresh prices with this
        // phase already ordered correctly.
        const solvencyResult = await runtime.runPhase("bankSolvencyTurn", () =>
          processBankSolvencyTurn(context.db, newTurn)
        );
        if (solvencyResult) {
          phaseResults.bankSolvencyTurn = {
            banksEvaluated: solvencyResult.banksEvaluated,
            fled: Math.round(solvencyResult.fled * 100) / 100,
            failures: solvencyResult.failures,
            contagionTriggered: solvencyResult.contagionTriggered,
          };
        }

        // B7 supervision: capital adequacy, stress test, forced recap. Runs
        // AFTER solvency so it reads the same turn's marked prop book and
        // settled deposit aggregates. Distinct from solvency on purpose:
        // solvency asks whether the bank can meet withdrawals today,
        // supervision asks whether it holds enough capital for what it lent.
        const supervisionResult = await runtime.runPhase("bankSupervision", () =>
          processBankSupervision(context.db, newTurn)
        );
        if (supervisionResult) {
          phaseResults.bankSupervision = {
            banksAssessed: supervisionResult.banksAssessed,
            stressed: supervisionResult.stressed,
            undercapitalized: supervisionResult.undercapitalized,
            chartersRevoked: supervisionResult.chartersRevoked,
          };
        }

        const suspectScanResult = await runtime.runPhase("financialSuspectScan", () =>
          runFinancialSuspectScan(context.db, newTurn)
        );
        phaseResults.financialSuspectScan = suspectScanResult === null ? null : true;

        if (bondTurnResult) {
          phaseResults.bondTurn = {
            bondsProcessed: bondTurnResult.bondsProcessed,
            couponsPaid: bondTurnResult.couponsPaid,
            bondsMatured: bondTurnResult.bondsMatured,
            bondsDefaulted: bondTurnResult.bondsDefaulted,
            totalCouponsPaid: bondTurnResult.totalCouponsPaid,
            bondHistorySnapshots: bondTurnResult.bondHistorySnapshots,
          };
        }

        if (commodityResult) {
          phaseResults.commodityPrices = {
            commoditiesUpdated: commodityResult.commoditiesUpdated,
            statesWithActivity: commodityResult.statesWithActivity,
          };
        }
      },
    },
    {
      key: "demographicsAndPartySetup",
      async execute(context, runtime) {
        const { stateMap, newTurn, gameNow, phaseResults, realNow, db } = context;
        const decayedStates = await runtime.runPhase("turnoutDecay", () => applyDecayToAllStates());
        const gotvResults = await runtime.runPhase("partyGOTV", () =>
          processPartyGOTV(
            undefined,
            undefined,
            undefined,
            undefined,
            stateMap,
            undefined,
            undefined,
            newTurn
          )
        );
        await runtime.runPhase("partyOrgTurn", () => processPartyOrgTurn());

        // Phase 3 turn-pipeline additions: drift→decay (Phase 0.5 §8.3 steps 3-4),
        // PS pressure decay, and Priority Region cluster validation. Run sequentially
        // AFTER partyOrgTurn settles so drift reads up-to-date Org values, and before
        // the parallel block of party elections / partyActionGeneration so the
        // Reg / pressure layer is consistent for every downstream reader this turn.
        const regDriftDecayResult = await runtime.runPhase("regDriftDecay", () =>
          processRegDriftDecay(newTurn, realNow)
        );
        if (regDriftDecayResult) {
          phaseResults.regDriftDecay = regDriftDecayResult;
        }
        const pressureDecayResult = await runtime.runPhase("pressureDecay", () =>
          processPressureDecay(newTurn, realNow)
        );
        if (pressureDecayResult) {
          phaseResults.pressureDecay = pressureDecayResult;
        }
        const priorityRegionDecayResult = await runtime.runPhase("priorityRegionDecay", () =>
          processPriorityRegionDecay()
        );
        if (priorityRegionDecayResult) {
          phaseResults.priorityRegionDecay = priorityRegionDecayResult;
        }
        // Redistricting Campaign Here boosts erode toward 0 each turn (flag-gated no-op when off).
        await runtime.runPhase("campaignBoostDecay", () =>
          processCampaignBoostDecay(newTurn, realNow)
        );

        // Phase F: candidate Support regression-to-mean. Runs after the
        // Reg/PS decay pass so vote-distribution reads consistent values.
        const supportDecayResult = await runtime.runPhase("supportDecay", () =>
          processSupportDecay(newTurn, realNow)
        );
        if (supportDecayResult) {
          phaseResults.supportDecay = supportDecayResult;
        }

        // Phase B (B1), apply queued rally-accrual drips before
        // vote-distribution reads Support this turn. Ordering matters:
        // accruals applied BEFORE supportDecay would have the just-
        // applied drip immediately partially decayed; running it AFTER
        // means a rally's trailing 40% drip is "fresh" relative to the
        // tally that runs later in the turn.
        const supportAccrualResult = await runtime.runPhase("supportAccrual", () =>
          processSupportAccrualTick(newTurn, realNow)
        );
        if (supportAccrualResult) {
          phaseResults.supportAccrual = supportAccrualResult;
        }

        phaseResults.turnoutProcessing = {
          statesDecayed: decayedStates?.length ?? 0,
          gotvBudgetsProcessed: gotvResults?.budgets?.length ?? 0,
          canvassingProcessed: 0,
        };

        if (decayedStates && gotvResults) {
          console.log(
            `[Turn] Demographic turnout processed: ${decayedStates.length} states decayed, ${gotvResults.budgets.length} party budgets processed`
          );
        }

        // Party tier (Major/Minor) recompute (D5). Runs AFTER partyOrgTurn
        // settles Org and BEFORE partyActionGeneration so the tier-derived PS
        // cap is fresh when PS is generated this turn. Sequential: it writes
        // tier/psCapEarnedRegions/politicalStrength that partyActionGeneration
        // reads in the parallel block below.
        const partyTierResult = await runtime.runPhase("partyTierTurn", () =>
          processPartyTierTurn(newTurn, realNow)
        );
        if (partyTierResult) {
          phaseResults.partyTierTurn = partyTierResult;
        }

        const [
          stateElectionResults,
          nationalElectionResults,
          committeeElectionResults,
          partyActionResults,
        ] = await Promise.all([
          runtime.runPhase("statePartyElections", () =>
            processStatePartyElections(newTurn, gameNow)
          ),
          runtime.runPhase("nationalPartyElections", () =>
            processNationalPartyElections(newTurn, gameNow)
          ),
          runtime.runPhase("nationalCommitteeElections", () =>
            processNationalCommitteeElections(newTurn, gameNow)
          ),
          runtime.runPhase("partyActionGeneration", () =>
            processPartyActionGeneration(gameNow, undefined, newTurn)
          ),
        ]);

        phaseResults.partyElections = {
          stateElectionsCompleted: stateElectionResults?.electionsCompleted ?? 0,
          nationalElectionsCompleted: nationalElectionResults?.electionsCompleted ?? 0,
          committeeElectionsCompleted: committeeElectionResults?.electionsCompleted ?? 0,
        };

        if (partyActionResults) {
          phaseResults.partyActions = {
            totalActionsGenerated: partyActionResults.totalActionsGenerated,
          };
        }

        // Phase 6: expire stale charters BEFORE emptyPartyCleanup so the
        // chartered-party immunity check reads up-to-date status (an
        // already-expired charter no longer protects its party).
        const expireChartersResult = await runtime.runPhase("expireCharters", () =>
          expireCharters(newTurn, gameNow)
        );
        if (
          expireChartersResult &&
          (expireChartersResult.expiredFromPending > 0 ||
            expireChartersResult.expiredFromReplacement > 0)
        ) {
          phaseResults.expireCharters = expireChartersResult;
        }

        const emptyPartyResult = await runtime.runPhase("emptyPartyCleanup", () =>
          cleanupEmptyParties()
        );
        if (emptyPartyResult && emptyPartyResult.deletedParties.length > 0) {
          phaseResults.emptyPartyCleanup = {
            partiesDeleted: emptyPartyResult.deletedParties.length,
            stateOrgsDeleted: emptyPartyResult.deletedStatePartyOrgs,
          };
        }

        await runtime.runPhase("coalitionDisbandVotes", () => resolveExpiredDisbandVotes(gameNow));

        const nppRelationshipMaintenanceResult = await runtime.runPhase(
          "nppRelationshipMaintenance",
          () => processCaucusRelationshipMaintenance(gameNow)
        );
        if (nppRelationshipMaintenanceResult) {
          phaseResults.nppRelationshipMaintenance = nppRelationshipMaintenanceResult;
        }

        // Fire any queued governor legislation BEFORE nppBehavior so NPPs can
        // vote on the just-introduced bill in the same turn.
        const governorQueueResult = await runtime.runPhase("governorLegislationQueue", () =>
          processGovernorLegislationQueue(db, newTurn)
        );
        if (governorQueueResult) {
          phaseResults.governorLegislationQueue = governorQueueResult;
        }

        // NPP autonomous bill sponsorship runs BEFORE nppBehavior so NPPs can
        // vote on the just-introduced bills in the same turn.
        await runtime.runPhase("nppBillSponsorship", async () => {
          // Load a lightweight NPP context scoped to the current turn so we have
          // nppOfficials + nppMap without the full voting/election machinery.
          const { loadNPPContext } = await import("@/lib/turn/npp/context");
          const sponsorCtx = await loadNPPContext(gameNow, {
            billDeadlineNow: realNow,
            currentTurn: newTurn,
          });
          const billsProposed = await processNppBillSponsorship(sponsorCtx);
          if (billsProposed > 0) {
            console.log(`[Turn] NPP bill sponsorship: ${billsProposed} bills introduced`);
          }
          return { billsProposed };
        });

        // File bench challengers directly into otherwise-uncontested single-seat
        // primaries (governor/senate) BEFORE nppBehavior, governor is last in
        // RACE_PRIORITY so nppBehavior's own Phase-2 starves it. Running first
        // means nppBehavior (which reloads context this same turn) sees the filed
        // candidate and won't double-fill the race.
        await runtime.runPhase("generateChallengers", () => processChallengerGeneration(gameNow));

        const nppResult = await runtime.runPhase("nppBehavior", () =>
          processNPPTurn(gameNow, { billDeadlineNow: realNow, currentTurn: newTurn })
        );
        if (nppResult) {
          phaseResults.nppBehavior = {
            nppsEntered: nppResult.entered,
            billVotesCast: nppResult.votescast,
            speakerVotesCast: nppResult.speakerVotes,
          };
        }
      },
    },
    {
      key: "billsCampaignsAndActivity",
      async execute(context, runtime) {
        const { realNow, phaseResults, newTurn, db, config, gameState } = context;
        const countryBillPhaseEntries = Object.entries(COUNTRY_BILL_PHASES);
        const billPhaseResults = await Promise.all([
          runtime.runPhase("billLifecycle", () => processBillLifecycle(realNow)),
          ...countryBillPhaseEntries.map(([, entry]) =>
            runtime.runPhase(entry.phaseName, () => entry.fn(realNow))
          ),
          runtime.runPhase("stateBillTimers", () => processStateBillTimers(realNow)),
          runtime.runPhase("cabinetNominations", () => processCabinetNominationLifecycle(realNow)),
          // SCOTUS (#3598): runs in the same parallel group as cabinetNominations
          // (a like-shaped Senate-confirmation lifecycle) and BEFORE
          // socialAxisDrift below, a diverged case's synthesized enactment
          // writes statePolicies this same turn, and socialAxisDrift reads
          // whatever statePolicies rows the bill phases just wrote.
          runtime.runPhase("scotusTurn", () =>
            processScotusTurn(gameState.currentTurn, realNow, db)
          ),
          // UK JR surprise flavor, same parallel group as SCOTUS; UK-only
          // mild uk_* enactments tagged uk_judicial_review_surprise.
          runtime.runPhase("ukJrSurpriseTurn", () =>
            processUkJrSurpriseTurn(gameState.currentTurn, db)
          ),
          // FOMC seat confirmations, a like-shaped Senate-confirmation lifecycle,
          // appended last so the index math above is unchanged.
          runtime.runPhase("fomcNominations", () => processFomcNominationLifecycle(realNow)),
        ]);
        const countryBillResultsStart = 1;
        const stateBillResultIndex = countryBillResultsStart + countryBillPhaseEntries.length;
        const cabinetNominationResultIndex = stateBillResultIndex + 1;
        const scotusTurnResultIndex = cabinetNominationResultIndex + 1;
        const ukJrSurpriseResultIndex = scotusTurnResultIndex + 1;
        const billLifecycleResult = billPhaseResults[0] as Awaited<
          ReturnType<typeof processBillLifecycle>
        > | null;
        const countryBillResults = billPhaseResults.slice(
          countryBillResultsStart,
          stateBillResultIndex
        );
        const stateBillTimersResult = billPhaseResults[stateBillResultIndex] as Awaited<
          ReturnType<typeof processStateBillTimers>
        > | null;
        const cabinetNominationResult = billPhaseResults[cabinetNominationResultIndex] as Awaited<
          ReturnType<typeof processCabinetNominationLifecycle>
        > | null;
        const scotusTurnResult = billPhaseResults[scotusTurnResultIndex] as Awaited<
          ReturnType<typeof processScotusTurn>
        > | null;
        const ukJrSurpriseResult = billPhaseResults[ukJrSurpriseResultIndex] as Awaited<
          ReturnType<typeof processUkJrSurpriseTurn>
        > | null;
        const fomcNominationResult = billPhaseResults[ukJrSurpriseResultIndex + 1] as Awaited<
          ReturnType<typeof processFomcNominationLifecycle>
        > | null;
        phaseResults.fomcNominations = fomcNominationResult ?? null;

        phaseResults.billLifecycle = billLifecycleResult ?? {
          billsProcessed: 0,
          billsPassed: 0,
          billsFailed: 0,
          billsVetoed: 0,
        };
        phaseResults.stateBillTimers = stateBillTimersResult ?? { billsProcessed: 0 };
        phaseResults.cabinetNominations = cabinetNominationResult ?? {
          nominationsProcessed: 0,
        };
        phaseResults.scotusTurn = scotusTurnResult ?? {
          tenure: { seatsAdvanced: 0, seatsVacatedByHistory: 0, seatsVacatedByHazard: 0 },
          docket: { casesFired: 0, casesAffirmed: 0, casesDiverged: 0 },
          surpriseCase: { spawned: false },
          nominations: { nominationsProcessed: 0, confirmed: 0, rejected: 0 },
        };
        phaseResults.ukJrSurpriseTurn = ukJrSurpriseResult ?? { spawned: false };

        const phaseResultsRecord = phaseResults as Record<string, unknown>;
        countryBillPhaseEntries.forEach(([, entry], index) => {
          const result = countryBillResults[index] ?? null;
          phaseResultsRecord[entry.phaseName] = result ?? entry.emptyResult;
        });

        // Country social-axis drift, runs sequentially AFTER bill enactment so
        // it reads the statePolicies rows the bill phases just wrote this turn.
        // Pass gameState.currentTurn (NOT newTurn): the bill phases stamp
        // enactedTurn with the pre-increment currentTurn, which the turn system
        // only advances to newTurn after every phase has run.
        const socialAxisDriftResult = await runtime.runPhase("socialAxisDrift", () =>
          processSocialAxisDrift(db, gameState.currentTurn)
        );
        if (socialAxisDriftResult) {
          phaseResults.socialAxisDrift = socialAxisDriftResult;
        }

        // Governor's Office maintenance, runs sequentially AFTER bill enactment so
        // supersession of executive orders by same-turn bills is deterministic.
        //
        // Ensure an office-state row exists for every current regional executive
        // + national seat BEFORE regen. `seedOfficeStates` only ever runs at
        // bootstrap/reset, so a region added later (e.g. the Ireland build-out)
        // has no `governorOfficeState` row, its office AP reads `?? 0` and
        // `governorAPRegen` has nothing to increment, freezing AP at 0 forever.
        // The seed is idempotent (skips existing rows) and creates any missing
        // row at the action cap, so it self-heals here and the row is then
        // eligible for regen on the same turn.
        const officeStateSeedResult = await runtime.runPhase("officeStateSeed", () =>
          seedOfficeStates(db, newTurn)
        );
        if (officeStateSeedResult) {
          phaseResults.officeStateSeed = officeStateSeedResult;
        }
        const governorAPRegenResult = await runtime.runPhase("governorAPRegen", () =>
          processGovernorAPRegen(db, newTurn)
        );
        if (typeof governorAPRegenResult === "number") {
          phaseResults.governorAPRegen = { actionsGranted: governorAPRegenResult };
        }
        const governorOrdersResult = await runtime.runPhase("governorExecutiveOrders", () =>
          processGovernorExecutiveOrders(db, newTurn)
        );
        if (governorOrdersResult) {
          phaseResults.governorExecutiveOrders = governorOrdersResult;
        }
        const governorAddressExpiryResult = await runtime.runPhase("governorAddressExpiry", () =>
          processGovernorAddressExpiry(db, newTurn)
        );
        if (governorAddressExpiryResult) {
          phaseResults.governorAddressExpiry = governorAddressExpiryResult;
        }
        // Run BEFORE campaignTurn so endorsement auto-withdrawals propagate.
        const governorEndorsementsResult = await runtime.runPhase("governorEndorsements", () =>
          processGovernorEndorsements(db)
        );
        if (governorEndorsementsResult) {
          phaseResults.governorEndorsements = governorEndorsementsResult;
        }
        const executiveEndorsementsResult = await runtime.runPhase("executiveEndorsements", () =>
          processExecutiveEndorsements(db)
        );
        if (executiveEndorsementsResult) {
          phaseResults.executiveEndorsements = executiveEndorsementsResult;
        }
        // Player endorsements must not outlive their issuer's party alignment
        // (ticket #1179). Same placement rationale as governor/executive above:
        // withdraw BEFORE campaignTurn so the defector's per-turn action grant
        // to the old party's candidate stops this very turn.
        const playerEndorsementSweepResult = await runtime.runPhase(
          "playerEndorsementPartySweep",
          async () => {
            const { sweepPartyMismatchedPlayerEndorsements } =
              await import("@/lib/elections/playerEndorsements");
            return sweepPartyMismatchedPlayerEndorsements(db, newTurn, realNow);
          }
        );
        if (playerEndorsementSweepResult) {
          phaseResults.playerEndorsementPartySweep = {
            withdrawn: playerEndorsementSweepResult,
          };
        }

        const campaignResults = await runtime.runPhase("campaignTurn", () =>
          processCampaignTurn(newTurn)
        );
        if (campaignResults) {
          phaseResults.campaignTurn = {
            campaignsProcessed: campaignResults.campaignsProcessed,
            totalFundsGenerated: campaignResults.totalFundsGenerated,
            totalActionsGenerated: campaignResults.totalActionsGenerated,
          };
        }

        // In-game year for era-gated events (same formula as fiscalYearBoundary).
        const eventsCurrentYear =
          (gameState.startingYear ?? STARTING_YEAR) + Math.floor((newTurn - 1) / TURNS_PER_YEAR);

        const playerRandomEventsResult = await runtime.runPhase("playerRandomEvents", () =>
          processPlayerRandomEventsTurn(db, newTurn, {
            playerRandomEventsEnabled: gameState.playerRandomEventsEnabled,
            rpgStatsEnabled: gameState.rpgStatsEnabled,
            currentYear: eventsCurrentYear,
          })
        );
        if (playerRandomEventsResult) {
          phaseResults.playerRandomEvents = playerRandomEventsResult;
        }

        // World Events v1 Phase 0 substrate maintenance: expire temporary
        // sectorDemandModifier docs. No scheduler yet (Phase 1), this only
        // keeps countryModifiers from growing unbounded regardless of the
        // worldEventsEnabled flag (cheap no-op collection when nothing wrote to it).
        const worldEventsMaintenanceResult = await runtime.runPhase("worldEventsMaintenance", () =>
          sweepExpiredCountryModifiers(db, newTurn)
        );
        if (typeof worldEventsMaintenanceResult === "number") {
          phaseResults.worldEventsMaintenance = { expiredModifiers: worldEventsMaintenanceResult };
        }

        // World Events v1 Phase 1: deterministic scheduler producer. Runs
        // right after the maintenance sweep so a definition that just
        // expired its cooldown modifier can be offered again the same turn.
        // No-op (flag off / no scheduled definitions) is the default.
        const worldEventsSchedulerResult = await runtime.runPhase("worldEventsScheduler", () =>
          processWorldEventsTurn(db, newTurn, {
            worldEventsEnabled: gameState.worldEventsEnabled,
            currentYear: eventsCurrentYear,
          })
        );
        if (worldEventsSchedulerResult) {
          phaseResults.worldEventsScheduler = worldEventsSchedulerResult;
        }

        const nppActionResult = await runtime.runPhase("nppActionProcessing", () =>
          processNppActions(db, newTurn)
        );
        // Log aggregate totals whenever the processing phase actually ran (every 4 turns
        // with the economy gate on), even when zero actions fired, the count breakdown
        // is the per-tick signal for diagnosing NPP-action throughput.
        if (nppActionResult && nppActionResult.nppsProcessed > 0) {
          phaseResults.nppActionProcessing = nppActionResult;
        }

        const activityLoggingResult = await runtime.runPhase("activityLogging", () =>
          processActivityLogging(db, newTurn, config)
        );
        if (activityLoggingResult) {
          phaseResults.activityLogging = {
            summariesInserted: activityLoggingResult.summariesInserted,
          };
        }
      },
    },
    {
      key: "electionResolutionAndGovernment",
      async execute(context, runtime) {
        const { db, gameNow, newTurn, phaseResults } = context;
        // Group 7 is strictly sequential. Reordering any of these steps corrupts
        // elections by dropping final-turn votes or resolving offices from stale tallies.
        await runtime.runPhase("candidatePartySweep", async () => {
          const { sweepPartyMismatchedCandidates } = await import("@/lib/utils/electionCandidacy");
          await sweepPartyMismatchedCandidates();
          const { withdrawOpsIneligibleCandidacies } =
            await import("@/lib/onePartyState/withdrawOpsIneligibleCandidacies");
          await withdrawOpsIneligibleCandidacies(db, gameNow);
        });

        await runtime.runPhase("primaryResolution", () =>
          resolvePrimariesIfNeeded(gameNow, newTurn)
        );
        await runtime.runPhase("voteAccumulation", () =>
          accumulateGeneralElectionVotes(gameNow, newTurn)
        );
        phaseResults.voteAccumulation = { electionsProcessed: 0 };

        // A2, clear `Campaign.spendThisTurn` after vote tallies have read
        // it. This runs after voteAccumulation in the same turn-tick, so
        // the swing-flow engine's money driver saw the value during the
        // tally, and the field starts the next turn-tick interval at 0
        // ready to accumulate player upgrades + new maintenance writes.
        const campaignSpendResetResult = await runtime.runPhase("campaignSpendReset", () =>
          processCampaignSpendReset(db)
        );
        phaseResults.campaignSpendReset = {
          campaignsReset: campaignSpendResetResult?.campaignsReset ?? 0,
        };

        await runtime.runPhase("electionTimers", () =>
          advanceElectionTimers(gameNow, newTurn, async () => {
            /* primaries already resolved in step 8 */
          })
        );
        phaseResults.electionTimers = { electionsAdvanced: 0 };

        const snapshotResult = await runtime.runPhase("primarySnapshots", () =>
          recordPrimarySnapshots(gameNow, newTurn)
        );
        phaseResults.primarySnapshots = { snapshotsTaken: snapshotResult ?? 0 };

        const generalResolved = await runtime.runPhase("electionResolution", () =>
          resolveGeneralElections(gameNow)
        );
        phaseResults.electionResolution = {
          electionsResolved: generalResolved ?? 0,
          winners: [],
        };

        // Phase F: clear `support` on every candidate of every election
        // that's now in `"resolved"` status (matches §3.1 "cleared at
        // Election.status === 'resolved'"). Runs after BOTH primary and
        // general resolution so it sweeps both transition types in one
        // pass. Idempotent.
        const clearedSupport = await runtime.runPhase("clearResolvedSupport", () =>
          processClearResolvedSupport()
        );
        if (clearedSupport) {
          phaseResults.clearResolvedSupport = clearedSupport;
        }

        if (generalResolved && generalResolved > 0) {
          const vacatedCount = await runtime.runPhase("leadershipVacate", () =>
            vacateLeadershipAfterElections(db)
          );
          phaseResults.leadershipVacated = { positionsVacated: vacatedCount ?? 0 };
        }

        const govResult = await runtime.runPhase("parliamentaryGovernmentFormation", () =>
          runPostElectionGovernmentPhases(db, gameNow, generalResolved ?? 0)
        );
        const govFormedMap = govResult?.governmentFormed ?? {};

        await runtime.runPhase("parliamentaryGovernmentPhases", () =>
          runParliamentaryGovernmentPhases(gameNow, newTurn)
        );
        await runtime.runPhase("parliamentaryVacancyWatcher", () =>
          runParliamentaryVacancyWatcher(gameNow, newTurn)
        );
        // NPP Autonomy V1 governing brain, runs after executives are seated so
        // the agenda computation sees a formed government. Self-gates per
        // country on nppAutonomyAtLeast(v1); a cheap no-op below v1.
        await runtime.runPhase("nppGovernmentPhases", () =>
          runNppGovernmentPhases(gameNow, newTurn)
        );
        phaseResults.ukGovernment = {
          governmentFormed: govFormedMap.UK ?? false,
          noConfidenceProcessed: 0,
          confidenceProcessed: 0,
        };
      },
    },
    {
      key: "electionCoverageAndSuccession",
      async execute(context, runtime) {
        const { db, gameNow, newTurn, phaseResults } = context;

        // End the live pre-iteration founding phase once every founding race has
        // resolved (flips `preIteration.active` off in the DB for NEXT turn and
        // stamps the calendar offset). Runs after this turn's resolution group.
        await runtime.runPhase("detectPreIterationComplete", () =>
          detectPreIterationComplete(db, newTurn)
        );
        // While the founding phase is active, the canonical spawners are
        // SUPPRESSED: the founding races were spawned once at bootstrap, and
        // re-running the ensure* battery would re-spawn cycle-0 races for seats
        // that just resolved (never converging) and prematurely spawn the real
        // cycle-1 before the offset lands. Reads the start-of-turn snapshot, so
        // the turn that completes the phase still suppresses (resume next turn).
        const foundingActive = context.gameState.preIteration?.active === true;

        // Withdraw inactive players' candidacies BEFORE election resolution and
        // auto-reentry below, so a withdrawn inactive player is neither counted
        // in a resolving race nor re-added the same turn (one-way; manual re-entry
        // on return). Runs sequentially first for that ordering guarantee.
        await runtime.runPhase("withdrawInactiveCandidates", () =>
          withdrawInactiveCandidates(db, gameNow)
        );

        const countryElectionPhasePromises = foundingActive
          ? []
          : Object.entries(COUNTRY_ELECTION_PHASES).flatMap(([, entries]) =>
              entries.map(({ name, fn }) => runtime.runPhase(name, () => fn(gameNow)))
            );

        await Promise.all([
          ...(foundingActive
            ? []
            : [
                runtime.runPhase("perpetualElections", () =>
                  ensurePerpetualElections(gameNow, newTurn)
                ),
              ]),
          ...countryElectionPhasePromises,
          runtime.runPhase("leadershipElections", () => resolveExpiredLeadershipElections(db)),
          runtime.runPhase("staleCandidateCleanup", () => cleanupStaleElectionCandidates(gameNow)),
          runtime.runPhase("internationalOrganizations", () =>
            processInternationalOrganizationsTurn(db, newTurn)
          ),
        ]);
        // After perpetual elections settle, fill any mid-term governor vacancy
        // with an off-calendar by-election (distinct electionType keeps it clear
        // of the regular schedule). Suppressed during founding, every seat is
        // being elected, so there are no "mid-term" vacancies to backfill.
        if (!foundingActive) {
          await runtime.runPhase("byElectionWatcher", () =>
            processByElectionWatcher(db, newTurn, gameNow)
          );
        }
        phaseResults.perpetualElections = { electionsCreated: 0 };
        phaseResults.leadershipElections = { electionsResolved: 0 };
        phaseResults.staleCandidateCleanup = { candidatesRemoved: 0 };
        phaseResults.internationalOrganizations = {
          proposalsResolved: 0,
          legislationResolved: 0,
          electionsResolved: 0,
        };

        // Sequential and AFTER the batch above: alignment drift reads the org
        // memberships the internationalOrganizations phase writes, so it must
        // not run alongside it.
        phaseResults.alignment = await runtime.runPhase("alignment", () =>
          processAlignmentTurn(db, newTurn)
        );

        // Sequential and AFTER alignment: seat direction is read from live bloc
        // membership, which the alignment phase writes.
        phaseResults.settlement = await runtime.runPhase("settlement", () =>
          processSettlementTurn(db, newTurn)
        );

        await runtime.runPhase("autoReelectionEntry", () =>
          runAutoReelectionEntry(db, gameNow, newTurn)
        );
        await runtime.runPhase("impeachmentLifecycle", () =>
          processImpeachmentLifecycle(db, newTurn, gameNow)
        );
        await runtime.runPhase("presidentialSuccession", () => processPresidentialSuccession(db));
      },
    },
    {
      key: "fiscalYearBoundary",
      async execute(context, runtime) {
        const { db, newTurn, phaseResults, gameState } = context;
        const startingYear = gameState.startingYear ?? STARTING_YEAR;
        const currentYear = startingYear + Math.floor((newTurn - 1) / TURNS_PER_YEAR);
        let fiscalYearProcessed = false;
        let newFiscalYear: number | null = null;
        if (isFiscalYearEnd(newTurn)) {
          newFiscalYear = calculateFiscalYear(currentYear, newTurn);
          await runtime.runPhase("fiscalYear", () =>
            processFiscalYear(db, newFiscalYear!, newTurn)
          );
          fiscalYearProcessed = true;
        } else {
          await runtime.markPhaseSkipped(
            "fiscalYear",
            "conditional",
            "Skipped because this turn is not a fiscal year boundary."
          );
        }
        phaseResults.fiscalYear = { processed: fiscalYearProcessed, newFiscalYear };
      },
    },
    stateEffectsAndNationalAggregationPhase,
    {
      key: "indexFunds",
      async execute(context, runtime) {
        const { db, newTurn, phaseResults } = context;
        const { isIndexFundsEnabled } = await import("@/lib/indexFunds/featureFlag");
        if (!(await isIndexFundsEnabled())) {
          await runtime.markPhaseSkipped(
            "indexFunds",
            "featureDisabled",
            "Skipped because index funds are disabled."
          );
          return;
        }

        const { runIndexFundCron } = await import("@/lib/indexFunds/fundCron");
        // Was a bare await with no runtime.runPhase() wrapper, the ONLY phase in
        // the entire registry invisible to TurnPhaseTelemetryMap (confirmed: every
        // other adapter uses runPhase/markPhaseSkipped). Found via the headless sim
        // harness: turnLogs.phaseStatuses showed the last tracked phase
        // (gameHealthSnapshot, the entry right before this one) ending ~11s into a
        // turn that took ~108s total, the missing ~97s was entirely this phase,
        // with zero telemetry trace and zero Sentry slow-phase reporting in
        // production either. Wrapping it fixes both: visibility here, AND
        // production's existing >30s slow-phase alerting now covers this phase too.
        const result = await runtime.runPhase("indexFunds", () =>
          runIndexFundCron(db, { currentTurn: newTurn })
        );
        if (!result) return; // runPhase already logged/warned on failure or timeout

        phaseResults.indexFunds = {
          fundsProcessed: result.fundsProcessed,
          navUpdates: result.navUpdates,
          floatPurchases: result.floatPurchases,
          rebalances: result.rebalances,
          redemptionsPaid: result.redemptionsPaid,
          bondDeployments: result.bondDeployments,
          nppsProcessed: result.nppsProcessed,
          nppInvested: result.nppInvested,
        };

        if (result.errors.length > 0) {
          for (const err of result.errors) {
            context.warnings.push(`[indexFunds] ${err}`);
          }
        }
      },
    },
    {
      key: "moneySupplySnapshot",
      async execute(context, runtime) {
        const count = await runtime.runPhase("moneySupplySnapshot", () =>
          snapshotMoneySupply(context.db, context.newTurn)
        );
        if (count !== null) {
          context.phaseResults.moneySupplySnapshot = { currenciesProcessed: count };
        }
      },
    },
    // --- Shadow ledger (registered LAST) --------------------------------------
    // Snapshot the authoritative money balances AFTER every value-affecting
    // phase has run, then reconcile this turn's shadow ledger entries against
    // the snapshot diff. Shadow-only and flag-gated (`ledgerShadow`, off in prod
    // seeds, on in the sim harness), zero game-behavior impact. See
    // docs/plans/2026-07-05-shadow-ledger-plan.md §2/§3.
    {
      key: "ledgerBalanceSnapshot",
      async execute(context, runtime) {
        const { db, newTurn, config, phaseResults } = context;
        if (!isLedgerShadowEnabledFromConfig(config)) {
          await runtime.markPhaseSkipped(
            "ledgerBalanceSnapshot",
            "featureDisabled",
            "Skipped because the shadow ledger flag is off."
          );
          return;
        }
        const accountsSnapshotted = await runtime.runPhase("ledgerBalanceSnapshot", () =>
          writeBalanceSnapshot(db, newTurn)
        );
        if (accountsSnapshotted !== null) {
          phaseResults.ledgerBalanceSnapshot = { accountsSnapshotted };
        }
      },
    },
    {
      key: "ledgerReconcile",
      async execute(context, runtime) {
        const { db, newTurn, config, phaseResults, warnings } = context;
        if (!isLedgerShadowEnabledFromConfig(config)) {
          await runtime.markPhaseSkipped(
            "ledgerReconcile",
            "featureDisabled",
            "Skipped because the shadow ledger flag is off."
          );
          return;
        }
        const report = await runtime.runPhase("ledgerReconcile", () => reconcileTurn(db, newTurn));
        if (report) {
          phaseResults.ledgerReconcile = {
            status: report.status,
            entriesChecked: report.entriesChecked,
            unbalancedCount: report.trialBalance.unbalancedCount,
            stockVsFlowDivergences: report.stockVsFlow.divergentCount,
          };
          if (report.trialBalance.status === "red") {
            warnings.push(
              `[ledger] ${report.trialBalance.unbalancedCount} unbalanced ledger entr` +
                `${report.trialBalance.unbalancedCount === 1 ? "y" : "ies"} at turn ${newTurn}`
            );
          }
        }
      },
    },
    {
      key: "economicVitalSigns",
      async execute(context, runtime) {
        const snapshot = await runtime.runPhase("economicVitalSigns", () =>
          snapshotEconomicVitalSigns(context.db, context.newTurn)
        );
        if (snapshot) {
          context.phaseResults.economicVitalSigns = {
            snapshotTurn: snapshot.turn,
            domainsAvailable: [
              snapshot.goods.pooledFillRate,
              snapshot.trade.intentFulfillmentRate,
              snapshot.production.physicalSellThrough,
              snapshot.firms.marketCapHhi,
              snapshot.securities.activeTradedListingShare,
              snapshot.households.wealthGini,
              snapshot.money.medianAnnualizedM2GrowthPct,
            ].filter((item) => item.value !== null).length,
          };
        }
      },
    },
  ];
}
