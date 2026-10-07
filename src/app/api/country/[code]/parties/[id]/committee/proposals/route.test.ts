import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { POST } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: () => ({ ok: true }) }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: async () => ({ currentTurn: 10 }) }));

let db: ReturnType<typeof createMockDb>;
const chairId = new ObjectId();
const source = { _id: new ObjectId(), sequentialId: 1, countryId: "US", chairId, committeeIds: [] };
const target = { _id: new ObjectId(), sequentialId: 2, countryId: "US" };
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: {
      userId: "test",
      isAdmin: false,
      character: { _id: chairId, countryId: "US", party: "1" },
    },
  } as never);
  vi.mocked(findPartyBySequentialId).mockResolvedValue(source as never);
  db.collection("politicalParties").findOne.mockResolvedValue(target);
  db.collection("states").find.mockReturnValue({
    toArray: async () => [{ _id: "CA" }, { _id: "OR" }, { _id: "WA" }],
  });
  db.collection("committeeProposals").insertOne.mockResolvedValue({ insertedId: new ObjectId() });
});
async function request() {
  return POST(
    new Request("http://localhost/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "merge", targetPartyId: target._id.toString() }),
    }),
    { params: Promise.resolve({ code: "us", id: "1" }) }
  );
}
describe("merger proposal geography", () => {
  it.each([
    ["CA", 200],
    ["OR", 200],
    ["WA", 400],
  ] as const)("target in %s returns %s", async (region, status) => {
    db.collection("characters").find.mockReturnValue({
      toArray: async () => [
        { party: "1", homeState: "CA" },
        { party: "2", homeState: region },
      ],
    });
    const response = await request();
    expect(response.status).toBe(status);
    if (status === 400) {
      expect((await response.json()).error).toContain("adjacent region");
      expect(db.collection("committeeProposals").insertOne).not.toHaveBeenCalled();
    } else expect(db.collection("committeeProposals").insertOne).toHaveBeenCalledOnce();
  });
  it("does not exempt an admin from merger geography", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "admin",
        isAdmin: true,
        character: { _id: chairId, countryId: "US", party: "1" },
      },
    } as never);
    expect((await request()).status).toBe(400);
    expect(db.collection("committeeProposals").insertOne).not.toHaveBeenCalled();
  });
});
