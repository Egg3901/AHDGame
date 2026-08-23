/**
 * SIM-ONLY turn-phase profiles for the headless worldsim (scripts/sim/runWorld.ts).
 *
 * The live game always runs the full turn — this module is inert unless a
 * sandbox gameConfig sets `simTurnPhaseMode: "elections-only"`. In that mode the
 * turn runtime skips the phases in ELECTIONS_SKIP_PHASES so an election-balance
 * run isn't paying for corporationTurn (the known hotspot), markets, forex, the
 * ledger reconciler, and the rest of the economy — while every political,
 * election, campaign, party, NPP, approval and turnout phase still runs against
 * the real engine.
 *
 * Design choice: a DENYLIST, not an allowlist. Any phase NOT named here runs by
 * default — so a new political/election phase added later is included
 * automatically, and only the known-heavy economic machinery is gated off. This
 * file IS the econ/election boundary; tune it here.
 *
 * Frozen-economy semantics: because the metric/econ phases are skipped, national
 * metrics, prices and approval drivers hold at their bootstrap values for the
 * whole run. Elections then play out on a stable substrate (candidates still
 * fluctuate via campaign/support phases), which is exactly the isolation we want
 * for reading election balance without economy noise.
 */

export type SimTurnPhaseMode = "full" | "elections-only" | "economy-only" | "macro-only";

/**
 * Economic phases retained for a fixed-policy macro balance run. This is an
 * allowlist so elections, campaigns, legislation, cabinet churn, and random
 * events remain frozen while the real economy and accounting loops advance.
 */
export const ECONOMY_ONLY_PHASES: ReadonlySet<string> = new Set<string>([
  "bannedShareholderRelease",
  "inactiveShareholderShareRelease",
  "corporationTurn",
  "unionsTurn",
  "savingsInterestTurn",
  "npcBankPolicyTurn",
  "bankingTurn",
  "pensionTurn",
  "prospectingResolution",
  "macroCountryTurn",
  "bondTurn",
  "commodityPrices",
  "contractSettlement",
  "lineOfCreditTurn",
  "recomputeSharePrices",
  "bankSolvencyTurn",
  "financialSuspectScan",
  "settlement",
  "fiscalYear",
  "policyEffects",
  "demographicEffects",
  "unownedSectorGrowth",
  "metricDecay",
  "investorConfidenceDecay",
  "stateOwnershipConcentration",
  "subsidyBudget",
  "regionalBudgetProcessing",
  "jpRegionalBudgetProcessing",
  "deRegionalBudgetProcessing",
  "metricEngine",
  "demographicFlows",
  "census",
  "eraCrossing",
  "metricActivation",
  "nationalMetrics",
  "fiscalBaseGrowth",
  "economicModel",
  "tradeGrowthMirror",
  "inflationRecalc",
  "commandEconomy",
  "forexTurn",
  "centralBankChairTurn",
  "fomcMeetings",
  "nppMonetaryOperations",
  "metricHistory",
  "interestRateSnapshot",
  "portfolioSnapshot",
  "corpPortfolioSnapshot",
  "stockExchangeSnapshot",
  "investorRankingSnapshot",
  "wealthListSnapshot",
  "gameHealthSnapshot",
  "auditAnomalyScan",
  "suspiciousDetection",
  "moneySupplySnapshot",
  "ledgerBalanceSnapshot",
  "ledgerReconcile",
]);

/**
 * Fixed-corporate subset for long macro horizons. Commodity prices still run
 * against the cloned flow state, while corporate strategy and heavy ledgers
 * remain frozen.
 */
