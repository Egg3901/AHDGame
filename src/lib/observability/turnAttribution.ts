/**
 * Interval-based attribution of a turn's wall time to phases and subsystems.
 *
 * Per-phase `ms` values cannot be summed. Phases inside one `Promise.all`
 * group each report the group's shared wall time (about 60 per-country
 * election and bill phases run together), so naive sums reach 1.2x to 1.5x
 * the turn and overstate any saving. This splits every slice of the turn's
 * wall clock equally among the phases open during it, so the attribution sums
 * to the covered wall time. Equal split is a neutral prior on one JavaScript
 * thread, not a CPU measurement (#2691).
 *
 * Pure: plain data in, plain data out.
 */

export const SUBSYSTEMS = [
  "Corporations & sectors",
  "Capital markets & banking",
  "NPP agents",
  "Elections & campaigns",
  "Governance & opinion",
  "Macro economy & world",
  "History & integrity scans",
] as const;
export type Subsystem = (typeof SUBSYSTEMS)[number];

const words = (s: string) => s.split(/\s+/).filter(Boolean);

const EXPLICIT: Record<string, Subsystem> = Object.fromEntries([
  ...words(
    "corporationTurn topSectorsRecompute unownedSectorGrowth stateOwnershipConcentration extractionAutoStrategy autoSectorSeed prospectingResolution expireCharters contractSettlement commandEconomy defenceWindfallRecovery"
  ).map((p) => [p, "Corporations & sectors"]),
  ...words(
    "indexFunds bondTurn stockExchangeSnapshot recomputeSharePrices bankingTurn lineOfCreditTurn fundGeneration portfolioSnapshot corpPortfolioSnapshot investorRankingSnapshot savingsInterestTurn bankSupervision bankSolvencyTurn pensionTurn treasuryTurn forexTurn ledgerReconcile ledgerPreForexSnapshot ledgerBalanceSnapshot moneySupplySnapshot interestRateSnapshot wealthListSnapshot inactiveShareholderShareRelease bannedShareholderRelease settlement npcBankPolicyTurn savingsShadowTurn brettonWoodsTurn fomcMeetings fomcNominations centralBankChairTurn centralBankChairSelection centralBankChairExecutiveRemoval investorConfidenceDecay"
  ).map((p) => [p, "Capital markets & banking"]),
  ...words(
    "voteAccumulation electionResolution primaryResolution primarySnapshots partyGOTV campaignTurn generateChallengers candidatePartySweep runningMateSurrogateActionReset leadershipPartyEligibility electionTimers autoReelectionEntry withdrawInactiveCandidates staleCandidateCleanup byElectionWatcher commonsByElectionWatcher parliamentaryVacancyWatcher perpetualElections turnoutDecay campaignSpendReset campaignBoostDecay postConversionElections playerEndorsementPartySweep executiveEndorsements governorEndorsements"
  ).map((p) => [p, "Elections & campaigns"]),
  ...words(
    "billLifecycle ministerialOrders cabinetNominations parliamentaryGovernmentPhases parliamentaryGovernmentFormation regionalBudgetProcessing subsidyBudget cnPresidentSync scotusTurn stateBillTimers justiceActionReset vicePresidentActionReset presidentialSuccession impeachmentLifecycle referendumLifecycle coalitionDisbandVotes leadershipVacate cabinetYearCrossing officeStateSeed fiscalYear fiscalBaseGrowth policyEffects ukLeadershipChallenges ukJrSurpriseTurn statehood governorAPRegen governorExecutiveOrders governorLegislationQueue governorAddressExpiry politicalMetricsDynamics approvalSnapshot archetypeApprovalDecay demographicEffects demographicFlows partyHistorySnapshot partyOrgTurn partyActionGeneration partyTierTurn partyInfluenceTurn partyMemberCountReconcile nationalPartyElections statePartyElections nationalCommitteeElections leadershipElections ukPartyConferences regDriftDecay socialAxisDrift supportDecay supportAccrual clearResolvedSupport independenceDesireDrift alignment unionsTurn caucusTax emptyPartyCleanup priorityRegionDecay pressureDecay metricDecay playerRandomEvents actionRefresh"
  ).map((p) => [p, "Governance & opinion"]),
  ...words(
    "economicVitalSigns commodityPrices inflationRecalc economicModel crisisTurn autoCrisisTurn autoDisasterTurn internationalOrganizations nationalMetrics coldWarTension intelligenceTurn navairOperations sphereSponsorTurn worldEventsScheduler worldEventsMaintenance tradeGrowthMirror macroCountryTurn decolonization eraCrossing militaryBranchYearCrossing census longHorizonContext detectPreIterationComplete"
  ).map((p) => [p, "Macro economy & world"]),
  ...words(
    "metricHistory metricEngine financialSuspectScan auditAnomalyScan suspiciousDetection gameHealthSnapshot activityLogging metricActivation"
  ).map((p) => [p, "History & integrity scans"]),
]);

