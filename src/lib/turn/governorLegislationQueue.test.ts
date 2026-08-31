import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const mockCanManageOffice = vi.fn();
const mockCancelQueue = vi.fn();

vi.mock("@/lib/governorOffice/access", () => ({
  canManageOffice: (...args: unknown[]) => mockCanManageOffice(...args),
}));
vi.mock("@/lib/governorOffice/legislation/cancelQueue", () => ({
  cancelQueue: (...args: unknown[]) => mockCancelQueue(...args),
}));

const QUEUER = new ObjectId(); // the chair/officer who queued (NOT the seat holder)
const NPP_ID = new ObjectId();

function pendingEntry() {
  return {
    _id: new ObjectId(),
    countryId: "US",
    stateId: "TX",
    governorCharacterId: QUEUER,
    governorName: "Jane Chair",
    targetNppId: NPP_ID,
    targetNppName: "Reform NPP",
    targetPartyId: "3",
    title: "A Bill",
    summary: "Summary",
    proposalActionCost: 1,
    proposalNpiCost: 5,
    queuedAtTurn: 200,
    status: "pending",
  };
}

describe("processGovernorLegislationQueue — NPP-office officer authority", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Pending queue entry due to fire.
    db.collection("governorLegislationQueue").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pendingEntry()]),
    });
    // NPP still eligible.
    db.collection("npps").findOne.mockResolvedValue({
      _id: NPP_ID,
      party: "3",
      retiredAt: null,
      name: "Reform NPP",
    });
    // electedOfficials: the regional executive seat is held by an NPP (so a
    // by-characterId lookup of the QUEUER returns null), but the NPP holds a
    // sub-national seat (nppId lookup returns a seat).
    db.collection("electedOfficials").findOne.mockImplementation((q: Record<string, unknown>) => {
      if (q.nppId) return Promise.resolve({ nppId: NPP_ID, seatsHeld: 1 });
      return Promise.resolve(null);
    });
    // No active bill already in flight for this NPP.
    db.collection("stateBills").findOne.mockResolvedValue(null);
  });

  it("fires an officer-queued bill when the queuer can still manage the NPP-held office", async () => {
    mockCanManageOffice.mockResolvedValue(true);
    const { processGovernorLegislationQueue } = await import("./governorLegislationQueue");
    const result = await processGovernorLegislationQueue(db as unknown as Db, 201);

    expect(result.fired).toBe(1);
    expect(result.cancelled).toBe(0);
    expect(db.collection("stateBills").insertOne).toHaveBeenCalledTimes(1);
    expect(mockCancelQueue).not.toHaveBeenCalled();
    // Authorization was resolved via the shared office-access helper.
    expect(mockCanManageOffice).toHaveBeenCalledWith(expect.anything(), "US", "TX", QUEUER);
  });

  it("cancels (refunds) when the queuer can no longer manage the office", async () => {
    mockCanManageOffice.mockResolvedValue(false);
    const { processGovernorLegislationQueue } = await import("./governorLegislationQueue");
    const result = await processGovernorLegislationQueue(db as unknown as Db, 201);

    expect(result.fired).toBe(0);
    expect(result.cancelled).toBe(1);
    expect(db.collection("stateBills").insertOne).not.toHaveBeenCalled();
    expect(mockCancelQueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "governor_left_office"
    );
  });

  it("cancels (refunds) when queued provisions fail the strict fire-time schema (audit S6)", async () => {
    mockCanManageOffice.mockResolvedValue(true);
    db.collection("governorLegislationQueue").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          ...pendingEntry(),
          provisions: [{ type: "tariff", scopeType: "economy_wide", rate: 50 }],
        },
      ]),
    });
    const { processGovernorLegislationQueue } = await import("./governorLegislationQueue");
    const result = await processGovernorLegislationQueue(db as unknown as Db, 201);

    expect(result.fired).toBe(0);
    expect(result.cancelled).toBe(1);
    expect(db.collection("stateBills").insertOne).not.toHaveBeenCalled();
    expect(mockCancelQueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "invalid_provisions"
    );
  });

  it("still fires when queued provisions are valid sub-national provisions", async () => {
    mockCanManageOffice.mockResolvedValue(true);
    db.collection("governorLegislationQueue").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          ...pendingEntry(),
          provisions: [{ legislationTypeId: "min_wage", effectDirection: 1 }],
        },
      ]),
    });
    const { processGovernorLegislationQueue } = await import("./governorLegislationQueue");
    const result = await processGovernorLegislationQueue(db as unknown as Db, 201);

    expect(result.fired).toBe(1);
    expect(mockCancelQueue).not.toHaveBeenCalled();
  });

  it("freezes the current law on the fired bill's provisions", async () => {
    // Fire time is the queue's analogue of proposal. Without a snapshot here the
    // bill detail page re-reads the live law, so after enactment the current-law
    // box shows the bill's own outcome.
    mockCanManageOffice.mockResolvedValue(true);
    db.collection("governorLegislationQueue").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          ...pendingEntry(),
          provisions: [{ legislationTypeId: "min_wage", policyOptionId: "o2", effectDirection: 1 }],
        },
      ]),
    });
    db.collection("legislationTypes").find.mockReturnValue({
      toArray: async () => [
        {
          _id: "min_wage",
          name: "Minimum Wage",
          policyOptions: [
            { id: "o1", name: "Federal Floor", effectDirection: 1, explanation: "No top-up." },
            { id: "o2", name: "Living Wage", effectDirection: 1, explanation: "Indexed floor." },
          ],
        },
      ],
    });
    db.collection("statePolicies").find.mockReturnValue({
      toArray: async () => [
        { legislationTypeId: "min_wage", policyOptionId: "o1", policyOptionIndex: 0 },
      ],
    });
    db.collection("enactedLaws").find.mockReturnValue({
      sort: () => ({ toArray: async () => [] }),
    });

    const { processGovernorLegislationQueue } = await import("./governorLegislationQueue");
    const result = await processGovernorLegislationQueue(db as unknown as Db, 201);

    expect(result.fired).toBe(1);
    const inserted = db.collection("stateBills").insertOne.mock.calls[0]?.[0] as {
      provisions: Array<Record<string, unknown>>;
    };
    expect(inserted.provisions[0]).toMatchObject({
      currentPolicyOptionIdSnapshot: "o1",
      currentPolicyOptionNameSnapshot: "Federal Floor",
      currentPolicyOptionExplanationSnapshot: "No top-up.",
      policyOptionNameSnapshot: "Living Wage",
      policyOptionExplanationSnapshot: "Indexed floor.",
    });
  });

  it("does not mutate the queue document when snapshotting the fired bill", async () => {
    // The bill takes a copy: a queue entry that fails later must not carry
    // snapshot fields written for a bill that was never inserted.
    mockCanManageOffice.mockResolvedValue(true);
    const entry = {
      ...pendingEntry(),
      provisions: [{ legislationTypeId: "min_wage", policyOptionId: "o2", effectDirection: 1 }],
    };
    db.collection("governorLegislationQueue").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([entry]),
    });
    db.collection("legislationTypes").find.mockReturnValue({
      toArray: async () => [
        {
          _id: "min_wage",
          name: "Minimum Wage",
          policyOptions: [
            { id: "o1", name: "Federal Floor", effectDirection: 1 },
            { id: "o2", name: "Living Wage", effectDirection: 1 },
          ],
        },
      ],
    });
    db.collection("statePolicies").find.mockReturnValue({
      toArray: async () => [
        { legislationTypeId: "min_wage", policyOptionId: "o1", policyOptionIndex: 0 },
      ],
    });
    db.collection("enactedLaws").find.mockReturnValue({
      sort: () => ({ toArray: async () => [] }),
    });

    const { processGovernorLegislationQueue } = await import("./governorLegislationQueue");
    await processGovernorLegislationQueue(db as unknown as Db, 201);

    expect(entry.provisions[0]).not.toHaveProperty("currentPolicyOptionIdSnapshot");
  });
});
