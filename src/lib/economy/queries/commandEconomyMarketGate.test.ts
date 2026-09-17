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
  it("blocks always-command countries (RU/USSR) via the dial", async () => {
    // CONTRACT CHANGE (2026-09-15): this used to assert "with no DB reads at
    // all", because RU was blocked by the static
    // `disallowPrivateCorporationFounding` config flag before any lookup. That
    // flag was redundant with MARKETIZATION_SCHEDULE and diverged from it four
    // ways (BLR/BAL/UKR and CN were scheduled but unflagged; the flag also
    // claimed RU could never marketize despite its schedule ending in 1991), so
    // it was retired. The dial is now the only authority and it costs two reads.
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 1970 });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");

    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, ["RU", "DD"]);

    expect(blocked.has("RU")).toBe(true);
    expect(blocked.has("DD")).toBe(true);
  });

  it("blocks the union republics, which the retired config flag never covered", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 1970 });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");

    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, [
      "BLR",
      "BAL",
      "UKR",
    ]);

    expect(blocked.has("BLR")).toBe(true);
    expect(blocked.has("BAL")).toBe(true);
    expect(blocked.has("UKR")).toBe(true);
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

  it("still blocks CN when commandEconomyEnabled is off", async () => {
    // CONTRACT CHANGE (2026-09-15): previously the dial was gated behind
    // `commandEconomyEnabled` so flag-off worlds were byte-identical. That flag
    // governs the planned-economy SIMULATION subsystems (forex, administered
    // CPI, monobank); whether a country is a planned economy is world data. With
    // it honoured, switching the flag off re-opened Soviet and Chinese markets to
    // private expansion, which is the defect class this gate exists to prevent.
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ commandEconomyEnabled: false });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 1953 });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { loadCommandEconomyBlockedCountries } = await import("./commandEconomyMarketGate");
    const blocked = await loadCommandEconomyBlockedCountries(db as unknown as Db, ["CN"]);

    expect(blocked.has("CN")).toBe(true);
  });

  it("RELEASES CN once the scheduled year crosses the reform era", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 1985 });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

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
