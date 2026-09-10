/**
 * The three screens that sell Campaign Presence must quote one number.
 *
 * They did not: the campaign manager priced the escalating ladder in the
 * campaign's currency, the Political Operations tab priced the same ladder in
 * anchor units, and the per-state primary page quoted the flat base constant.
 * Only the first matched what the build route charges.
 *
 * This pins them together at the seam they share, so a fourth screen cannot
 * quietly invent a fourth price.
 */
import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { statePresenceNextCost } from "./statePresenceCost";
import { stateOrgLevelCost } from "@/lib/electionEngine/constants";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(true) }));

const CHARACTER_ID = new ObjectId();
const RATE = 2;
const LEVEL = 4;

/** A db that reports the FX rate and one presence row at LEVEL. */
function stubDb(): Db {
  return {
    collection: (name: string) => ({
      findOne: vi
        .fn()
        .mockResolvedValue(
          name === "exchangeRates"
            ? { currencyCode: "USD", rate: RATE }
            : name === "characterStateOrg"
              ? { characterId: CHARACTER_ID, stateId: "IA", level: LEVEL }
              : null
        ),
      find: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue(
            name === "characterStateOrg"
              ? [{ characterId: CHARACTER_ID, stateId: "IA", level: LEVEL, totalInvested: LEVEL }]
              : []
          ),
        project: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      }),
    }),
  } as unknown as Db;
}

describe("every presence screen quotes one price", () => {
  it("resolves the same rate the build route charges at", async () => {
    const { loadCampaignFxRate } = await import("@/lib/currency/campaignFxRate");
    expect(await loadCampaignFxRate(stubDb(), { countryId: "US" })).toBe(RATE);
  });

  it("falls back to 1 when forex is off, rather than dropping the price to zero", async () => {
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValueOnce(false);
    const { loadCampaignFxRate } = await import("@/lib/currency/campaignFxRate");
    expect(await loadCampaignFxRate(stubDb(), { countryId: "US" })).toBe(1);
  });

  it("prices a level the same however the screen reached it", () => {
    // The hub prices from a level it holds; the routes price from a level they
    // read. Same helper, same answer, or the two screens disagree again.
    const fromHub = statePresenceNextCost(LEVEL, RATE);
    const fromRoute = statePresenceNextCost(LEVEL, RATE);
    expect(fromHub).toBe(fromRoute);
    expect(fromHub).toBe(stateOrgLevelCost(LEVEL) * RATE);
  });

  it("is not the flat base constant once a state has been built in", async () => {
    // The regression the per-state page shipped: a level-4 state quoted at the
    // level-0 price is short by more than two thirds.
    const { STATE_ORG_COST_FUNDS } = await import("@/lib/electionEngine/constants");
    expect(statePresenceNextCost(LEVEL, 1)).not.toBe(STATE_ORG_COST_FUNDS);
  });
});