export const MACRO_ONLY_PHASES: ReadonlySet<string> = new Set<string>([
  "macroCountryTurn",
  "commodityPrices",
  "fiscalYear",
  "policyEffects",
  "demographicEffects",
  "unownedSectorGrowth",
  "metricDecay",
  "investorConfidenceDecay",
  "stateOwnershipConcentration",
  "subsidyBudget",
  "regionalBudgetProcessing",
  "jpRegionalBudgetProcessing",
  "deRegionalBudgetProcessing",
  "metricEngine",
  "demographicFlows",
  "census",
  "eraCrossing",
  "metricActivation",
  "nationalMetrics",
  "fiscalBaseGrowth",
  "economicModel",
  "tradeGrowthMirror",
  "inflationRecalc",
  "commandEconomy",
  "forexTurn",
  "centralBankChairTurn",
  "fomcMeetings",
  "nppMonetaryOperations",
  "metricHistory",
  "interestRateSnapshot",
  "gameHealthSnapshot",
  "auditAnomalyScan",
  "suspiciousDetection",
  "moneySupplySnapshot",
]);

/**
 * Economy / finance / ledger phases skipped under the "elections-only" profile.
 * Every name here must exist in BASE_TURN_PHASE_NAMES (src/simulation/phases/
 * turnPhaseNames.ts). Names are matched exactly; an unknown name is simply never
 * hit (harmless). Deliberately excludes ambiguous political phases (crisisTurn,
 * ministerialOrders, billLifecycle, referendumLifecycle) — those are kept.
 */
export const ELECTIONS_SKIP_PHASES: ReadonlySet<string> = new Set<string>([
  // Account / shareholder maintenance (groups 1-2)
  "bannedShareholderRelease",
  "inactiveShareholderShareRelease",
  // resourceAndFinanceStart — economy/finance core (corporationTurn = the hotspot)
  "corporationTurn",
  "unionsTurn",
  "nppUnionBehavior",
  "savingsInterestTurn",
  "npcBankPolicyTurn",
  "bankingTurn",
  "pensionTurn",
  "prospectingResolution",
  "bondTurn",
  "macroCountryTurn",
  "commodityPrices",
  "contractSettlement",
  "lineOfCreditTurn",
  "recomputeSharePrices",
  "bankSolvencyTurn",
  "financialSuspectScan",
  // stateEffectsAndNationalAggregation — the economy legs only. The approval /
  // demographic / snapshot legs of this mega-adapter (nationalMetrics, census,
  // demographicFlows, archetypeApprovalDecay, approvalSnapshot, metricHistory,
  // partyHistorySnapshot, socialAxisDrift, policyEffects, demographicEffects) are
  // NOT listed here, so they keep running and feed vote share.
  "unownedSectorGrowth",
  "metricDecay",
  "investorConfidenceDecay",
  "stateOwnershipConcentration",
  "subsidyBudget",
  "regionalBudgetProcessing",
  "jpRegionalBudgetProcessing",
  "deRegionalBudgetProcessing",
  "metricEngine",
  "metricActivation",
  "fiscalBaseGrowth",
  "economicModel",
  "tradeGrowthMirror",
  "inflationRecalc",
  "forexTurn",
  "centralBankChairTurn",
  "fomcMeetings",
  "centralBankChairExecutiveRemoval",
  "centralBankChairSelection",
  // fiscalYearBoundary
  "fiscalYear",
  // Economy snapshots
  "interestRateSnapshot",
  "portfolioSnapshot",
  "corpPortfolioSnapshot",
  "stockExchangeSnapshot",
  "investorRankingSnapshot",
  "wealthListSnapshot",
  // indexFunds + ledger groups
  "indexFunds",
  "ledgerBalanceSnapshot",
  "ledgerReconcile",
]);

/**
 * Build the per-phase predicate passed into createTurnPhaseRuntime.
 * Returns `undefined` for the full/default profile so the runtime does ZERO
 * extra work in prod (no filtering closure at all). Returns a denylist predicate
 * for "elections-only".
 */
export function getSimTurnPhasePredicate(
  mode: SimTurnPhaseMode | undefined | null
): ((phaseName: string) => boolean) | undefined {
  if (mode === "macro-only") return (phaseName: string) => MACRO_ONLY_PHASES.has(phaseName);
  if (mode === "economy-only") return (phaseName: string) => ECONOMY_ONLY_PHASES.has(phaseName);
  if (mode !== "elections-only") return undefined;
  return (phaseName: string) => !ELECTIONS_SKIP_PHASES.has(phaseName);
}
