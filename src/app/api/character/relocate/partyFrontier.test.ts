import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn(async () => ({ currentTurn: 10, effectiveNow: new Date() })),
}));
vi.mock("@/lib/character/performRelocation", () => ({
  performRelocation: vi.fn(async () => ({
    relinquishedCommands: [],
    withdrawnGeneralElections: 0,
    withdrawnStatePartyElections: 0,
    withdrawnNationalPartyElections: 0,
    withdrawnCommitteeElections: 0,
  })),
}));
vi.mock("@/lib/corporations/ceoResidency", () => ({
  findActiveResidentCeoCorporation: vi.fn(async () => null),
}));
let db: MockDb;
beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: {
      userId: new ObjectId().toString(),
      isAdmin: false,
      character: { _id: new ObjectId(), countryId: "UK", homeState: "SCO", party: "7" },
    },
  } as never);
  db.collection("states").findOne.mockResolvedValue({
    _id: "LON",
    countryId: "UK",
    name: "London",
  });
  db.collection("states").find.mockReturnValue({
    toArray: async () => ["SCO", "NEE", "LON"].map((_id) => ({ _id })),
  });
  db.collection("characters").distinct.mockResolvedValue(["SCO"]);
});
function request(confirmPartyDeparture = false) {
  return new Request("http://localhost/api/character/relocate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetStateId: "LON",
      targetCountryId: "UK",
      paymentMethod: "cash",
      confirmPartyDeparture,
    }),
  });
}
describe("relocation departure consent", () => {
  it.each(["character", "combined"])(
    "requires party consent for %s moves across countries with identical region IDs",
    async (mode) => {
      const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
      vi.mocked(requireAuthWithCharacter).mockResolvedValue({
        ok: true,
        user: {
          userId: new ObjectId().toString(),
          isAdmin: true,
          character: { _id: new ObjectId(), countryId: "DE", homeState: "HB", party: "7" },
        },
      } as never);
      db.collection("states").findOne.mockResolvedValue({
        _id: "HB",
        countryId: "CN",
        name: "Hubei",
      });
      const { POST } =
        mode === "character"
          ? await import("./route")
          : await import("../relocate-with-corp/route");
      const response = await POST(
        new Request("http://localhost/api/character/relocate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetStateId: "HB",
            targetCountryId: "CN",
            paymentMethod: "cash",
          }),
        })
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ partyDepartureRequired: true });
    }
  );

  it.each(["character", "combined"])(
    "blocks %s relocation before mutations without confirmation",
    async (mode) => {
      const { POST } =
        mode === "character"
          ? await import("./route")
          : await import("../relocate-with-corp/route");
      const response = await POST(request());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ partyDepartureRequired: true });
      const { performRelocation } = await import("@/lib/character/performRelocation");
      expect(performRelocation).not.toHaveBeenCalled();
      for (const collection of Object.values(db.collectionMocks)) {
        expect(collection.updateOne).not.toHaveBeenCalled();
        expect(collection.insertOne).not.toHaveBeenCalled();
        expect(collection.updateMany).not.toHaveBeenCalled();
      }
    }
  );
  it("passes confirmed domestic departure into the relocation pipeline", async () => {
    const { POST } = await import("./route");
    expect((await POST(request(true))).status).toBe(200);
    const { performRelocation } = await import("@/lib/character/performRelocation");
    expect(performRelocation).toHaveBeenCalledWith(db, expect.any(Object), expect.any(Object), {
      leaveParty: true,
    });
  });
  it("does not force departure just because the client sends confirmation", async () => {
    db.collection("characters").distinct.mockResolvedValue(["LON"]);
    const { POST } = await import("./route");
    expect((await POST(request(true))).status).toBe(200);
    const { performRelocation } = await import("@/lib/character/performRelocation");
    expect(performRelocation).toHaveBeenCalledWith(db, expect.any(Object), expect.any(Object), {
      leaveParty: false,
    });
  });
});
