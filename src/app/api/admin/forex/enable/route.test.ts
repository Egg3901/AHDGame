import { describe, it, expect, vi, beforeEach } from "vitest";

// Lock-state handling for the forex migration entry-point. The original code
// returned a plain "Turn is currently processing" 409 on any isProcessing=true
// state, which dead-ends the admin during a stuck-lock incident even though
// the manual /api/admin/turn/reset-lock workaround exists. The fix surfaces
// the lock's lastTouch so the admin sees it's stale and can take action.

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

describe("POST /api/admin/forex/enable — lock-state handling", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);
  });

  function mockGameState(doc: Record<string, unknown>) {
    return {
      collection: () => ({
        findOne: vi.fn().mockResolvedValue(doc),
        updateOne: vi.fn().mockResolvedValue({}),
      }),
    };
  }

  it("returns 409 with the plain busy message when a turn is in progress with a fresh heartbeat", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(
      mockGameState({
        _id: "current",
        isProcessing: true,
        processingHeartbeatAt: new Date(),
        forexEnabled: false,
      }) as never
    );

    const { POST } = await import("./route");
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/turn is currently processing/i);
    // Should NOT advertise stale-lock recovery for a healthy in-flight turn.
    expect(body.lockStale).toBeFalsy();
  });

  it("returns 409 with stale-lock context + reset-lock hint when the heartbeat is stale", async () => {
    // The admin should be told the lock is stale + given the path to recovery
    // rather than the generic "wait for the turn to finish" message that
    // applies only to healthy locks.
    const staleHeartbeat = new Date(Date.now() - 25 * 60 * 1000);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(
      mockGameState({
        _id: "current",
        isProcessing: true,
        processingHeartbeatAt: staleHeartbeat,
        forexEnabled: false,
      }) as never
    );

    const { POST } = await import("./route");
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.lockStale).toBe(true);
    expect(body.lockLastTouch).toBe(staleHeartbeat.toISOString());
    expect(body.error).toMatch(/stale/i);
    expect(body.error).toMatch(/reset/i);
  });
});
