import { describe, expect, it, vi } from "vitest";
import { stateEffectsAndNationalAggregationPhase } from "@/simulation/phases/stateEffectsPhase";

/**
 * S4 (2026-07-16 core-sim audit): crisisTurn, ministerialOrders, and
 * policyEffects all write the same stateMetrics "<cat>.<metric>.value" paths
 * ($inc, $inc, and read-modify-write $set respectively). They must be strictly
 * serialized — crisisTurn → ministerialOrders → policyEffects — while the
 * non-conflicting phases stay parallel.
 *
 * The runtime stub records start/end events per phase and resolves each phase
 * on a macrotask, so phases launched concurrently all record their "start"
 * before any "end". If the three writers ever regress to running inside the
 * parallel Promise.all, their starts interleave and these assertions fail.
 * Phase fns are never invoked, so no DB access happens.
 */
function makeHarness() {
  const events: string[] = [];
  const runtime = {
    runPhase: vi.fn(async (name: string, _fn: () => Promise<unknown>) => {
      events.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      events.push(`end:${name}`);
      // The Bretton Woods shell reports what it did; the adapter records it
      // on phaseResults for turn logs. Other phases return null here.
      if (name === "brettonWoodsTurn") {
        return {
          enabled: true,
          goldCover: 1,
          suspended: [],
          floated: [],
          currenciesProcessed: 0,
        };
      }
      return null;
    }),
    markPhaseSkipped: vi.fn(async () => {}),
  };
  const context = {
    db: {},
    newTurn: 1000,
    currentYear: 2025,
    phaseResults: {} as Record<string, unknown>,
    gameState: { forexEnabled: true, startingYear: 2019 },
    gameNow: new Date("2025-01-01T00:00:00Z"),
    startTimeMs: Date.now(),
    warnings: [] as string[],
    phaseStatuses: {} as Record<string, unknown>,
  };
  return { events, runtime, context };
}

describe("stateEffectsAndNationalAggregation phase ordering", () => {
  it("serializes the stateMetrics writers: crisisTurn → ministerialOrders → policyEffects", async () => {
    const { events, runtime, context } = makeHarness();

    await stateEffectsAndNationalAggregationPhase.execute(context as never, runtime as never);

    const idx = (event: string) => {
      const i = events.indexOf(event);
      expect(i, `${event} must be recorded`).toBeGreaterThanOrEqual(0);
      return i;
    };

    // Strict serialization: each writer fully completes before the next starts.
    expect(idx("end:crisisTurn")).toBeLessThan(idx("start:ministerialOrders"));
    expect(idx("end:ministerialOrders")).toBeLessThan(idx("start:policyEffects"));

    // The metric engine consumes the settled metric values and must run after
    // the last writer finishes.
    expect(idx("end:policyEffects")).toBeLessThan(idx("start:metricEngine"));
  });

  it("keeps non-conflicting phases parallel with the serialized writer chain", async () => {
    const { events, runtime, context } = makeHarness();

    await stateEffectsAndNationalAggregationPhase.execute(context as never, runtime as never);

    // demographicEffects (no stateMetrics writes) still starts in the same
    // scheduling tick as crisisTurn — i.e. before crisisTurn has ended —
    // proving the fix did not serialize the whole Promise.all.
    const demoStart = events.indexOf("start:demographicEffects");
    const crisisEnd = events.indexOf("end:crisisTurn");
    expect(demoStart).toBeGreaterThanOrEqual(0);
    expect(demoStart).toBeLessThan(crisisEnd);
  });

  // Issue #7: the Bretton Woods exit is built, tested and flagged on, but the
  // turn never reaches it — no phase in this sequence invokes the mechanic, so
  // a flagged-on world can never suspend convertibility. The exit must run on
  // the real player-facing entry path: after inflationRecalc (which settles
  // the US inflation gap the gold-cover drain reads) and before forexTurn
  // (which applies the regime's band and drift the same turn).
  it("reaches the Bretton Woods exit between inflationRecalc and forexTurn", async () => {
    const { events, runtime, context } = makeHarness();

    await stateEffectsAndNationalAggregationPhase.execute(context as never, runtime as never);

    const idx = (event: string) => {
      const i = events.indexOf(event);
      expect(i, `${event} must be recorded`).toBeGreaterThanOrEqual(0);
      return i;
    };

    expect(idx("end:inflationRecalc")).toBeLessThan(idx("start:brettonWoodsTurn"));
    expect(idx("end:brettonWoodsTurn")).toBeLessThan(idx("start:forexTurn"));

    // The adapter records the shell's report on phaseResults for turn logs.
    expect(context.phaseResults).toMatchObject({
      brettonWoodsTurn: {
        enabled: true,
        goldCover: 1,
        suspended: [],
        floated: [],
        currenciesProcessed: 0,
      },
    });
  });
});
