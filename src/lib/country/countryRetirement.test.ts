import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import { COUNTRY_ORDER } from "@/lib/constants/countries";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

/**
 * Retiring a country is the capability the registry never had: `registeredBase`
 * and `getRegisteredCountryIds` both return `[...COUNTRY_ORDER, ...activated]`,
 * so a country compiled into the static base could be hidden from players but
 * never taken out of the engine. These hold both chokepoints to the new
 * contract.
 */
describe("country retirement", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("keeps every base country registered when none is dissolved", async () => {
    prime(db, "countryGameStates").find.mockReturnValue(cursor([]));
    const { getRegisteredCountryIds } = await import("./registeredCountries");
    const ids = await getRegisteredCountryIds(db as unknown as Db);
    expect(ids).toEqual(COUNTRY_ORDER);
  });

  it("removes a dissolved country from the registry even though it is in the static base", async () => {
    expect(COUNTRY_ORDER).toContain("DD");
    prime(db, "countryGameStates").find.mockReturnValue(
      cursor([{ _id: "DD", dissolvedTurn: 412 }])
    );
    const { getRegisteredCountryIds } = await import("./registeredCountries");
    const ids = await getRegisteredCountryIds(db as unknown as Db);
    expect(ids).not.toContain("DD");
    expect(ids).toContain("DE");
  });

  it("does not treat an activated-but-live extra as dissolved", async () => {
    prime(db, "countryGameStates").find.mockReturnValue(
      cursor([{ _id: "SCO", status: "active", dissolvedTurn: null }])
    );
    const { getRegisteredCountryIds } = await import("./registeredCountries");
    const ids = await getRegisteredCountryIds(db as unknown as Db);
    expect(ids).toContain("SCO");
  });

  it("retires an activated extra too, not only base countries", async () => {
    prime(db, "countryGameStates").find.mockReturnValue(
      cursor([{ _id: "SCO", status: "active", dissolvedTurn: 500 }])
    );
    const { getRegisteredCountryIds } = await import("./registeredCountries");
    const ids = await getRegisteredCountryIds(db as unknown as Db);
    expect(ids).not.toContain("SCO");
  });

  it("stops simulating a dissolved country", async () => {
    // The engine list is the one that matters most: an emptied country left in
    // it runs elections over no regions and budgets over no states.
    prime(db, "countryGameStates").find.mockReturnValue(
      cursor([{ _id: "DD", status: "active", enabledForPlayers: true, dissolvedTurn: 412 }])
    );
    const { getSimulatedCountryIds } = await import("@/lib/countryAccess");
    const ids = await getSimulatedCountryIds(db as unknown as Db);
    expect(ids).not.toContain("DD");
  });

  it("stops offering a dissolved country to players", async () => {
    prime(db, "countryGameStates").find.mockReturnValue(
      cursor([{ _id: "DD", status: "active", enabledForPlayers: true, dissolvedTurn: 412 }])
    );
    const { getEnabledCountryIdsFromDb } = await import("@/lib/countryAccess");
    const ids = await getEnabledCountryIdsFromDb(db as unknown as Db);
    expect(ids).not.toContain("DD");
  });

  it("hides a dissolved country from the economy list as well", async () => {
    prime(db, "countryGameStates").find.mockReturnValue(
      cursor([
        {
          _id: "DD",
          status: "active",
          enabledForPlayers: true,
          economyPreview: true,
          dissolvedTurn: 412,
        },
      ])
    );
    const { getEconomyVisibleCountryIds } = await import("@/lib/countryAccess");
    const ids = await getEconomyVisibleCountryIds();
    expect(ids).not.toContain("DD");
  });

  it("leaves a country with an explicit null dissolvedTurn alone", async () => {
    prime(db, "countryGameStates").find.mockReturnValue(
      cursor([{ _id: "DD", status: "active", enabledForPlayers: true, dissolvedTurn: null }])
    );
    const { getSimulatedCountryIds } = await import("@/lib/countryAccess");
    const ids = await getSimulatedCountryIds(db as unknown as Db);
    expect(ids).toContain("DD");
  });
});
