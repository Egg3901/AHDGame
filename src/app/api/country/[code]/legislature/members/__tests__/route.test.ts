import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// Import after mock registration
const { getDb } = await import("@/lib/mongodb");

describe("GET /api/country/[code]/legislature/members (UK)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ukParams = {
    params: Promise.resolve({ code: "uk" }),
  };

  function makeDb(officials: object[], parties: object[]) {
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "electedOfficials") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(officials) }),
          };
        }
        if (name === "politicalParties") {
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(parties) }) };
        }
        // `states` (live lower-chamber sizing) projects then toArrays; empty →
        // the helper falls back to the config base (650 for UK). `gameState`
        // (active-preset lookup for era-conditional configs) findOnes; no doc
        // → preset undefined → base (non-era-overridden) config.
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Db);
  }

  it("returns Commons composition and members list", async () => {
    makeDb(
      [
        {
          characterId: "cid1",
          characterName: "Jane Smith",
          party: "1",
          state: "Edinburgh North",
          isNPP: false,
        },
      ],
      [{ _id: "party_id_1", sequentialId: 1, name: "Labour Party", color: "#E4003B" }]
    );

    const { GET } = await import("@/app/api/country/[code]/legislature/members/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/legislature/members"),
      ukParams
    );
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("totalSeats", 650);
    expect(data).toHaveProperty("filledSeats", 1);
    expect(data).toHaveProperty("vacantSeats", 649);
    expect(data.members).toHaveLength(1);
    expect(data.members[0]).toHaveProperty("characterName", "Jane Smith");
    expect(data.members[0]).toHaveProperty("constituency", "Edinburgh North");
    expect(data.members[0]).toHaveProperty("party", "1");
    expect(data.members[0]).toHaveProperty("partyColor", "#E4003B");
    expect(data.members[0]).toHaveProperty("isNPP", false);
    expect(data.composition).toHaveLength(1);
    expect(data.composition[0]).toHaveProperty("partyId", "1");
    expect(data.composition[0]).toHaveProperty("partyName", "Labour Party");
    expect(data.composition[0]).toHaveProperty("seats", 1);
  });

  it("correctly calculates vacant seats", async () => {
    const officials = Array.from({ length: 645 }, (_, i) => ({
      characterId: `cid${i}`,
      characterName: `MP ${i}`,
      party: "uk_labour",
      state: `Seat ${i}`,
      isNPP: false,
    }));
    makeDb(officials, [
      { _id: "party_id_1", sequentialId: 1, name: "Labour Party", color: "#E4003B" },
    ]);

    const { GET } = await import("@/app/api/country/[code]/legislature/members/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/legislature/members"),
      ukParams
    );
    const data = await response.json();
    expect(data.totalSeats).toBe(650);
    expect(data.filledSeats).toBe(645);
    expect(data.vacantSeats).toBe(5);
  });

  it("handles members with no party affiliation", async () => {
    makeDb(
      [
        {
          characterId: "cid1",
          characterName: "Independent MP",
          party: null,
          state: "Test Constituency",
          isNPP: false,
        },
      ],
      []
    );

    const { GET } = await import("@/app/api/country/[code]/legislature/members/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/legislature/members"),
      ukParams
    );
    const data = await response.json();
    expect(data.members[0]).toHaveProperty("party", "independent");
    expect(data.members[0]).toHaveProperty("partyColor", "#888888");
    expect(data.composition[0]).toHaveProperty("partyId", "independent");
  });

  it("correctly identifies NPCs (members without userId)", async () => {
    makeDb(
      [
        {
          nppId: "npp1",
          characterName: "NPC MP",
          party: "uk_conservative",
          state: "Safe Seat",
          isNPP: true,
        },
      ],
      [{ _id: "party_id_2", sequentialId: 2, name: "Conservative Party", color: "#0087DC" }]
    );

    const { GET } = await import("@/app/api/country/[code]/legislature/members/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/legislature/members"),
      ukParams
    );
    const data = await response.json();
    expect(data.members[0]).toHaveProperty("isNPP", true);
  });
});
