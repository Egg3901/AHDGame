import { describe, expect, it } from "vitest";
import { getPlay, mag, SEAT_CAPITAL_CAP, SETTLEMENT_PLAYS } from "@/lib/constants/settlementCrisis";
import { authoredPoints, capitalPriceFor } from "./capitalPrice";

describe("authoredPoints", () => {
  it("recovers the authored mockup points from a tempo-scaled magnitude", () => {
    for (const points of [8, 6, 5, 4, 3, 2.5, 2, 1.5, 1]) {
      expect(authoredPoints(mag(points)), `${points} points`).toBeCloseTo(points, 1);
    }
  });

  it("inverts mag, not the tempo-scaled hundredths", () => {
    // The distinction that matters: mag(8)/HUNDREDTHS is 1.0 at tempo 8 because
    // it stays tempo-scaled. Pricing off that would make the capital route
    // cheaper every time the tempo rose while cash costs, which are literal
    // figures, stood still.
    expect(authoredPoints(mag(8))).toBeCloseTo(8, 1);
    expect(mag(8) / 100).toBeCloseTo(1, 1);
  });
});

describe("capitalPriceFor", () => {
  it("prices every treasury-funded play at the k=4 table", () => {
    const expected: Record<string, number> = {
      aid: 16,
      border: 46,
      referendum: 32,
      ostpolitik: 28,
      peace: 20,
      credit: 20,
      station: 14,
      rhine: 16,
      broadcast: 12,
    };
    for (const [id, price] of Object.entries(expected)) {
      expect(capitalPriceFor(getPlay(id)!), id).toBe(price);
    }
  });

  it("never beats the value per capital point of that seat's capital-only play", () => {
    // The criterion k is bounded above by: a play bought with capital must not
    // be better value per capital point than the play the seat already buys
    // with capital alone, or that play is obsolete and the catalogue has lost
    // an option rather than gained one. Asserted here so a future k change
    // cannot break it silently.
    const benchmarks: Record<string, string> = {
      DD: "terms",
      RU: "pressure",
      US: "article5",
      UK: "fourpower",
    };
    for (const play of SETTLEMENT_PLAYS.filter((p) => p.seat !== null && p.fundsCost > 0)) {
      const bench = getPlay(benchmarks[play.seat!])!;
      expect(
        play.magnitude / capitalPriceFor(play),
        `${play.id} obsoletes ${bench.id}`
      ).toBeLessThanOrEqual(bench.magnitude / bench.capitalCost);
    }
  });

  it("never prices a route above what a seat can ever bank", () => {
    // A price over SEAT_CAPITAL_CAP is not expensive, it is UNBUYABLE: the bank
    // cannot hold enough to ever afford it, so the button would sit dead
    // forever. The dearest is `border` at 46 against a ceiling of 60.
    for (const play of SETTLEMENT_PLAYS.filter((p) => p.seat !== null && p.fundsCost > 0)) {
      expect(capitalPriceFor(play), `${play.id} is unbuyable`).toBeLessThanOrEqual(
        SEAT_CAPITAL_CAP
      );
    }
  });

  it("adds to the play's existing capital cost rather than replacing it", () => {
    // Paying this way is never cheaper IN CAPITAL than paying cash. The route
    // buys you out of indebting the nation, not a discount.
    const border = getPlay("border")!;
    expect(capitalPriceFor(border)).toBeGreaterThan(border.capitalCost);
  });
});
