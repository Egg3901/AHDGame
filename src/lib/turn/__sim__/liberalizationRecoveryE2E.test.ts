/**
 * E2E: liberalization-menu reforms pull a Stage-2 regime back from the
 * brink. Models the same sustained-bad-governance inputs as the
 * collapse test, but the player intervenes at Stage 2 with a sequence
 * of reform actions (legalize-party, reduce-vote-multipliers, hold-
 * honest-by-election) over the next 50 turns.
 *
 * Per the spec note in § Phase 8.4: `computeNextStage` is forward-
 * only by design. Scalar recovery does NOT regress the stage — the
 * regime is "Stuck at Crisis stage label, but scalars are healthy"
 * which is the design's intentional surface. What we assert here:
 *   - popular legitimacy climbs back above the crisis threshold (35)
 *   - Stage 4 (collapse) NEVER fires — the recovery path worked
 */
import { describe, it, expect } from "vitest";
import { runSimTurns } from "./helpers";

describe("E2E — liberalization recovery", () => {
  const sustainedBadInputs = (turn: number) => ({
    economic: {
      gdpGrowthAnnualPct: -2,
      unemploymentDeltaPct: 0.3,
      inflationDeviationFromTargetPct: 3,
    },
    purges: turn % 4 === 0 ? [{ severity: "minor" as const, kind: "discipline" as const }] : [],
    enactedBills: [],
    election: { isElectionTurn: false, opsMultiplier: 1.0 },
  });

  it("three reform actions at Stage 2 pull popular legitimacy back above the crisis threshold", () => {
    let interventionStart: number | null = null;
    const interventions: { turn: number; action: string }[] = [];

    const snapshots = runSimTurns({
      turns: 350,
      inputsForTurn: sustainedBadInputs,
      onTurn: (turn, snap, mut) => {
        if (interventionStart === null && snap.stage === "crisis") {
          interventionStart = turn;
        }
        if (interventionStart === null) return;

        const offset = turn - interventionStart;
        // Sequence the reforms per design § Phase 5: each action carries
        // a one-shot popular gain plus a per-turn boost over its window.
        if (offset === 1) {
          // legalize-party: +8 one-shot, +0.2/turn × 120
          mut.setPopular(snap.popularLegitimacy + 8);
          mut.addBoost(0.2, 120);
          interventions.push({ turn, action: "legalizeParty" });
        }
        if (offset === 5) {
          // reduce-vote-multipliers: +4 one-shot, +0.15/turn × 96
          mut.setPopular(snap.popularLegitimacy + 4);
          mut.addBoost(0.15, 96);
          interventions.push({ turn, action: "reduceVoteMultipliers" });
        }
        if (offset === 10) {
          // hold-honest-by-election: +5 one-shot (no boost)
          mut.setPopular(snap.popularLegitimacy + 5);
          interventions.push({ turn, action: "holdHonestByElection" });
        }
        if (offset === 25) {
          // anti-corruption purge: +3 one-shot — purge events with
          // kind=anticorruption are carved out of the repression
          // popular cost (see Phase 2 driver) so they're net-positive.
          mut.setPopular(snap.popularLegitimacy + 3);
          interventions.push({ turn, action: "anticorruptionPurge" });
        }
      },
    });

    expect(interventionStart).not.toBeNull();
    expect(interventions.length).toBe(4);

    // Look at the recovery window: 50 turns after interventionStart,
    // popular legitimacy should be back above the crisis threshold.
    const recoveryIdx = snapshots.findIndex((s) => s.turn === interventionStart! + 50);
    expect(recoveryIdx).toBeGreaterThan(0);
    expect(snapshots[recoveryIdx].popularLegitimacy).toBeGreaterThan(35);

    // Stage 4 never fires — the reforms pulled us back in time.
    const collapseIdx = snapshots.findIndex((s) => s.stage === "collapse");
    expect(collapseIdx).toBe(-1);
  });

  it("design intent: stage stays at 'crisis' even after scalars recover (forward-only state machine)", () => {
    let interventionStart: number | null = null;

    const snapshots = runSimTurns({
      turns: 250,
      inputsForTurn: sustainedBadInputs,
      onTurn: (turn, snap, mut) => {
        if (interventionStart === null && snap.stage === "crisis") {
          interventionStart = turn;
        }
        if (interventionStart === null) return;
        const offset = turn - interventionStart;
        if (offset === 1) {
          mut.setPopular(snap.popularLegitimacy + 30); // huge one-time boost
          mut.addBoost(0.5, 100); // long boost
        }
      },
    });

    expect(interventionStart).not.toBeNull();

    // 30 turns post-intervention: popular is well above crisis
    // threshold, but stage stays at "crisis" by design.
    const idx = snapshots.findIndex((s) => s.turn === interventionStart! + 30);
    expect(idx).toBeGreaterThan(0);
    expect(snapshots[idx].popularLegitimacy).toBeGreaterThan(50);
    expect(snapshots[idx].stage).toBe("crisis");
  });

  it("popular boost modifiers from reform actions are recorded in the snapshot trajectory", () => {
    // Baseline: no interventions, popular keeps falling.
    const baseline = runSimTurns({ turns: 100, inputsForTurn: sustainedBadInputs });

    // With reform: same inputs but a 0.5/turn boost from turn 30.
    const boosted = runSimTurns({
      turns: 100,
      inputsForTurn: sustainedBadInputs,
      onTurn: (turn, _snap, mut) => {
        if (turn === 30) mut.addBoost(0.5, 60);
      },
    });

    // At turn 80 (50 turns into the boost window), the boosted run
    // should be measurably above the baseline.
    expect(boosted[79].popularLegitimacy).toBeGreaterThan(baseline[79].popularLegitimacy + 5);
  });
});
