import { describe, expect, it } from "vitest";
import { RACE_TRACK_LENGTH, RACERS, runRace } from "./race";

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe("race", () => {
  it("always finishes with the drawn winner alone at the line", () => {
    for (let seed = 1; seed < 300; seed++) {
      const { winner, frames } = runRace(seeded(seed));
      const last = frames[frames.length - 1];
      const index = RACERS.findIndex((r) => r.id === winner);
      expect(last[index]).toBe(RACE_TRACK_LENGTH);
      last.forEach((p, i) => i !== index && expect(p).toBeLessThan(RACE_TRACK_LENGTH));
      expect(frames.length).toBeLessThanOrEqual(61);
    }
  });

  it("gives every racer the same chance", () => {
    const wins: Record<string, number> = {};
    const steps = 4000;
    for (let i = 0; i < steps; i++) {
      const first = (i + 0.5) / steps;
      let calls = 0;
      const rng = () => (calls++ === 0 ? first : 0.5);
      const { winner } = runRace(rng);
      wins[winner] = (wins[winner] ?? 0) + 1;
    }
    for (const r of RACERS) expect(wins[r.id]).toBe(steps / RACERS.length);
  });
});
