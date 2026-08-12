import { describe, it, expect } from "vitest";
import {
  AUTO_GRANT_MIN_CONTRIBUTION_ANCHOR,
  AUTO_GRANT_MIN_SHORTFALL_RATIO,
  decidePetitionAutomatically,
  failuresAfterWaiver,
  isWaivable,
  isWaiverActive,
  requiredContributionAnchor,
  WAIVER_TURNS,
} from "./rules";

describe("what a waiver can buy", () => {
  it("suppresses the qualification bars", () => {
    expect(isWaivable("free_float")).toBe(true);
    expect(isWaivable("size")).toBe(true);
  });

  it("NEVER suppresses insolvency", () => {
    // A committee that can wave an insolvent corporation into an index makes
    // fund holders pay for a political favour.
    expect(isWaivable("insolvent")).toBe(false);
    expect(failuresAfterWaiver(["size", "insolvent"], true)).toEqual(["insolvent"]);
  });

  it("leaves failures untouched with no waiver", () => {
    expect(failuresAfterWaiver(["size", "free_float"], false)).toEqual(["size", "free_float"]);
  });

  it("clears a fully waivable failure set", () => {
    expect(failuresAfterWaiver(["size", "free_float"], true)).toEqual([]);
  });
});

describe("required contribution", () => {
  it("scales with the petitioner's market cap", () => {
    expect(requiredContributionAnchor(1_000_000_000)).toBe(20_000_000);
  });

  it("never falls below the floor, so a shell still pays something real", () => {
    expect(requiredContributionAnchor(0)).toBe(AUTO_GRANT_MIN_CONTRIBUTION_ANCHOR);
    expect(requiredContributionAnchor(-5)).toBe(AUTO_GRANT_MIN_CONTRIBUTION_ANCHOR);
  });
});

describe("the automatic decision", () => {
  const marginal = { marketCapAnchor: 1_000_000, worstShortfallRatio: 0.9 };

  it("grants a marginal case that paid enough", () => {
    expect(
      decidePetitionAutomatically({
        ...marginal,
        contributionAnchor: requiredContributionAnchor(marginal.marketCapAnchor),
        hasUnwaivableFailure: false,
      })
    ).toEqual({ granted: true, reason: "granted" });
  });

  it("refuses an insolvent petitioner however much it paid", () => {
    expect(
      decidePetitionAutomatically({
        ...marginal,
        contributionAnchor: 999_999_999,
        hasUnwaivableFailure: true,
      })
    ).toEqual({ granted: false, reason: "unwaivable_failure" });
  });

  it("refuses a shortfall too large to be a marginal case", () => {
    expect(
      decidePetitionAutomatically({
        marketCapAnchor: 1_000_000,
        worstShortfallRatio: AUTO_GRANT_MIN_SHORTFALL_RATIO - 0.01,
        contributionAnchor: 999_999_999,
        hasUnwaivableFailure: false,
      })
    ).toEqual({ granted: false, reason: "shortfall_too_large" });
  });

  it("refuses a marginal case that underpaid", () => {
    expect(
      decidePetitionAutomatically({
        ...marginal,
        contributionAnchor: 1,
        hasUnwaivableFailure: false,
      })
    ).toEqual({ granted: false, reason: "contribution_too_small" });
  });

  it("refuses a petitioner that is no longer failing anything", () => {
    // Granting would be harmless but dishonest: the record would show a waiver
    // doing work it never did.
    expect(
      decidePetitionAutomatically({
        ...marginal,
        worstShortfallRatio: null,
        contributionAnchor: 999_999_999,
        hasUnwaivableFailure: false,
      })
    ).toEqual({ granted: false, reason: "no_longer_failing" });
    expect(
      decidePetitionAutomatically({
        ...marginal,
        worstShortfallRatio: 1.2,
        contributionAnchor: 999_999_999,
        hasUnwaivableFailure: false,
      })
    ).toEqual({ granted: false, reason: "no_longer_failing" });
  });

  it("is a pure function of its inputs, so a replay decides the same way", () => {
    const input = {
      ...marginal,
      contributionAnchor: requiredContributionAnchor(marginal.marketCapAnchor),
      hasUnwaivableFailure: false,
    };
    expect(decidePetitionAutomatically(input)).toEqual(decidePetitionAutomatically(input));
  });
});

describe("waiver validity", () => {
  it("is a fixed term, not a permanent exemption", () => {
    const granted = { status: "granted", waiverUntilTurn: 100 };
    expect(isWaiverActive(granted, 100)).toBe(true);
    expect(isWaiverActive(granted, 101)).toBe(false);
  });

  it("is nothing at all for a refused or pending petition", () => {
    expect(isWaiverActive({ status: "refused", waiverUntilTurn: 999 }, 1)).toBe(false);
    expect(isWaiverActive({ status: "pending" }, 1)).toBe(false);
  });

  it("runs WAIVER_TURNS past the decision", () => {
    expect(isWaiverActive({ status: "granted", waiverUntilTurn: 10 + WAIVER_TURNS }, 10 + WAIVER_TURNS)).toBe(
      true
    );
  });
});
