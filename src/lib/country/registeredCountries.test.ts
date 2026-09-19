import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  getRegisteredCountryIds,
  getDissolvedCountryIds,
  activateCountry,
} from "./registeredCountries";
import { COUNTRY_ORDER } from "@/lib/constants/countries";

function cursorOf<T>(docs: T[]) {
  // `project` returns the cursor so the chained form in getDissolvedCountryIds
  // works against the same helper as the unprojected reads.
  const cursor: { toArray: ReturnType<typeof vi.fn>; project: ReturnType<typeof vi.fn> } = {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn(() => cursor),
  };
  return cursor;
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

  /**
   * ⚠️ ERA ABSENCE MUST NARROW THIS LIST, NOT ONLY THE ACCESS LAYER.
   *
   * `countryAccess` answers `registered: false` for an `absentInEra` row, on
   * purpose and identically to a dissolved one. This function is what per-turn
   * processing iterates, and it filtered only `dissolvedTurn` -- so East Germany
   * in a 2019 world was absent from every page and still simulated by every
   * phase.
   */
  it("drops a country flagged absentInEra", async () => {
    db.collection("countryGameStates").find.mockReturnValue(
      cursorOf([{ _id: "DD", status: "beta", absentInEra: true }])
    );
    const ids = await getRegisteredCountryIds(db as unknown as Db);
    expect(ids).not.toContain("DD");
    expect(ids).toEqual(COUNTRY_ORDER.filter((id) => id !== "DD"));
  });

  it("keeps a country whose absentInEra was cleared by a later reset", async () => {
    db.collection("countryGameStates").find.mockReturnValue(
      cursorOf([{ _id: "DD", status: "beta", absentInEra: false }])
    );
    expect(await getRegisteredCountryIds(db as unknown as Db)).toEqual(COUNTRY_ORDER);
  });

  it("does not activate an extra country that is absent from this era", async () => {
    db.collection("countryGameStates").find.mockReturnValue(
      cursorOf([{ _id: "SCO", status: "active", absentInEra: true }])
    );
    expect(await getRegisteredCountryIds(db as unknown as Db)).not.toContain("SCO");
  });

  /**
   * The two causes stay distinct in the DATA even though they give the same
   * registry answer -- merge idempotency depends on "absorbed" not meaning
   * "absent", so the dissolved loader must not start matching this flag.
   */
  it("keeps era absence out of the dissolved set", async () => {
    db.collection("countryGameStates").find.mockReturnValue(
      cursorOf([{ _id: "DD", absentInEra: true }])
    );
    expect(await getDissolvedCountryIds(db as unknown as Db)).toEqual(new Set());
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
