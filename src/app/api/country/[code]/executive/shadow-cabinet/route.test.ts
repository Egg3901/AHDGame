import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/countryState", () => ({ getCountryState: vi.fn() }));
vi.mock("@/lib/parliament/oppositionLeader", () => ({
  resolveOppositionLeaderForCountry: vi.fn(),
}));
vi.mock("@/lib/uk/cabinetEligibility", () => ({ getEligibleCabinetCharacters: vi.fn() }));

function makeRequest(method: "POST" | "DELETE", body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/UK/executive/shadow-cabinet", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ukParams = { params: Promise.resolve({ code: "UK" }) };

describe("shadow-cabinet route", () => {
  let db: MockDb;
  const leaderCharId = new ObjectId();
  const oppositionPartyId = new ObjectId();
  const eligibleCharId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    // Caller resolves (by userId) to the sitting Opposition Leader.
    db.collection("characters").findOne.mockResolvedValue({ _id: leaderCharId });
    db.collection("governmentFormations").findOne.mockResolvedValue({
      _id: "UK",
      pmCharacterId: new ObjectId(),
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), character: { _id: leaderCharId } },
    } as never);

    const { getCountryState } = await import("@/lib/countryState");
    vi.mocked(getCountryState).mockResolvedValue({
      governmentType: "parliamentaryMonarchy",
    } as never);

    const { resolveOppositionLeaderForCountry } = await import("@/lib/parliament/oppositionLeader");
    vi.mocked(resolveOppositionLeaderForCountry).mockResolvedValue({
      chairId: leaderCharId,
      partyDoc: { _id: oppositionPartyId, name: "Labour", sequentialId: 2 },
    } as never);

    const { getEligibleCabinetCharacters } = await import("@/lib/uk/cabinetEligibility");
    vi.mocked(getEligibleCabinetCharacters).mockResolvedValue([
      {
        _id: eligibleCharId.toString(),
        name: "Backbencher",
        partyName: "Labour",
        constituency: "X",
      },
    ] as never);
  });

  it("lets the Opposition Leader appoint a shadow minister and writes to their party", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest("POST", { positionId: "chancellor", characterId: eligibleCharId.toString() }),
      ukParams
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.politicalParties.updateOne).toHaveBeenCalledTimes(1);
    // Written to the opposition party document, keyed by position id.
    const [filter, update] = db.collectionMocks.politicalParties.updateOne.mock.calls[0]!;
    expect(filter).toEqual({ _id: oppositionPartyId });
    const appointment = update.$set["shadowCabinet.chancellor"];
    expect(appointment.characterId.toString()).toBe(eligibleCharId.toString());
    expect(appointment.characterName).toBe("Backbencher");
    expect(appointment.appointedAt).toBeInstanceOf(Date);
  });

  it("rejects a caller who is not the Opposition Leader (403)", async () => {
    const { resolveOppositionLeaderForCountry } = await import("@/lib/parliament/oppositionLeader");
    vi.mocked(resolveOppositionLeaderForCountry).mockResolvedValue({
      chairId: new ObjectId(), // someone else
      partyDoc: { _id: oppositionPartyId, name: "Labour", sequentialId: 2 },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest("POST", { positionId: "chancellor", characterId: eligibleCharId.toString() }),
      ukParams
    );

    expect(res.status).toBe(403);
    expect(db.collectionMocks.politicalParties?.updateOne).toBeUndefined();
  });

  it("rejects an unknown cabinet position (400)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest("POST", {
        positionId: "not_a_real_post",
        characterId: eligibleCharId.toString(),
      }),
      ukParams
    );

    expect(res.status).toBe(400);
    expect(db.collectionMocks.politicalParties?.updateOne).toBeUndefined();
  });

  it("rejects an ineligible appointee (403)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest("POST", { positionId: "chancellor", characterId: new ObjectId().toString() }),
      ukParams
    );

    expect(res.status).toBe(403);
    expect(db.collectionMocks.politicalParties?.updateOne).toBeUndefined();
  });

  it("404s for a non-parliamentary runtime government type", async () => {
    const { getCountryState } = await import("@/lib/countryState");
    vi.mocked(getCountryState).mockResolvedValue({ governmentType: "onePartyState" } as never);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest("POST", { positionId: "chancellor", characterId: eligibleCharId.toString() }),
      ukParams
    );

    expect(res.status).toBe(404);
  });

  it("lets the Opposition Leader clear a shadow post (DELETE unsets the field)", async () => {
    const { resolveOppositionLeaderForCountry } = await import("@/lib/parliament/oppositionLeader");
    vi.mocked(resolveOppositionLeaderForCountry).mockResolvedValue({
      chairId: leaderCharId,
      partyDoc: {
        _id: oppositionPartyId,
        name: "Labour",
        sequentialId: 2,
        shadowCabinet: {
          chancellor: {
            characterId: eligibleCharId,
            characterName: "Backbencher",
            appointedAt: new Date(),
          },
        },
      },
    } as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(makeRequest("DELETE", { positionId: "chancellor" }), ukParams);

    expect(res.status).toBe(200);
    const [, update] = db.collectionMocks.politicalParties.updateOne.mock.calls[0]!;
    expect(update.$unset).toEqual({ "shadowCabinet.chancellor": "" });
  });
});
