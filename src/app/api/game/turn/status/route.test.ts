import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn(),
}));

describe("GET /api/game/turn/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T08:10:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the reset-lock countdown while processing is still within the stale window", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 506,
      currentYear: 2030,
      isActive: true,
      isProcessing: true,
      lastTurnProcessed: new Date("2026-05-02T00:00:00.000Z"),
      processingPhase: "financialSuspectScan",
      processingTargetTurn: 507,
      processingStartedAt: new Date("2026-05-02T08:00:39.000Z"),
      processingHeartbeatAt: new Date("2026-05-02T08:00:53.000Z"),
      corporationActionsPaused: false,
      playerTransfersPaused: false,
      forexEnabled: true,
      fastMode: false,
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/game/turn/status"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      isProcessing: true,
      processingPhase: "financialSuspectScan",
      processingProgress: expect.any(Number),
      processingPhaseLabel: "financial Suspect Scan",
      processingTargetTurn: 507,
      canResetProcessingLock: false,
      processingLockRetryAfterSeconds: 653,
      processingLockStaleAt: "2026-05-02T08:20:53.000Z",
    });
    expect(body.processingProgress).toBeGreaterThan(0);
    expect(body.processingProgress).toBeLessThanOrEqual(98);
  });

  it("marks the reset as available once the stale window has elapsed", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 506,
      currentYear: 2030,
      isActive: true,
      isProcessing: true,
      lastTurnProcessed: new Date("2026-05-02T00:00:00.000Z"),
      processingPhase: "financialSuspectScan",
      processingTargetTurn: 507,
      processingStartedAt: new Date("2026-05-02T08:00:39.000Z"),
      processingHeartbeatAt: new Date("2026-05-02T07:40:00.000Z"),
      corporationActionsPaused: false,
      playerTransfersPaused: false,
      forexEnabled: true,
      fastMode: false,
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/game/turn/status"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      isProcessing: true,
      canResetProcessingLock: true,
      processingLockRetryAfterSeconds: 0,
      processingLockStaleAt: "2026-05-02T08:00:00.000Z",
    });
  });
});
