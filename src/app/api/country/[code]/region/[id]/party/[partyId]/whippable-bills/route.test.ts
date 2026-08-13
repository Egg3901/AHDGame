import { beforeEach, describe, expect, it, vi } from "vitest";
import { Db, ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));

vi.mock("@/lib/db/partyLookup", () => ({
  findPartyBySequentialId: vi.fn(),
  getPartyIdString: vi.fn(),
  getStatePartyOrgDocumentId: vi.fn(),
}));

describe("GET /api/country/[code]/region/[id]/party/[partyId]/whippable-bills", () => {
  let db: MockDb;
  const chairId = new ObjectId("507f1f77bcf86cd799439011");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();

    db.collection("bills");
    db.collection("stateBills");
    db.collection("billWhips");
    db.collection("electedOfficials");
    db.collection("statePartyOrg");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        isAdmin: false,
        character: {
          _id: chairId,
        },
      },
    } as never);

    const { findPartyBySequentialId, getPartyIdString, getStatePartyOrgDocumentId } =
      await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: "us-dem",
      sequentialId: 1,
      countryId: "US",
      chairId: null,
      viceChairId: null,
      name: "Democrats",
    } as never);
    vi.mocked(getPartyIdString).mockReturnValue("1");
    vi.mocked(getStatePartyOrgDocumentId).mockReturnValue("AZ:1");

    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "AZ:1",
      chairId,
      viceChairId: null,
    });
  });

  it("returns federal delegation bills and local chamber bills for state NPP whips", async () => {
    const federalBillId = new ObjectId("507f1f77bcf86cd799439021");
    const localBillId = new ObjectId("507f1f77bcf86cd799439022");

    db.collectionMocks["bills"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: federalBillId,
          title: "Federal Housing Reform",
          status: "active",
          currentChamber: "house",
          votingEndsAt: new Date("2026-05-01T00:00:00.000Z"),
          countryId: "US",
        },
      ]),
    } as never);

    db.collectionMocks["stateBills"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: localBillId,
          title: "Arizona Budget Act",
          status: "active",
          stateId: "AZ",
          votingEndsAt: new Date("2026-05-01T00:00:00.000Z"),
        },
      ]),
    } as never);

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ officeType: "house" }, { officeType: "stateSenate" }]),
      }),
    } as never);

    db.collectionMocks["billWhips"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          targetId: federalBillId,
          chamber: "house",
          direction: "for",
          attemptNumber: 1,
          mode: "soft",
          issuedByCharacterId: chairId,
        },
        {
          targetId: localBillId,
          chamber: "stateSenate",
          direction: "against",
          attemptNumber: 1,
          mode: "hard",
          issuedByCharacterId: chairId,
        },
      ]),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/us/region/AZ/party/1/whippable-bills"),
      {
        params: Promise.resolve({ code: "us", id: "AZ", partyId: "1" }),
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<
      string,
      Array<{
        bill: { id: string; title: string };
        existingWhips: Array<{ direction: string; mode: string }>;
        canWhip: boolean;
      }>
    >;

    expect(body.house).toHaveLength(1);
    expect(body.house?.[0]?.bill.title).toBe("Federal Housing Reform");
    expect(body.house?.[0]?.existingWhips).toEqual([
      expect.objectContaining({ direction: "for", mode: "soft", issuedByRole: "Chair" }),
    ]);

    expect(body.stateSenate).toHaveLength(1);
    expect(body.stateSenate?.[0]?.bill.title).toBe("Arizona Budget Act");
    expect(body.stateSenate?.[0]?.existingWhips).toEqual([
      expect.objectContaining({ direction: "against", mode: "hard", issuedByRole: "Chair" }),
    ]);
  });
});
