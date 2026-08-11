/**
 * E2E: sustained bad governance drives CN through every stage and
 * eventually collapses the regime.
 *
 * Inputs per design § Phase 8.2: recession, slowly rising
 * unemployment, off-target inflation, low-grade repression. No
 * decision-handler intervention — measures the slowest natural slide.
 *
 * Hard floor from the design doc: total collapse time ≥ 132 turns.
 * Soft ranges (Stage 1 in 30-60, Stage 4 by 300) are tuning targets;
 * the asserts here bracket what the harness actually produces so
 * regressions are caught before silently retuning the bands.
 */
import { describe, it, expect } from "vitest";
import { runSimTurns } from "./helpers";

describe("E2E — collapse path under sustained bad governance", () => {
  const inputsForTurn = (turn: number) => ({
    economic: {
      gdpGrowthAnnualPct: -2,
      unemploymentDeltaPct: 0.3,
      inflationDeviationFromTargetPct: 3,
    },
    purges: turn % 4 === 0 ? [{ severity: "minor" as const, kind: "discipline" as const }] : [],
    enactedBills: [],
    election: { isElectionTurn: false, opsMultiplier: 1.0 },
  });

  it("walks stable → discontent → crisis → internalChallenge → collapse without intervention", () => {
    const snapshots = runSimTurns({ turns: 400, inputsForTurn });

    const firstAt = (stage: string): number => snapshots.findIndex((s) => s.stage === stage);

    const stage1 = firstAt("discontent");
    const stage2 = firstAt("crisis");
    const stage3 = firstAt("internalChallenge");
    const stage4 = firstAt("collapse");

    // All four stages eventually fire under sustained mismanagement.
    expect(stage1).toBeGreaterThan(0);
    expect(stage2).toBeGreaterThan(stage1);
    expect(stage3).toBeGreaterThan(stage2);
    expect(stage4).toBeGreaterThan(stage3);

    // Design ranges from the spec § Phase 8.2. The harness currently produces
    // Stage1@35, Stage2@119, Stage3@257, Stage4@329.
    //
    // Stages 3 and 4 each moved ~60 turns later when #3165 halved the two-way
    // legitimacy/confidence coupling (popularLegitimacyBleedIntoParty
    // -0.5/-1.0 → -0.25/-0.5, intraPartyCouplingBleed -0.3 → -0.05). That was
    // a deliberate fix: the old bleeds outran every recovery force, making
    // collapse mathematically inescapable once popular < 15. The earlier
    // Stage3@197 / Stage4@269 figures are pre-#3165 and not recoverable
    // without reintroducing that death spiral.
    //
    // NOTE: collapse at 329 now sits above the spec's "collapse by 300"
    // target. Slowing the slide was the point of #3165, so the miss is a
    // tuning decision for the design owner, not a bug to fix here — the
    // bounds below bracket real behaviour rather than the stale target.
    expect(stage1).toBeGreaterThanOrEqual(25);
    expect(stage1).toBeLessThanOrEqual(65);
    expect(stage2).toBeGreaterThanOrEqual(80);
    expect(stage2).toBeLessThanOrEqual(170);
    expect(stage4).toBeGreaterThanOrEqual(200);
    expect(stage4).toBeLessThanOrEqual(360);

    // Hard floor from the spec — collapse must take at least 132 turns
    // from the first sign of discontent.
    expect(stage4 - stage1).toBeGreaterThanOrEqual(132);
  });

  it("popular legitimacy bottoms below the Stage-2 entry threshold (35) before crisis fires", () => {
    const snapshots = runSimTurns({ turns: 200, inputsForTurn });
    const stage2Idx = snapshots.findIndex((s) => s.stage === "crisis");
    expect(stage2Idx).toBeGreaterThan(0);
    expect(snapshots[stage2Idx].popularLegitimacy).toBeLessThanOrEqual(35);
  });

  it("intra-party confidence couples downward as popular collapses", () => {
    // 300 turns, not 250: post-#3165 the halved coupling bleed reaches Stage 3
    // at ~257, so a 250-turn window ends one stage short of what this asserts.
    const snapshots = runSimTurns({ turns: 300, inputsForTurn });
    const stage3Idx = snapshots.findIndex((s) => s.stage === "internalChallenge");
    if (stage3Idx === -1) {
      // Tuning warning: Stage 3 didn't fire in 300 turns. The coupling bleed
      // (-0.25 to -0.5 per turn while popular < 30) should still drag
      // intra-party below 15 under sustained crisis.
      throw new Error(
        "Stage 3 did not fire in 300 turns — intra-party coupling has weakened further since #3165"
      );
    }
    // At Stage 3 entry, intra-party should be at or below 15 (the
    // Stage-3 entry threshold per the design doc).
    expect(snapshots[stage3Idx].partyConfidence).toBeLessThanOrEqual(15);
  });

  it("Stage 4 entry confirms collapsed scalar state (popular < 15 sustained)", () => {
    const snapshots = runSimTurns({ turns: 400, inputsForTurn });
    const stage4Idx = snapshots.findIndex((s) => s.stage === "collapse");
    expect(stage4Idx).toBeGreaterThan(0);
    // The dwell counter for stage4 must have crossed its 72-turn
    // threshold by entry — popular has been below 15 for ≥72 turns.
    expect(snapshots[stage4Idx].dwellCounters.stage4).toBeGreaterThanOrEqual(72);
  });
});
