import { describe, expect, it } from "vitest";
import { decideCaseOutcome, type SeatedJusticeLean } from "./divergence";

function justice(economicLean: number, socialLean: number): SeatedJusticeLean {
  return { economicLean, socialLean };
}

describe("decideCaseOutcome", () => {
  it("affirms when the sitting majority matches the historical direction", () => {
    const seated = [justice(3, 1), justice(2, 1), justice(1, -1), justice(-1, -1), justice(-2, -1)];
    const result = decideCaseOutcome(seated, "economic", 1);
    expect(result.outcome).toBe("affirmed");
    expect(result.majoritySide).toBe(1);
    expect(result.positiveCount).toBe(3);
    expect(result.negativeCount).toBe(2);
    expect(result.seatedCount).toBe(5);
  });

  it("diverges when the sitting majority differs from the historical direction", () => {
    const seated = [justice(3, 1), justice(2, 1), justice(1, -1), justice(-1, -1), justice(-2, -1)];
    // Same court composition, but history's majority direction was actually -1
    const result = decideCaseOutcome(seated, "economic", -1);
    expect(result.outcome).toBe("diverged");
    expect(result.majoritySide).toBe(1);
  });

  it("evaluates only the tagged axis — a social-axis case never reads economicLean", () => {
    // Economic axis is unanimously positive; social axis is unanimously negative.
    const seated = [justice(5, -5), justice(5, -5), justice(5, -5)];
    const economicResult = decideCaseOutcome(seated, "economic", 1);
    const socialResult = decideCaseOutcome(seated, "social", -1);
    expect(economicResult.outcome).toBe("affirmed");
    expect(socialResult.outcome).toBe("affirmed");

    const flippedSocial = decideCaseOutcome(seated, "social", 1);
    expect(flippedSocial.outcome).toBe("diverged");
  });

  it("excludes vacant seats from the denominator entirely (caller passes only seated justices)", () => {
    // 9-seat court with only 5 filled — the 4 vacancies never appear in the input at all.
    const seated = [justice(1, 1), justice(1, 1), justice(1, 1), justice(-1, -1), justice(-1, -1)];
    const result = decideCaseOutcome(seated, "economic", 1);
    expect(result.seatedCount).toBe(5);
    expect(result.outcome).toBe("affirmed");
  });

  it("treats a tie as a divergence from either authored direction", () => {
    const seated = [justice(1, 1), justice(-1, -1)];
    const resultVsPositive = decideCaseOutcome(seated, "economic", 1);
    const resultVsNegative = decideCaseOutcome(seated, "economic", -1);
    expect(resultVsPositive.majoritySide).toBe(0);
    expect(resultVsPositive.outcome).toBe("diverged");
    expect(resultVsNegative.majoritySide).toBe(0);
    expect(resultVsNegative.outcome).toBe("diverged");
  });

  it("counts a lean of exactly 0 as neutral, not toward either side", () => {
    const seated = [justice(0, 0), justice(1, 1), justice(-1, -1)];
    const result = decideCaseOutcome(seated, "economic", 1);
    expect(result.neutralCount).toBe(1);
    expect(result.positiveCount).toBe(1);
    expect(result.negativeCount).toBe(1);
    expect(result.seatedCount).toBe(3);
    // 1 vs 1 with one neutral is still a tie -> diverges regardless of authored direction.
    expect(result.majoritySide).toBe(0);
    expect(result.outcome).toBe("diverged");
  });

  it("affirms history on a fully vacant court (no bench, no contrary majority)", () => {
    const result = decideCaseOutcome([], "economic", 1);
    expect(result.seatedCount).toBe(0);
    expect(result.majoritySide).toBe(0);
    expect(result.outcome).toBe("affirmed");
  });

  it("is deterministic for the same input", () => {
    const seated = [justice(2, -3), justice(-1, 4), justice(0, 0)];
    const results = Array.from({ length: 20 }, () => decideCaseOutcome(seated, "social", -1));
    const serialized = results.map((r) => JSON.stringify(r));
    expect(new Set(serialized).size).toBe(1);
  });

  describe("historicalOutcomeLocked (race/equal-protection cases — deliberately fixed, not a bug)", () => {
    it("forces 'affirmed' even when the sitting majority opposes the historical direction", () => {
      const seated = [justice(3, 3), justice(2, 2), justice(1, 1)];
      const unlocked = decideCaseOutcome(seated, "social", -1);
      expect(unlocked.outcome).toBe("diverged"); // the underlying algorithm would diverge...

      const locked = decideCaseOutcome(seated, "social", -1, { historicalOutcomeLocked: true });
      expect(locked.outcome).toBe("affirmed"); // ...but a locked case never does.
    });

    it("still reports the real composition honestly (majoritySide/counts unaffected by the lock)", () => {
      const seated = [justice(3, 3), justice(2, 2), justice(-1, -1)];
      const locked = decideCaseOutcome(seated, "social", -1, { historicalOutcomeLocked: true });
      expect(locked.majoritySide).toBe(1);
      expect(locked.positiveCount).toBe(2);
      expect(locked.negativeCount).toBe(1);
      expect(locked.outcome).toBe("affirmed");
    });

    it("is a no-op (still affirms) when composition genuinely matches history too", () => {
      const seated = [justice(-3, -3), justice(-2, -2), justice(1, 1)];
      const locked = decideCaseOutcome(seated, "social", -1, { historicalOutcomeLocked: true });
      expect(locked.majoritySide).toBe(-1);
      expect(locked.outcome).toBe("affirmed");
    });

    it("defaults to unlocked (genuine divergence) when the option is omitted", () => {
      const seated = [justice(3, 3), justice(2, 2)];
      const result = decideCaseOutcome(seated, "social", -1);
      expect(result.outcome).toBe("diverged");
    });
  });
});
