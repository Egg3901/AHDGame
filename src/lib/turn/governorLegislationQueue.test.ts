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
});
