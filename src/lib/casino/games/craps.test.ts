import { describe, expect, it } from "vitest";
import { playCraps } from "./craps";

/** Rng that yields the given die faces in order. */
function dice(...faces: number[]): () => number {
  let i = 0;
  return () => (faces[i++] - 1) / 6 + 0.01;
}

describe("craps", () => {
  it("resolves the come-out", () => {
    expect(playCraps(dice(3, 4), "pass")).toMatchObject({ result: "win", multiplier: 2 });
    expect(playCraps(dice(1, 1), "pass").result).toBe("loss");
    expect(playCraps(dice(6, 6), "dontpass")).toMatchObject({ result: "push", multiplier: 1 });
    expect(playCraps(dice(5, 6), "dontpass").result).toBe("loss");
  });

  it("rolls to the point or a seven", () => {
    const made = playCraps(dice(2, 2, 1, 2, 3, 1), "pass");
    expect(made).toMatchObject({ point: 4, result: "win" });
    expect(made.rolls).toHaveLength(3);
    expect(playCraps(dice(2, 2, 3, 4), "dontpass")).toMatchObject({ point: 4, result: "win" });
  });

  it("returns about 98.6% on pass", () => {
    // Exact pass-line probability is 244/495.
    let ev = 0;
    const faces = [1, 2, 3, 4, 5, 6];
    const p: Record<number, number> = {};
    for (const a of faces) for (const b of faces) p[a + b] = (p[a + b] ?? 0) + 1 / 36;
    for (const [t, pt] of Object.entries(p)) {
      const total = Number(t);
      if (total === 7 || total === 11) ev += pt;
      else if (![2, 3, 12].includes(total)) ev += pt * (p[total] / (p[total] + p[7]));
    }
    expect(ev).toBeCloseTo(244 / 495, 10);
    expect(2 * ev).toBeCloseTo(0.9859, 3);
  });
});
