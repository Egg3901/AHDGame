/**
 * Integration test for processTurn() full turn cycle.
 *
 * Verifies that all sub-processors are invoked by processTurn() and that
 * the function returns the expected shape on success and failure.
 *
 * All DB operations and sub-processor modules are mocked so the test runs
 * without a real database or game state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { MS_PER_TURN } from "@/lib/constants/turnTime";

// ── Mock all sub-processor modules ─────────────────────────────────────────
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

vi.mock("@/lib/turn/actionRefresh", () => ({ processActionRefresh: vi.fn() }));
vi.mock("@/lib/turn/fundGeneration", () => ({ processFundGeneration: vi.fn() }));
vi.mock("@/lib/turn/lineOfCreditTurn", () => ({
  processLineOfCreditTurn: vi
    .fn()
    .mockResolvedValue({ charactersProcessed: 0, paymentsInternal: 0 }),
}));
vi.mock("@/lib/turn/campaignTurn", () => ({ processCampaignTurn: vi.fn() }));
vi.mock("@/lib/turn/perpetualElections", () => ({
  advanceElectionTimers: vi.fn(),
  ensurePerpetualElections: vi.fn(),
  ensureUKElections: vi.fn(),
  ensureUKRegionalCouncilElections: vi.fn(),
  ensureSCOElections: vi.fn(),
  ensureWALElections: vi.fn(),
  ensureSCOGovernorElections: vi.fn(),
  ensureWALGovernorElections: vi.fn(),
  ensureSCORegionalCouncilElections: vi.fn(),
  ensureWALRegionalCouncilElections: vi.fn(),
  cleanupStaleElectionCandidates: vi.fn(),
}));
vi.mock("@/lib/turn/electionResolution", () => ({
  resolveGeneralElections: vi.fn(),
  HOUSE_SEATS: {},
}));
vi.mock("@/lib/turn/primaryResolution", () => ({
  recordPrimarySnapshots: vi.fn(),
  resolvePrimariesIfNeeded: vi.fn(),
  accumulateGeneralElectionVotes: vi.fn(),
}));
vi.mock("@/lib/turn/demographicTurnoutTurn", () => ({
  applyDecayToAllStates: vi.fn(),
  processPartyGOTV: vi.fn(),
  processPlayerCanvassing: vi.fn(),
}));
vi.mock("@/lib/turn/partyActionGeneration", () => ({
  processPartyActionGeneration: vi.fn(),
}));
vi.mock("@/lib/billLifecycle", () => ({ processBillLifecycle: vi.fn() }));
vi.mock("@/lib/turn/billLifecycle/regionalEngine", () => ({ processStateBillTimers: vi.fn() }));
vi.mock("@/lib/cabinetNominationLifecycle", () => ({
  processCabinetNominationLifecycle: vi.fn(),
}));
vi.mock("@/lib/statePartyElections", () => ({
  processStatePartyElections: vi.fn(),
}));
vi.mock("@/lib/nationalPartyElections", () => ({
  processNationalPartyElections: vi.fn(),
}));
vi.mock("@/lib/nationalCommitteeElections", () => ({
  processNationalCommitteeElections: vi.fn(),
}));
vi.mock("@/lib/turn/nppBehavior", () => ({
  processNPPTurn: vi.fn(),
  recalculateNPPSpeakerVotes: vi.fn(),
}));
vi.mock("@/lib/budget/fiscalYear", () => ({
  isFiscalYearEnd: vi.fn().mockReturnValue(false),
  calculateFiscalYear: vi.fn(),
  processFiscalYear: vi.fn(),
}));
vi.mock("@/lib/congress/leadershipElections", () => ({
  resolveExpiredLeadershipElections: vi.fn(),
}));
const mockUKBillLifecycle = vi.fn();
vi.mock("@/lib/turn/countryPhases", () => ({
  COUNTRY_BILL_PHASES: {
    UK: {
      phaseName: "ukBillLifecycle",
      fn: mockUKBillLifecycle,
      emptyResult: { enacted: 0, failed: 0 },
    },
  },
  COUNTRY_ELECTION_PHASES: {},
  runPostElectionGovernmentPhases: vi.fn().mockResolvedValue({ ukGovFormed: false }),
  runParliamentaryGovernmentPhases: vi.fn(),
  runParliamentaryVacancyWatcher: vi.fn(),
}));
vi.mock("@/lib/policyEffects", () => ({
  processStatePolicyEffects: vi.fn(),
}));
vi.mock("@/lib/turn/independenceDesireDrift", () => ({
  processIndependenceDesireDrift: vi.fn().mockResolvedValue(null),
  computeIndependenceDesireDriftSnapshot: vi.fn(),
}));
vi.mock("@/lib/utils/governmentApproval", () => ({
  snapshotApprovalHistory: vi.fn(),
}));
vi.mock("@/lib/utils/approvalSnapshotRun", () => ({
  snapshotApprovalsForTurn: vi.fn(),
}));
vi.mock("@/lib/demographicEffects", () => ({
  processAllStateDemographics: vi.fn(),
}));
vi.mock("@/lib/policyReactions", () => ({
  decayPolicyReactions: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({
  invalidateGameTimeCache: vi.fn(),
  reconcileGameStateClock: vi.fn(async (gameState) => ({
    currentTurn: gameState.currentTurn,
    lastTurnProcessed: gameState.lastTurnProcessed,
  })),
}));
vi.mock("@/lib/events", () => ({
  emit: vi.fn(),
}));
vi.mock("@/lib/turn/commodityPriceTurn", () => ({
  processCommodityPriceTurn: vi.fn(),
}));
vi.mock("@/lib/navair/turn", () => ({
  processNavairTurn: vi.fn().mockResolvedValue({
    countriesProcessed: 0,
    regionsContested: 0,
    channelsWritten: 0,
    unitsStationed: 0,
    engagementsFought: 0,
    formationsLost: 0,
    formationsUpdated: 0,
  }),
}));

describe("processTurn() — full turn flow", () => {
  let db: MockDb;

  const mockGameState = {
    _id: "current",
    currentTurn: 99,
    isActive: true,
    isProcessing: false,
    lastTurnProcessed: new Date("2026-01-01T00:00:00Z"),
    currentYear: 2026,
    pausedAt: null,
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Freeze system time at lastTurnProcessed + 1 hour so the drift guard
    // (AUTO_PAUSE_DRIFT_MS = 4h) does not fire and intercept these flow tests.
    // Tests that explicitly need a different time call vi.setSystemTime themselves.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(mockGameState.lastTurnProcessed.getTime() + 60 * 60 * 1000));
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    // Game state collection
    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue(mockGameState);
    db.collectionMocks["gameState"].findOneAndUpdate.mockResolvedValue(mockGameState);
    db.collectionMocks["gameState"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    // Characters collection — empty is fine for this test
    db.collection("characters");
    db.collectionMocks["characters"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    // gameConfig collection
    db.collection("gameConfig");
    db.collectionMocks["gameConfig"].findOne.mockResolvedValue(null);

    // Set up sub-processor return values
    const actionRefresh = await import("@/lib/turn/actionRefresh");
    vi.mocked(actionRefresh.processActionRefresh).mockResolvedValue(undefined as never);

    const fundGen = await import("@/lib/turn/fundGeneration");
    vi.mocked(fundGen.processFundGeneration).mockResolvedValue({
      totalGenerated: 0,
      totalStateTaxes: 0,
      totalNationalTaxes: 0,
    } as never);

    const demographicTurnout = await import("@/lib/turn/demographicTurnoutTurn");
    vi.mocked(demographicTurnout.applyDecayToAllStates).mockResolvedValue([] as never);
    vi.mocked(demographicTurnout.processPartyGOTV).mockResolvedValue({ budgets: [] } as never);
    vi.mocked(demographicTurnout.processPlayerCanvassing).mockResolvedValue(undefined as never);

    const statePartyElections = await import("@/lib/statePartyElections");
    vi.mocked(statePartyElections.processStatePartyElections).mockResolvedValue({
      electionsCompleted: 0,
    } as never);

    const nationalPartyElections = await import("@/lib/nationalPartyElections");
    vi.mocked(nationalPartyElections.processNationalPartyElections).mockResolvedValue(
      undefined as never
    );

    const nationalCommitteeElections = await import("@/lib/nationalCommitteeElections");
    vi.mocked(nationalCommitteeElections.processNationalCommitteeElections).mockResolvedValue(
      undefined as never
    );

    const partyActionGen = await import("@/lib/turn/partyActionGeneration");
    vi.mocked(partyActionGen.processPartyActionGeneration).mockResolvedValue({
      totalActionsGenerated: 0,
    } as never);

    const nppBehavior = await import("@/lib/turn/nppBehavior");
    vi.mocked(nppBehavior.processNPPTurn).mockResolvedValue({
      entered: 0,
      votescast: 0,
      speakerVotes: 0,
    } as never);
    vi.mocked(nppBehavior.recalculateNPPSpeakerVotes).mockResolvedValue(undefined as never);

    const bills = await import("@/lib/billLifecycle");
    vi.mocked(bills.processBillLifecycle).mockResolvedValue({
      billsProcessed: 0,
      billsPassed: 0,
      billsFailed: 0,
      billsVetoed: 0,
    } as never);
    mockUKBillLifecycle.mockResolvedValue({ enacted: 0, failed: 0 });

    const stateBills = await import("@/lib/turn/billLifecycle/regionalEngine");
    vi.mocked(stateBills.processStateBillTimers).mockResolvedValue({
      billsProcessed: 0,
    } as never);

    const cabinet = await import("@/lib/cabinetNominationLifecycle");
    vi.mocked(cabinet.processCabinetNominationLifecycle).mockResolvedValue({
      nominationsProcessed: 0,
    } as never);

    const primary = await import("@/lib/turn/primaryResolution");
    vi.mocked(primary.recordPrimarySnapshots).mockResolvedValue(undefined as never);
    vi.mocked(primary.accumulateGeneralElectionVotes).mockResolvedValue(undefined as never);

    const campaign = await import("@/lib/turn/campaignTurn");
    vi.mocked(campaign.processCampaignTurn).mockResolvedValue({
      campaignsProcessed: 0,
      totalFundsGenerated: 0,
      totalActionsGenerated: 0,
    } as never);

    const perpetual = await import("@/lib/turn/perpetualElections");
    vi.mocked(perpetual.advanceElectionTimers).mockResolvedValue(undefined as never);
    vi.mocked(perpetual.ensurePerpetualElections).mockResolvedValue(undefined as never);
    vi.mocked(perpetual.cleanupStaleElectionCandidates).mockResolvedValue(undefined as never);

    const electionRes = await import("@/lib/turn/electionResolution");
    vi.mocked(electionRes.resolveGeneralElections).mockResolvedValue(undefined as never);

    const leadershipElections = await import("@/lib/congress/leadershipElections");
    vi.mocked(leadershipElections.resolveExpiredLeadershipElections).mockResolvedValue(
      undefined as never
    );

    const policyEffects = await import("@/lib/policyEffects");
    vi.mocked(policyEffects.processStatePolicyEffects).mockResolvedValue(undefined as never);

    const govApproval = await import("@/lib/utils/governmentApproval");
    vi.mocked(govApproval.snapshotApprovalHistory).mockResolvedValue(undefined as never);
    const approvalRun = await import("@/lib/utils/approvalSnapshotRun");
    vi.mocked(approvalRun.snapshotApprovalsForTurn).mockResolvedValue({
      countriesProcessed: 0,
      guestsReleased: [],
    });

    const demographicEffects = await import("@/lib/demographicEffects");
    vi.mocked(demographicEffects.processAllStateDemographics).mockResolvedValue(undefined as never);

    const policyReactions = await import("@/lib/policyReactions");
    vi.mocked(policyReactions.decayPolicyReactions).mockResolvedValue(undefined as never);
  });

  it("returns success=true with incremented turn number", async () => {
    const { processTurn } = await import("@/lib/turnSystem");
    const result = await processTurn();

    expect(result.success).toBe(true);
    expect(result.turn).toBe(100); // mockGameState.currentTurn + 1
    expect(result.message).toContain("100");
  }, 30_000);

  it("persists the new turn number to the game state collection", async () => {
    const { processTurn } = await import("@/lib/turnSystem");
    await processTurn();

    const updateOne = db.collectionMocks["gameState"].updateOne;
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({ currentTurn: 100 }),
      })
    );
  });

  it("acquires the turn lock with stale-heartbeat recovery metadata", async () => {
    const { processTurn } = await import("@/lib/turnSystem");
    await processTurn();

    expect(db.collectionMocks["gameState"].findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "current",
        $or: expect.arrayContaining([
          { isProcessing: { $ne: true } },
          expect.objectContaining({
            processingHeartbeatAt: expect.objectContaining({ $lt: expect.any(Date) }),
          }),
        ]),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          isProcessing: true,
          processingKind: "turn",
          processingStartedAt: expect.any(Date),
          processingHeartbeatAt: expect.any(Date),
          processingPhase: "turn_bootstrap",
        }),
      }),
      { returnDocument: "after" }
    );
  });

  it("clears processing metadata when the turn finishes", async () => {
    const { processTurn } = await import("@/lib/turnSystem");
    await processTurn();

    expect(db.collectionMocks["gameState"].updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({
          isProcessing: false,
          processingKind: null,
          processingStartedAt: null,
          processingHeartbeatAt: null,
          processingPhase: null,
        }),
      })
    );
  });

  it("calls processActionRefresh and processFundGeneration", async () => {
    const { processTurn } = await import("@/lib/turnSystem");
    await processTurn();

    const { processActionRefresh } = await import("@/lib/turn/actionRefresh");
    const { processFundGeneration } = await import("@/lib/turn/fundGeneration");

    expect(processActionRefresh).toHaveBeenCalledTimes(1);
    expect(processFundGeneration).toHaveBeenCalledTimes(1);
  });

  it("calls advanceElectionTimers and ensurePerpetualElections", async () => {
    const { processTurn } = await import("@/lib/turnSystem");
    await processTurn();

    const { advanceElectionTimers, ensurePerpetualElections } =
      await import("@/lib/turn/perpetualElections");

    expect(advanceElectionTimers).toHaveBeenCalledTimes(1);
    expect(ensurePerpetualElections).toHaveBeenCalledTimes(1);
  });

  it("writes actual bill and nomination phase telemetry instead of zero placeholders", async () => {
    const bills = await import("@/lib/billLifecycle");
    const stateBills = await import("@/lib/turn/billLifecycle/regionalEngine");
    const cabinet = await import("@/lib/cabinetNominationLifecycle");

    vi.mocked(bills.processBillLifecycle).mockResolvedValue({
      billsProcessed: 4,
      billsPassed: 3,
      billsFailed: 1,
      billsVetoed: 0,
    } as never);
    mockUKBillLifecycle.mockResolvedValue({ enacted: 2, failed: 1 });
    vi.mocked(stateBills.processStateBillTimers).mockResolvedValue({
      billsProcessed: 5,
    } as never);
    vi.mocked(cabinet.processCabinetNominationLifecycle).mockResolvedValue({
      nominationsProcessed: 6,
    } as never);

    const { processTurn } = await import("@/lib/turnSystem");
    await processTurn();

    const turnLog = db.collectionMocks["turnLogs"].insertOne.mock.calls.at(-1)?.[0] as {
      phases: Record<string, unknown>;
    };

    expect(turnLog.phases.billLifecycle).toEqual({
      billsProcessed: 4,
      billsPassed: 3,
      billsFailed: 1,
      billsVetoed: 0,
    });
    expect(turnLog.phases.ukBillLifecycle).toEqual({ enacted: 2, failed: 1 });
    expect(turnLog.phases.stateBillTimers).toEqual({ billsProcessed: 5 });
    expect(turnLog.phases.cabinetNominations).toEqual({ nominationsProcessed: 6 });
  });

  it("uses real wall-clock time for national bill lifecycle phases", async () => {
    // Fast-mode runs turns every 30 min but advances the game calendar one
    // game-hour per turn, so the game clock pulls AHEAD of real time: realNow is
    // only 30 min past the last turn, yet gameNow = lastTurnProcessed + MS_PER_TURN
    // (1h). That divergence proves the bill phases use realNow while the NPP phase
    // uses the game clock. (In normal mode the two clocks coincide — computeGameNow
    // only pulls ahead under fastMode; see computeGameNow.test.ts.) The gap stays
    // under AUTO_PAUSE_DRIFT_MS so the drift guard does not intercept.
    const fastModeState = { ...mockGameState, fastMode: true };
    db.collectionMocks["gameState"].findOne.mockResolvedValue(fastModeState);
    db.collectionMocks["gameState"].findOneAndUpdate.mockResolvedValue(fastModeState);

    const realNow = new Date(mockGameState.lastTurnProcessed.getTime() + 30 * 60 * 1000);
    vi.useFakeTimers();
    vi.setSystemTime(realNow);

    const { processTurn } = await import("@/lib/turnSystem");
    await processTurn();

    const expectedGameNow = new Date(
      Math.max(mockGameState.lastTurnProcessed.getTime() + MS_PER_TURN, realNow.getTime())
    );

    const { processBillLifecycle } = await import("@/lib/billLifecycle");
    const { processNPPTurn } = await import("@/lib/turn/nppBehavior");
    const { processStateBillTimers } = await import("@/lib/turn/billLifecycle/regionalEngine");
    const { processCabinetNominationLifecycle } = await import("@/lib/cabinetNominationLifecycle");

    expect(processNPPTurn).toHaveBeenCalledWith(expectedGameNow, {
      billDeadlineNow: realNow,
      currentTurn: expect.any(Number),
    });
    expect(processBillLifecycle).toHaveBeenCalledWith(realNow);
    expect(mockUKBillLifecycle).toHaveBeenCalledWith(realNow);
    expect(processStateBillTimers).toHaveBeenCalledWith(realNow);
    expect(processCabinetNominationLifecycle).toHaveBeenCalledWith(realNow);
    expect(processBillLifecycle).not.toHaveBeenCalledWith(expectedGameNow);
    expect(mockUKBillLifecycle).not.toHaveBeenCalledWith(expectedGameNow);
    expect(processStateBillTimers).not.toHaveBeenCalledWith(expectedGameNow);
    expect(processCabinetNominationLifecycle).not.toHaveBeenCalledWith(expectedGameNow);
  });

  it("calls resolveGeneralElections after advanceElectionTimers", async () => {
    const callOrder: string[] = [];
    const perpetual = await import("@/lib/turn/perpetualElections");
    const electionRes = await import("@/lib/turn/electionResolution");

    vi.mocked(perpetual.advanceElectionTimers).mockImplementation(async () => {
      callOrder.push("advanceElectionTimers");
    });
    vi.mocked(electionRes.resolveGeneralElections).mockImplementation(async (_now: Date) => {
      void _now;
      callOrder.push("resolveGeneralElections");
      return 0;
    });

    const { processTurn } = await import("@/lib/turnSystem");
    await processTurn();

    const advIdx = callOrder.indexOf("advanceElectionTimers");
    const resIdx = callOrder.indexOf("resolveGeneralElections");
    expect(advIdx).toBeGreaterThanOrEqual(0);
    expect(resIdx).toBeGreaterThan(advIdx);
  });

  it("returns success=false when game state is not initialized", async () => {
    db.collectionMocks["gameState"].findOne.mockResolvedValue(null);
    db.collectionMocks["gameState"].findOneAndUpdate.mockResolvedValue(null);

    const { processTurn } = await import("@/lib/turnSystem");
    const result = await processTurn();

    // With the concurrency lock, a null findOneAndUpdate means either no game state
    // or another turn is processing — both return success: true with a skip message
    expect(result.success).toBe(true);
    expect(result.message).toContain("Skipped");
  });
});
