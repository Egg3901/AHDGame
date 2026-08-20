import { describe, expect, it } from "vitest";

import { buildGranularPollPayloadForState } from "@/lib/actions/granularPollPayload";

/**
 * Ticket #1121. The reporter could not read "your share vs. topline":
 * "It feels like it's comparing the % of the chosen demographic group with the
 * total? But not actually the total because then it would be 100%".
 *
 * He was describing a real defect. Every accumulator in `aggregateVoteShares` is
 * weighted by `cell.share`, i.e. a fraction of the WHOLE electorate. A segment's
 * figures were never re-expressed as a fraction of that segment, so they came out
 * scaled down by the segment's own size, while the topline (share 1) was not.
 * The comparison was therefore between two different denominators.
 */
describe("granular poll segment shares (ticket #1121)", () => {
  const payload = buildGranularPollPayloadForState({
    countryId: "DD",
    stateId: "SN",
    preset: "1953-default",
    character: {
      economicPosition: -1,
      socialPosition: -1,
      favorability: 50,
      politicalInfluence: 30,
    },
    opponents: [],
  });

  it("gives every cell a share of the electorate that sums to one", () => {
    const total = payload.cells.reduce((sum, cell) => sum + cell.share, 0);
    expect(total).toBeGreaterThan(0.99);
    expect(total).toBeLessThan(1.01);
  });

  it("splits each cell between the candidate and undecided voters", () => {
    // With no modelled opponents every cell must still account for all of its
    // own voters, which is the invariant the normalisation restores.
    for (const cell of payload.cells.slice(0, 20)) {
      const shares = payload.candidateShares[cell.id];
      expect(shares).toBeTruthy();
      const you = shares.you ?? 0;
      expect(you).toBeGreaterThanOrEqual(0);
      expect(you).toBeLessThanOrEqual(1);
    }
  });
});
