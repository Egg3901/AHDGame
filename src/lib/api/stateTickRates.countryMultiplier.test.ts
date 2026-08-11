import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { getFederalMultiplier } from "@shared/constants/formulas";

// The drift helper hits the DB; stub it to null (non-devolved region) so the tick-rate
// computation returns cleanly under the mock DB.
vi.mock("@/lib/turn/independenceDesireDrift", () => ({
  computeIndependenceDesireDriftForRegion: vi.fn().mockResolvedValue(null),
}));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  };
}

describe("computeStateTickRates — country-aware national scope multiplier", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePolicies");
    db.collection("states");
    db.collection("legislationTypes");
  });

  it("displays a UK national policy's tick with the UK 1/12 multiplier, not the US 1/50", async () => {
    const ukChildcare = legislationTypes.find((l) => l._id === "uk_childcare");
    expect(ukChildcare, "uk_childcare seed present").toBeTruthy();

    db.collectionMocks.statePolicies.find.mockReturnValue(
      cursor([
        {
          stateId: "uk_national",
          legislationTypeId: "uk_childcare",
          policyOptionId: "unmatched", // effectDirection fallback → strongest left option
          effectDirection: 1,
        },
      ])
    );
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "LON", countryId: "UK" });
    db.collectionMocks.legislationTypes.find.mockReturnValue(cursor([ukChildcare]));

    const { computeStateTickRates } = await import("./stateTickRates");
    const rates = await computeStateTickRates(db as unknown as Db, "LON", "UK");

    const strongest = 0.75; // UK_BIRTH_RATE_TICK_RATES_7[0]
    expect(rates.population?.birthRate).toBeCloseTo(strongest * getFederalMultiplier("UK"), 6);
    // Guard against the old hardcoded 1/50: that would yield ~0.015, well below this.
    expect(rates.population?.birthRate ?? 0).toBeGreaterThan(strongest * (1 / 50) + 0.001);
  });
});
