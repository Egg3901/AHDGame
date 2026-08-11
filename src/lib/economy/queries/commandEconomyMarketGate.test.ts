import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("gameConfig");
  db.collection("gameState");
  db.collection("federalBudget");
});

describe("loadCommandEconomyBlockedCountries", () => {
  it("blocks always-command countries (RU/USSR) with no DB reads at all", async () => {
    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");

    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, ["RU", "DD"]);

    expect(blocked.has("RU")).toBe(true);
    expect(blocked.has("DD")).toBe(true);
    // Structural signal never touches the DB.
    expect(db.collectionMocks.gameConfig.findOne).not.toHaveBeenCalled();
  });

  it("does not block a normal market country (US)", async () => {
    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");

    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, ["US"]);

    expect(blocked.has("US")).toBe(false);
  });

  it("ignores unknown/blank country ids", async () => {
    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");

    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, [
      "",
      null,
      undefined,
      "ZZ",
    ]);

    expect(blocked.size).toBe(0);
  });

  it("does not block a schedule country (CN) when commandEconomyEnabled is off", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ commandEconomyEnabled: false });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 1953 });

    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");
    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, ["CN"]);

    expect(blocked.has("CN")).toBe(false);
  });

  it("blocks CN via the scheduled level when the flag is on and the year is pre-reform", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ commandEconomyEnabled: true });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 1953 });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]), // nothing persisted yet
    });

    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");
    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, ["CN"]);

    expect(blocked.has("CN")).toBe(true);
  });

  it("releases CN once the scheduled level has passed the command ceiling (post-reform)", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ commandEconomyEnabled: true });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 2019 });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");
    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, ["CN"]);

    expect(blocked.has("CN")).toBe(false);
  });

  it("prefers a persisted live marketization level over the era schedule", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ commandEconomyEnabled: true });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 1953 }); // schedule says command
    db.collectionMocks.federalBudget.find.mockReturnValue({
      // A country that has liberalized in-play past the ceiling despite the
      // 1953 schedule saying "command" — the live value should win.
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "CN", economicFactors: { marketizationLevel: 80 } }]),
    });

    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");
    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, ["CN"]);

    expect(blocked.has("CN")).toBe(false);
  });

  it("fails open on a DB error from the dynamic path", async () => {
    db.collectionMocks.gameConfig.findOne.mockRejectedValue(new Error("boom"));

    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");
    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, ["CN"]);

    expect(blocked.has("CN")).toBe(false);
  });

  it("mixes structural and dynamic signals across a candidate list", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ commandEconomyEnabled: true });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 1953 });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");
    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, [
      "US",
      "RU",
      "CN",
    ]);

    expect(blocked.has("US")).toBe(false);
    expect(blocked.has("RU")).toBe(true);
    expect(blocked.has("CN")).toBe(true);
  });
});
