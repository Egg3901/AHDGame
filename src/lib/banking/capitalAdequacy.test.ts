import { describe, it, expect } from "vitest";
import {
  MIN_CAPITAL_RATIO,
  RECAP_GRACE_TURNS,
  STRESS_CAPITAL_RATIO,
  STRESS_LOSS_FRACTION,
  assessCapital,
  capitalShortfall,
  mayDistribute,
  recapDeadlineExpired,
} from "./capitalAdequacy";

const bank = (over: Partial<Parameters<typeof assessCapital>[0]> = {}) =>
  assessCapital({ postedCapital: 20_000, liquidCapital: 0, totalLoans: 100_000, ...over });

describe("assessCapital", () => {
  it("counts posted capital and the bank's own free cash", () => {
    const position = bank({ postedCapital: 10_000, liquidCapital: 5_000 });
    expect(position.capitalAnchor).toBe(15_000);
    expect(position.capitalRatio).toBeCloseTo(0.15, 6);
  });

  it("counts the proprietary book as a risk asset", () => {
    const position = bank({ totalLoans: 100_000, propBookMarkValue: 100_000 });
    expect(position.riskAssetsAnchor).toBe(200_000);
    expect(position.capitalRatio).toBeCloseTo(0.1, 6);
  });

  it("treats a bank that has lent nothing as adequate rather than dividing by a floor", () => {
    const position = bank({ totalLoans: 0, postedCapital: 0, liquidCapital: 0 });
    expect(position.standing).toBe("adequate");
    expect(position.capitalRatio).toBe(1);
  });

  it("marks a bank below the minimum as undercapitalized", () => {
    const position = bank({ postedCapital: 5_000, totalLoans: 100_000 });
    expect(position.capitalRatio).toBeLessThan(MIN_CAPITAL_RATIO);
    expect(position.standing).toBe("undercapitalized");
  });

  it("marks a bank that meets the minimum but fails the scenario as stressed", () => {
    // 9% capital: clears the 8% minimum. After a 15% loss on the book, capital
    // is negative, so it fails the scenario.
    const position = bank({ postedCapital: 9_000, totalLoans: 100_000 });
    expect(position.capitalRatio).toBeGreaterThanOrEqual(MIN_CAPITAL_RATIO);
    expect(position.stressedCapitalRatio).toBeLessThan(STRESS_CAPITAL_RATIO);
    expect(position.standing).toBe("stressed");
  });

  it("clears a well-capitalized bank on both tests", () => {
    const position = bank({ postedCapital: 30_000, totalLoans: 100_000 });
    expect(position.standing).toBe("adequate");
    expect(position.stressedCapitalRatio).toBeGreaterThanOrEqual(STRESS_CAPITAL_RATIO);
  });

  it("shrinks the book by the same losses that burn the capital", () => {
    // A defaulted loan stops being an asset. Measuring post-shock capital
    // against the PRE-shock book would overstate the damage and fail banks
    // that are actually fine.
    const position = bank({ postedCapital: 30_000, totalLoans: 100_000 });
    const loss = 100_000 * STRESS_LOSS_FRACTION;
    expect(position.stressedCapitalRatio).toBeCloseTo((30_000 - loss) / (100_000 - loss), 6);
  });

  it("treats malformed figures as zero rather than propagating NaN", () => {
    const position = assessCapital({
      postedCapital: Number.NaN,
      liquidCapital: -500,
      totalLoans: 100_000,
    });
    expect(Number.isFinite(position.capitalRatio)).toBe(true);
    expect(position.capitalAnchor).toBe(0);
  });
});

describe("capitalShortfall", () => {
  it("returns the posting that exactly cures the breach", () => {
    const position = bank({ postedCapital: 5_000, totalLoans: 100_000 });
    const shortfall = capitalShortfall(position);
    expect(shortfall).toBe(3_000); // 8% of 100,000 = 8,000; already has 5,000.

    // Posting exactly that much must clear the minimum — the number shown has
    // to be the number that works, not one the player iterates on.
    const cured = bank({ postedCapital: 5_000 + shortfall, totalLoans: 100_000 });
    expect(cured.standing).not.toBe("undercapitalized");
  });

  it("asks for nothing from a bank that already meets the minimum", () => {
    expect(capitalShortfall(bank({ postedCapital: 30_000 }))).toBe(0);
    expect(capitalShortfall(bank({ postedCapital: 9_000 }))).toBe(0);
  });
});

describe("recapDeadlineExpired", () => {
  it("does not expire before the grace period is up", () => {
    expect(recapDeadlineExpired(100, 100 + RECAP_GRACE_TURNS - 1)).toBe(false);
  });

  it("expires exactly on the deadline turn", () => {
    expect(recapDeadlineExpired(100, 100 + RECAP_GRACE_TURNS)).toBe(true);
  });

  it("never expires for a bank that was never marked", () => {
    expect(recapDeadlineExpired(undefined, 9_999)).toBe(false);
  });
});

describe("mayDistribute", () => {
  it("bars both impaired standings, not just outright breach", () => {
    expect(mayDistribute("adequate")).toBe(true);
    expect(mayDistribute("stressed")).toBe(false);
    expect(mayDistribute("undercapitalized")).toBe(false);
  });
});
