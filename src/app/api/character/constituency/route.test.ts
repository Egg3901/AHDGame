import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
const { GET, POST } = await import("@/app/api/character/constituency/route");

function authAs(character: object) {
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { character },
  } as unknown as Awaited<ReturnType<typeof requireAuthWithCharacter>>);
}

function dbWith(overrides: Record<string, object> = {}) {
  const mockDb = {
    collection: vi.fn((name: string) => overrides[name] ?? {}),
  };
  vi.mocked(getDb).mockResolvedValue(mockDb as never);
  return mockDb;
}

describe("GET /api/character/constituency (issue #2115)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats a stateless Prime Minister as eligible via homeState", async () => {
    authAs({
      _id: new ObjectId(),
      homeState: "LON",
      countryId: "UK",
      currentOffice: { type: "primeMinister" },
    });
    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.eligible).toBe(true);
    expect(data.regionId).toBe("LON");
    expect(data.constituencies.length).toBe(75);
  });

  it("keeps a Commons MP eligible in their region", async () => {
    authAs({
      _id: new ObjectId(),
      homeState: "LON",
      countryId: "UK",
      currentOffice: { type: "commons", state: "LON", seatsHeld: 1 },
    });
    const response = await GET();
    const data = await response.json();
    expect(data.eligible).toBe(true);
    expect(data.regionId).toBe("LON");
  });

  it("stays ineligible without office or region", async () => {
    authAs({ _id: new ObjectId(), countryId: "UK", currentOffice: null });
    const data = await (await GET()).json();
    expect(data.eligible).toBe(false);
  });
});

describe("POST /api/character/constituency (issue #2115)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function post(body: object) {
    return new Request("http://localhost/api/character/constituency", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("lets a stateless Prime Minister claim a home-region seat", async () => {
    const characterId = new ObjectId();
    authAs({
      _id: characterId,
      homeState: "LON",
      countryId: "UK",
      currentOffice: { type: "primeMinister" },
    });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    dbWith({
      electedOfficials: { findOne: vi.fn().mockResolvedValue(null) },
      characters: { updateOne },
    });
    const response = await POST(post({ constituencyId: "E14001073" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.selected).toMatchObject({ id: "E14001073", name: "Barking" });
    expect(data.officeLabel).toContain("Barking");
    const set = updateOne.mock.calls[0][1].$set;
    expect(set["currentOffice.constituencyId"] ?? set.currentOffice?.constituencyId).toBe(
      "E14001073"
    );
  });
});

describe("/api/character/constituency for UK cabinet ministers (ticket #1490)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function post(body: object) {
    return new Request("http://localhost/api/character/constituency", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("shows the picker to a cabinet minister who still holds a Commons seat", async () => {
    const characterId = new ObjectId();
    authAs({
      _id: characterId,
      homeState: "SCO",
      countryId: "UK",
      currentOffice: { type: "ukCabinet", positionId: "home_secretary" },
    });
    const findOne = vi.fn().mockResolvedValue({
      officeType: "commons",
      countryId: "UK",
      state: "LON",
      characterId,
      constituency: "Barking",
      constituencyId: "E14001073",
    });
    dbWith({ electedOfficials: { findOne } });
    const data = await (await GET()).json();
    expect(data.eligible).toBe(true);
    expect(data.officeType).toBe("ukCabinet");
    expect(data.regionId).toBe("LON");
    expect(data.selected).toEqual({ id: "E14001073", name: "Barking" });
    expect(data.constituencies.length).toBe(75);
    expect(findOne.mock.calls[0][0]).toMatchObject({ officeType: "commons", countryId: "UK" });
  });

  it("keeps the picker hidden for a cabinet minister without a Commons seat", async () => {
    authAs({
      _id: new ObjectId(),
      homeState: "LON",
      countryId: "UK",
      currentOffice: { type: "ukCabinet", positionId: "home_secretary" },
    });
    dbWith({ electedOfficials: { findOne: vi.fn().mockResolvedValue(null) } });
    const data = await (await GET()).json();
    expect(data.eligible).toBe(false);
  });

  it("updates the seat and Commons career entry but leaves the cabinet office alone", async () => {
    const characterId = new ObjectId();
    authAs({
      _id: characterId,
      homeState: "LON",
      countryId: "UK",
      currentOffice: { type: "ukCabinet", positionId: "home_secretary" },
    });
    const seat = { officeType: "commons", countryId: "UK", state: "LON", characterId };
    const officialsFindOne = vi
      .fn()
      .mockImplementation((filter: Record<string, unknown>) =>
        Promise.resolve(filter.officeType === "commons" ? seat : null)
      );
    const officialsUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const charactersUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    dbWith({
      electedOfficials: { findOne: officialsFindOne, updateOne: officialsUpdateOne },
      characters: { updateOne: charactersUpdateOne },
    });

    const response = await POST(post({ constituencyId: "E14001073" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.selected).toMatchObject({ id: "E14001073", name: "Barking" });

    expect(officialsUpdateOne).toHaveBeenCalledTimes(1);
    expect(officialsUpdateOne.mock.calls[0][0]).toMatchObject({
      officeType: "commons",
      state: "LON",
      characterId,
    });
    expect(officialsUpdateOne.mock.calls[0][1].$set).toMatchObject({
      constituency: "Barking",
      constituencyId: "E14001073",
    });

    expect(charactersUpdateOne).toHaveBeenCalledTimes(1);
    const [, update, options] = charactersUpdateOne.mock.calls[0];
    expect(update.$set.currentOffice).toBeUndefined();
    expect(update.$set["careerHistory.$[event].office.constituencyId"]).toBe("E14001073");
    expect(options.arrayFilters[0]).toMatchObject({
      "event.type": "elected",
      "event.office.type": "commons",
      "event.office.state": "LON",
    });
  });

  it("rejects a constituency outside the minister's seat region", async () => {
    const characterId = new ObjectId();
    authAs({
      _id: characterId,
      homeState: "LON",
      countryId: "UK",
      currentOffice: { type: "ukCabinet", positionId: "home_secretary" },
    });
    const officialsUpdateOne = vi.fn();
    dbWith({
      electedOfficials: {
        findOne: vi.fn().mockResolvedValue({
          officeType: "commons",
          countryId: "UK",
          state: "SCO",
          characterId,
        }),
        updateOne: officialsUpdateOne,
      },
    });
    const response = await POST(post({ constituencyId: "E14001073" }));
    expect(response.status).toBe(400);
    expect(officialsUpdateOne).not.toHaveBeenCalled();
  });
});
