import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { resolvePrivatizationVote } from "./resolvePrivatizationVote";

vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  refundCharacterCash: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineCorpPrivatized: vi.fn().mockReturnValue("privatized"),
  wireHeadlineCorpPrivatizationVoteFailed: vi.fn().mockReturnValue("failed"),
}));
// Resolution code calls `void notifyVoteEventRaw(...)`; without this stub, the
// fire-and-forget call hits the partially-mocked db and throws an unhandled rejection.
vi.mock("@/lib/corporations/votes/voteNotifications", () => ({
  notifyVoteEventRaw: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
}));

function makeVote(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    openedByCharacterId: new ObjectId(),
    openedAtTurn: 100,
    deadlineAtTurn: 124,
    lockedBuyoutPrice: 1.1,
    lockedBuyoutCurrency: "USD",
    totalReservedCash: 1_100_000,
    reservedCashCurrency: "USD",
    votes: [],
    status: "open" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("resolvePrivatizationVote — atomic claim", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-ops when vote is not yet past deadline", async () => {
    const vote = makeVote({ deadlineAtTurn: 200 });
    const db = {
      collection: vi.fn().mockReturnValue({
        updateOne: vi.fn(),
        findOne: vi.fn(),
      }),
    } as unknown as Db;
    const result = await resolvePrivatizationVote({
      db,
      vote: vote as never,
      currentTurn: 150,
      forexEnabled: false,
    });
    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toBe("not_due");
  });

  it("no-ops when vote is already resolved", async () => {
    const vote = makeVote({ status: "passed" });
    const db = {
      collection: vi.fn().mockReturnValue({ updateOne: vi.fn(), findOne: vi.fn() }),
    } as unknown as Db;
    const result = await resolvePrivatizationVote({
      db,
      vote: vote as never,
      currentTurn: 200,
      forexEnabled: false,
    });
    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toBe("already_resolved");
  });

  it("bails out as already_resolved when atomic claim loses the race (matchedCount=0)", async () => {
    // Simulates a concurrent resolver that already transitioned the vote.
    const vote = makeVote({
      votes: [{ characterId: new ObjectId(), voteShares: 100, vote: "yes", castAt: new Date() }],
    });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const corpFindOne = vi
      .fn()
      .mockResolvedValue({ _id: new ObjectId(), ceoId: new ObjectId(), shareholders: [] });
    const corpUpdateOne = vi.fn();
    const db = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "corporationPrivatizationVotes") return { updateOne };
        if (name === "corporations") return { findOne: corpFindOne, updateOne: corpUpdateOne };
        return { findOne: vi.fn(), updateOne: vi.fn() };
      }),
    } as unknown as Db;

    const result = await resolvePrivatizationVote({
      db,
      vote: vote as never,
      currentTurn: 200,
      forexEnabled: false,
    });
    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toBe("already_resolved");
    // Critical: no payouts and no corp writes when the claim fails — losing the
    // race must be a pure read.
    expect(corpUpdateOne).not.toHaveBeenCalled();
    const refundMock = await import("@/lib/financialTxLog/atomicCashGuard");
    expect(vi.mocked(refundMock.refundCharacterCash)).not.toHaveBeenCalled();
  });

  it("on fail: refunds CEO cash and sets cooldown", async () => {
    const ceoId = new ObjectId();
    const corpId = new ObjectId();
    const vote = makeVote({
      corporationId: corpId,
      votes: [{ characterId: new ObjectId(), voteShares: 100, vote: "no", castAt: new Date() }],
    });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const corpUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const corp = {
      _id: corpId,
      ceoId,
      name: "TestCo",
      sequentialId: 1,
      shareholders: [{ characterId: ceoId, shares: 9_000_000 }],
      publicFloat: 1_000_000,
      totalShares: 10_000_000,
    };
    const db = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "corporationPrivatizationVotes") return { updateOne };
        if (name === "corporations") {
          return { findOne: vi.fn().mockResolvedValue(corp), updateOne: corpUpdateOne };
        }
        return { findOne: vi.fn(), updateOne: vi.fn() };
      }),
    } as unknown as Db;

    const result = await resolvePrivatizationVote({
      db,
      vote: vote as never,
      currentTurn: 200,
      forexEnabled: false,
    });
    expect(result.resolved).toBe(true);
    if (result.resolved) expect(result.status).toBe("failed");

    // Atomic claim transitioned to "failed" first
    const claimCall = updateOne.mock.calls[0];
    expect(claimCall[1].$set.status).toBe("failed");

    // Then refund happened
    const refundMock = await import("@/lib/financialTxLog/atomicCashGuard");
    expect(vi.mocked(refundMock.refundCharacterCash)).toHaveBeenCalledTimes(1);

    // And cooldown was set on the corp
    const cooldownSet = corpUpdateOne.mock.calls.find(
      (c) => c[1]?.$set?.privatizationCooldownUntilTurn !== undefined
    );
    expect(cooldownSet).toBeDefined();
  });

  it("#3450: on pass, pays an index-fund holder and drops its holding (no free absorption)", async () => {
    const ceoId = new ObjectId();
    const voterId = new ObjectId();
    const fundId = new ObjectId();
    const corpId = new ObjectId();
    // A passing vote: the non-CEO character votes yes; a fund also holds a stake.
    const vote = makeVote({
      corporationId: corpId,
      lockedBuyoutPrice: 1.1,
      lockedBuyoutCurrency: "USD",
      votes: [{ characterId: voterId, voteShares: 1_000_000, vote: "yes", castAt: new Date() }],
    });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const corpUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const fundUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const corp = {
      _id: corpId,
      ceoId,
      name: "TestCo",
      sequentialId: 1,
      publicFloat: 0,
      totalShares: 10_000_000,
      shareholders: [
        { characterId: ceoId, shares: 8_000_000 },
        { characterId: voterId, shares: 1_000_000 },
        { fundId, shares: 1_000_000 },
      ],
    };
    const db = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "corporationPrivatizationVotes") return { updateOne };
        if (name === "corporations")
          return { findOne: vi.fn().mockResolvedValue(corp), updateOne: corpUpdateOne };
        if (name === "indexFunds") return { updateOne: fundUpdateOne };
        return { findOne: vi.fn(), updateOne: vi.fn() };
      }),
    } as unknown as Db;

    const result = await resolvePrivatizationVote({
      db,
      vote: vote as never,
      currentTurn: 200,
      forexEnabled: true,
    });

    expect(result.resolved).toBe(true);
    if (result.resolved) expect(result.status).toBe("passed");
    // The fund was actually paid: cashAnchor credited (1,000,000 × 1.1 / rate 1)
    // and its now-absorbed holding pulled — not silently wiped.
    expect(fundUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = fundUpdateOne.mock.calls[0];
    expect(filter._id).toBe(fundId);
    expect(update.$inc.cashAnchor).toBeCloseTo(1_100_000, 0);
    expect(update.$pull.holdings.corporationId).toBe(corpId);
  });
});
