import { describe, it, expect } from "vitest";
import {
  getPrimaryWinnersForElection,
  getPrimaryWinnersForCountry,
  US_HOUSE_PRIMARY_ADVANCE,
} from "./countries";

describe("getPrimaryWinnersForElection", () => {
  it("advances 3 for US House only when redistricting is enabled", () => {
    expect(getPrimaryWinnersForElection("US", "house", true)).toBe(3);
    expect(US_HOUSE_PRIMARY_ADVANCE).toBe(3);
  });

  it("keeps the legacy single nominee for US House when the flag is off (default)", () => {
    expect(getPrimaryWinnersForElection("US", "house")).toBe(getPrimaryWinnersForCountry("US"));
    expect(getPrimaryWinnersForElection("US", "house", false)).toBe(1);
  });

  it("leaves other US elections at the country default regardless of the flag", () => {
    expect(getPrimaryWinnersForElection("US", "senate", true)).toBe(
      getPrimaryWinnersForCountry("US")
    );
    expect(getPrimaryWinnersForElection("US", "president", true)).toBe(1);
    expect(getPrimaryWinnersForElection("US", "governor", true)).toBe(1);
  });

  it("leaves non-US house at the country default", () => {
    expect(getPrimaryWinnersForElection("UK", "house", true)).toBe(
      getPrimaryWinnersForCountry("UK")
    );
    expect(getPrimaryWinnersForElection("JP", "house", true)).toBe(
      getPrimaryWinnersForCountry("JP")
    );
  });

  // Single-winner executive offices (governor/president/uachtaran) elect exactly
  // one holder, so only one candidate per party may advance from the primary —
  // regardless of the country's legislative primary cap. Without this, the
  // government-type table would let 3 (parliamentary) or 7 (onePartyState)
  // same-party candidates split a single-seat governor's general vote.
  it("advances exactly one per party for governor in parliamentary countries", () => {
    // UK/JP are parliamentaryMonarchy (legislative cap 3) — governor must stay 1.
    expect(getPrimaryWinnersForCountry("UK")).toBe(3);
    expect(getPrimaryWinnersForElection("UK", "governor")).toBe(1);
    expect(getPrimaryWinnersForElection("JP", "governor")).toBe(1);
  });

  it("advances exactly one per party for governor in one-party states", () => {
    // CN is onePartyState (legislative cap 7) — governor must stay 1.
    expect(getPrimaryWinnersForCountry("CN")).toBe(7);
    expect(getPrimaryWinnersForElection("CN", "governor")).toBe(1);
  });

  it("advances exactly one per party for directly-elected presidencies", () => {
    // IE's Uachtarán is a directly-elected single-winner presidency under a
    // parliamentaryRepublic (legislative cap 3) — must stay 1.
    expect(getPrimaryWinnersForCountry("IE")).toBe(3);
    expect(getPrimaryWinnersForElection("IE", "uachtaran")).toBe(1);
    // president is 1 everywhere, including parliamentary/one-party countries.
    expect(getPrimaryWinnersForElection("DE", "president")).toBe(1);
    expect(getPrimaryWinnersForElection("CN", "president")).toBe(1);
  });

  it("advances exactly one per party for a German Minister-President (single seat)", () => {
    // DE is parliamentaryRepublic (legislative cap 3), but the Land
    // Minister-President fills one seat — its primary must advance 1 per party.
    expect(getPrimaryWinnersForCountry("DE")).toBe(3);
    expect(getPrimaryWinnersForElection("DE", "ministerPresident")).toBe(1);
    // The Land legislature (bundestag/landtag) keeps the multi-seat cap.
    expect(getPrimaryWinnersForElection("DE", "landtag")).toBe(3);
  });
});
