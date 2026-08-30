import { describe, expect, it } from "vitest";
import {
  capTurnSliceToElectorate,
  capTurnSliceToRemainingElectorate,
  scalePoolToRegistered,
} from "./resolvedTurnout";

describe("capTurnSliceToRemainingElectorate", () => {
  it("lets a slice through while the electorate has room", () => {
    expect(capTurnSliceToRemainingElectorate(50_000, 600_000, 1_000_000)).toBe(50_000);
  });

  it("shrinks the closing slice to whatever electorate has not voted yet", () => {
    // 990k already on the board of a 1M electorate: a 62.5k surge slice
    // (the 13th-slice + strength-multiplier overshoot) releases only 10k.
    expect(capTurnSliceToRemainingElectorate(62_500, 990_000, 1_000_000)).toBe(10_000);
  });

  it("releases nothing once the electorate is exhausted, never a negative slice", () => {
    expect(capTurnSliceToRemainingElectorate(62_500, 1_020_000, 1_000_000)).toBe(0);
  });

  it("leaves the slice alone without an electorate figure", () => {
    expect(capTurnSliceToRemainingElectorate(62_500, 990_000, 0)).toBe(62_500);
  });
});

describe("scalePoolToRegistered", () => {
  it("removes the unregistered share from the pool", () => {
    // 6% unregistered (the seeded US shape): 94% of the pool can cast ballots.
    expect(scalePoolToRegistered(1_000_000, 6)).toBe(940_000);
  });

  it("leaves the pool untouched when no registration data exists", () => {
    // Most non-US worlds have no stateRegistrationPool doc — prior behavior,
    // no invented exclusion.
    expect(scalePoolToRegistered(1_000_000, undefined)).toBe(1_000_000);
    expect(scalePoolToRegistered(1_000_000, null)).toBe(1_000_000);
    expect(scalePoolToRegistered(1_000_000, Number.NaN)).toBe(1_000_000);
  });

  it("clamps corrupt registration figures instead of inverting the pool", () => {
    expect(scalePoolToRegistered(1_000_000, 250)).toBe(0);
    expect(scalePoolToRegistered(1_000_000, -10)).toBe(1_000_000);
  });

  it("is share-invariant by construction: a uniform scale factor", () => {
    // The F-4 guarantee — the same factor applies to every candidate's slice,
    // so relative shares (and therefore seats and winners) cannot move.
    const a = scalePoolToRegistered(600_000, 8);
    const b = scalePoolToRegistered(400_000, 8);
    expect(a / b).toBeCloseTo(600_000 / 400_000, 10);
  });
});

describe("capTurnSliceToElectorate", () => {
  it("rescales the slice when the pool exceeds the electorate", () => {
    // The 333%-of-VEP case: a 3.3M pool over a 1M electorate releases only the
    // electorate's share of each turn slice.
    expect(capTurnSliceToElectorate(33_000, 3_300_000, 1_000_000)).toBeCloseTo(10_000, 6);
  });

  it("passes the slice through when the pool fits inside the electorate", () => {
    expect(capTurnSliceToElectorate(33_000, 900_000, 1_000_000)).toBe(33_000);
    expect(capTurnSliceToElectorate(33_000, 1_000_000, 1_000_000)).toBe(33_000);
  });

  it("never divides by a zero electorate", () => {
    expect(capTurnSliceToElectorate(33_000, 3_300_000, 0)).toBe(33_000);
  });

  it("caps the ballot, not just a bookkeeping figure", () => {
    // The distributors compute ballots as slice x (sum contributions / pool).
    // With contributions summing to the pool, ballots == slice — so capping
    // the slice IS capping the ballots, while the old form (shrinking the
    // pool too) restored the overrun through the normalisation.
    const pool = 3_300_000;
    const electorate = 1_000_000;
    const slice = 33_000;
    const capped = capTurnSliceToElectorate(slice, pool, electorate);
    const ballots = capped * (pool / pool);
    expect(ballots).toBeCloseTo(slice * (electorate / pool), 6);

    const oldFormBallots = capped * (pool / electorate); // pool clamped to electorate
    expect(oldFormBallots).toBeCloseTo(slice, 6); // the overrun handed straight back
  });
});
