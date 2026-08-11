import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { seedCountryStateFromConfig, seedAllCountryStates } from "@/lib/countryState/seed";
import { COUNTRY_CONFIGS, COUNTRY_ORDER } from "@/lib/constants/countries";

function makeCursor(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("seedCountryStateFromConfig", () => {
  it("copies governmentType from COUNTRY_CONFIGS", () => {
    const state = seedCountryStateFromConfig("CN", new Date("2026-05-28"));
    expect(state.governmentType).toBe(COUNTRY_CONFIGS.CN.governmentType);
  });

  it("copies rulingPartyId from COUNTRY_CONFIGS for one-party states", () => {
    const state = seedCountryStateFromConfig("CN", new Date("2026-05-28"));
    expect(state.rulingPartyId).toBe(COUNTRY_CONFIGS.CN.rulingPartyId);
  });

  it("normalises missing opsVoteMultipliers to null", () => {
    const state = seedCountryStateFromConfig("CN", new Date("2026-05-28"));
    expect(state.opsVoteMultipliers).toEqual(COUNTRY_CONFIGS.CN.opsVoteMultipliers ?? null);
  });

  it("sets hasLeaderConfidenceModel from COUNTRY_CONFIGS for CN", () => {
    const state = seedCountryStateFromConfig("CN", new Date("2026-05-28"));
    expect(state.hasLeaderConfidenceModel).toBe(true);
  });

  it("sets hasLeaderConfidenceModel false for non-one-party countries", () => {
    const state = seedCountryStateFromConfig("US", new Date("2026-05-28"));
    expect(state.hasLeaderConfidenceModel).toBe(false);
  });

  it("uses _id === countryId", () => {
    const state = seedCountryStateFromConfig("CN", new Date("2026-05-28"));
    expect(state._id).toBe("CN");
    expect(state.countryId).toBe("CN");
  });

  it("stamps createdAt and updatedAt from supplied date", () => {
    const at = new Date("2026-05-28T12:00:00Z");
    const state = seedCountryStateFromConfig("CN", at);
    expect(state.createdAt).toEqual(at);
    expect(state.updatedAt).toEqual(at);
  });

  it("seeds socialAxisPosition from the config baseline (P6b)", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(seedCountryStateFromConfig("CN", at).socialAxisPosition).toBe(3.5);
    expect(seedCountryStateFromConfig("US", at).socialAxisPosition).toBe(-1.5);
    expect(seedCountryStateFromConfig("UK", at).socialAxisPosition).toBe(-1.5);
    expect(seedCountryStateFromConfig("IE", at).socialAxisPosition).toBe(-1.5);
    expect(seedCountryStateFromConfig("DE", at).socialAxisPosition).toBe(0);
    expect(seedCountryStateFromConfig("JP", at).socialAxisPosition).toBe(0);
    expect(seedCountryStateFromConfig("BR", at).socialAxisPosition).toBe(0);
  });

  it("FR defaults to Fifth Republic presidential without a preset", () => {
    const state = seedCountryStateFromConfig("FR", new Date("2026-05-28"));
    expect(state.governmentType).toBe("presidential");
  });

  it("FR 1953-default seeds Fourth Republic parliamentaryRepublic", () => {
    const state = seedCountryStateFromConfig("FR", new Date("2026-05-28"), "1953-default");
    expect(state.governmentType).toBe("parliamentaryRepublic");
  });

  it("FR 1979-default stays Fifth Republic presidential", () => {
    const state = seedCountryStateFromConfig("FR", new Date("2026-05-28"), "1979-default");
    expect(state.governmentType).toBe("presidential");
  });

  it("ES defaults to parliamentaryMonarchy without a preset", () => {
    const state = seedCountryStateFromConfig("ES", new Date("2026-05-28"));
    expect(state.governmentType).toBe("parliamentaryMonarchy");
    expect(state.rulingPartyId).toBeNull();
  });

  it("ES 1953-default seeds Franco onePartyState with FET rulingPartyId", () => {
    const state = seedCountryStateFromConfig("ES", new Date("2026-05-28"), "1953-default");
    expect(state.governmentType).toBe("onePartyState");
    expect(state.rulingPartyId).toBe(1);
  });

  it("ES 1979-default stays parliamentaryMonarchy with no ruling party", () => {
    const state = seedCountryStateFromConfig("ES", new Date("2026-05-28"), "1979-default");
    expect(state.governmentType).toBe("parliamentaryMonarchy");
    expect(state.rulingPartyId).toBeNull();
  });
});

describe("seedAllCountryStates", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
    db.collectionMocks.countryState.find.mockReturnValue(makeCursor([]));
  });

  it("inserts one countryState per registered country (COUNTRY_ORDER) on empty DB", async () => {
    // Latent secession countries (SCO/WAL) are in COUNTRY_CONFIGS but absent from
    // COUNTRY_ORDER, so they are NOT seeded — seeding tracks the registered set.
    const result = await seedAllCountryStates(db as unknown as Db);

    expect(result.created).toBe(COUNTRY_ORDER.length);
    expect(result.skipped).toBe(0);
    expect(db.collectionMocks.countryState.insertOne).toHaveBeenCalledTimes(COUNTRY_ORDER.length);
  });

  it("is idempotent — skips countries that already have state", async () => {
    db.collectionMocks.countryState.find.mockReturnValue(
      makeCursor([{ _id: "CN", countryId: "CN", governmentType: "onePartyState" }])
    );

    const result = await seedAllCountryStates(db as unknown as Db);

    expect(result.skipped).toBe(1);
    const insertCalls = db.collectionMocks.countryState.insertOne.mock.calls;
    const cnInsert = insertCalls.find((call: unknown[]) => {
      const doc = call[0] as { _id: string };
      return doc._id === "CN";
    });
    expect(cnInsert).toBeUndefined();
  });
});
