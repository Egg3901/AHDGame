import { afterEach, describe, expect, it, vi } from "vitest";
import { createTurnPhaseRuntime } from "./turnPhaseRuntime";
import { TURN_LOCK_HEARTBEAT_MS } from "@/lib/turn/processingLock";

vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));

function fixture() {
  const durable: Record<string, unknown> = {};
  const apply = (update: { $set: Record<string, unknown> }) => {
    Object.assign(durable, structuredClone(update.$set));
    return { acknowledged: true, matchedCount: 1 };
  };
  const updateOne = vi.fn(async (_filter: unknown, update: { $set: Record<string, unknown> }) =>
    apply(update)
  );
  const runtime = createTurnPhaseRuntime({
    db: { collection: vi.fn().mockReturnValue({ updateOne }) },
    phaseStatuses: {},
    warnings: [],
    currentPhaseRef: { current: null },
  });
  return { durable, apply, updateOne, runtime };
}

afterEach(() => vi.useRealTimers());

describe("durable phase start boundaries", () => {
  it("persists a later phase before its first mutation within the flush window", async () => {
    vi.useFakeTimers();
    const { runtime, durable } = fixture();
    await runtime.runPhase("warmup", async () => 1);
    let mutations = 0;
    await runtime.runPhase("cashSettlement", async () => {
      expect(durable["processingPhaseStatuses.cashSettlement"]).toMatchObject({
        status: "running",
      });
      mutations++;
      return 1;
    });
    expect(mutations).toBe(1);
    // A crash here must classify the phase as applied/interrupted, never pending.
    expect(durable["processingPhaseStatuses.cashSettlement"]).toMatchObject({ status: "running" });
  });

  it("does not mutate when the later phase's start marker cannot be persisted", async () => {
    vi.useFakeTimers();
    const { runtime, updateOne } = fixture();
    await runtime.runPhase("warmup", async () => 1);
    updateOne.mockRejectedValueOnce(new Error("start marker unavailable"));
    const mutate = vi.fn(async () => 1);
    await expect(runtime.runPhase("cashSettlement", mutate)).resolves.toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not mutate when the processing lock no longer matches", async () => {
    const { runtime, updateOne } = fixture();
    updateOne.mockResolvedValueOnce({ acknowledged: true, matchedCount: 0 });
    const mutate = vi.fn(async () => 1);
    await expect(runtime.runPhase("cashSettlement", mutate)).resolves.toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("cannot revive a failed phase when an older heartbeat finishes late", async () => {
    vi.useFakeTimers();
    const { runtime, updateOne, apply, durable } = fixture();
    let rejectWork!: (error: Error) => void;
    const work = new Promise<number>((_resolve, reject) => {
      rejectWork = reject;
    });
    const running = runtime.runPhase("cashSettlement", () => work);
    await vi.advanceTimersByTimeAsync(0);
    let releaseHeartbeat!: () => void;
    updateOne.mockImplementationOnce(
      (_filter, update) =>
        new Promise((resolve) => {
          releaseHeartbeat = () => resolve(apply(update));
        })
    );
    await vi.advanceTimersByTimeAsync(TURN_LOCK_HEARTBEAT_MS);
    rejectWork(new Error("settlement failed"));
    await running;
    releaseHeartbeat();
    await vi.advanceTimersByTimeAsync(0);
    expect(durable["processingPhaseStatuses.cashSettlement"]).toMatchObject({ status: "failed" });
  });
});
