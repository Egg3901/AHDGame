/**
 * D8/D9 crossover tests for the one-party bill lifecycle: bicameral configs
 * (RU) must clear BOTH Supreme Soviet chambers by the cast-votes majority
 * rule; unicameral configs (CN) keep the single-chamber immediate-enact flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Bill } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));
vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn().mockResolvedValue({ governmentType: "onePartyState" }),
}));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/turn/atomicClaim", () => ({
  claimStatusTransition: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/turn/rulingPartyConfidenceTurn", () => ({
  processRulingPartyConfidenceTurn: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/rulingPartyConfidence", () => ({
  ensureLeaderStateExists: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/popularLegitimacyTurn", () => ({
  processPopularLegitimacyTurn: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/regimeEscalationTurn", () => ({
  processRegimeEscalationTurn: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/onePartyState/decisionEvents", () => ({}));

function makeBill(overrides: Partial<Bill>): Bill {
  return {
    _id: new ObjectId(),
    title: "Test Bill",
    status: "active",
    countryId: "RU",
    originChamber: "sovietOfTheUnion",
    currentChamber: "sovietOfTheUnion",
    votesFor: 0,
    votesAgainst: 0,
    votingEndsOnTurn: 99,
    provisions: [],
    ...overrides,
  } as unknown as Bill;
}

function makeDb(activeBills: Bill[], otherBills: Bill[]) {
  const updates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const allBills = [...activeBills, ...otherBills];
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "bills") {
        return {
          find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
            if (filter.status === "active") {
              return { toArray: vi.fn().mockResolvedValue(activeBills) };
            }
            if (filter.status === "active_other") {
              return { toArray: vi.fn().mockResolvedValue(otherBills) };
            }
            if (filter._id && (filter._id as { $in?: unknown[] }).$in) {
              return { toArray: vi.fn().mockResolvedValue(activeBills) };
            }
            return { toArray: vi.fn().mockResolvedValue([]) };
          }),
          // The engine re-fetches each expired bill by _id before resolving it.
          findOne: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
            const found = allBills.find((b) => String(b._id) === String(filter._id));
            return Promise.resolve(found ?? null);
          }),
          updateOne: vi.fn().mockImplementation((filter, update) => {
            updates.push({ filter, update });
            return Promise.resolve({});
          }),
        };
      }
      // governmentFormations (leader-state self-heal), purge events, etc.
      return {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        updateOne: vi.fn().mockResolvedValue({}),
      };
    }),
  };
  return { db, updates };
}

async function mount(db: unknown) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RU crossover (bicameral one-party)", () => {
  it("origin-chamber pass sends the bill to the sibling chamber with reset counters", async () => {
    const bill = makeBill({ votesFor: 5, votesAgainst: 2 });
    const { db } = makeDb([bill], []);
    await mount(db);
    const { processOnePartyBillLifecycleForCountry } = await import("./onePartyBillLifecycle");
    await processOnePartyBillLifecycleForCountry("RU", new Date());

    const { claimStatusTransition } = await import("@/lib/turn/atomicClaim");
    const crossoverClaim = vi
      .mocked(claimStatusTransition)
      .mock.calls.find(
        (c) => (c[3] as { $set: { status?: string } }).$set.status === "active_other"
      );
    expect(crossoverClaim).toBeDefined();
    const set = (crossoverClaim![3] as { $set: Record<string, unknown> }).$set;
    expect(set.currentChamber).toBe("sovietOfNationalities");
    expect(set.otherChamberVotesFor).toBe(0);
    expect(set.otherChamberVotes).toEqual({});
    expect(set.otherChamberVotingEndsOnTurn).toBe(124); // currentTurn 100 + 24h window
  });

  it("origin-chamber rejection fails the bill without crossover", async () => {
    const bill = makeBill({ votesFor: 1, votesAgainst: 3 });
    const { db } = makeDb([bill], []);
    await mount(db);
    const { processOnePartyBillLifecycleForCountry } = await import("./onePartyBillLifecycle");
    const result = await processOnePartyBillLifecycleForCountry("RU", new Date());

    expect(result.failed).toBe(1);
    const { claimStatusTransition } = await import("@/lib/turn/atomicClaim");
    const statuses = vi
      .mocked(claimStatusTransition)
      .mock.calls.map((c) => (c[3] as { $set: { status?: string } }).$set.status);
    expect(statuses).toContain("failed");
    expect(statuses).not.toContain("active_other");
  });

  it("second-chamber majority enacts the bill with effects applied", async () => {
    const bill = makeBill({
      status: "active_other",
      currentChamber: "sovietOfNationalities",
      otherChamberVotesFor: 4,
      otherChamberVotesAgainst: 1,
      otherChamberVotingEndsOnTurn: 99,
    } as Partial<Bill>);
    const { db } = makeDb([], [bill]);
    await mount(db);
    const { processOnePartyBillLifecycleForCountry } = await import("./onePartyBillLifecycle");
    const result = await processOnePartyBillLifecycleForCountry("RU", new Date());

    expect(result.enacted).toBe(1);
    const { applyLegislationEffect } = await import("@/lib/legislationEffects");
    expect(vi.mocked(applyLegislationEffect)).toHaveBeenCalledTimes(1);
  });

  it("second-chamber rejection kills the bill (both chambers must approve)", async () => {
    const bill = makeBill({
      status: "active_other",
      currentChamber: "sovietOfNationalities",
      otherChamberVotesFor: 1,
      otherChamberVotesAgainst: 4,
      otherChamberVotingEndsOnTurn: 99,
    } as Partial<Bill>);
    const { db } = makeDb([], [bill]);
    await mount(db);
    const { processOnePartyBillLifecycleForCountry } = await import("./onePartyBillLifecycle");
    const result = await processOnePartyBillLifecycleForCountry("RU", new Date());

    expect(result.failed).toBe(1);
    const { applyLegislationEffect } = await import("@/lib/legislationEffects");
    expect(vi.mocked(applyLegislationEffect)).not.toHaveBeenCalled();
  });
});

describe("CN parity (unicameral one-party)", () => {
  it("a passing CN bill enacts immediately — no crossover", async () => {
    const bill = makeBill({
      countryId: "CN",
      originChamber: "npc",
      currentChamber: "npc",
      votesFor: 5,
      votesAgainst: 1,
    });
    const { db } = makeDb([bill], []);
    await mount(db);
    const { processOnePartyBillLifecycleForCountry } = await import("./onePartyBillLifecycle");
    const result = await processOnePartyBillLifecycleForCountry("CN", new Date());

    expect(result.enacted).toBe(1);
    const { claimStatusTransition } = await import("@/lib/turn/atomicClaim");
    const crossoverClaim = vi
      .mocked(claimStatusTransition)
      .mock.calls.find(
        (c) => (c[3] as { $set: { status?: string } }).$set.status === "active_other"
      );
    expect(crossoverClaim).toBeUndefined();
  });
});
