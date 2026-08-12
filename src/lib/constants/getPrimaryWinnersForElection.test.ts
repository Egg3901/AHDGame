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

  it("keeps the legacy single nominee for US House when the flag is off", () => {
    expect(getPrimaryWinnersForElection("US", "house", false)).toBe(
      getPrimaryWinnersForCountry("US")
    );
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
    expect(getPrimaryWinnersForElection("UK", "governor", false)).toBe(1);
    expect(getPrimaryWinnersForElection("JP", "governor", false)).toBe(1);
  });

  it("advances exactly one per party for governor in one-party states", () => {
    // CN is onePartyState (legislative cap 7) — governor must stay 1.
    expect(getPrimaryWinnersForCountry("CN")).toBe(7);
    expect(getPrimaryWinnersForElection("CN", "governor", false)).toBe(1);
  });

  it("advances exactly one per party for directly-elected presidencies", () => {
    // IE's Uachtarán is a directly-elected single-winner presidency under a
    // parliamentaryRepublic (legislative cap 3) — must stay 1.
    expect(getPrimaryWinnersForCountry("IE")).toBe(3);
    expect(getPrimaryWinnersForElection("IE", "uachtaran", false)).toBe(1);
    // president is 1 everywhere, including parliamentary/one-party countries.
    expect(getPrimaryWinnersForElection("DE", "president", false)).toBe(1);
    expect(getPrimaryWinnersForElection("CN", "president", false)).toBe(1);
  });

  it("advances exactly one per party for a German Minister-President (single seat)", () => {
    // DE is parliamentaryRepublic (legislative cap 3), but the Land
    // Minister-President fills one seat — its primary must advance 1 per party.
    expect(getPrimaryWinnersForCountry("DE")).toBe(3);
    expect(getPrimaryWinnersForElection("DE", "ministerPresident", false)).toBe(1);
    // The Land legislature (bundestag/landtag) keeps the multi-seat cap.
    expect(getPrimaryWinnersForElection("DE", "landtag", false)).toBe(3);
  });

  // The redistricting flag is a REQUIRED argument with no default. It defaulted
  // to `false` until ticket-1041, which silently gave every caller that omitted
  // it the legacy single-nominee cap: the turn resolver advanced 3 US House
  // nominees per party while the race page, the wiki, Discord /race and the
  // admin force-resolve endpoint all capped at 1. A player who won their primary
  // therefore appeared to be their party's sole nominee, then lost districts to
  // co-nominees they could not see. Keeping the parameter required makes a
  // forgotten flag a compile error instead of a silent gameplay divergence.
  it("advances 3 for US House whenever redistricting is on, matching the turn resolver", () => {
    expect(getPrimaryWinnersForElection("US", "house", true)).toBe(US_HOUSE_PRIMARY_ADVANCE);
    expect(getPrimaryWinnersForElection("US", "house", true)).not.toBe(
      getPrimaryWinnersForElection("US", "house", false)
    );
  });
});
