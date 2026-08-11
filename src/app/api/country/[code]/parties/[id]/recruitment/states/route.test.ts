import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));

const chairId = new ObjectId();
const stateChairId = new ObjectId();
const baseParty = {
  _id: new ObjectId(),
  sequentialId: 9,
  countryId: "US",
  chairId,
  viceChairId: null,
  treasurerId: new ObjectId(),
  name: "Reform",
  treasury: 5_000_000,
  politicalStrength: 50,
};

async function setupMocks(db: MockDb) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: {
      userId: new ObjectId().toString(),
      isAdmin: false,
      character: { _id: chairId },
    },
  } as never);
  const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
  vi.mocked(findPartyBySequentialId).mockResolvedValue(baseParty as never);
}

describe("GET /api/country/[code]/parties/[id]/recruitment/states", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    await setupMocks(db);
  });

  it("returns every state — including ones with active state leadership — so national chairs can recruit anywhere", async () => {
    const states = [
      { _id: "CA", name: "California" },
      { _id: "TX", name: "Texas" },
    ];
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(states),
    } as never);
    db.collection("statePartyOrg").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { stateId: "CA", partyId: "9", organization: 80, chairId: stateChairId },
        { stateId: "TX", partyId: "9", organization: 25 },
      ]),
    } as never);
    db.collection("npps").aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "TX", count: 1 }]),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "us", id: "9" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.states).toHaveLength(2);
    const ca = body.states.find((s: { stateId: string }) => s.stateId === "CA");
    expect(ca).toMatchObject({
      stateId: "CA",
      hasStateLeadership: true,
      // Slot cap and resource gate still apply, but the leadership flag does not
      // by itself disable recruitment.
      canRecruit: true,
    });
    const tx = body.states.find((s: { stateId: string }) => s.stateId === "TX");
    expect(tx).toMatchObject({ stateId: "TX", hasStateLeadership: false });
  });

  it("still respects the per-state slot cap", async () => {
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "CA", name: "California" }]),
    } as never);
    db.collection("statePartyOrg").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        // Org of 0 → only 2 slots per calculateRecruitmentSlots.
        { stateId: "CA", partyId: "9", organization: 0, chairId: stateChairId },
      ]),
    } as never);
    db.collection("npps").aggregate.mockReturnValue({
      // Two NPPs already in the state — cap reached.
      toArray: vi.fn().mockResolvedValue([{ _id: "CA", count: 2 }]),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "us", id: "9" }),
    });
    const body = await response.json();

    const ca = body.states[0];
    expect(ca).toMatchObject({
      stateId: "CA",
      hasStateLeadership: true,
      availableSlots: 0,
      canRecruit: false,
    });
  });
});
