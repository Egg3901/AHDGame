import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getRegisteredCountryIds, activateCountry } from "./registeredCountries";
import { COUNTRY_ORDER } from "@/lib/constants/countries";

function cursorOf<T>(docs: T[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("getRegisteredCountryIds", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("returns exactly COUNTRY_ORDER when no extra country is active", async () => {
    db.collection("countryGameStates").find.mockReturnValue(cursorOf([]));
    expect(await getRegisteredCountryIds(db as unknown as Db)).toEqual(COUNTRY_ORDER);
  });

  it("includes a latent country once its row is active, appended after the base, no dupes", async () => {
    db.collection("countryGameStates").find.mockReturnValue(
      cursorOf([{ _id: "SCO", status: "active" }])
    );
    const ids = await getRegisteredCountryIds(db as unknown as Db);
    expect(ids).toContain("SCO");
    expect(ids.slice(0, COUNTRY_ORDER.length)).toEqual(COUNTRY_ORDER);
    expect(ids.filter((x) => x === "SCO")).toHaveLength(1);
  });

  it("does not double-count an active row that is already in COUNTRY_ORDER", async () => {
    db.collection("countryGameStates").find.mockReturnValue(
      cursorOf([{ _id: "UK", status: "active" }])
    );
    expect(await getRegisteredCountryIds(db as unknown as Db)).toEqual(COUNTRY_ORDER);
  });
});

describe("activateCountry", () => {
  it("upserts an active+enabled row", async () => {
    const db = createMockDb();
    await activateCountry(db as unknown as Db, "SCO");
    const call = db.collectionMocks.countryGameStates.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ _id: "SCO" });
    expect(call[1].$set).toMatchObject({ status: "active", enabledForPlayers: true });
    expect(call[2]).toMatchObject({ upsert: true });
  });
});
