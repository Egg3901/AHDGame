import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const CHAR = new ObjectId();
const auth = {
  ok: true as const,
  user: { isAdmin: false, character: { _id: CHAR, party: "8", countryId: "UK" } },
};

let db: MockDb;

vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: vi.fn(async () => auth),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(async () => db) }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn(async () => 50) }));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://t/api/country/uk/referendum/r1/position", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ code: "uk", refId: "507f1f77bcf86cd799439011" }) };

describe("POST referendum position", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("referendums").findOne.mockResolvedValue({
      _id: "507f1f77bcf86cd799439011",
      status: "campaigning",
      regionId: "NIR",
      partyPositions: [],
    });
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 8,
      countryId: "UK",
      chairId: CHAR,
      viceChairId: null,
    });
    db.collection("statePartyOrg").findOne.mockResolvedValue({
      chairId: CHAR,
      viceChairId: null,
    });
  });

  it("declares a position for an eligible chair", async () => {
    const res = await POST(req({ action: "declare", side: "yes" }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.positions[0].side).toBe("yes");
  });

  it("403s a viewer who is not chair/vice", async () => {
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 8,
      countryId: "UK",
      chairId: new ObjectId(),
      viceChairId: null,
    });
    db.collection("statePartyOrg").findOne.mockResolvedValue({
      chairId: new ObjectId(),
      viceChairId: null,
    });
    const res = await POST(req({ action: "declare", side: "yes" }), ctx);
    expect(res.status).toBe(403);
  });

  it("400s a declare with no side", async () => {
    const res = await POST(req({ action: "declare" }), ctx);
    expect(res.status).toBe(400);
  });
});