/** Subsystem for a phase name, or null when the name is not mapped. */
export function classifyPhase(name: string): Subsystem | null {
  const explicit = EXPLICIT[name];
  if (explicit) return explicit;
  if (name.startsWith("npp")) return "NPP agents";
  if (/Elections?$/.test(name)) return "Elections & campaigns";
  if (/(BillLifecycle|RegionalBudgetProcessing)$/.test(name)) return "Governance & opinion";
  return null;
}

export type CadenceTier = "quiet" | "nppAction" | "fundRebalance";

/** Fixed engine cadences: NPP actions every 4th turn, fund rebalance every 24th. */
export function cadenceTier(turn: number): CadenceTier {
  if (turn % 24 === 0) return "fundRebalance";
  if (turn % 4 === 0) return "nppAction";
  return "quiet";
}

export type PhaseStatusLike = {
  status?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  roundTrips?: number | null;
};

export type TurnLogLike = {
  turn: number;
  realTime: Date | string;
  durationMs: number;
  phaseStatuses?: Record<string, PhaseStatusLike> | null;
};

export type TurnAttribution = {
  turn: number;
  tier: CadenceTier;
  wallMs: number;
  coveredMs: number;
  /** Sum of raw phase elapsed times; exceeds wall time when phases overlap. */
  naivePhaseSumMs: number;
  roundTrips: number;
  subsystemMs: Record<Subsystem, number>;
  phaseMs: Record<string, number>;
  phaseRoundTrips: Record<string, number>;
  unmappedPhases: string[];
};

const toMs = (v: Date | string) => (v instanceof Date ? v.getTime() : Date.parse(v));

export function attributeTurn(log: TurnLogLike): TurnAttribution {
  const t0 = toMs(log.realTime);
  const t1 = t0 + log.durationMs;
  const intervals: Array<{ a: number; b: number; name: string }> = [];
  const phaseRoundTrips: Record<string, number> = {};
  const unmapped = new Set<string>();
  let roundTrips = 0;
  let naive = 0;
  for (const [name, status] of Object.entries(log.phaseStatuses ?? {})) {
    if (status?.status !== "completed" || !status.startedAt || !status.completedAt) continue;
    const a = toMs(status.startedAt);
    const b = toMs(status.completedAt);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    intervals.push({ a, b, name });
    naive += b - a;
    const rt = status.roundTrips ?? 0;
    phaseRoundTrips[name] = rt;
    roundTrips += rt;
    if (!classifyPhase(name)) unmapped.add(name);
  }

  const cuts = [...new Set([t0, t1, ...intervals.flatMap((i) => [i.a, i.b])])]
    .filter((x) => x >= t0 && x <= t1)
    .sort((x, y) => x - y);
  const subsystemMs = Object.fromEntries(SUBSYSTEMS.map((s) => [s, 0])) as Record<
    Subsystem,
    number
  >;
  const phaseMs: Record<string, number> = {};
  let covered = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b <= a) continue;
    const open = intervals.filter((iv) => iv.a <= a && iv.b >= b && iv.b > iv.a);
    if (open.length === 0) continue;
    const share = (b - a) / open.length;
    covered += b - a;
    for (const iv of open) {
      phaseMs[iv.name] = (phaseMs[iv.name] ?? 0) + share;
      const subsystem = classifyPhase(iv.name);
      if (subsystem) subsystemMs[subsystem] += share;
    }
  }

  return {
    turn: log.turn,
    tier: cadenceTier(log.turn),
    wallMs: log.durationMs,
    coveredMs: covered,
    naivePhaseSumMs: naive,
    roundTrips,
    subsystemMs,
    phaseMs,
    phaseRoundTrips,
    unmappedPhases: [...unmapped].sort(),
  };
}

export type AttributionSummary = {
  turns: number;
  meanWallMs: number;
  medianWallMs: number;
  minCoverage: number;
  subsystemMeanMs: Record<Subsystem, number>;
  byTier: Record<CadenceTier, { turns: number; medianWallMs: number; medianRoundTrips: number }>;
  unmappedPhases: string[];
};

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(rows: TurnAttribution[]): AttributionSummary {
  const n = rows.length || 1;
  const subsystemMeanMs = Object.fromEntries(
    SUBSYSTEMS.map((s) => [s, rows.reduce((sum, r) => sum + r.subsystemMs[s], 0) / n])
  ) as Record<Subsystem, number>;
  const tiers: CadenceTier[] = ["quiet", "nppAction", "fundRebalance"];
  const byTier = Object.fromEntries(
    tiers.map((tier) => {
      const t = rows.filter((r) => r.tier === tier);
      return [
        tier,
        {
          turns: t.length,
          medianWallMs: median(t.map((r) => r.wallMs)),
          medianRoundTrips: median(t.map((r) => r.roundTrips)),
        },
      ];
    })
  ) as AttributionSummary["byTier"];
  return {
    turns: rows.length,
    meanWallMs: rows.reduce((sum, r) => sum + r.wallMs, 0) / n,
    medianWallMs: median(rows.map((r) => r.wallMs)),
    minCoverage: rows.length ? Math.min(...rows.map((r) => r.coveredMs / r.wallMs)) : 0,
    subsystemMeanMs,
    byTier,
    unmappedPhases: [...new Set(rows.flatMap((r) => r.unmappedPhases))].sort(),
  };
}
