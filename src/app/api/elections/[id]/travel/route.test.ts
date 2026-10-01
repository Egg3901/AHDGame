import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  ELECTION_LIMITS: { maxRequests: 30, windowMs: 60000 },
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(),
}));
vi.mock("@/lib/constants/states", () => ({
  getElectoralVoteUnits: vi.fn().mockReturnValue([{ stateId: "PA" }]),
  getTravelActionCost: vi.fn().mockReturnValue(3),
}));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(async (_withSession, fallback) => fallback()),
}));

const characterId = new ObjectId();
const candidateId = new ObjectId();
const electionId = new ObjectId();
const params = { params: Promise.resolve({ id: electionId.toHexString() }) };

function request(key: string) {
  return new Request("http://localhost/api/elections/e1/travel", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ stateId: "PA" }),
  });
}

describe("presidential travel receipt replay", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character: { _id: characterId, actions: 10 } },
    } as never);
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: { _id: electionId, electionType: "president", status: "active" },
    } as never);
    db.collection("gameState").findOne.mockResolvedValue({ preset: undefined });
    db.collection("electionCandidates").findOne.mockResolvedValue({
      _id: candidateId,
      characterId,
      status: "active",
      travelState: "PA",
    });
    db.collection("characters").findOne.mockResolvedValue({ _id: characterId, actions: 0 });
  });

  it("returns the completed same-key result after travel and actions changed", async () => {
    db.collection("nonAtomicMoneyFlowReceipts").findOne.mockResolvedValue({
      _id: "travel-1",
      status: "completed",
      fingerprint: `${characterId.toHexString()}:${candidateId.toHexString()}:travel:PA:3`,
    });
    const { POST } = await import("./route");
    const response = await POST(request("travel-1"), params);
    expect(response.status).toBe(200);
    expect((await response.json()).duplicate).toBe(true);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
    expect(db.collection("electionCandidates").updateOne).not.toHaveBeenCalled();
  });

  it("rejects a key reused for a different destination", async () => {
    db.collection("nonAtomicMoneyFlowReceipts").findOne.mockResolvedValue({
      _id: "travel-1",
      status: "completed",
      fingerprint: `${characterId.toHexString()}:${candidateId.toHexString()}:travel:OH:3`,
    });
    const { POST } = await import("./route");
    const response = await POST(request("travel-1"), params);
    expect(response.status).toBe(500);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });
});
