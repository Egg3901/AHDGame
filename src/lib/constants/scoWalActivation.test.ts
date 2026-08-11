import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getRegisteredCountryIds, activateCountry } from "@/lib/country/registeredCountries";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";

function cursorOf<T>(docs: T[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("SCO/WAL activation lifecycle (SP2a)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("stays invisible while latent (no active row) — registered set == COUNTRY_ORDER", async () => {
    db.collection("countryGameStates").find.mockReturnValue(cursorOf([]));
    const ids = await getRegisteredCountryIds(db as unknown as Db);
    expect(ids).toEqual(COUNTRY_ORDER);
    expect(ids).not.toContain("SCO");
    expect(ids).not.toContain("WAL");
  });

  it("surfaces once activated (active row) — appended after COUNTRY_ORDER, no dupes", async () => {
    db.collection("countryGameStates").find.mockReturnValue(
      cursorOf([{ _id: "SCO", status: "active", enabledForPlayers: true }])
    );
    const ids = await getRegisteredCountryIds(db as unknown as Db);
    expect(ids).toContain("SCO");
    expect(ids.slice(0, COUNTRY_ORDER.length)).toEqual(COUNTRY_ORDER); // base preserved, SCO appended
    expect(ids.filter((x) => x === "SCO")).toHaveLength(1); // no dupes
  });

  it("activateCountry writes the active+enabled row", async () => {
    await activateCountry(db as unknown as Db, "WAL");
    expect(db.collectionMocks.countryGameStates.updateOne).toHaveBeenCalled();
  });
});

describe("SCO/WAL sterlingization", () => {
  it("share the UK's bank id so they group with it once registered", () => {
    // UK has no sharedBankId, so getBankId("UK") === "UK"; SCO/WAL must match it
    // (the SP1 "BOE" placeholder would orphan them onto a non-existent bank).
    expect(getBankId("UK")).toBe("UK");
    expect(getBankId("SCO")).toBe("UK");
    expect(getBankId("WAL")).toBe("UK");
  });
});
