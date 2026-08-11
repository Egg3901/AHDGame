import { describe, it, expect } from "vitest";
import { quietInputs, runSimTurns } from "./helpers";

describe("runSimTurns harness smoke", () => {
  it("advances 10 turns and produces one snapshot per turn", () => {
    const snapshots = runSimTurns({
      turns: 10,
      inputsForTurn: () => quietInputs(),
    });
    expect(snapshots).toHaveLength(10);
    expect(snapshots[0].turn).toBe(1);
    expect(snapshots[9].turn).toBe(10);
  });

  it("quiet inputs at INITIAL=75 stays in 'stable' for the whole window", () => {
    const snapshots = runSimTurns({
      turns: 30,
      inputsForTurn: () => quietInputs(),
    });
    for (const s of snapshots) {
      expect(s.stage).toBe("stable");
    }
  });

  it("flipping governmentType in onTurn halts further drift", () => {
    const snapshots = runSimTurns({
      turns: 20,
      inputsForTurn: () => quietInputs(),
      onTurn: (turn, _snap, mut) => {
        if (turn === 5) mut.flipGovernmentType("parliamentaryRepublic");
      },
    });
    expect(snapshots[5].governmentType).toBe("parliamentaryRepublic");
    // After conversion, popular + confidence stop drifting (recorded value
    // matches turn 5's post-mutation value through to turn 20).
    const postConvert = snapshots[5].popularLegitimacy;
    for (let i = 6; i < 20; i++) {
      expect(snapshots[i].popularLegitimacy).toBe(postConvert);
    }
  });

  it("addBoost shifts popular legitimacy upward over the boost window", () => {
    const baseline = runSimTurns({
      turns: 30,
      inputsForTurn: () => quietInputs(),
    });
    const boosted = runSimTurns({
      turns: 30,
      inputsForTurn: () => quietInputs(),
      onTurn: (turn, _snap, mut) => {
        if (turn === 1) mut.addBoost(0.5, 30);
      },
    });
    // The boost is +0.5/turn; over 30 turns the boosted run should be
    // measurably higher than the quiet baseline (capped at 100).
    expect(boosted[29].popularLegitimacy).toBeGreaterThan(baseline[29].popularLegitimacy);
  });
});
