import { describe, it, expect, vi, beforeEach } from "vitest";

// HTTP cron endpoint — mirrors the in-process stockExchangeRefreshCron in
// src/lib/cron.ts. Same stuck-isProcessing recovery semantics: a stale lock
// must NOT block the refresh, since stale = no real turn in flight.
// Tracks the same root cause as the 2026-05-24 sandbox-staging incident.

vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/api/requireCron", () => ({ requireCron: vi.fn() }));
vi.mock("@/lib/api/requestLog", () => ({ logRequest: vi.fn() }));
vi.mock("@/lib/corporations/applyPriceMultipliers", () => ({
  applyPriceMultipliers: vi.fn().mockResolvedValue({ updated: 0, pulseCount: 0 }),
}));
vi.mock("@/lib/turn/stockExchangeSnapshot", () => ({
  generateStockExchangeSnapshots: vi.fn().mockResolvedValue(undefined),
}));

describe("GET /api/cron/stock-exchange-refresh", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireCron } = await import("@/lib/api/requireCron");
    vi.mocked(requireCron).mockReturnValue(true);
  });

  it("returns 200 and skips refresh when a turn is in progress with a fresh heartbeat", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      isActive: true,
      isProcessing: true,
      processingHeartbeatAt: new Date(),
      currentTurn: 1,
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/cron/stock-exchange-refresh"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ skipped: true });
    const { applyPriceMultipliers } = await import("@/lib/corporations/applyPriceMultipliers");
    expect(applyPriceMultipliers).not.toHaveBeenCalled();
  });

  it("proceeds with refresh when isProcessing is true but the lock heartbeat is stale", async () => {
    // Regression: HTTP cron endpoint must follow the same stuck-lock recovery
    // rule as the in-process cron. Otherwise an externally-driven cron tick
    // would also skip forever on a stale flag.
    const staleHeartbeat = new Date(Date.now() - 25 * 60 * 1000);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      isActive: true,
      isProcessing: true,
      processingHeartbeatAt: staleHeartbeat,
      currentTurn: 1,
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/cron/stock-exchange-refresh"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    const { applyPriceMultipliers } = await import("@/lib/corporations/applyPriceMultipliers");
    expect(applyPriceMultipliers).toHaveBeenCalled();
  });

  it("skips when the turn system is paused regardless of lock state", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      isActive: false,
      isProcessing: false,
      currentTurn: 1,
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/cron/stock-exchange-refresh"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ skipped: true });
  });
});
