/**
 * Guards on the 1953-era UK regional polling table.
 *
 * These shares are normalized against each other when registration is seeded
 * (`registration: voteShare` in ukStatePartyOrgCalculations.ts), and vote
 * share tracks registration share closely in play. A region that sums to well
 * under 100 therefore does not leave the remainder unaligned — it inflates
 * whichever parties ARE listed. Northern Ireland used to list only
 * `uk_conservative: 63`, summing to 63, which normalized the Unionists to
 * ~100% of the region's registered support and swept all 18 Commons seats
 * (ticket #1032).
 */
import { describe, it, expect } from "vitest";
import { UK_REGION_POLLING_1951 } from "./ukRegionPolling1951";

const sumOf = (shares: Record<string, number>) =>
  Object.values(shares).reduce((total, share) => total + share, 0);

describe("UK_REGION_POLLING_1951", () => {
  it("covers all 12 Commons regions", () => {
    expect(Object.keys(UK_REGION_POLLING_1951)).toHaveLength(12);
  });

  it("gives every region a full electorate (shares sum to ~100)", () => {
    for (const [region, shares] of Object.entries(UK_REGION_POLLING_1951)) {
      expect(sumOf(shares), `${region} must account for ~100% of the vote`).toBeGreaterThanOrEqual(
        97
      );
      expect(sumOf(shares), `${region} must not exceed 100%`).toBeLessThanOrEqual(103);
    }
  });

  it("leaves no region as a seeded one-party sweep", () => {
    // Once normalized, no party should hold enough of a region to clear the
    // field on its own. The real 1951 maximum is Labour's ~61% in the North
    // East, so 75% leaves ample headroom for a genuinely dominant party while
    // still catching a region that was only seeded from one side.
    for (const [region, shares] of Object.entries(UK_REGION_POLLING_1951)) {
      const total = sumOf(shares);
      const top = Math.max(...Object.values(shares));
      expect(
        (100 * top) / total,
        `${region} normalizes to a one-party sweep`
      ).toBeLessThan(75);
    }
  });

  it("gives Northern Ireland parties on both sides of the divide", () => {
    const nir = UK_REGION_POLLING_1951.NIR;
    // Unionist bloc via the Conservative whip, nationalist bloc via Sinn Féin.
    expect(nir.uk_conservative).toBeGreaterThan(0);
    expect(nir.uk_sf).toBeGreaterThan(0);
    // The nationalist bloc must be able to clear the 10% historical Commons
    // eligibility gate on its own, or it wins no seats however it polls.
    expect((100 * nir.uk_sf) / sumOf(nir)).toBeGreaterThan(10);
  });
});
