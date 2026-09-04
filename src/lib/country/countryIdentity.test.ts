import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { clearCountryStateCacheForDb } from "@/lib/countryState/cache";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import {
  governmentTypeLabelFor,
  loadCountryPresentationOverrides,
  resolveCountryIdentity,
  resolveCountryIdentities,
} from "./countryIdentity";

/** A countryState row with runtime overrides layered on the seeded shape. */
function stateFor(countryId: "DD" | "DE" | "FR", over: Record<string, unknown> = {}) {
  return { ...seedCountryStateFromConfig(countryId, new Date()), ...over };
}

describe("governmentTypeLabelFor", () => {
  it("keeps the COMPILED label when runtime and compiled agree", () => {
    // The compiled label carries nuance the type cannot -- France is
    // "Semi-Presidential Republic" while its `governmentType` is just
    // `presidential` -- so it must win wherever the two describe the same system.
    const compiled = COUNTRY_CONFIGS.FR.governmentTypeLabel;
    expect(governmentTypeLabelFor("FR", "presidential")).toBe(compiled);
    // Guard the guard: if FR ever compiled to the generic title this test would
    // pass while proving nothing.
    expect(compiled).not.toBe("Presidential Republic");
  });

  it("names the RUNTIME system when the two disagree", () => {
    // The compiled label is now describing a system the country does not have.
    expect(governmentTypeLabelFor("DE", "onePartyState")).toBe("One Party State");
  });
});

describe("resolveCountryIdentity", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("countryState");
    clearCountryStateCacheForDb(db as unknown as Db);
  });

  it("prefers the runtime name and flag over the compiled ones", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValueOnce(
      stateFor("DD", {
        displayNameOverride: "Germany",
        flagEmojiOverride: "🇩🇪",
        governmentType: "onePartyState",
      })
    );

    const identity = await resolveCountryIdentity(db as unknown as Db, "DD");

    // A reunified Germany must not go on introducing itself as one half of itself.
    expect(identity.name).toBe("Germany");
    expect(identity.flagEmoji).toBe("🇩🇪");
    expect(identity.governmentType).toBe("onePartyState");
    expect(identity.governmentTypeLabel).toBe("One Party State");
  });

  it("falls back to the compiled identity for a country nothing has changed", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValueOnce(stateFor("FR"));

    const identity = await resolveCountryIdentity(db as unknown as Db, "FR");

    // Null override means "use the compiled name", which is every country that
    // has not been through a runtime conversion.
    expect(identity.name).toBe("France");
    expect(identity.governmentType).toBe("presidential");
  });

  it("reports the RUNTIME government type after a conversion the config cannot see", async () => {
    // `getCountryConfig` never consults countryState, so the compiled answer for
    // DE is `parliamentaryRepublic` for ever -- which is exactly what rendered a
    // one-party state as a parliamentary republic.
    db.collectionMocks.countryState.findOne.mockResolvedValueOnce(
      stateFor("DE", { governmentType: "onePartyState" })
    );

    const identity = await resolveCountryIdentity(db as unknown as Db, "DE");

    expect(identity.governmentType).toBe("onePartyState");
    expect(identity.governmentTypeLabel).toBe("One Party State");
  });
});

describe("resolveCountryIdentities", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("countryState");
    clearCountryStateCacheForDb(db as unknown as Db);
  });

  it("reads the whole listing in ONE query rather than one per country", async () => {
    const docs = [stateFor("DE"), stateFor("FR"), stateFor("DD")];
    db.collectionMocks.countryState.find.mockReturnValue({
      toArray: () => Promise.resolve(docs),
    });

    const out = await resolveCountryIdentities(db as unknown as Db, ["DE", "FR", "DD"]);

    expect(out.size).toBe(3);
    // `MongoClient.db()` hands back a NEW Db instance per call and the memo is
    // keyed on that instance, so the cache is cold at the top of every request:
    // without priming, a public listing pays one findOne per country, every hit.
    expect(db.collectionMocks.countryState.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.countryState.find.mock.calls[0][0]).toEqual({
      _id: { $in: ["DE", "FR", "DD"] },
    });
    expect(db.collectionMocks.countryState.findOne).not.toHaveBeenCalled();
  });

  it("still resolves a country the prime did not return", async () => {
    // A country with no row is left to `getCountryState`, which self-heals it
    // from seed config one at a time -- the rare path, deliberately not batched.
    db.collectionMocks.countryState.find.mockReturnValue({
      toArray: () => Promise.resolve([stateFor("FR")]),
    });
    db.collectionMocks.countryState.findOne.mockResolvedValue(null);

    const out = await resolveCountryIdentities(db as unknown as Db, ["FR", "DE"]);

    expect(out.get("FR")?.name).toBe("France");
    expect(out.get("DE")).toBeDefined();
  });
});

describe("loadCountryPresentationOverrides", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("countryState");
    clearCountryStateCacheForDb(db as unknown as Db);
  });

  it("returns both overrides in one read, and asks only for rows that have one", async () => {
    db.collectionMocks.countryState.find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          { _id: "DD", displayNameOverride: "Germany", flagEmojiOverride: "DE-FLAG" },
        ]),
    });

    const out = await loadCountryPresentationOverrides(db as unknown as Db);

    expect(out.DD).toEqual({ name: "Germany", flagEmoji: "DE-FLAG" });
    // One query for the whole world, and it must not read through
    // `getCountryState`, which self-heals a missing row by INSERTING it.
    expect(db.collectionMocks.countryState.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.countryState.findOne).not.toHaveBeenCalled();
    const filter = db.collectionMocks.countryState.find.mock.calls[0][0];
    expect(filter.$or).toHaveLength(2);
  });

  it("keeps a country that overrides only one of the two", async () => {
    db.collectionMocks.countryState.find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          { _id: "DD", displayNameOverride: "Germany" },
          { _id: "FR", flagEmojiOverride: "FR-FLAG" },
        ]),
    });

    const out = await loadCountryPresentationOverrides(db as unknown as Db);

    expect(out.DD).toEqual({ name: "Germany" });
    expect(out.FR).toEqual({ flagEmoji: "FR-FLAG" });
  });

  it("treats an empty string or null as no override rather than blanking the country", async () => {
    db.collectionMocks.countryState.find.mockReturnValue({
      toArray: () =>
        Promise.resolve([{ _id: "DD", displayNameOverride: "", flagEmojiOverride: null }]),
    });

    const out = await loadCountryPresentationOverrides(db as unknown as Db);

    expect(out.DD).toBeUndefined();
  });

  it("fails soft, because a country under its compiled name beats a 500", async () => {
    db.collectionMocks.countryState.find.mockImplementation(() => {
      throw new Error("mongo is down");
    });

    await expect(loadCountryPresentationOverrides(db as unknown as Db)).resolves.toEqual({});
  });
});
