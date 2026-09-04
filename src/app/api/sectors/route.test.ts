import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

function makeRequest(query: string) {
  return new Request(`http://localhost/api/sectors?${query}`);
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetCorpFxRateCacheForTests();
  db = createMockDb();
  db.collection("states");
  db.collection("exchangeRates");
  db.collection("unownedSectors");
  db.collection("corporateSectors");
  db.collection("corporations");
  db.collection("gameConfig");
  db.collection("gameState");
  db.collection("federalBudget");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  db.collectionMocks.states.find.mockReturnValue({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([
      { _id: "CA", name: "California", countryId: "US" },
      { _id: "UKR", name: "Ukraine", countryId: "RU" },
    ]),
  });
});

describe("GET /api/sectors country identity (ticket #1271)", () => {
  beforeEach(() => {
    // A reunified Germany keeps the DD country id and renames itself; the
    // absorbed DE shell keeps its config entry but holds no territory.
    db.collection("countryState");
    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", name: "California", countryId: "US" },
        { _id: "NW", name: "Nordrhein-Westfalen", countryId: "DD" },
        { _id: "MOS", name: "Moscow", countryId: "RU" },
      ]),
    });
    db.collectionMocks.countryState.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        // A settlement writes BOTH when it renames the survivor.
        { _id: "DD", displayNameOverride: "Germany", flagEmojiOverride: "🇩🇪" },
      ]),
    });
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.unownedSectors.countDocuments.mockResolvedValue(0);
    db.collectionMocks.corporateSectors.countDocuments.mockResolvedValue(0);
  });

  it("labels the country filter with the name the country now goes by", async () => {
    const { GET } = await import("./route");
    const data = await (await GET(makeRequest("view=unowned"))).json();

    const dd = (data.filters.countries as { value: string; label: string }[]).find(
      (c) => c.value === "DD"
    );
    expect(dd?.label).toBe("Germany");
  });

  it("applies the flag override alongside the name, not one without the other", async () => {
    // Half-correcting this is how a reunified Germany ends up reading "Germany"
    // under the flag of the state it replaced.
    const { GET } = await import("./route");
    const data = await (await GET(makeRequest("view=unowned"))).json();

    const dd = (data.filters.countries as { value: string; flag: string }[]).find(
      (c) => c.value === "DD"
    );
    expect(dd?.flag).toBe("🇩🇪");
  });

  it("names a country by its era name where no runtime override exists", async () => {
    // A 1953 world calls RU the Soviet Union. Reading the compiled config alone
    // listed it as "Russia" while every other surface disagreed.
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
    });

    const { GET } = await import("./route");
    const data = await (await GET(makeRequest("view=unowned"))).json();

    const ru = (data.filters.countries as { value: string; label: string }[]).find(
      (c) => c.value === "RU"
    );
    expect(ru?.label).toBe("Soviet Union");
  });

  it("drops a dissolved country that holds no territory from the filter list", async () => {
    const { GET } = await import("./route");
    const data = await (await GET(makeRequest("view=unowned"))).json();

    const values = (data.filters.countries as { value: string }[]).map((c) => c.value);
    expect(values).toContain("DD");
    expect(values).toContain("US");
    // DE is still a compiled country, but reunification left it with no states,
    // so offering it as a filter could only ever return an empty list.
    expect(values).not.toContain("DE");
  });

  it("filters on the same country it labels rows with", async () => {
    // Labelling a row from its state while filtering on its stored `countryId`
    // means a row whose stored value went stale is shown under one country and
    // findable under another, or under none at all once the filter list is
    // narrowed to countries that hold territory. The filter is expressed as the
    // country's STATES so the two can never disagree.
    const { GET } = await import("./route");
    await GET(makeRequest("view=owned&country=DD"));

    const corpFilter = db.collectionMocks.corporateSectors.find.mock.calls[0][0];
    // The country's own states, plus a leg for a row whose state no longer
    // exists: those are still LABELLED from their stored country, so they have
    // to be findable under it rather than shown under a name whose filter can
    // never return them.
    expect(corpFilter.$or[0]).toEqual({ stateId: { $in: ["NW"] } });
    expect(corpFilter.$or[1]).toMatchObject({ countryId: "DD" });
    expect(corpFilter).not.toHaveProperty("countryId");
    // ...and the badge is counted on exactly the same basis as the list.
    expect(db.collectionMocks.corporateSectors.countDocuments).toHaveBeenCalledWith(corpFilter);
  });

  it("keeps a row whose state no longer exists findable under the name it shows", async () => {
    // `mergeRegion` re-points sector rows before deleting a region, so this is
    // debris rather than normal state, and the pool heal deliberately leaves it
    // for a human. It is still labelled from its stored country, so the filter
    // has to be able to return it: visible unfiltered and gone the moment you
    // filter by the country it names would be the worst of both.
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          sectorType: "media",
          stateId: "GONE",
          countryId: "US",
          revenue: 1000,
        },
      ]),
    });

    const { GET } = await import("./route");
    const data = await (await GET(makeRequest("view=unowned&country=US"))).json();

    const filter = db.collectionMocks.unownedSectors.find.mock.calls[0][0];
    expect(filter.$or[1]).toMatchObject({ countryId: "US" });
    // Labelled from the stored country, because nothing else is left to use.
    expect(data.sectors[0]).toMatchObject({ stateId: "GONE", countryId: "US" });
  });

  it("labels sector rows with the override too, not the compiled name", async () => {
    // The owned view, which is where the ticket's screenshot showed every
    // German plant filed under "East Germany".
    const soeId = new ObjectId();
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ currencyCode: "USD", rate: 1 }]),
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          corporationId: soeId,
          stateId: "NW",
          countryId: "DD",
          sectorType: "extraction",
          revenue: 1000,
        },
      ]),
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: soeId,
          name: "German Extraction Enterprise",
          sequentialId: 900316,
          countryId: "DD",
          liquidCurrencyCode: "USD",
        },
      ]),
    });

    const { GET } = await import("./route");
    const data = await (await GET(makeRequest("view=owned"))).json();

    expect(data.sectors).toHaveLength(1);
    expect(data.sectors[0]).toMatchObject({ countryId: "DD", countryName: "Germany" });
  });
});

