import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/rateLimit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(() => ({ ok: true as const })),
  };
});
vi.mock("@/lib/api/requestLog", () => ({ logRequest: vi.fn() }));
vi.mock("@/lib/policyShift", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/policyShift")>();
  return {
    ...actual,
    applyBillVotePolicyShift: vi.fn().mockResolvedValue(undefined),
  };
});

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("characters");
  db.collection("bills");
  db.collection("electedOfficials");
  db.collection("governmentFormations");
  db.collection("cabinetMembers");
});

async function wireDb() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
}

function makeBasicAuth(userId: string) {
  return { ok: true as const, user: { userId } };
}

describe("POST /api/congress/bills/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    await wireDb();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const billId = new ObjectId().toString();
    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/congress/bills/${billId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote", vote: "for" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: billId }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid bill id", async () => {
    await wireDb();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(
      makeBasicAuth(new ObjectId().toString()) as never
    );

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/congress/bills/not-an-objectid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote", vote: "for" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "not-an-objectid" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid bill ID");
  });

  it("returns 400 when JSON body fails validation", async () => {
    await wireDb();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(
      makeBasicAuth(new ObjectId().toString()) as never
    );

    const billOid = new ObjectId();
    const billId = billOid.toString();
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: "Rep",
    });
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billOid,
      stateId: "CA",
      status: "active",
    });
    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/congress/bills/${billId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: billId }) });
    expect(res.status).toBe(400);
  });

  it("records an origin-chamber vote when member is eligible", async () => {
    await wireDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const billId = new ObjectId();
    const future = new Date(Date.now() + 86_400_000);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      name: "Rep Test",
      party: "1",
      policies: {},
    });
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      stateId: "CA",
      status: "active",
      currentChamber: "house",
      votingEndsAt: future,
      votes: {},
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      provisions: [],
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      characterId: charId,
      officeType: "house",
      seatsHeld: 1,
    });

    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/congress/bills/${billId.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote", vote: "for" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: billId.toString() }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain("Vote recorded");

    expect(db.collectionMocks["bills"]!.updateOne).toHaveBeenCalled();
  });

  it("records a cabinet review vote for an eligible cabinet member", async () => {
    await wireDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const billId = new ObjectId();
    const future = new Date(Date.now() + 86_400_000);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      name: "Cabinet Minister",
      party: "1",
      policies: {},
    });
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      countryId: "JP",
      originChamber: "cabinet",
      currentChamber: "shugiin",
      status: "cabinet_review",
      votingEndsAt: future,
      votes: {},
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      provisions: [],
    });
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      _id: "JP",
      pmCharacterId: new ObjectId(),
    });
    db.collectionMocks["cabinetMembers"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: charId,
      countryId: "JP",
    });

    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/congress/bills/${billId.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote", vote: "for" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: billId.toString() }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks["bills"]!.updateOne).toHaveBeenCalledWith(
      {
        _id: billId,
        status: "cabinet_review",
        [`votes.${charId.toString()}`]: { $exists: false },
      },
      expect.objectContaining({
        $set: expect.objectContaining({ [`votes.${charId.toString()}`]: "for" }),
        $inc: { votesFor: 1 },
      })
    );
  });

  it("rejects abstain votes during cabinet review", async () => {
    await wireDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const billId = new ObjectId();
    const future = new Date(Date.now() + 86_400_000);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      name: "Cabinet Minister",
      party: "1",
      policies: {},
    });
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      countryId: "JP",
      originChamber: "cabinet",
      currentChamber: "shugiin",
      status: "cabinet_review",
      votingEndsAt: future,
      votes: {},
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      provisions: [],
    });

    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/congress/bills/${billId.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote", vote: "abstain" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: billId.toString() }) });

    expect(res.status).toBe(400);
    expect(db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
  });

  it("removes co-sponsorship when the character is a co-sponsor", async () => {
    await wireDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const billId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      name: "Rep Cosponsor",
      party: "1",
      policies: {},
    });
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      stateId: "CA",
      status: "active",
      currentChamber: "house",
      coSponsors: [{ characterId: charId, characterName: "Rep Cosponsor" }],
    });

    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/congress/bills/${billId.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "uncosponsor" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: billId.toString() }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain("co-sponsorship has been removed");

    expect(db.collectionMocks["bills"]!.updateOne).toHaveBeenCalledWith(
      { _id: billId },
      expect.objectContaining({
        $pull: { coSponsors: { characterId: charId } },
      })
    );
  });
});
