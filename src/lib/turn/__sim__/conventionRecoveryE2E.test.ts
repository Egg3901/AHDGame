/**
 * E2E: voluntary constitutional convention path pre-empts Stage 4.
 *
 * Scenario: same sustained-mismanagement inputs as the collapse test,
 * but partway through the leader announces a convention, submits a
 * draft targeting parliamentaryRepublic, and the simulation tracks
 * through the auto-transition to ratification + conversion.
 *
 * Validates:
 *   - Convention announce immediately flips conventionInProgress true
 *   - Stage 4 dwell counter freezes for the convention's lifetime
 *   - At ratification + electionDelay, governmentType flips
 *   - Stage 4 never actually fires (convention pre-empts collapse)
 */
import { describe, it, expect } from "vitest";
import { runSimTurns } from "./helpers";

describe("E2E — voluntary convention recovery", () => {
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

  it("convention announced at Stage 2 successfully converts to parliamentaryRepublic before Stage 4", () => {
    let announcedAt: number | null = null;
    const draftAt = 5; // turns after announce we submit the draft

    const snapshots = runSimTurns({
      turns: 400,
      inputsForTurn: sustainedBadInputs,
      onTurn: (turn, snap, mut) => {
        // The instant we hit Stage 2 (crisis), announce.
        if (announcedAt === null && snap.stage === "crisis") {
          mut.announceConvention(turn, turn + 48);
          announcedAt = turn;
        }
        // Submit the draft a few turns later (player picks target).
        if (announcedAt !== null && turn === announcedAt + draftAt) {
          mut.submitConventionDraft("parliamentaryRepublic");
        }
      },
    });

    expect(announcedAt).not.toBeNull();

    // Find the conversion turn (governmentType flips out of onePartyState).
    const conversionIdx = snapshots.findIndex((s) => s.governmentType === "parliamentaryRepublic");
    expect(conversionIdx).toBeGreaterThan(0);

    // Expected: announce + 48 (draft window) + 24 (default election delay)
    // = announce + 72. Find the actual gap.
    const announcedTurn = announcedAt!;
    const conversionTurn = snapshots[conversionIdx].turn;
    expect(conversionTurn - announcedTurn).toBeGreaterThanOrEqual(60);
    expect(conversionTurn - announcedTurn).toBeLessThanOrEqual(90);

    // Stage 4 never fires — the convention's conventionInProgress flag
    // freezes the Stage 4 dwell counter for the convention's lifetime.
    const stage4Idx = snapshots.findIndex((s) => s.stage === "collapse");
    expect(stage4Idx).toBe(-1);
  });

  it("Stage 4 dwell counter does not accumulate while a convention is in progress", () => {
    let announcedAt: number | null = null;

    const snapshots = runSimTurns({
      turns: 200,
      inputsForTurn: sustainedBadInputs,
      onTurn: (turn, snap, mut) => {
        if (announcedAt === null && snap.stage === "crisis") {
          mut.announceConvention(turn, turn + 48);
          announcedAt = turn;
        }
        if (announcedAt !== null && turn === announcedAt + 5) {
          mut.submitConventionDraft("parliamentaryRepublic");
        }
      },
    });

    expect(announcedAt).not.toBeNull();

    // Find the snapshot right after announce — the convention-in-progress
    // flag was set, so subsequent Stage 4 dwell should be flat.
    const startIdx = snapshots.findIndex((s) => s.turn === announcedAt! + 1);
    const endIdx = Math.min(snapshots.length - 1, startIdx + 40);
    const startDwell = snapshots[startIdx].dwellCounters.stage4;
    const endDwell = snapshots[endIdx].dwellCounters.stage4;
    // While the convention is in progress, stage4 dwell stays put.
    expect(endDwell).toBe(startDwell);
  });

  it("post-conversion: governmentType remains the target system and drift stops", () => {
    const snapshots = runSimTurns({
      turns: 300,
      inputsForTurn: sustainedBadInputs,
      onTurn: (turn, snap, mut) => {
        if (turn === 100) {
          mut.announceConvention(turn, turn + 48);
        }
        if (turn === 105) {
          mut.submitConventionDraft("parliamentaryRepublic");
        }
      },
    });

    const post = snapshots.find(
      (s) => s.turn === 250 && s.governmentType === "parliamentaryRepublic"
    );
    expect(post).toBeDefined();
    // Scalars at turn 250 should match scalars at the conversion turn —
    // drift stops the moment the regime flips out of OPS.
    const conversionIdx = snapshots.findIndex((s) => s.governmentType === "parliamentaryRepublic");
    const conversionPopular = snapshots[conversionIdx].popularLegitimacy;
    expect(post!.popularLegitimacy).toBe(conversionPopular);
  });
});
