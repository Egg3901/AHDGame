import { describe, expect, it } from "vitest";
import {
  polesForYear,
  resolveAlignmentEra,
  type AlignmentChannel,
} from "@/lib/constants/alignmentEras";
import { normalizeShares } from "./normalize";
import { GDP_MILLIONS_TO_USD } from "@/lib/constants/internationalOrganizations";
import { PLAY_MAX_POINTS, pointsForSpend, pullForPlay } from "./influence";

/** A mid-sized target: $10bn a year, so 1% of it is $100m. */
const TEN_BILLION = 10_000_000_000;

const POLES = polesForYear(1979);
const at = (w: number, e: number) => normalizeShares({ WEST: w, EAST: e }, POLES);
const channel = (id: string): AlignmentChannel =>
  resolveAlignmentEra(1979).channels.find((c) => c.organizationId === id)!;

describe("pointsForSpend", () => {
  it("charges one point per one percent of the target's economy", () => {
    expect(pointsForSpend(100_000_000, TEN_BILLION)).toBeCloseTo(1, 5);
    expect(pointsForSpend(500_000_000, TEN_BILLION)).toBeCloseTo(5, 5);
  });

  it("makes the same money go further in a smaller economy", () => {
    // The whole point of the rule: $100m is decisive in a small economy and
    // rounding error in a large one.
    const spend = 100_000_000;
    expect(pointsForSpend(spend, 2_000_000_000)).toBeCloseTo(5, 5);
    expect(pointsForSpend(spend, 380_000_000_000)).toBeCloseTo(0.0263, 3);
  });

  it("is linear — no diminishing returns", () => {
    expect(pointsForSpend(200_000_000, TEN_BILLION)).toBeCloseTo(
      2 * pointsForSpend(100_000_000, TEN_BILLION),
      5
    );
  });

  it("caps, so no single cheque ends the Cold War", () => {
    expect(pointsForSpend(1e15, TEN_BILLION)).toBe(PLAY_MAX_POINTS);
  });

  it("buys nothing against an economy it cannot price", () => {
    // Zero must not read as "free" — an unpriceable nation is refused, not given away.
    expect(pointsForSpend(1e9, 0)).toBe(0);
    expect(pointsForSpend(1e9, Number.NaN)).toBe(0);
  });

  it("is zero for nothing, and never negative", () => {
    expect(pointsForSpend(0, TEN_BILLION)).toBe(0);
    expect(pointsForSpend(-5, TEN_BILLION)).toBe(0);
  });

  it("prices a target whose GDP arrived in millions", () => {
    // The unit trap, asserted in the units the caller actually holds: a $6bn
    // economy arrives as 6,000 millions, and 1% of it is $60m.
    const targetGdpUsd = 6_000 * GDP_MILLIONS_TO_USD;
    expect(pointsForSpend(60_000_000, targetGdpUsd)).toBeCloseTo(1, 5);
  });
});

describe("pullForPlay", () => {
  it("pulls toward the channel's pole, scaled by its weight", async () => {
    // The 1953 blocs both carry at 1.0; a fractional weight only exists in the
    // modern era, where the EU carries at 0.6 behind NATO's 1.0.
    const modernPoles = polesForYear(2019);
    const modern = (id: string) =>
      resolveAlignmentEra(2019).channels.find((c) => c.organizationId === id)!;
    const modernShares = normalizeShares({ WASHINGTON: 30, MOSCOW: 30 }, modernPoles);

    const nato = pullForPlay({
      channel: modern("NATO"),
      amountUsd: 200_000_000, // 2% of a $10bn economy = 2 points
      targetGdpUsd: TEN_BILLION,
      shares: modernShares,
      poles: modernPoles,
    });
    const eu = pullForPlay({
      channel: modern("EU"),
      amountUsd: 200_000_000,
      targetGdpUsd: TEN_BILLION,
      shares: modernShares,
      poles: modernPoles,
    });
    expect(nato.WASHINGTON).toBeCloseTo(2, 5); // 2 points x weight 1.0
    expect(eu.WASHINGTON).toBeCloseTo(1.2, 5); // 2 points x weight 0.6
  });

  it("is empty for a spend of nothing", () => {
    expect(
      pullForPlay({
        channel: channel("NATO"),
        amountUsd: 0,
        targetGdpUsd: TEN_BILLION,
        shares: at(30, 30),
        poles: POLES,
      })
    ).toEqual({});
  });

  it("is empty against a target with no economic data", () => {
    expect(
      pullForPlay({
        channel: channel("NATO"),
        amountUsd: 500_000_000,
        targetGdpUsd: 0,
        shares: at(30, 30),
        poles: POLES,
      })
    ).toEqual({});
  });
});
