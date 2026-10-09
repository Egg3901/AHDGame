import { describe, expect, it } from "vitest";
import {
  compareMatchedCase,
  outcomeHash,
  payoutFixture,
  type MatchedCase,
} from "./money-move-qualification-fixture";

describe("bounded payout qualification", () => {
  it("builds deterministic balanced payouts to every holder type at three scales", () => {
    for (const holders of [3, 12, 120]) {
      const fixture = payoutFixture(holders);
      expect(fixture.move.legs).toHaveLength(holders + 1);
      expect(fixture.move.legs.slice(1).reduce((sum, leg) => sum + leg.amount, 0)).toBe(
        fixture.move.legs[0].amount
      );
      for (const collection of ["characters", "npps", "indexFunds"]) {
        expect(fixture.documents[collection]).toHaveLength(holders / 3);
      }
      expect(outcomeHash(fixture)).toBe(outcomeHash(payoutFixture(holders)));
    }
  });

  it.each([0, 2, 301, 12.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects unsupported scale %s",
    (holders) => {
      expect(() => payoutFixture(holders)).toThrow(/holders/);
    }
  );

  const baseline: MatchedCase = {
    holders: 12,
    latencyMs: 3,
    lostAcknowledgement: false,
    outcomeHash: "matched",
    resources: { roundTrips: 100, documents: 40, bytes: 10_000 },
    nodeLifetimePeakRssBytes: 1000,
  };

  it("accepts identical results with smaller measured cost", () => {
    expect(() =>
      compareMatchedCase(
        baseline,
        { ...baseline, resources: { roundTrips: 30, documents: 30, bytes: 5000 } },
        4500
      )
    ).not.toThrow();
  });

  it("keeps differently interrupted recovery costs diagnostic while enforcing outcomes and fixed ceilings", () => {
    const before = { ...baseline, lostAcknowledgement: true };
    const run = { ...before, resources: { roundTrips: 101, documents: 100, bytes: 100_000 } };
    expect(() => compareMatchedCase(before, run, 4500)).not.toThrow();
    expect(() => compareMatchedCase(before, { ...run, outcomeHash: "different" }, 4500)).toThrow(
      /contract/
    );
    expect(() => compareMatchedCase(before, run, 100)).toThrow(/phase budget/);
  });

  it.each(["roundTrips", "documents", "bytes"] as const)(
    "rejects increased %s without raising the baseline",
    (metric) => {
      expect(() =>
        compareMatchedCase(
          baseline,
          {
            ...baseline,
            resources: { ...baseline.resources, [metric]: baseline.resources[metric] + 1 },
          },
          4500
        )
      ).toThrow(/baseline/);
    }
  );

  it("rejects changed output, mismatched state, excessive memory and a whole-phase budget violation", () => {
    expect(() =>
      compareMatchedCase(baseline, { ...baseline, outcomeHash: "different" }, 4500)
    ).toThrow(/contract/);
    expect(() => compareMatchedCase(baseline, { ...baseline, holders: 120 }, 4500)).toThrow();
    expect(() =>
      compareMatchedCase(baseline, { ...baseline, nodeLifetimePeakRssBytes: 1251 }, 4500)
    ).toThrow(/RSS/);
    expect(() => compareMatchedCase(baseline, baseline, 99)).toThrow(/phase budget/);
  });
});