describe("GET /api/sectors (view=unowned)", () => {
  it("excludes unowned markets in command-economy countries (RU/USSR) from the row list", async () => {
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          sectorType: "energy",
          stateId: "CA",
          countryId: "US",
          revenue: 1000,
        },
        {
          _id: new ObjectId(),
          sectorType: "energy",
          stateId: "UKR",
          countryId: "RU",
          revenue: 5000,
        },
      ]),
    });
    db.collectionMocks.unownedSectors.countDocuments.mockResolvedValue(1);
    db.collectionMocks.corporateSectors.countDocuments.mockResolvedValue(0);

    const { GET } = await import("./route");
    const response = await GET(makeRequest("view=unowned"));
    const data = await response.json();

    expect(response.status).toBe(200);
    const stateIds = (data.sectors as { stateId: string }[]).map((s) => s.stateId);
    expect(stateIds).toContain("CA");
    expect(stateIds).not.toContain("UKR");

    // The badge count query itself must also exclude command-economy countries
    // (not just the row list), so it can't silently overcount. Expressed as the
    // command economies' STATES, so the count agrees with the rows and the
    // filter about which country a sector is in (ticket #1271).
    expect(db.collectionMocks.unownedSectors.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        stateId: expect.objectContaining({
          $nin: expect.arrayContaining(["UKR"]),
        }),
      })
    );
  });

  it("forces a zero-result count filter when the explicit country filter is itself command-economy", async () => {
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.unownedSectors.countDocuments.mockResolvedValue(0);
    db.collectionMocks.corporateSectors.countDocuments.mockResolvedValue(0);

    const { GET } = await import("./route");
    const response = await GET(makeRequest("view=unowned&country=RU"));

    expect(response.status).toBe(200);
    expect(db.collectionMocks.unownedSectors.countDocuments).toHaveBeenCalledWith({
      stateId: { $in: [] },
    });
    // ...and the ROW query is the same one, so the list cannot show a stateless
    // row stamped with that country while the badge reads zero.
    expect(db.collectionMocks.unownedSectors.find.mock.calls[0][0]).toMatchObject({
      stateId: { $in: [] },
    });
  });
});

describe("GET /api/sectors (view=owned)", () => {
  it("ranks and labels a foreign sector by its host market currency (ticket #1161)", async () => {
    const foreignOwnerId = new ObjectId();
    const domesticOwnerId = new ObjectId();

    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        { _id: "JP-13", name: "Tokyo", countryId: "JP" },
        { _id: "US-CA", name: "California", countryId: "US" },
      ]),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        { currencyCode: "JPY", rate: 91 },
        { currencyCode: "USD", rate: 1 },
      ]),
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          corporationId: foreignOwnerId,
          stateId: "JP-13",
          countryId: "JP",
          sectorType: "defense",
          revenue: 9_100_000,
        },
        {
          _id: new ObjectId(),
          corporationId: domesticOwnerId,
          stateId: "US-CA",
          countryId: "US",
          sectorType: "defense",
          revenue: 500_000,
        },
      ]),
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: foreignOwnerId,
          name: "Foreign Holdings",
          sequentialId: 1,
          countryId: "US",
          liquidCurrencyCode: "USD",
        },
        {
          _id: domesticOwnerId,
          name: "Real Giant",
          sequentialId: 2,
          countryId: "US",
          liquidCurrencyCode: "USD",
        },
      ]),
    });

    const { GET } = await import("./route");
    const response = await GET(makeRequest("view=owned&type=defense&sort=revenue&dir=desc"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sectors).toHaveLength(2);
    expect(data.sectors[0]).toMatchObject({
      corporationName: "Real Giant",
      countryId: "US",
      countryName: "United States",
      revenueAnchor: 500_000,
    });
    expect(data.sectors[1]).toMatchObject({
      corporationName: "Foreign Holdings",
      stateName: "Tokyo",
      countryId: "JP",
      countryName: "Japan",
      revenueAnchor: 100_000,
    });
  });
});
