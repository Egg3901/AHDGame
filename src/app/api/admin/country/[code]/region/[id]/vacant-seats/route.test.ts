import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

async function callGet(code: string, regionId: string) {
  const { GET } = await import("./route");
  return GET(new Request("http://t/x"), {
    params: Promise.resolve({ code, id: regionId }),
  });
}

describe("GET region vacant-seats — config-driven seat groups", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("electedOfficials");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true } as never);
  });

  it("CN region: governor + NPC delegate + provincial congress groups, NO senate group", async () => {
    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "CN-XB",
      countryId: "CN",
      name: "Xibei",
      houseDistricts: 320,
      stateSenateSeats: 232,
    });
    // One filled NPC delegate (45 seats), nobody else.
    db.collectionMocks.electedOfficials!.find.mockReturnValue(
      cursor([
        {
          _id: "o1",
          state: "CN-XB",
          officeType: "npcDelegate",
          seatsHeld: 45,
          characterId: null,
          nppId: "npp1",
          characterName: "Cai Min",
          party: "NPP",
          isNPP: true,
        },
      ])
    );

    const res = await callGet("cn", "CN-XB");
    expect(res.status).toBe(200);
    const data = await res.json();

    const kinds = data.seatGroups.map((g: { kind: string }) => g.kind);
    expect(kinds).toEqual(["executive", "lowerChamber", "subNationalChamber"]);
    expect(
      data.seatGroups.find((g: { kind: string }) => g.kind === "classedUpper")
    ).toBeUndefined();

    const lower = data.seatGroups.find((g: { kind: string }) => g.kind === "lowerChamber");
    expect(lower).toMatchObject({ officeType: "npcDelegate", total: 320, vacant: 275 }); // 320 - 45
    const sub = data.seatGroups.find((g: { kind: string }) => g.kind === "subNationalChamber");
    expect(sub).toMatchObject({ officeType: "peoplesCongress", total: 232, vacant: 232 });
    const exec = data.seatGroups.find((g: { kind: string }) => g.kind === "executive");
    expect(exec).toMatchObject({ officeType: "governor", vacant: 1 });
  });

  it("RU region: nationalities group totals from the D11 map, not a State field", async () => {
    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "TRA",
      countryId: "RU",
      name: "Transcaucasia",
      houseDistricts: 40,
      stateSenateSeats: 220,
    });
    // 30 Nationalities seats filled by one NPC bloc.
    db.collectionMocks.electedOfficials!.find.mockReturnValue(
      cursor([
        {
          _id: "o1",
          state: "TRA",
          officeType: "nationalitiesDeputy",
          seatsHeld: 30,
          characterId: null,
          nppId: "npp1",
          characterName: "CPSU Bloc",
          party: "su_cpsu",
          isNPP: true,
        },
      ])
    );

    const res = await callGet("ru", "TRA");
    expect(res.status).toBe(200);
    const data = await res.json();

    const kinds = data.seatGroups.map((g: { kind: string }) => g.kind);
    expect(kinds).toEqual(["executive", "upperChamber", "lowerChamber", "subNationalChamber"]);

    const upper = data.seatGroups.find((g: { kind: string }) => g.kind === "upperChamber");
    // TRA gets 108 Nationalities seats from RU_NATIONALITIES_SEATS (not 220 from stateSenateSeats).
    expect(upper).toMatchObject({
      officeType: "nationalitiesDeputy",
      multiSeat: true,
      total: 108,
      vacant: 78,
    });

    const lower = data.seatGroups.find((g: { kind: string }) => g.kind === "lowerChamber");
    expect(lower).toMatchObject({ officeType: "supremeSovietDeputy", total: 40, vacant: 40 });
  });

  it("US region: includes a classed senate group built from SENATE_CLASSES", async () => {
    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      houseDistricts: 52,
      stateSenateSeats: 40,
    });
    db.collectionMocks.electedOfficials!.find.mockReturnValue(cursor([]));

    const res = await callGet("us", "CA");
    const data = await res.json();
    const senate = data.seatGroups.find((g: { kind: string }) => g.kind === "classedUpper");
    expect(senate.officeType).toBe("senate");
    expect(Array.isArray(senate.classes)).toBe(true);
    expect(senate.classes.length).toBeGreaterThan(0);
    // Legacy mirror preserved for the UK tab + older consumers.
    expect(data.houseTotal).toBe(52);
    expect(data.stateSenateTotal).toBe(40);
  });
});
