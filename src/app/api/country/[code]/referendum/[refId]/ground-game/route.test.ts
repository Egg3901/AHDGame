import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const CHAR = new ObjectId();
let authUser: { isAdmin: boolean; character: { _id: ObjectId; party: string; countryId: string } };

let db: MockDb;

vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: vi.fn(async () => ({ ok: true, user: authUser })),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(async () => db) }));

const ggMock = vi.fn();
vi.mock("@/lib/referendum/groundGame", () => ({
  spendGroundGame: (...a: unknown[]) => ggMock(...a),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://t/api/country/uk/referendum/r1/ground-game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ code: "uk", refId: "507f1f77bcf86cd799439011" }) };
const goodBody = { side: "yes", presetId: "mass_rally", target: "whole", mode: "official" };

describe("POST referendum ground-game", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    authUser = { isAdmin: false, character: { _id: CHAR, party: "8", countryId: "UK" } };
    db.collection("referendums").findOne.mockResolvedValue({
      _id: "507f1f77bcf86cd799439011",
      countryId: "UK",
      regionId: "NIR",
      status: "campaigning",
    });
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 8,
      countryId: "UK",
      chairId: CHAR,
      viceChairId: null,
    });
    db.collection("statePartyOrg").findOne.mockResolvedValue({ chairId: CHAR, viceChairId: null });
    ggMock.mockResolvedValue({ status: 200, body: { yesShare: 55 } });
  });

  it("official: 200 for an eligible party officer", async () => {
    const res = await POST(req(goodBody), ctx);
    expect(res.status).toBe(200);
    expect(ggMock).toHaveBeenCalledOnce();
  });

  it("volunteer: 200 for a same-nation player (no party role needed)", async () => {
    db.collection("politicalParties").findOne.mockResolvedValue(null);
    const res = await POST(req({ ...goodBody, mode: "volunteer" }), ctx);
    expect(res.status).toBe(200);
  });

  it("403 for a foreign character (nation gate)", async () => {
    authUser = { isAdmin: false, character: { _id: CHAR, party: "8", countryId: "IE" } };
    const res = await POST(req({ ...goodBody, mode: "volunteer" }), ctx);
    expect(res.status).toBe(403);
    expect(ggMock).not.toHaveBeenCalled();
  });

  it("403 for an official who is not chair/vice", async () => {
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
    const res = await POST(req(goodBody), ctx);
    expect(res.status).toBe(403);
    expect(ggMock).not.toHaveBeenCalled();
  });

  it("400 for a bad body (missing presetId)", async () => {
    const res = await POST(req({ side: "yes", target: "whole", mode: "official" }), ctx);
    expect(res.status).toBe(400);
  });
});
