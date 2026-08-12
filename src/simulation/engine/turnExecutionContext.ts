import { getCharactersCollection } from "@/lib/db/collections";
import type {
  GameConfig,
  GameIteration,
  GameState,
  TurnLog,
  State,
  TurnPhaseTelemetryMap,
} from "@/lib/db/types";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calendarTurn } from "@/lib/utils/gameDate";
import { computeGameNow } from "@/lib/time/computeGameNow";
import type { Db } from "mongodb";
import type { TurnExecutionContext } from "@/simulation/engine/types";

export async function buildTurnExecutionContext(input: {
  db: Db;
  gameState: GameState;
  config: GameConfig | null;
  warnings: string[];
  activeIteration?: GameIteration;
  phaseStatuses: TurnPhaseTelemetryMap;
  startTimeMs: number;
}): Promise<TurnExecutionContext> {
  const { db, gameState, config, warnings, activeIteration, phaseStatuses, startTimeMs } = input;
  const newTurn = gameState.currentTurn + 1;
  // Preset-aware: read the calendar baseline from GameState so 1991 games
  // advance their year correctly. Legacy rows fall back to STARTING_YEAR.
  const startingYear = gameState.startingYear ?? STARTING_YEAR;
  // Honor the pre-iteration clock: while the founding phase is active the
  // calendar is pinned to the era start even as `newTurn` advances; afterward
  // it resumes via the `preIterationTurns` offset. Identity on normal worlds.
  const calTurn = calendarTurn(newTurn, {
    preIterationActive: gameState.preIteration?.active,
    preIterationTurns: gameState.preIterationTurns,
  });
  const currentYear = startingYear + Math.floor((calTurn - 1) / TURNS_PER_YEAR);

  // Normal mode: the game clock tracks real time and self-heals any offset left
  // by a prior fast-mode session; fast-mode keeps its intentional pull-ahead.
  // See computeGameNow. realNow shares the same nowMs so the two agree exactly.
  const nowMs = Date.now();
  const realNow = new Date(nowMs);
  const gameNow = computeGameNow(gameState.lastTurnProcessed, nowMs, {
    fastMode: gameState.fastMode,
  });

  const nextTurnTime = new Date(realNow);
  nextTurnTime.setSeconds(0, 0);
  if (gameState.fastMode) {
    const mins = nextTurnTime.getMinutes();
    if (mins < 30) {
      nextTurnTime.setMinutes(30);
    } else {
      nextTurnTime.setMinutes(0);
      nextTurnTime.setHours(nextTurnTime.getHours() + 1);
    }
  } else {
    nextTurnTime.setMinutes(0, 0, 0);
    nextTurnTime.setHours(nextTurnTime.getHours() + 1);
  }

  const charactersCollection = await getCharactersCollection(db);
  const characters = await charactersCollection.find({}).toArray();
  const states = await db.collection<State>("states").find({}).toArray();
  const stateMap = new Map(states.map((state) => [state._id, state]));

  return {
    db,
    gameState,
    config,
    activeIteration,
    newTurn,
    currentYear,
    gameNow,
    realNow,
    startTimeMs,
    nextTurnTime,
    characters,
    states,
    stateMap,
    warnings,
    phaseStatuses,
    phaseResults: createInitialTurnLogPhases(),
  };
}

function createInitialTurnLogPhases(): TurnLog["phases"] {
  return {
    actionRefresh: null,
    caucusTax: null,
    fundGeneration: null,
    lineOfCreditTurn: null,
    turnoutProcessing: null,
    partyElections: null,
    partyActions: null,
    nppRelationshipMaintenance: null,
    nppBehavior: null,
    billLifecycle: null,
    ukBillLifecycle: null,
    jpBillLifecycle: null,
    deBillLifecycle: null,
    stateBillTimers: null,
    cabinetNominations: null,
    voteAccumulation: null,
    campaignTurn: null,
    playerRandomEvents: null,
    worldEventsMaintenance: null,
    worldEventsScheduler: null,
    campaignSpendReset: null,
    electionTimers: null,
    primarySnapshots: null,
    electionResolution: null,
    ukGovernment: null,
    perpetualElections: null,
    leadershipElections: null,
    leadershipVacated: null,
    staleCandidateCleanup: null,
    fiscalYear: null,
    policyEffects: null,
    demographicEffects: null,
    archetypeApprovalDecay: null,
    nationalMetrics: null,
    metricHistory: null,
    approvalSnapshot: null,
    bannedShareholderRelease: null,
    inactiveShareholderShareRelease: null,
    corporationTurn: null,
    bondTurn: null,
    commodityPrices: null,
    savingsInterestTurn: null,
    npcBankPolicyTurn: null,
    bankingTurn: null,
    pensionTurn: null,
    bankSolvencyTurn: null,
    treasuryTurn: null,
    indexFunds: null,
    portfolioSnapshot: null,
    financialSuspectScan: null,
    emptyPartyCleanup: null,
    centralBankChairTurn: null,
    fomcMeetings: null,
    fomcNominations: null,
    centralBankChairExecutiveRemoval: null,
    centralBankChairSelection: null,
    nppFundGeneration: null,
    nppActionProcessing: null,
    unownedSectorGrowth: null,
    metricEngine: null,
    regionalBudgetProcessing: null,
    jpRegionalBudgetProcessing: null,
    deRegionalBudgetProcessing: null,
    crisisTurn: null,
    ministerialOrders: null,
    officeStateSeed: null,
    governorAPRegen: null,
    governorExecutiveOrders: null,
    governorAddressExpiry: null,
    governorEndorsements: null,
    governorLegislationQueue: null,
    gameHealthSnapshot: null,
    activityLogging: null,
    suspiciousDetection: null,
    tradeGrowthMirror: null,
    forexTurn: null,
  };
}
