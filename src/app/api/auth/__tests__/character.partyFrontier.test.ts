import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock("@/lib/countryAccess", () => ({
  getCountryAccess: vi.fn(async () => ({ enabledForPlayers: true })),
}));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn(async () => ({ currentTurn: 1, effectiveNow: new Date() })),
}));
vi.mock("@/lib/stats/featureFlag", () => ({ isRpgStatsEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/onboarding/featureFlag", () => ({
  isOnboardingChecklistEnabled: vi.fn(async () => false),
}));
vi.mock("@/lib/mail/systemMail", () => ({ sendSystemMail: vi.fn() }));
vi.mock("@/lib/analytics/characterActivation", () => ({ rememberCharacterActivation: vi.fn() }));

let db: MockDb;
const userId = new ObjectId();
function request(party = "7") {
  return new Request("http://localhost/api/auth/character", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Synthetic Resident",
      countryId: "US",
      homeState: "WA",
      party,
      policies: { economic: 0, social: 0 },
      demographics: { race: "white", gender: "male", education: "college", wealth: "middle" },
    }),
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toString() },
  } as never);
  db.collection("users").findOne.mockResolvedValue({ _id: userId, isAdmin: false });
  db.collection("states").findOne.mockResolvedValue({
    _id: "WA",
    countryId: "US",
    name: "Washington",
  });
  db.collection("states").find.mockReturnValue({
    toArray: async () => ["WA", "OR", "NY", "CA"].map((_id) => ({ _id })),
  });
  db.collection("gameConfig").findOne.mockResolvedValue({
    startingFunds: 50000,
    startingActions: 3,
    startingPoliticalInfluence: 0,
    startingFavorability: 50,
    startingInfamy: 0,
    startingDonorBaseLevel: 1,
  });
  db.collection("politicalParties").findOne.mockResolvedValue({
    sequentialId: 7,
    countryId: "US",
    name: "Synthetic Party",
  });
  db.collection("characters").distinct.mockResolvedValue(["NY"]);
  db.collection("counters").findOneAndUpdate.mockResolvedValue({ seq: 1 });
});

describe("starting party frontier", () => {
  it("rejects remote starting membership before any character or counter write", async () => {
    const { POST } = await import("../character/route");
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not established/);
    expect(db.collection("characters").insertOne).not.toHaveBeenCalled();
    expect(db.collection("users").updateOne).not.toHaveBeenCalled();
    expect(db.collection("counters").findOneAndUpdate).not.toHaveBeenCalled();
  });
  it.each(["WA", "OR"])("allows same-region or adjacent presence in %s", async (region) => {
    db.collection("characters").distinct.mockResolvedValue([region]);
    const { POST } = await import("../character/route");
    expect((await POST(request())).status).toBe(201);
    expect(db.collection("characters").insertOne.mock.calls[0][0].party).toBe("7");
  });
  it("does not allow two-hop expansion", async () => {
    db.collection("characters").distinct.mockResolvedValue(["CA"]);
    const { POST } = await import("../character/route");
    expect((await POST(request())).status).toBe(403);
  });
  it("allows an empty party to be re-anchored", async () => {
    db.collection("characters").distinct.mockResolvedValue([]);
    const { POST } = await import("../character/route");
    expect((await POST(request())).status).toBe(201);
  });
  it("counts NPP presence as well as members", async () => {
    db.collection("npps").distinct.mockResolvedValue(["OR"]);
    const { POST } = await import("../character/route");
    expect((await POST(request())).status).toBe(201);
  });
  it("leaves Independent creation unrestricted", async () => {
    const { POST } = await import("../character/route");
    expect((await POST(request("independent"))).status).toBe(201);
    expect(db.collection("politicalParties").findOne).not.toHaveBeenCalled();
  });
  it("preserves the admin frontier bypass", async () => {
    db.collection("users").findOne.mockResolvedValue({ _id: userId, isAdmin: true });
    const { POST } = await import("../character/route");
    expect((await POST(request())).status).toBe(201);
    expect(db.collection("characters").distinct).not.toHaveBeenCalled();
  });
  it("requires a real country-scoped party", async () => {
    db.collection("politicalParties").findOne.mockResolvedValue(null);
    const { POST } = await import("../character/route");
    expect((await POST(request())).status).toBe(400);
    expect(db.collection("politicalParties").findOne).toHaveBeenCalledWith({
      countryId: "US",
      sequentialId: 7,
    });
  });
  it.each(["7junk", "007", "missing"])("rejects malformed party %s", async (party) => {
    const { POST } = await import("../character/route");
    expect((await POST(request(party))).status).toBe(400);
    expect(db.collection("characters").insertOne).not.toHaveBeenCalled();
  });
  it.each([
    { isDefunct: true, status: 400 },
    { membershipMode: "approval", status: 403 },
  ])("rejects unavailable or approval-only parties: %o", async ({ status, ...fields }) => {
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 7,
      countryId: "US",
      name: "Synthetic Party",
      ...fields,
    });
    const { POST } = await import("../character/route");
    expect((await POST(request())).status).toBe(status);
    expect(db.collection("characters").insertOne).not.toHaveBeenCalled();
  });
});
