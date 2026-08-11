import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("./blocs", () => ({
  computeBlocsForCountry: vi.fn(),
}));

describe("chamber composition majority party", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electedOfficials");
  });

  it("tracks the House majority party as the largest party, not the dominant party in the largest bloc", async () => {
    const { computeBlocsForCountry } = await import("./blocs");
    const partyMap = new Map([
      ["MAJ", { name: "Majority Coalition", color: "#111111" }],
      ["ALLY", { name: "Ally Party", color: "#222222" }],
      ["OPP", { name: "Opposition Party", color: "#333333" }],
    ]);

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: new ObjectId(), officeType: "house", party: "MAJ", seatsHeld: 40 },
        { _id: new ObjectId(), officeType: "house", party: "ALLY", seatsHeld: 10 },
        { _id: new ObjectId(), officeType: "house", party: "OPP", seatsHeld: 45 },
      ]),
    });

    vi.mocked(computeBlocsForCountry).mockResolvedValue({
      blocs: [],
      majorityBloc: {
        kind: "coalition",
        id: "unity",
        displayName: "Unity Coalition",
        displayColor: "#111111",
        partySlugs: new Set(["MAJ", "ALLY"]),
        seats: 50,
        dominantPartySlug: "MAJ",
        dominantPartySeats: 40,
      },
      minorityBloc: {
        kind: "party",
        id: "OPP",
        displayName: "Opposition Party",
        displayColor: "#333333",
        partySlugs: new Set(["OPP"]),
        seats: 45,
        dominantPartySlug: "OPP",
        dominantPartySeats: 45,
      },
    } as never);

    const { getHouseComposition } = await import("./houseComposition");
    const composition = await getHouseComposition(db as unknown as Db, partyMap as never);

    expect(composition.majorityBloc?.dominantPartySlug).toBe("MAJ");
    expect(composition.majorityParty).toBe("OPP");
  });

  it("tracks the Senate majority party as the largest party, not the dominant party in the largest bloc", async () => {
    const { computeBlocsForCountry } = await import("./blocs");
    const partyMap = new Map([
      ["MAJ", { name: "Majority Coalition", color: "#111111" }],
      ["ALLY", { name: "Ally Party", color: "#222222" }],
      ["OPP", { name: "Opposition Party", color: "#333333" }],
    ]);

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        ...Array.from({ length: 40 }, () => ({
          _id: new ObjectId(),
          officeType: "senate",
          party: "MAJ",
        })),
        ...Array.from({ length: 10 }, () => ({
          _id: new ObjectId(),
          officeType: "senate",
          party: "ALLY",
        })),
        ...Array.from({ length: 45 }, () => ({
          _id: new ObjectId(),
          officeType: "senate",
          party: "OPP",
        })),
      ]),
    });

    vi.mocked(computeBlocsForCountry).mockResolvedValue({
      blocs: [],
      majorityBloc: {
        kind: "coalition",
        id: "unity",
        displayName: "Unity Coalition",
        displayColor: "#111111",
        partySlugs: new Set(["MAJ", "ALLY"]),
        seats: 50,
        dominantPartySlug: "MAJ",
        dominantPartySeats: 40,
      },
      minorityBloc: {
        kind: "party",
        id: "OPP",
        displayName: "Opposition Party",
        displayColor: "#333333",
        partySlugs: new Set(["OPP"]),
        seats: 45,
        dominantPartySlug: "OPP",
        dominantPartySeats: 45,
      },
    } as never);

    const { getSenateComposition } = await import("./senateComposition");
    const composition = await getSenateComposition(db as unknown as Db, partyMap as never);

    expect(composition.majorityBloc?.dominantPartySlug).toBe("MAJ");
    expect(composition.majorityParty).toBe("OPP");
  });
});
