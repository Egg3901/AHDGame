import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findOne } = vi.hoisted(() => ({ findOne: vi.fn() }));
vi.mock("@/lib/db/collections", () => ({
  getGameStateCollection: vi.fn(async () => ({ findOne })),
}));
vi.mock("@/lib/api/errors", () => ({
  handleRouteError: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
}));
vi.mock("@/lib/singleplayer", () => ({ isSingleplayer: vi.fn(() => false) }));

describe("GET /api/game/turn/status", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T08:10:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces 50 active-turn polls and projects only public status fields", async () => {
    findOne.mockResolvedValue({ currentTurn: 1, isProcessing: true, isActive: true });
    const { GET } = await import("./route");
    const responses = await Promise.all(
      Array.from({ length: 50 }, () => GET(new Request("http://localhost/api/game/turn/status")))
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(findOne).toHaveBeenCalledTimes(1);
    const projection = findOne.mock.calls[0][1]?.projection;
    expect(projection).toMatchObject({
      currentTurn: 1,
      processingPhaseStatuses: 1,
      processingAbandonedAt: 1,
      updatedAt: 1,
    });
    expect(Object.values(projection)).not.toContain(0);
    expect(projection).not.toHaveProperty("census");
    findOne.mockResolvedValue({ currentTurn: 2, isProcessing: false, isActive: true });
    vi.advanceTimersByTime(501);
    const completed = await GET(new Request("http://localhost/api/game/turn/status"));
    expect((await completed.json()).currentTurn).toBe(2);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it("does not cache singleplayer polls", async () => {
    const { isSingleplayer } = await import("@/lib/singleplayer");
    vi.mocked(isSingleplayer).mockReturnValue(true);
    findOne.mockResolvedValueOnce({ currentTurn: 1 }).mockResolvedValueOnce({ currentTurn: 2 });
    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/game/turn/status"));
    const response = await GET(new Request("http://localhost/api/game/turn/status"));
    expect((await response.json()).currentTurn).toBe(2);
    expect(findOne).toHaveBeenCalledTimes(2);
    vi.mocked(isSingleplayer).mockReturnValue(false);
  });

  it("retries a rejected read instead of retaining a rejected promise", async () => {
    findOne.mockRejectedValueOnce(new Error("transient read error"));
    const { GET } = await import("./route");
    expect((await GET(new Request("http://localhost/api/game/turn/status"))).status).toBe(500);
    findOne.mockResolvedValueOnce({ currentTurn: 3 });
    const response = await GET(new Request("http://localhost/api/game/turn/status"));
    expect((await response.json()).currentTurn).toBe(3);
  });

  it("reports the reset-lock countdown while processing is still within the stale window", async () => {
    findOne.mockResolvedValue({
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
    findOne.mockResolvedValue({
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
