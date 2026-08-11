import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TurnPhaseTelemetryMap } from "@/lib/db/types";
import { createTurnPhaseRuntime } from "@/simulation/engine/turnPhaseRuntime";

const recordAudit = vi.fn();
vi.mock("@/lib/audit/recordAudit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));

function createMockDb() {
  const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
  return {
    updateOne,
    db: {
      collection: vi.fn().mockReturnValue({
        updateOne,
      }),
    },
  };
}

async function flushAsyncStatusWrites() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createTurnPhaseRuntime", () => {
  beforeEach(() => {
    recordAudit.mockClear();
  });

  it("records running and completed telemetry for successful phases", async () => {
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const warnings: string[] = [];
    const currentPhaseRef = { current: null as string | null };
    const { db, updateOne } = createMockDb();

    const runtime = createTurnPhaseRuntime({
      db,
      phaseStatuses,
      warnings,
      currentPhaseRef,
    });

    const result = await runtime.runPhase("fundGeneration", async () => 42);
    await flushAsyncStatusWrites();

    expect(result).toBe(42);
    expect(currentPhaseRef.current).toBe("fundGeneration");
    expect(phaseStatuses.fundGeneration.status).toBe("completed");
    expect(phaseStatuses.fundGeneration.startedAt).not.toBeNull();
    expect(phaseStatuses.fundGeneration.completedAt).not.toBeNull();
    expect(updateOne).toHaveBeenCalled();
  });

  it("records failed telemetry and warning messages when a phase throws", async () => {
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const warnings: string[] = [];
    const currentPhaseRef = { current: null as string | null };
    const { db } = createMockDb();

    const runtime = createTurnPhaseRuntime({
      db,
      phaseStatuses,
      warnings,
      currentPhaseRef,
    });

    const result = await runtime.runPhase("bondTurn", async () => {
      throw new Error("coupon mismatch");
    });
    await flushAsyncStatusWrites();

    expect(result).toBeNull();
    expect(currentPhaseRef.current).toBe("bondTurn");
    expect(phaseStatuses.bondTurn.status).toBe("failed");
    expect(phaseStatuses.bondTurn.message).toBe("coupon mismatch");
    expect(warnings).toEqual(["bondTurn: coupon mismatch"]);
  });

  it("marks skipped phases without mutating the active phase ref", async () => {
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const warnings: string[] = [];
    const currentPhaseRef = { current: "campaignTurn" };
    const { db } = createMockDb();

    const runtime = createTurnPhaseRuntime({
      db,
      phaseStatuses,
      warnings,
      currentPhaseRef,
    });

    await runtime.markPhaseSkipped(
      "forexTurn",
      "featureDisabled",
      "Skipped because the forex system is disabled."
    );

    expect(currentPhaseRef.current).toBe("campaignTurn");
    expect(phaseStatuses.forexTurn.status).toBe("skipped");
    expect(phaseStatuses.forexTurn.reason).toBe("featureDisabled");
  });

  it("emits one audit envelope for a successful mutating phase (T2.7)", async () => {
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const warnings: string[] = [];
    const currentPhaseRef = { current: null as string | null };
    const { db } = createMockDb();

    const runtime = createTurnPhaseRuntime({
      db,
      phaseStatuses,
      warnings,
      currentPhaseRef,
      turn: 42,
    });

    await runtime.runPhase("fundGeneration", async () => [1, 2, 3]);
    await flushAsyncStatusWrites();

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const entry = recordAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      source: "turn",
      category: "system",
      action: "turn.phase",
      phase: "fundGeneration",
      turn: 42,
      traceId: "turn:42:fundGeneration",
      outcome: "ok",
    });
    expect(entry.meta).toMatchObject({ count: 3 });
  });

  it("emits an audit envelope with outcome error when a mutating phase throws", async () => {
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const warnings: string[] = [];
    const currentPhaseRef = { current: null as string | null };
    const { db } = createMockDb();

    const runtime = createTurnPhaseRuntime({
      db,
      phaseStatuses,
      warnings,
      currentPhaseRef,
      turn: 7,
    });

    await runtime.runPhase("bondTurn", async () => {
      throw new Error("coupon mismatch");
    });
    await flushAsyncStatusWrites();

    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit.mock.calls[0][0]).toMatchObject({
      action: "turn.phase",
      phase: "bondTurn",
      traceId: "turn:7:bondTurn",
      outcome: "error",
      reason: "coupon mismatch",
    });
  });

  it("does not emit an audit envelope for a read-only/telemetry phase", async () => {
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const warnings: string[] = [];
    const currentPhaseRef = { current: null as string | null };
    const { db } = createMockDb();

    const runtime = createTurnPhaseRuntime({
      db,
      phaseStatuses,
      warnings,
      currentPhaseRef,
      turn: 3,
    });

    await runtime.runPhase("activityLogging", async () => 5);
    await flushAsyncStatusWrites();

    expect(recordAudit).not.toHaveBeenCalled();
  });
});
