import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TurnPhaseTelemetryMap } from "@/lib/db/types";
import { recordRoundTrip, resetRoundTripProfiler } from "@/lib/observability/mongoRoundTrips";
import { createTurnPhaseRuntime } from "@/simulation/engine/turnPhaseRuntime";
import { getAnomalyScanCadencePredicate } from "@/simulation/phases/anomalyScanCadence";
import { getSingleplayerPhasePredicate } from "@/simulation/phases/singleplayerPhases";

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
  it.each([
    { name: "financialSuspectScan", predicate: getAnomalyScanCadencePredicate(1, 3) },
    { name: "gameHealthSnapshot", predicate: getSingleplayerPhasePredicate(true) },
  ])(
    "does not label a filtered $name phase as an elections-only simulation",
    async ({ name, predicate }) => {
      const phaseStatuses: TurnPhaseTelemetryMap = {};
      const currentPhaseRef = { current: "campaignTurn" };
      const { db, updateOne } = createMockDb();
      const execute = vi.fn().mockResolvedValue(42);
      const runtime = createTurnPhaseRuntime({
        db,
        phaseStatuses,
        warnings: [],
        currentPhaseRef,
        shouldRunPhase: predicate,
      });

      await expect(runtime.runPhase(name, execute)).resolves.toBeNull();

      expect(execute).not.toHaveBeenCalled();
      expect(currentPhaseRef.current).toBe("campaignTurn");
      expect(phaseStatuses[name]).toMatchObject({
        status: "skipped",
        reason: "conditional",
        message: "skipped: phase eligibility predicate",
      });
      expect(updateOne).toHaveBeenCalledWith(
        { _id: "current", isProcessing: true },
        expect.objectContaining({
          $set: expect.objectContaining({
            [`processingPhaseStatuses.${name}`]: expect.objectContaining({ reason: "conditional" }),
          }),
        })
      );
    }
  );

  it("reports a completed phase to an opt-in sandbox observer without changing its result", async () => {
    const observed: Array<{ name: string; result: unknown }> = [];
    const runtime = createTurnPhaseRuntime({
      db: createMockDb().db,
      phaseStatuses: {},
      warnings: [],
      currentPhaseRef: { current: null },
      onPhaseCompleted: async (phase) => {
        observed.push({ name: phase.name, result: phase.result });
      },
    });

    await expect(runtime.runPhase("traceablePhase", async () => ({ changed: 2 }))).resolves.toEqual(
      { changed: 2 }
    );
    expect(observed).toEqual([{ name: "traceablePhase", result: { changed: 2 } }]);
  });
  beforeEach(() => {
    recordAudit.mockClear();
    resetRoundTripProfiler();
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

describe("unmeasured query telemetry", () => {
  it("omits query counts and budget status when no monitor has observed commands", async () => {
    resetRoundTripProfiler();
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const runtime = createTurnPhaseRuntime({
      db: createMockDb().db,
      phaseStatuses,
      warnings: [],
      currentPhaseRef: { current: null },
    });
    await runtime.runPhase("unmonitored", async () => 1);
    await flushAsyncStatusWrites();
    expect(phaseStatuses.unmonitored).not.toHaveProperty("roundTrips");
    expect(phaseStatuses.unmonitored).not.toHaveProperty("overBudget");
  });
  it("records real counts and a measured zero after the monitor observes commands", async () => {
    resetRoundTripProfiler();
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const runtime = createTurnPhaseRuntime({
      db: createMockDb().db,
      phaseStatuses,
      warnings: [],
      currentPhaseRef: { current: null },
    });
    await runtime.runPhase("measured", async () => {
      recordRoundTrip("npps");
    });
    await runtime.runPhase("empty", async () => 1);
    await flushAsyncStatusWrites();
    expect(phaseStatuses.measured.roundTrips).toBe(1);
    expect(phaseStatuses.empty.roundTrips).toBe(0);
    resetRoundTripProfiler();
  });
});

describe("phase sub-steps and top collections (#2689)", () => {
  it("persists named sub-steps with their own round trips, and top collections above the threshold", async () => {
    resetRoundTripProfiler();
    const { substepMarker } = await import("@/lib/observability/phaseSubsteps");
    const { TOP_COLLECTIONS_MIN_ROUND_TRIPS } =
      await import("@/simulation/engine/turnPhaseRuntime");
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const runtime = createTurnPhaseRuntime({
      db: createMockDb().db,
      phaseStatuses,
      warnings: [],
      currentPhaseRef: { current: null },
    });
    await runtime.runPhase("corporationTurn", async () => {
      const steps = substepMarker();
      for (let i = 0; i < TOP_COLLECTIONS_MIN_ROUND_TRIPS; i++) recordRoundTrip("corporations");
      steps.mark("load");
      recordRoundTrip("sectors");
      recordRoundTrip("sectors");
      steps.mark("write");
      recordRoundTrip("sectors");
      steps.mark("write");
    });
    await flushAsyncStatusWrites();
    const status = phaseStatuses.corporationTurn;
    expect(status.substeps?.load).toMatchObject({ roundTrips: 100, calls: 1 });
    expect(status.substeps?.write).toMatchObject({ roundTrips: 3, calls: 2 });
    expect(status.topCollections?.[0]).toEqual({ collection: "corporations", roundTrips: 100 });
    expect(status.topCollections).toHaveLength(2);
    resetRoundTripProfiler();
  });

  it("records nothing for small phases, outside a phase, or when a phase fails", async () => {
    resetRoundTripProfiler();
    const { substepMarker } = await import("@/lib/observability/phaseSubsteps");
    substepMarker().mark("outside");
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const runtime = createTurnPhaseRuntime({
      db: createMockDb().db,
      phaseStatuses,
      warnings: [],
      currentPhaseRef: { current: null },
    });
    await runtime.runPhase("small", async () => {
      recordRoundTrip("npps");
    });
    await runtime.runPhase("broken", async () => {
      substepMarker().mark("partial");
      throw new Error("boom");
    });
    await runtime.runPhase("broken", async () => 1);
    await flushAsyncStatusWrites();
    expect(phaseStatuses.small).not.toHaveProperty("topCollections");
    expect(phaseStatuses.small).not.toHaveProperty("substeps");
    expect(phaseStatuses.broken).not.toHaveProperty("substeps");
    resetRoundTripProfiler();
  });
});
