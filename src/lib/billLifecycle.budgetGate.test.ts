/**
 * Audit S6 — the previously-bypassed national enactment paths (pocket-sign and
 * veto-override) now run budget validation. Uses the REAL billEnactment module
 * (unlike billLifecycle.test.ts) with the validation module spied, proving the
 * timer paths reach validateFederalBudgetImpact end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));
// billEnactment is REAL here; mock its heavy dependencies instead.
vi.mock("@/lib/budget/enactedLaws", () => ({
  recordEnactedLaw: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { billEnacted: 0x00ff00 },
}));
vi.mock("@/lib/archetypeAffinities", () => ({
  calculateShiftImpacts: vi.fn().mockReturnValue({}),
}));
vi.mock("@/lib/budget/revenue", () => ({
  calculateFederalRevenue: vi.fn().mockResolvedValue({ total: 1000 }),
  calculateStateRevenue: vi.fn().mockResolvedValue({ total: 500 }),
  normalizeFederalTaxRates: vi.fn((t) => t ?? null),
  normalizeStateTaxRates: vi.fn((t) => t ?? null),
}));
vi.mock("@/lib/budget/costs", () => ({
  getSelectedPolicyOption: vi.fn().mockReturnValue(undefined),
}));
vi.mock("@/lib/budget/spending", () => ({
  syncFederalBudgetSpending: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/internationalOrganizations/withdrawalBills", () => ({
  applyInternationalWithdrawalMeasure: vi.fn().mockResolvedValue(undefined),
  billRequiresExecutiveAction: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/congress/resolveBillCountryId", () => ({
  resolveBillCountryId: vi.fn().mockResolvedValue("US"),
  inferCountryIdFromStateId: vi.fn((stateId: string) => (stateId === "federal" ? "US" : null)),
}));
vi.mock("@/lib/budget/validation", () => ({
  validateFederalBudgetImpact: vi.fn(),
}));
vi.mock("@/lib/budget/debt", () => ({
  triggerDebtCeilingCrisis: vi.fn().mockResolvedValue(undefined),
}));

import { validateFederalBudgetImpact } from "@/lib/budget/validation";

const NOW = new Date("2025-06-15T12:00:00Z");

describe("processBillLifecycle — budget gate on timer enactment paths", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bills");
    db.collection("electedOfficials");
    db.collection("characters");
    db.collection("gameState");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 10 } as never);
    vi.mocked(validateFederalBudgetImpact).mockResolvedValue({
      allowed: true,
      costAmount: 1e9,
      newTotalSpending: 4e12,
    });
  });

  /** Route bills.find calls by their status filter. */
  function routeBillFinds(billsByStatus: Record<string, unknown[]>, byId?: unknown[]) {
    db.collectionMocks["bills"]!.find.mockImplementation((q: Record<string, unknown>) => {
      let docs: unknown[] = [];
      if (typeof q?.status === "string" && billsByStatus[q.status]) {
        docs = billsByStatus[q.status];
      } else if (q?._id && byId) {
        docs = byId;
      }
      return {
        toArray: vi.fn().mockResolvedValue(docs),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
    });
  }

  it("pocket-sign (presidential deadline expired) runs budget validation and persists it", async () => {
    const bill = {
      _id: new ObjectId(),
      title: "Pocket Act",
      originChamber: "house",
      currentChamber: "house",
      status: "enrolled",
      legislationTypeId: "education_funding",
      effectDirection: 1,
      votesFor: 5,
      votesAgainst: 1,
      votesAbstain: 0,
      sponsorId: null,
      coSponsors: [],
      presidentActionDeadlineOnTurn: 5,
    };
    routeBillFinds({ enrolled: [bill] });

    const { processBillLifecycle } = await import("./billLifecycle");
    await processBillLifecycle(NOW);

    expect(validateFederalBudgetImpact).toHaveBeenCalledTimes(1);
    expect(validateFederalBudgetImpact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: bill._id }),
      "federal"
    );
    const persistCall = db.collectionMocks["bills"]!.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.budgetValidation
    );
    expect(persistCall).toBeDefined();
  });

  it("veto-override enactment runs budget validation and persists it", async () => {
    const houseChar = new ObjectId();
    const senateChar = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      title: "Override Act",
      countryId: "US",
      originChamber: "house",
      currentChamber: "house",
      status: "veto_override",
      legislationTypeId: "education_funding",
      effectDirection: 1,
      votesFor: 5,
      votesAgainst: 1,
      votesAbstain: 0,
      sponsorId: null,
      coSponsors: [],
      overrideVotingEndsOnTurn: 5,
      vetoOverrideVotes: {
        [houseChar.toString()]: "for",
        [senateChar.toString()]: "for",
      },
    };
    routeBillFinds({ veto_override: [bill] }, [bill]);
    // Seat map: one 3-seat official per chamber; both vote "for" -> 2/3 met.
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { characterId: houseChar, countryId: "US", officeType: "house", seatsHeld: 3 },
        { characterId: senateChar, countryId: "US", officeType: "senate", seatsHeld: 3 },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const { processBillLifecycle } = await import("./billLifecycle");
    const result = await processBillLifecycle(NOW);

    expect(result.billsPassed).toBe(1);
    expect(validateFederalBudgetImpact).toHaveBeenCalledTimes(1);
    const persistCall = db.collectionMocks["bills"]!.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.budgetValidation
    );
    expect(persistCall).toBeDefined();
  });
});
